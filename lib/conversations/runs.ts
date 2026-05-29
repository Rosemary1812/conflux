import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getAdapter } from "@/lib/adapters/registry";
import type { AdapterAttachment, AdapterMessage, AgentEvent } from "@/lib/adapters/types";
import { getDb } from "@/lib/db/client";
import { agentExternalSessions, agentRuns, agents, artifacts, conversations, messages } from "@/lib/db/schema";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import type { AgentSummary } from "@/lib/agents/types";
import { cancelPendingRunInteractions, createInteraction } from "@/lib/interactions/service";
import { waitForInteractionResponse } from "@/lib/interactions/run-bridge";
import type { PendingAgentInteraction } from "@/lib/interactions/types";

const activeRuns = new Map<string, AbortController>();
const maxSnapshotFiles = 2500;
const ignoredArtifactDirs = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  "data"
]);

type StartRunParams = {
  conversationId: string;
  agent: AgentSummary;
  workspacePath: string;
  attachments?: AdapterAttachment[];
};

export function startAgentRun({ conversationId, agent, workspacePath, attachments = [] }: StartRunParams) {
  const now = Date.now();
  const runId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const controller = new AbortController();
  const db = getDb();

  db.insert(agentRuns)
    .values({
      id: runId,
      conversationId,
      agentId: agent.id,
      status: "running",
      startedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .run();

  db.insert(messages)
    .values({
      id: assistantMessageId,
      conversationId,
      role: "assistant",
      authorName: agent.name,
      agentId: agent.id,
      content: "",
      status: "running",
      createdAt: now + 1
    })
    .run();

  db.update(conversations)
    .set({ status: "running", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();

  activeRuns.set(runId, controller);
  publishConversationEvent(conversationId, { type: "run_status", runId, status: "running" });

  void drainAgentRun({
    runId,
    conversationId,
    messageId: assistantMessageId,
    agent,
    workspacePath,
    attachments,
    signal: controller.signal
  });

  return { runId, assistantMessageId };
}

export function stopConversationRun(conversationId: string) {
  const db = getDb();
  const run = db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.conversationId, conversationId))
    .orderBy(agentRuns.createdAt)
    .all()
    .reverse()
    .find((item) => item.status === "running" || item.status === "pending" || item.status === "awaiting_interaction");

  if (!run) {
    return null;
  }

  activeRuns.get(run.id)?.abort();
  markRunCancelled(conversationId, run.id);
  return run.id;
}

async function drainAgentRun({
  runId,
  conversationId,
  messageId,
  agent,
  workspacePath,
  attachments,
  signal
}: {
  runId: string;
  conversationId: string;
  messageId: string;
  agent: AgentSummary;
  workspacePath: string;
  attachments: AdapterAttachment[];
  signal: AbortSignal;
}) {
  let content = "";
  const adapter = getAdapter(agent.platform);
  const beforeSnapshot = snapshotWorkspace(workspacePath);

  try {
    const externalSession = getExternalSession(conversationId, agent.id, agent.platform);

    for await (const event of adapter.run({
      runId,
      conversationId,
      workspacePath,
      messages: getAdapterMessages(conversationId),
      attachments,
      externalSessionId: externalSession?.externalSessionId,
      signal,
      requestInteraction(interaction) {
        return requestRunInteraction({
          interaction,
          conversationId,
          runId,
          messageId,
          agentId: agent.id,
          signal
        });
      },
      saveExternalSessionId(sessionId, capabilities) {
        saveExternalSession({
          conversationId,
          agentId: agent.id,
          platform: agent.platform,
          externalSessionId: sessionId,
          capabilities
        });
      }
    })) {
      content = await handleAgentEvent({
        event,
        content,
        conversationId,
        messageId,
        runId,
        workspacePath,
        beforeSnapshot,
        signal
      });
    }
  } catch (error) {
    if (signal.aborted) {
      markRunCancelled(conversationId, runId, messageId);
      return;
    }

    markRunErrored({
      conversationId,
      runId,
      messageId,
      error: error instanceof Error ? error.message : "运行失败。"
    });
  } finally {
    activeRuns.delete(runId);
  }
}

function getExternalSession(conversationId: string, agentId: string, platform: string) {
  return getDb()
    .select()
    .from(agentExternalSessions)
    .where(
      and(
        eq(agentExternalSessions.conversationId, conversationId),
        eq(agentExternalSessions.agentId, agentId),
        eq(agentExternalSessions.platform, platform)
      )
    )
    .get();
}

function saveExternalSession({
  conversationId,
  agentId,
  platform,
  externalSessionId,
  capabilities
}: {
  conversationId: string;
  agentId: string;
  platform: string;
  externalSessionId: string;
  capabilities?: Record<string, unknown>;
}) {
  const now = Date.now();

  getDb()
    .insert(agentExternalSessions)
    .values({
      id: crypto.randomUUID(),
      conversationId,
      agentId,
      platform,
      externalSessionId,
      capabilitiesJson: capabilities ? JSON.stringify(capabilities) : null,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [
        agentExternalSessions.conversationId,
        agentExternalSessions.agentId,
        agentExternalSessions.platform
      ],
      set: {
        externalSessionId,
        capabilitiesJson: capabilities ? JSON.stringify(capabilities) : null,
        updatedAt: now
      }
    })
    .run();
}

async function handleAgentEvent({
  event,
  content,
  conversationId,
  messageId,
  runId,
  workspacePath,
  beforeSnapshot,
  signal
}: {
  event: AgentEvent;
  content: string;
  conversationId: string;
  messageId: string;
  runId: string;
  workspacePath: string;
  beforeSnapshot: WorkspaceSnapshot;
  signal: AbortSignal;
}) {
  if (event.type === "text_delta") {
    const nextContent = `${content}${event.delta}`;
    getDb().update(messages).set({ content: nextContent }).where(eq(messages.id, messageId)).run();
    publishConversationEvent(conversationId, {
      type: "message_delta",
      messageId,
      delta: event.delta
    });
    return nextContent;
  }

  if (event.type === "message_done") {
    recordWorkspaceArtifacts({ conversationId, messageId, runId, workspacePath, beforeSnapshot });
    markRunDone(conversationId, runId, messageId);
  }

  if (event.type === "message_cancelled") {
    markRunCancelled(conversationId, runId, messageId);
  }

  if (event.type === "message_error") {
    markRunErrored({ conversationId, runId, messageId, error: event.error });
  }

  if (event.type === "artifact_created") {
    if (event.artifact.path && hasArtifactForRunPath(runId, event.artifact.path)) {
      return content;
    }

    const now = Date.now();
    getDb()
      .insert(artifacts)
      .values({
        id: crypto.randomUUID(),
        conversationId,
        messageId,
        runId,
        type: event.artifact.type,
        title: event.artifact.title,
        description: event.artifact.description ?? "",
        path: event.artifact.path,
        metadata: event.artifact.metadata ? JSON.stringify(event.artifact.metadata) : null,
        createdAt: now
      })
      .run();
  }

  if (event.type === "interaction_required") {
    await requestRunInteraction({
      interaction: {
        kind: event.interaction.kind,
        messageId: event.interaction.messageId,
        payload: event.interaction.payload,
        conversationAgentId: event.interaction.conversationAgentId,
        orchestratorTaskId: event.interaction.orchestratorTaskId
      },
      conversationId,
      runId,
      messageId,
      agentId: event.interaction.agentId,
      signal
    });
  }

  return content;
}

async function requestRunInteraction({
  interaction,
  conversationId,
  runId,
  messageId,
  agentId,
  signal
}: {
  interaction: Omit<PendingAgentInteraction, "conversationId" | "runId" | "agentId">;
  conversationId: string;
  runId: string;
  messageId: string;
  agentId: string;
  signal: AbortSignal;
}) {
  const created = createInteraction({
    ...interaction,
    conversationId,
    runId,
    messageId: interaction.messageId || messageId,
    agentId
  });

  return waitForInteractionResponse(created, signal);
}

function hasArtifactForRunPath(runId: string, artifactPath: string) {
  return Boolean(
    getDb()
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(and(eq(artifacts.path, artifactPath), eq(artifacts.runId, runId)))
      .get()
  );
}

type FileFingerprint = {
  mtimeMs: number;
  size: number;
};

type WorkspaceSnapshot = Map<string, FileFingerprint>;

function snapshotWorkspace(workspacePath: string): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = new Map();

  if (!fs.existsSync(workspacePath)) {
    return snapshot;
  }

  walkWorkspace(workspacePath, workspacePath, snapshot);
  return snapshot;
}

function walkWorkspace(root: string, current: string, snapshot: WorkspaceSnapshot) {
  if (snapshot.size >= maxSnapshotFiles) {
    return;
  }

  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (snapshot.size >= maxSnapshotFiles) {
      return;
    }

    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (entry.isDirectory()) {
      if (!ignoredArtifactDirs.has(entry.name)) {
        walkWorkspace(root, absolutePath, snapshot);
      }
      continue;
    }

    if (!entry.isFile() || isIgnoredArtifactPath(relativePath)) {
      continue;
    }

    try {
      const stat = fs.statSync(absolutePath);
      snapshot.set(relativePath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
    } catch {
      continue;
    }
  }
}

function isIgnoredArtifactPath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");

  return (
    normalized.startsWith("data/attachments/") ||
    normalized.endsWith(".db") ||
    normalized.endsWith(".sqlite") ||
    normalized.endsWith(".sqlite3") ||
    normalized.endsWith(".log")
  );
}

function recordWorkspaceArtifacts({
  conversationId,
  messageId,
  runId,
  workspacePath,
  beforeSnapshot
}: {
  conversationId: string;
  messageId: string;
  runId: string;
  workspacePath: string;
  beforeSnapshot: WorkspaceSnapshot;
}) {
  const afterSnapshot = snapshotWorkspace(workspacePath);
  const changedPaths = [...afterSnapshot.entries()]
    .filter(([relativePath, after]) => {
      const before = beforeSnapshot.get(relativePath);
      return !before || before.mtimeMs !== after.mtimeMs || before.size !== after.size;
    })
    .map(([relativePath]) => relativePath)
    .slice(0, 20);

  if (changedPaths.length === 0) {
    return;
  }

  const now = Date.now();
  const db = getDb();

  for (const [index, relativePath] of changedPaths.entries()) {
    const absolutePath = path.join(workspacePath, relativePath);
    const existing = db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(and(eq(artifacts.path, absolutePath), eq(artifacts.runId, runId)))
      .get();

    if (existing) {
      continue;
    }

    db.insert(artifacts)
      .values({
        id: crypto.randomUUID(),
        conversationId,
        messageId,
        runId,
        type: artifactTypeForPath(relativePath),
        title: path.basename(relativePath),
        description: relativePath,
        path: absolutePath,
        metadata: JSON.stringify({ source: "workspace_diff", relativePath }),
        createdAt: now + index
      })
      .run();
  }
}

function artifactTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(extension)) {
    return "image";
  }

  if ([".md", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".py", ".go", ".rs"].includes(extension)) {
    return "code";
  }

  return "file";
}

function getAdapterMessages(conversationId: string): AdapterMessage[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .all()
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function markRunDone(conversationId: string, runId: string, messageId: string) {
  if (!isRunActive(runId)) {
    return;
  }

  const now = Date.now();
  cancelPendingRunInteractions(runId);
  getDb().update(messages).set({ status: "done" }).where(eq(messages.id, messageId)).run();
  getDb()
    .update(agentRuns)
    .set({ status: "done", finishedAt: now, updatedAt: now })
    .where(eq(agentRuns.id, runId))
    .run();
  getDb()
    .update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();
  publishConversationEvent(conversationId, { type: "message_status", messageId, status: "done" });
  publishConversationEvent(conversationId, { type: "run_status", runId, status: "done" });
}

function markRunErrored({
  conversationId,
  runId,
  messageId,
  error
}: {
  conversationId: string;
  runId: string;
  messageId: string;
  error: string;
}) {
  if (!isRunActive(runId)) {
    return;
  }

  const now = Date.now();
  cancelPendingRunInteractions(runId);
  const currentMessage = getDb().select().from(messages).where(eq(messages.id, messageId)).get();
  getDb()
    .update(messages)
    .set({
      status: "error",
      content: currentMessage?.content ? currentMessage.content : `运行失败：${error}`
    })
    .where(eq(messages.id, messageId))
    .run();
  getDb()
    .update(agentRuns)
    .set({ status: "error", error, finishedAt: now, updatedAt: now })
    .where(eq(agentRuns.id, runId))
    .run();
  getDb()
    .update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();
  publishConversationEvent(conversationId, { type: "message_status", messageId, status: "error", error });
  publishConversationEvent(conversationId, { type: "run_status", runId, status: "error", error });
}

function markRunCancelled(conversationId: string, runId: string, messageId?: string) {
  if (!isRunActive(runId)) {
    return;
  }

  const now = Date.now();
  const db = getDb();
  cancelPendingRunInteractions(runId);
  const assistantMessageId =
    messageId ??
    db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(agents, eq(messages.agentId, agents.id))
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)
      .all()
      .reverse()
      .find((message) => message.id)?.id;

  if (assistantMessageId) {
    db.update(messages).set({ status: "cancelled" }).where(eq(messages.id, assistantMessageId)).run();
    publishConversationEvent(conversationId, {
      type: "message_status",
      messageId: assistantMessageId,
      status: "cancelled"
    });
  }

  db.update(agentRuns)
    .set({ status: "cancelled", finishedAt: now, updatedAt: now })
    .where(eq(agentRuns.id, runId))
    .run();
  db.update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();
  publishConversationEvent(conversationId, { type: "run_status", runId, status: "cancelled" });
}

function isRunActive(runId: string) {
  const run = getDb().select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId)).get();
  return run?.status === "running" || run?.status === "pending" || run?.status === "awaiting_interaction";
}

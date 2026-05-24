import { eq } from "drizzle-orm";
import { getAdapter } from "@/lib/adapters/registry";
import type { AdapterMessage, AgentEvent } from "@/lib/adapters/types";
import { getDb } from "@/lib/db/client";
import { agentRuns, agents, conversations, messages } from "@/lib/db/schema";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import type { AgentSummary } from "@/lib/agents/types";

const activeRuns = new Map<string, AbortController>();

type StartRunParams = {
  conversationId: string;
  agent: AgentSummary;
};

export function startAgentRun({ conversationId, agent }: StartRunParams) {
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
    .find((item) => item.status === "running" || item.status === "pending");

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
  signal
}: {
  runId: string;
  conversationId: string;
  messageId: string;
  agent: AgentSummary;
  signal: AbortSignal;
}) {
  let content = "";
  const adapter = getAdapter(agent.platform);

  try {
    for await (const event of adapter.run({
      runId,
      conversationId,
      workspacePath: process.cwd(),
      messages: getAdapterMessages(conversationId),
      attachments: [],
      signal
    })) {
      content = handleAgentEvent({ event, content, conversationId, messageId, runId });
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

function handleAgentEvent({
  event,
  content,
  conversationId,
  messageId,
  runId
}: {
  event: AgentEvent;
  content: string;
  conversationId: string;
  messageId: string;
  runId: string;
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
    markRunDone(conversationId, runId, messageId);
  }

  if (event.type === "message_cancelled") {
    markRunCancelled(conversationId, runId, messageId);
  }

  if (event.type === "message_error") {
    markRunErrored({ conversationId, runId, messageId, error: event.error });
  }

  return content;
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
  return run?.status === "running" || run?.status === "pending";
}

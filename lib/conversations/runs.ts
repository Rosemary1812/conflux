import { eq } from "drizzle-orm";
import { runFakeAdapter } from "@/lib/adapters/fake";
import { getDb } from "@/lib/db/client";
import { agentRuns, agents, conversations, messages } from "@/lib/db/schema";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import type { AgentSummary } from "@/lib/agents/types";

const activeRuns = new Map<string, AbortController>();

type StartRunParams = {
  conversationId: string;
  agent: AgentSummary;
  userContent: string;
};

export function startFakeAgentRun({ conversationId, agent, userContent }: StartRunParams) {
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

  void drainFakeRun({
    runId,
    conversationId,
    messageId: assistantMessageId,
    shouldFail: shouldTriggerFakeError(userContent),
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

async function drainFakeRun({
  runId,
  conversationId,
  messageId,
  shouldFail,
  signal
}: {
  runId: string;
  conversationId: string;
  messageId: string;
  shouldFail: boolean;
  signal: AbortSignal;
}) {
  let content = "";

  try {
    for await (const event of runFakeAdapter({ shouldFail, signal })) {
      if (event.type === "text_delta") {
        content += event.delta;
        getDb().update(messages).set({ content }).where(eq(messages.id, messageId)).run();
        publishConversationEvent(conversationId, {
          type: "message_delta",
          messageId,
          delta: event.delta
        });
      }

      if (event.type === "message_done") {
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
    }
  } catch (error) {
    if (signal.aborted) {
      markRunCancelled(conversationId, runId, messageId);
      return;
    }

    const message = error instanceof Error ? error.message : "运行失败。";
    const now = Date.now();
    getDb().update(messages).set({ status: "error" }).where(eq(messages.id, messageId)).run();
    getDb()
      .update(agentRuns)
      .set({ status: "error", error: message, finishedAt: now, updatedAt: now })
      .where(eq(agentRuns.id, runId))
      .run();
    getDb()
      .update(conversations)
      .set({ status: "done", updatedAt: now })
      .where(eq(conversations.id, conversationId))
      .run();
    publishConversationEvent(conversationId, { type: "message_status", messageId, status: "error", error: message });
    publishConversationEvent(conversationId, { type: "run_status", runId, status: "error", error: message });
  } finally {
    activeRuns.delete(runId);
  }
}

function shouldTriggerFakeError(content: string) {
  return /(^|\s)\/fake-error(\s|$)|模拟错误|触发错误/i.test(content);
}

function markRunCancelled(conversationId: string, runId: string, messageId?: string) {
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

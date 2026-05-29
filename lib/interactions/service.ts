import { and, asc, eq } from "drizzle-orm";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import { getDb } from "@/lib/db/client";
import { agentInteractions, agentRuns, conversations, messages } from "@/lib/db/schema";
import { hasInteractionWaiter, resumeInteraction } from "@/lib/interactions/run-bridge";
import type {
  AgentInteraction,
  InteractionDecision,
  InteractionKind,
  InteractionStatus,
  PendingAgentInteraction
} from "@/lib/interactions/types";

type InteractionRow = typeof agentInteractions.$inferSelect;

export class InteractionError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function createInteraction(input: PendingAgentInteraction): AgentInteraction {
  const now = Date.now();
  const row = {
    id: crypto.randomUUID(),
    kind: input.kind,
    status: "pending",
    conversationId: input.conversationId,
    runId: input.runId,
    messageId: input.messageId,
    agentId: input.agentId,
    conversationAgentId: input.conversationAgentId ?? null,
    orchestratorTaskId: input.orchestratorTaskId ?? null,
    payloadJson: JSON.stringify(input.payload),
    responseJson: null,
    createdAt: now,
    resolvedAt: null
  } satisfies InteractionRow;

  const db = getDb();
  db.insert(agentInteractions).values(row).run();
  db.update(agentRuns)
    .set({ status: "awaiting_interaction", updatedAt: now })
    .where(eq(agentRuns.id, input.runId))
    .run();

  const interaction = toAgentInteraction(row);
  publishConversationEvent(input.conversationId, { type: "run_status", runId: input.runId, status: "awaiting_interaction" });
  publishConversationEvent(input.conversationId, { type: "interaction_requested", interaction });
  return interaction;
}

export function resolveInteraction(interactionId: string, decision: InteractionDecision): AgentInteraction {
  const db = getDb();
  const current = db.select().from(agentInteractions).where(eq(agentInteractions.id, interactionId)).get();

  if (!current) {
    throw new InteractionError("交互请求不存在。", 404);
  }

  if (current.status !== "pending") {
    throw new InteractionError("交互请求已经处理。", 409);
  }

  if (current.kind !== decision.kind) {
    throw new InteractionError("回应类型与交互类型不一致。", 400);
  }

  const nextStatus = statusFromDecision(decision);
  const now = Date.now();

  if (!hasInteractionWaiter(interactionId)) {
    expireUnresumableInteraction(current, now);
    throw new InteractionError("原运行进程已不可恢复，请重新发送这条消息。", 409);
  }

  db.update(agentInteractions)
    .set({
      status: nextStatus,
      responseJson: JSON.stringify(decision),
      resolvedAt: now
    })
    .where(eq(agentInteractions.id, interactionId))
    .run();
  db.update(agentRuns)
    .set({ status: "running", updatedAt: now })
    .where(eq(agentRuns.id, current.runId))
    .run();
  db.update(conversations)
    .set({ status: "running", updatedAt: now })
    .where(eq(conversations.id, current.conversationId))
    .run();

  const resolved = toAgentInteraction({
    ...current,
    status: nextStatus,
    responseJson: JSON.stringify(decision),
    resolvedAt: now
  });

  publishConversationEvent(current.conversationId, {
    type: "interaction_resolved",
    interactionId,
    status: nextStatus,
    response: decision
  });
  publishConversationEvent(current.conversationId, { type: "run_status", runId: current.runId, status: "running" });
  if (!resumeInteraction(interactionId, decision)) {
    expireUnresumableInteraction(current, Date.now());
    throw new InteractionError("原运行进程已不可恢复，请重新发送这条消息。", 409);
  }
  return resolved;
}

export function listConversationInteractions(conversationId: string, status?: InteractionStatus) {
  const conditions = status
    ? and(eq(agentInteractions.conversationId, conversationId), eq(agentInteractions.status, status))
    : eq(agentInteractions.conversationId, conversationId);

  return getDb()
    .select()
    .from(agentInteractions)
    .where(conditions)
    .orderBy(asc(agentInteractions.createdAt))
    .all()
    .map(toAgentInteraction);
}

export function cancelPendingRunInteractions(runId: string) {
  const db = getDb();
  const rows = db
    .select()
    .from(agentInteractions)
    .where(and(eq(agentInteractions.runId, runId), eq(agentInteractions.status, "pending")))
    .all();

  if (rows.length === 0) {
    return;
  }

  const now = Date.now();

  for (const row of rows) {
    db.update(agentInteractions)
      .set({ status: "cancelled", resolvedAt: now })
      .where(eq(agentInteractions.id, row.id))
      .run();
    publishConversationEvent(row.conversationId, {
      type: "interaction_resolved",
      interactionId: row.id,
      status: "cancelled"
    });
  }
}

function statusFromDecision(decision: InteractionDecision): InteractionStatus {
  if (decision.kind === "choice") {
    return "answered";
  }

  return decision.approved ? "approved" : "rejected";
}

function expireUnresumableInteraction(row: InteractionRow, now: number) {
  const db = getDb();
  const error = "原运行进程已不可恢复，请重新发送这条消息。";
  const currentMessage = db.select().from(messages).where(eq(messages.id, row.messageId)).get();

  db.update(agentInteractions)
    .set({ status: "expired", resolvedAt: now })
    .where(eq(agentInteractions.id, row.id))
    .run();
  db.update(messages)
    .set({
      status: "error",
      content: currentMessage?.content ? currentMessage.content : `运行失败：${error}`
    })
    .where(eq(messages.id, row.messageId))
    .run();
  db.update(agentRuns)
    .set({ status: "error", error, finishedAt: now, updatedAt: now })
    .where(eq(agentRuns.id, row.runId))
    .run();
  db.update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, row.conversationId))
    .run();

  publishConversationEvent(row.conversationId, {
    type: "interaction_resolved",
    interactionId: row.id,
    status: "expired"
  });
  publishConversationEvent(row.conversationId, {
    type: "message_status",
    messageId: row.messageId,
    status: "error",
    error
  });
  publishConversationEvent(row.conversationId, { type: "run_status", runId: row.runId, status: "error", error });
}

function toAgentInteraction(row: InteractionRow): AgentInteraction {
  return {
    id: row.id,
    kind: row.kind as InteractionKind,
    status: row.status as InteractionStatus,
    conversationId: row.conversationId,
    runId: row.runId,
    messageId: row.messageId,
    agentId: row.agentId,
    conversationAgentId: row.conversationAgentId,
    orchestratorTaskId: row.orchestratorTaskId,
    payload: JSON.parse(row.payloadJson) as AgentInteraction["payload"],
    response: row.responseJson ? (JSON.parse(row.responseJson) as InteractionDecision) : null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt
  };
}

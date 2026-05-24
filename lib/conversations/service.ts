import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agents, conversationAgents, conversations, messages } from "@/lib/db/schema";
import { parseAgentMentions, slugFor } from "@/lib/agents/mention";
import type { AgentSummary } from "@/lib/agents/types";
import type { ConversationMode, ConversationSummary, MockMessage } from "@/lib/conversations/types";
import { startAgentRun } from "@/lib/conversations/runs";

type ConversationRow = typeof conversations.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type UpdateConversationInput = {
  title?: string;
  archived?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function listAgents(): AgentSummary[] {
  return getDb()
    .select()
    .from(agents)
    .where(eq(agents.enabled, true))
    .orderBy(asc(agents.name))
    .all()
    .map(toAgentSummary);
}

export function createConversation(mode: ConversationMode = "single") {
  if (mode === "group") {
    throw new ApiError("V1 后端只允许创建 single 会话；群聊保持静态 UI。", 400);
  }

  const now = Date.now();
  const row: typeof conversations.$inferInsert = {
    id: crypto.randomUUID(),
    mode,
    title: "新建聊天",
    status: "empty",
    createdAt: now,
    updatedAt: now
  };

  getDb().insert(conversations).values(row).run();
  return getConversation(row.id);
}

export function listConversations(): ConversationSummary[] {
  const rows = getDb()
    .select({
      conversation: conversations,
      agent: agents
    })
    .from(conversations)
    .leftJoin(agents, eq(conversations.lockedAgentId, agents.id))
    .where(eq(conversations.mode, "single"))
    .orderBy(desc(conversations.updatedAt))
    .all();

  return rows.map(({ conversation, agent }) => toConversationSummary(conversation, agent));
}

export function getConversation(id: string) {
  const row = getDb()
    .select({
      conversation: conversations,
      agent: agents
    })
    .from(conversations)
    .leftJoin(agents, eq(conversations.lockedAgentId, agents.id))
    .where(eq(conversations.id, id))
    .get();

  if (!row) {
    throw new ApiError("会话不存在。", 404);
  }

  return toConversationSummary(row.conversation, row.agent);
}

export function updateConversation(id: string, input: UpdateConversationInput) {
  const conversation = ensureConversation(id);

  if (conversation.mode !== "single") {
    throw new ApiError("V1 只支持管理 single 会话。", 400);
  }

  const now = Date.now();
  const updates: Partial<typeof conversations.$inferInsert> = {
    updatedAt: now
  };

  if (input.title !== undefined) {
    const title = input.title.trim();

    if (!title) {
      throw new ApiError("会话名称不能为空。", 400);
    }

    if (title.length > 80) {
      throw new ApiError("会话名称不能超过 80 个字符。", 400);
    }

    updates.title = title;
  }

  if (input.archived !== undefined) {
    updates.archivedAt = input.archived ? now : null;
  }

  if (updates.title === undefined && input.archived === undefined) {
    throw new ApiError("没有可更新的会话字段。", 400);
  }

  getDb().update(conversations).set(updates).where(eq(conversations.id, id)).run();
  return getConversation(id);
}

export function deleteConversation(id: string) {
  const conversation = ensureConversation(id);

  if (conversation.mode !== "single") {
    throw new ApiError("V1 只支持删除 single 会话。", 400);
  }

  getDb().delete(conversations).where(eq(conversations.id, id)).run();
}

export function listMessages(conversationId: string): MockMessage[] {
  ensureConversation(conversationId);

  return getDb()
    .select({
      message: messages,
      agent: agents
    })
    .from(messages)
    .leftJoin(agents, eq(messages.agentId, agents.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .all()
    .map(({ message, agent }) => toMessage(message, agent));
}

export function sendMessage(conversationId: string, content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new ApiError("消息不能为空。", 400);
  }

  const conversation = ensureConversation(conversationId);

  if (conversation.mode !== "single") {
    throw new ApiError("V1 群聊只保留静态 UI，不接真实消息 API。", 400);
  }

  const allAgents = listAgents();
  const parsed = parseAgentMentions(trimmed, allAgents);

  if (!parsed.ok) {
    throw new ApiError(parsed.error, 400);
  }

  const existingLock = getLockedAgent(conversationId);
  const selectedAgent = validateSingleChatMention(conversation, existingLock, parsed.mentions);
  const now = Date.now();
  const messageId = crypto.randomUUID();

  const db = getDb();

  if (!existingLock) {
    db.insert(conversationAgents)
      .values({
        id: crypto.randomUUID(),
        conversationId,
        agentId: selectedAgent.id,
        role: "primary",
        lockedAt: now,
        createdAt: now
      })
      .run();
  }

  db.insert(messages)
    .values({
      id: messageId,
      conversationId,
      role: "user",
      authorName: "你",
      content: trimmed,
      status: "done",
      createdAt: now
    })
    .run();

  db.update(conversations)
    .set({
      title: conversation.title === "新建聊天" ? titleFromMessage(trimmed) : conversation.title,
      status: "running",
      lockedAgentId: selectedAgent.id,
      updatedAt: now
    })
    .where(eq(conversations.id, conversationId))
    .run();

  const run = startAgentRun({
    conversationId,
    agent: selectedAgent
  });

  return {
    conversation: getConversation(conversationId),
    messages: listMessages(conversationId),
    run
  };
}

function validateSingleChatMention(
  conversation: ConversationRow,
  existingLock: AgentSummary | null,
  mentions: AgentSummary[]
) {
  if (!existingLock) {
    if (mentions.length === 0) {
      throw new ApiError("首条消息必须 @ 一个 Agent。", 400);
    }

    if (mentions.length > 1) {
      throw new ApiError("单聊首条消息只能 @ 一个 Agent。", 400);
    }

    return mentions[0];
  }

  if (mentions.some((agent) => agent.id !== existingLock.id)) {
    throw new ApiError(`当前会话已锁定 ${existingLock.name}，不能切换到其他 Agent。`, 400);
  }

  return existingLock;
}

function ensureConversation(id: string) {
  const conversation = getDb().select().from(conversations).where(eq(conversations.id, id)).get();

  if (!conversation) {
    throw new ApiError("会话不存在。", 404);
  }

  return conversation;
}

function getLockedAgent(conversationId: string) {
  const row = getDb()
    .select({ agent: agents })
    .from(conversationAgents)
    .innerJoin(agents, eq(conversationAgents.agentId, agents.id))
    .where(and(eq(conversationAgents.conversationId, conversationId), eq(conversationAgents.role, "primary")))
    .get();

  return row ? toAgentSummary(row.agent) : null;
}

function toConversationSummary(conversation: ConversationRow, agent: AgentRow | null): ConversationSummary {
  return {
    id: conversation.id,
    mode: conversation.mode,
    title: conversation.title,
    preview: agent ? `${agent.name} 已锁定` : "等待首条消息 @ 一个 Agent",
    status: conversation.status,
    avatar: agent ? slugFor(toAgentSummary(agent)) : "claude-code",
    lockedAgent: agent ? toAgentSummary(agent) : null,
    archivedAt: conversation.archivedAt,
    updatedAt: conversation.updatedAt
  };
}

function toMessage(message: MessageRow, agent: AgentRow | null): MockMessage {
  return {
    id: message.id,
    author: message.authorName,
    avatar: agent ? slugFor(toAgentSummary(agent)) : undefined,
    tone: message.role === "user" ? "user" : "agent",
    status:
      message.status === "running" || message.status === "done" || message.status === "error" || message.status === "cancelled"
        ? message.status
        : undefined,
    time: new Date(message.createdAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }),
    body: message.content
  };
}

function toAgentSummary(agent: AgentRow): AgentSummary {
  return {
    id: agent.id,
    slug: agent.slug,
    name: agent.name,
    platform: agent.platform as AgentSummary["platform"],
    description: agent.description
  };
}

function titleFromMessage(content: string) {
  return content.replace(/@[a-zA-Z0-9][a-zA-Z0-9_-]*/g, "").trim().slice(0, 34) || "新建聊天";
}

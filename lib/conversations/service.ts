import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { agents, artifacts, conversationAgents, conversations, messageAttachments, messages, orchestratorTasks } from "@/lib/db/schema";
import {
  parseAgentAliasMentions,
  parseAgentMentions,
  parseAgentMentionsForRoster,
  slugFor
} from "@/lib/agents/mention";
import type { AdapterAttachment } from "@/lib/adapters/types";
import type { AgentSummary } from "@/lib/agents/types";
import type { ConversationMode, ConversationSummary, MockMessage } from "@/lib/conversations/types";
import { startAgentRun } from "@/lib/conversations/runs";
import { processGroupMessage } from "@/lib/orchestrator/service";
import { invokeAgentForTask } from "@/lib/orchestrator/invoker";
import type { OrchestratorTaskRecord } from "@/lib/orchestrator/types";

type ConversationRow = typeof conversations.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type MessageAttachmentRow = typeof messageAttachments.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;
type UpdateConversationInput = {
  title?: string;
  archived?: boolean;
  workspacePath?: string;
};
type CreateConversationInput = {
  mode?: ConversationMode;
  workspacePath?: string;
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

export function createConversation(input: CreateConversationInput = {}) {
  const mode = input.mode ?? "single";
  const now = Date.now();
  const row: typeof conversations.$inferInsert = {
    id: crypto.randomUUID(),
    mode,
    title: mode === "group" ? "新建群聊" : "新建聊天",
    status: "empty",
    workspacePath: input.workspacePath ? normalizeWorkspacePath(input.workspacePath) : defaultWorkspacePath(),
    createdAt: now,
    updatedAt: now
  };

  getDb().insert(conversations).values(row).run();
  return getConversation(row.id);
}

export function listConversations(options: { q?: string } = {}): ConversationSummary[] {
  const rows = getDb()
    .select({
      conversation: conversations,
      agent: agents
    })
    .from(conversations)
    .leftJoin(agents, eq(conversations.lockedAgentId, agents.id))
    .orderBy(desc(conversations.updatedAt))
    .all();

  const query = options.q?.trim().toLowerCase();

  return rows
    .filter(({ conversation }) => conversation.status !== "empty" || Boolean(conversation.lockedAgentId))
    .map(({ conversation, agent }) => {
      const latestMessage = getLatestMessage(conversation.id);
      return {
        summary: toConversationSummary(conversation, agent, latestMessage),
        latestMessage
      };
    })
    .filter(({ summary, latestMessage }) => {
      if (!query) {
        return true;
      }

      return (
        summary.title.toLowerCase().includes(query) ||
        (latestMessage?.content.toLowerCase().includes(query) ?? false)
      );
    })
    .map(({ summary }) => summary);
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

  if (input.workspacePath !== undefined) {
    updates.workspacePath = normalizeWorkspacePath(input.workspacePath);
  }

  if (updates.title === undefined && input.archived === undefined && updates.workspacePath === undefined) {
    throw new ApiError("没有可更新的会话字段。", 400);
  }

  getDb().update(conversations).set(updates).where(eq(conversations.id, id)).run();
  return getConversation(id);
}

export function deleteConversation(id: string) {
  ensureConversation(id);
  getDb().delete(conversations).where(eq(conversations.id, id)).run();
}

export function listMessages(conversationId: string): MockMessage[] {
  ensureConversation(conversationId);

  const rows = getDb()
    .select({
      message: messages,
      agent: agents
    })
    .from(messages)
    .leftJoin(agents, eq(messages.agentId, agents.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .all();

  if (rows.length === 0) {
    return [];
  }

  const messageIds = rows.map(({ message }) => message.id);

  const attachmentRows = getDb()
    .select()
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, messageIds))
    .orderBy(asc(messageAttachments.createdAt))
    .all();

  const attachmentsByMessage = new Map<string, MessageAttachmentRow[]>();
  for (const att of attachmentRows) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  const artifactRows = getDb()
    .select()
    .from(artifacts)
    .where(inArray(artifacts.messageId, messageIds))
    .orderBy(asc(artifacts.createdAt))
    .all();

  const artifactsByMessage = new Map<string, ArtifactRow[]>();
  for (const art of artifactRows) {
    if (!art.messageId) continue;
    const list = artifactsByMessage.get(art.messageId) ?? [];
    list.push(art);
    artifactsByMessage.set(art.messageId, list);
  }

  return rows.map(({ message, agent }) =>
    toMessage(message, agent, {
      attachments: attachmentsByMessage.get(message.id) ?? [],
      artifacts: artifactsByMessage.get(message.id) ?? []
    })
  );
}

export type ListMessagesPaginatedResult = {
  messages: MockMessage[];
  hasMore: boolean;
};

export function listMessagesPaginated(
  conversationId: string,
  options: { limit?: number; beforeId?: string } = {}
): ListMessagesPaginatedResult {
  ensureConversation(conversationId);

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

  let beforeTime: number | undefined;
  if (options.beforeId) {
    const anchor = getDb()
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.id, options.beforeId), eq(messages.conversationId, conversationId)))
      .get();
    if (anchor) {
      beforeTime = anchor.createdAt;
    }
  }

  const conditions = beforeTime
    ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, beforeTime))
    : eq(messages.conversationId, conversationId);

  const rows = getDb()
    .select({
      message: messages,
      agent: agents
    })
    .from(messages)
    .leftJoin(agents, eq(messages.agentId, agents.id))
    .where(conditions)
    .orderBy(desc(messages.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // Reverse to chronological order for UI
  pageRows.reverse();

  if (pageRows.length === 0) {
    return { messages: [], hasMore: false };
  }

  const messageIds = pageRows.map(({ message }) => message.id);

  const attachmentRows = getDb()
    .select()
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, messageIds))
    .orderBy(asc(messageAttachments.createdAt))
    .all();

  const attachmentsByMessage = new Map<string, MessageAttachmentRow[]>();
  for (const att of attachmentRows) {
    const list = attachmentsByMessage.get(att.messageId) ?? [];
    list.push(att);
    attachmentsByMessage.set(att.messageId, list);
  }

  const artifactRows = getDb()
    .select()
    .from(artifacts)
    .where(inArray(artifacts.messageId, messageIds))
    .orderBy(asc(artifacts.createdAt))
    .all();

  const artifactsByMessage = new Map<string, ArtifactRow[]>();
  for (const art of artifactRows) {
    if (!art.messageId) continue;
    const list = artifactsByMessage.get(art.messageId) ?? [];
    list.push(art);
    artifactsByMessage.set(art.messageId, list);
  }

  const mappedMessages = pageRows.map(({ message, agent }) =>
    toMessage(message, agent, {
      attachments: attachmentsByMessage.get(message.id) ?? [],
      artifacts: artifactsByMessage.get(message.id) ?? []
    })
  );

  return { messages: mappedMessages, hasMore };
}

export type IncomingAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  allowExternal?: boolean;
};

export function sendMessage(conversationId: string, content: string, incomingAttachments: IncomingAttachment[] = []) {
  const trimmed = content.trim();

  if (!trimmed && incomingAttachments.length === 0) {
    throw new ApiError("消息不能为空。", 400);
  }

  const conversation = ensureConversation(conversationId);

  if (!conversation.workspacePath) {
    throw new ApiError("未选择工作区，不能发送消息。", 400);
  }

  if (conversation.mode === "group") {
    return sendGroupMessage(conversation, trimmed, incomingAttachments);
  }

  return sendSingleMessage(conversation, trimmed, incomingAttachments);
}

function sendSingleMessage(
  conversation: typeof conversations.$inferSelect,
  trimmed: string,
  incomingAttachments: IncomingAttachment[]
) {
  const allAgents = listAgents();
  const parsed = parseAgentMentions(trimmed, allAgents);

  if (!parsed.ok) {
    throw new ApiError(parsed.error, 400);
  }

  const existingLock = getLockedAgent(conversation.id);
  const selectedAgent = validateSingleChatMention(conversation, existingLock, parsed.mentions);
  const now = Date.now();
  const messageId = crypto.randomUUID();

  const db = getDb();
  let lockedConversationAgentId: string | undefined;

  if (!existingLock) {
    lockedConversationAgentId = crypto.randomUUID();
    db.insert(conversationAgents)
      .values({
        id: lockedConversationAgentId,
        conversationId: conversation.id,
        agentId: selectedAgent.id,
        alias: slugFor(selectedAgent),
        displayName: selectedAgent.name,
        role: "primary",
        status: "active",
        joinedAt: now,
        lockedAt: now,
        createdAt: now
      })
      .run();
  }

  db.insert(messages)
    .values({
      id: messageId,
      conversationId: conversation.id,
      role: "user",
      authorName: "你",
      content: trimmed,
      status: "done",
      createdAt: now
    })
    .run();

  const storedAttachments = storeMessageAttachments({
    conversationId: conversation.id,
    messageId,
    attachments: incomingAttachments,
    workspacePath: conversation.workspacePath,
    now
  });

  db.update(conversations)
    .set({
      title: conversation.title === "新建聊天" ? titleFromMessage(trimmed) : conversation.title,
      status: "running",
      lockedAgentId: selectedAgent.id,
      updatedAt: now
    })
    .where(eq(conversations.id, conversation.id))
    .run();

  if (existingLock) {
    lockedConversationAgentId = db
      .select({ id: conversationAgents.id })
      .from(conversationAgents)
      .where(
        and(
          eq(conversationAgents.conversationId, conversation.id),
          eq(conversationAgents.role, "primary")
        )
      )
      .get()?.id;
  }

  const run = startAgentRun({
    conversationId: conversation.id,
    agent: selectedAgent,
    workspacePath: conversation.workspacePath,
    attachments: storedAttachments.map(toAdapterAttachment),
    conversationAgentId: lockedConversationAgentId
  });

  return {
    conversation: getConversation(conversation.id),
    messages: listMessages(conversation.id),
    run
  };
}

function sendGroupMessage(
  conversation: typeof conversations.$inferSelect,
  trimmed: string,
  incomingAttachments: IncomingAttachment[]
) {
  const db = getDb();
  const roster = db
    .select()
    .from(conversationAgents)
    .where(eq(conversationAgents.conversationId, conversation.id))
    .orderBy(conversationAgents.joinedAt)
    .all();

  const now = Date.now();
  const messageId = crypto.randomUUID();

  if (roster.length === 0) {
    const allAgents = listAgents();
    const parsed = parseAgentMentionsForRoster(trimmed, allAgents);

    if (!parsed.ok) {
      throw new ApiError(parsed.error, 400);
    }

    if (parsed.mentions.length < 2) {
      throw new ApiError("群聊首条消息必须 @ 两个或以上 Agent。", 400);
    }

    for (const mention of parsed.mentions) {
      db.insert(conversationAgents)
        .values({
          id: crypto.randomUUID(),
          conversationId: conversation.id,
          agentId: mention.agent.id,
          alias: mention.alias,
          displayName: mention.displayName,
          role: "member",
          status: "active",
          joinedAt: now,
          lockedAt: now,
          createdAt: now
        })
        .run();
    }

    db.insert(messages)
      .values({
        id: messageId,
        conversationId: conversation.id,
        role: "user",
        authorName: "你",
        content: trimmed,
        status: "done",
        createdAt: now
      })
      .run();

    storeMessageAttachments({
      conversationId: conversation.id,
      messageId,
      attachments: incomingAttachments,
      workspacePath: conversation.workspacePath,
      now
    });

    db.update(conversations)
      .set({
        title: conversation.title === "新建群聊" ? titleFromMessage(trimmed) : conversation.title,
        status: "running",
        updatedAt: now
      })
      .where(eq(conversations.id, conversation.id))
      .run();

    void processGroupMessage(conversation.id, messageId, trimmed);

    return {
      conversation: getConversation(conversation.id),
      messages: listMessages(conversation.id),
      run: null
    };
  }

  const rosterAliases = roster.map((r) => r.alias);
  const aliasParse = parseAgentAliasMentions(trimmed, rosterAliases);

  if (!aliasParse.ok) {
    throw new ApiError(aliasParse.error, 400);
  }

  db.insert(messages)
    .values({
      id: messageId,
      conversationId: conversation.id,
      role: "user",
      authorName: "你",
      content: trimmed,
      status: "done",
      createdAt: now
    })
    .run();

  const storedAttachments = storeMessageAttachments({
    conversationId: conversation.id,
    messageId,
    attachments: incomingAttachments,
    workspacePath: conversation.workspacePath,
    now
  });

  db.update(conversations)
    .set({
      title: conversation.title === "新建群聊" ? titleFromMessage(trimmed) : conversation.title,
      status: "running",
      updatedAt: now
    })
    .where(eq(conversations.id, conversation.id))
    .run();

  // D1: direct assign when exactly one agent is mentioned
  if (aliasParse.aliases.length === 1) {
    const targetAlias = aliasParse.aliases[0];
    const targetConversationAgent = roster.find((r) => r.alias.toLowerCase() === targetAlias);
    if (targetConversationAgent) {
      const agentRow = db
        .select()
        .from(agents)
        .where(eq(agents.id, targetConversationAgent.agentId))
        .get();
      if (agentRow) {
        const run = startAgentRun({
          conversationId: conversation.id,
          agent: toAgentSummary(agentRow),
          workspacePath: conversation.workspacePath,
          attachments: storedAttachments.map(toAdapterAttachment),
          conversationAgentId: targetConversationAgent.id
        });
        return {
          conversation: getConversation(conversation.id),
          messages: listMessages(conversation.id),
          run
        };
      }
    }
  }

  void processGroupMessage(conversation.id, messageId, trimmed);

  return {
    conversation: getConversation(conversation.id),
    messages: listMessages(conversation.id),
    run: null
  };
}

export function regenerateMessage(messageId: string) {
  const message = getDb().select().from(messages).where(eq(messages.id, messageId)).get();

  if (!message) {
    throw new ApiError("消息不存在。", 404);
  }

  if (message.role !== "assistant") {
    throw new ApiError("只能重新生成 Agent 回复。", 400);
  }

  if (message.status === "running") {
    throw new ApiError("当前回复仍在生成中。", 400);
  }

  const conversation = ensureConversation(message.conversationId);

  if (conversation.mode === "single") {
    const existingLock = getLockedAgent(message.conversationId);

    if (!existingLock || message.agentId !== existingLock.id) {
      throw new ApiError("只能重新生成当前锁定 Agent 的回复。", 400);
    }

    const latestAssistant = getDb()
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, message.conversationId), eq(messages.role, "assistant")))
      .orderBy(desc(messages.createdAt))
      .get();

    if (latestAssistant?.id !== messageId) {
      throw new ApiError("当前只支持重新生成最近一条 Agent 回复。", 400);
    }

    getDb().delete(messages).where(eq(messages.id, messageId)).run();

    const lockedConversationAgent = getDb()
      .select()
      .from(conversationAgents)
      .where(
        and(
          eq(conversationAgents.conversationId, conversation.id),
          eq(conversationAgents.role, "primary")
        )
      )
      .get();

    const run = startAgentRun({
      conversationId: message.conversationId,
      agent: existingLock,
      workspacePath: conversation.workspacePath || defaultWorkspacePath(),
      attachments: [],
      conversationAgentId: lockedConversationAgent?.id
    });

    return {
      conversation: getConversation(message.conversationId),
      messages: listMessages(message.conversationId),
      run
    };
  }

  if (conversation.mode === "group") {
    if (!message.authorConversationAgentId) {
      throw new ApiError("群聊中只能重新生成 Agent 的回复。", 400);
    }

    const ca = getDb()
      .select()
      .from(conversationAgents)
      .where(eq(conversationAgents.id, message.authorConversationAgentId))
      .get();
    if (!ca) {
      throw new ApiError("Agent 已不在当前群聊中。", 400);
    }

    const agentRow = getDb().select().from(agents).where(eq(agents.id, ca.agentId)).get();
    if (!agentRow) {
      throw new ApiError("Agent 不存在。", 400);
    }

    getDb().delete(messages).where(eq(messages.id, messageId)).run();

    if (message.orchestratorTaskId) {
      const task = getDb()
        .select()
        .from(orchestratorTasks)
        .where(eq(orchestratorTasks.id, message.orchestratorTaskId))
        .get();
      if (!task) {
        throw new ApiError("关联的任务已不存在。", 400);
      }

      getDb()
        .update(orchestratorTasks)
        .set({ status: "running", resultMessageId: null, resultSummary: null, error: null })
        .where(eq(orchestratorTasks.id, message.orchestratorTaskId))
        .run();

      const { runId, messageId: newMessageId } = invokeAgentForTask({
        conversationId: conversation.id,
        task: task as unknown as OrchestratorTaskRecord,
        workspacePath: conversation.workspacePath || defaultWorkspacePath()
      });
      return {
        conversation: getConversation(message.conversationId),
        messages: listMessages(message.conversationId),
        run: { runId, assistantMessageId: newMessageId }
      };
    }

    const run = startAgentRun({
      conversationId: message.conversationId,
      agent: toAgentSummary(agentRow),
      workspacePath: conversation.workspacePath || defaultWorkspacePath(),
      attachments: [],
      conversationAgentId: ca.id
    });
    return {
      conversation: getConversation(message.conversationId),
      messages: listMessages(message.conversationId),
      run
    };
  }

  throw new ApiError("不支持的会话模式。", 400);
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

function toConversationSummary(
  conversation: ConversationRow,
  agent: AgentRow | null,
  latestMessage?: MessageRow | null
): ConversationSummary {
  const fallbackPreview = agent ? `${agent.name} 已锁定` : "等待首条消息 @ 一个 Agent";

  return {
    id: conversation.id,
    mode: conversation.mode,
    title: conversation.title,
    preview: latestMessage ? previewFromMessage(latestMessage) : fallbackPreview,
    status: conversation.status,
    avatar: agent ? slugFor(toAgentSummary(agent)) : "claude-code",
    workspacePath: conversation.workspacePath || defaultWorkspacePath(),
    lockedAgent: agent ? toAgentSummary(agent) : null,
    archivedAt: conversation.archivedAt,
    updatedAt: conversation.updatedAt
  };
}

function getLatestMessage(conversationId: string) {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .get();
}

function previewFromMessage(message: MessageRow) {
  const authorPrefix = message.role === "user" ? "你" : message.authorName;
  const content = message.content.replace(/\s+/g, " ").trim();
  return `${authorPrefix}: ${content || "（空消息）"}`.slice(0, 80);
}

function listConversationArtifacts(conversationId: string) {
  return getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.conversationId, conversationId))
    .orderBy(desc(artifacts.createdAt))
    .all();
}

function toConversationArtifact(artifact: ArtifactRow) {
  return {
    id: artifact.id,
    type: artifact.type,
    title: artifact.title,
    description: artifact.description,
    path: artifact.path
  };
}

function toMessage(
  message: MessageRow,
  agent: AgentRow | null,
  preloaded?: { attachments: MessageAttachmentRow[]; artifacts: ArtifactRow[] }
): MockMessage {
  return {
    id: message.id,
    author: message.authorName,
    avatar: agent ? slugFor(toAgentSummary(agent)) : undefined,
    tone:
      message.role === "user" ? "user" : message.role === "orchestrator" ? "orchestrator" : "agent",
    status:
      message.status === "running" || message.status === "done" || message.status === "error" || message.status === "cancelled"
        ? message.status
        : undefined,
    time: new Date(message.createdAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    }),
    body: message.content,
    attachments: (preloaded?.attachments ?? getMessageAttachments(message.id)).map(toPublicAttachment),
    artifacts: (preloaded?.artifacts ?? getMessageArtifacts(message.id)).map(toConversationArtifact),
    authorConversationAgentId: message.authorConversationAgentId ?? undefined
  };
}

export function getConversationRoster(conversationId: string) {
  ensureConversation(conversationId);

  return getDb()
    .select({
      id: conversationAgents.id,
      alias: conversationAgents.alias,
      displayName: conversationAgents.displayName,
      status: conversationAgents.status,
      slug: agents.slug,
      name: agents.name
    })
    .from(conversationAgents)
    .innerJoin(agents, eq(conversationAgents.agentId, agents.id))
    .where(eq(conversationAgents.conversationId, conversationId))
    .orderBy(conversationAgents.joinedAt)
    .all()
    .map((row, _index, rows) => {
      const currentDisplayName = row.displayName ?? row.name ?? row.alias;
      const sameSlugRows = rows.filter((candidate) => candidate.slug === row.slug);
      const displayNameSet = new Set(
        sameSlugRows.map((candidate) => candidate.displayName ?? candidate.name ?? candidate.alias)
      );
      const sameSlugIndex = sameSlugRows.findIndex((candidate) => candidate.id === row.id) + 1;
      const displayName =
        sameSlugRows.length > 1 && displayNameSet.size < sameSlugRows.length
          ? `${row.name ?? currentDisplayName} ${sameSlugIndex}`
          : currentDisplayName;

      return {
        id: row.id,
        alias: row.alias,
        displayName,
        status: row.status as "active" | "idle" | "running" | "unavailable",
        slug: row.slug
      };
    });
}

function getMessageAttachments(messageId: string) {
  return getDb()
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .orderBy(asc(messageAttachments.createdAt))
    .all();
}

function getMessageArtifacts(messageId: string) {
  return getDb()
    .select()
    .from(artifacts)
    .where(eq(artifacts.messageId, messageId))
    .orderBy(asc(artifacts.createdAt))
    .all();
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

function defaultWorkspacePath() {
  return process.cwd();
}

function normalizeWorkspacePath(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new ApiError("工作区路径不能为空。", 400);
  }

  const normalized = path.resolve(trimmed);

  if (!fs.existsSync(normalized)) {
    throw new ApiError("工作区路径不存在。", 400);
  }

  if (!fs.statSync(normalized).isDirectory()) {
    throw new ApiError("工作区路径必须是目录。", 400);
  }

  return normalized;
}

function storeMessageAttachments({
  conversationId,
  messageId,
  attachments,
  workspacePath,
  now
}: {
  conversationId: string;
  messageId: string;
  attachments: IncomingAttachment[];
  workspacePath: string;
  now: number;
}) {
  if (attachments.length === 0) {
    return [];
  }

  if (attachments.length > 8) {
    throw new ApiError("单条消息最多引用 8 个附件。", 400);
  }

  const rows: Array<typeof messageAttachments.$inferInsert> = attachments.map((attachment, index) => {
    const id = crypto.randomUUID();
    const filePath = normalizeAttachmentPath(attachment, workspacePath);

    return {
      id,
      conversationId,
      messageId,
      fileName: sanitizeFileName(attachment.fileName || path.basename(filePath)),
      mimeType: attachment.mimeType || "application/octet-stream",
      size: attachment.size || fs.statSync(filePath).size,
      storagePath: filePath,
      createdAt: now + index
    };
  });

  getDb().insert(messageAttachments).values(rows).run();
  return rows;
}

function sanitizeFileName(fileName: string) {
  return path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "attachment";
}

function normalizeAttachmentPath(attachment: IncomingAttachment, workspacePath: string) {
  if (!attachment.path?.trim()) {
    throw new ApiError("附件路径不能为空。", 400);
  }

  const filePath = path.resolve(attachment.path);

  if (!fs.existsSync(filePath)) {
    throw new ApiError(`附件不存在：${attachment.fileName || filePath}`, 400);
  }

  const stat = fs.statSync(filePath);

  if (!stat.isFile()) {
    throw new ApiError(`附件必须是文件：${attachment.fileName || filePath}`, 400);
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    throw new ApiError(`附件不可读：${attachment.fileName || filePath}`, 400);
  }

  if (!attachment.allowExternal && !isPathInside(workspacePath, filePath)) {
    throw new ApiError("附件必须位于当前工作区内，或由用户明确确认引用外部路径。", 400);
  }

  return filePath;
}

function isPathInside(parentPath: string, childPath: string) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPublicAttachment(attachment: MessageAttachmentRow) {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    path: attachment.storagePath
  };
}

function toAdapterAttachment(attachment: typeof messageAttachments.$inferInsert): AdapterAttachment {
  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    path: attachment.storagePath
  };
}

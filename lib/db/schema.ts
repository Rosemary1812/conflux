import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    description: text("description").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    slugIdx: uniqueIndex("agents_slug_idx").on(table.slug)
  })
);

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["single", "group"] }).notNull(),
  title: text("title").notNull(),
  status: text("status", { enum: ["empty", "running", "done", "preview"] }).notNull(),
  lockedAgentId: text("locked_agent_id").references(() => agents.id),
  workspacePath: text("workspace_path").notNull().default(""),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const conversationAgents = sqliteTable(
  "conversation_agents",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    alias: text("alias").notNull(),
    displayName: text("display_name"),
    role: text("role").notNull().default("primary"),
    roleHint: text("role_hint"),
    status: text("status", { enum: ["active", "idle", "running", "unavailable"] })
      .notNull()
      .default("idle"),
    joinedAt: integer("joined_at"),
    lockedAt: integer("locked_at").notNull(),
    runtimeContextJson: text("runtime_context_json"),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    conversationAgentAliasIdx: uniqueIndex("conversation_agents_alias_unique_idx").on(
      table.conversationId,
      table.alias
    ),
    conversationAgentAgentIdx: index("conversation_agents_agent_idx").on(
      table.conversationId,
      table.agentId
    )
  })
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system", "tool", "orchestrator"] }).notNull(),
    authorName: text("author_name").notNull(),
    agentId: text("agent_id").references(() => agents.id),
    authorConversationAgentId: text("author_conversation_agent_id").references(
      () => conversationAgents.id,
      { onDelete: "set null" }
    ),
    orchestratorTaskId: text("orchestrator_task_id"),
    content: text("content").notNull(),
    status: text("status", { enum: ["pending", "running", "done", "error", "cancelled"] })
      .notNull()
      .default("done"),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    conversationIdIdx: index("messages_conversation_id_idx").on(table.conversationId)
  })
);

export const messageAttachments = sqliteTable("message_attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: integer("created_at").notNull()
});

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    conversationAgentId: text("conversation_agent_id").references(() => conversationAgents.id, {
      onDelete: "set null"
    }),
    status: text("status", { enum: ["pending", "running", "awaiting_interaction", "done", "error", "cancelled"] })
      .notNull()
      .default("pending"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    conversationIdIdx: index("agent_runs_conversation_id_idx").on(table.conversationId)
  })
);

export const agentInteractions = sqliteTable(
  "agent_interactions",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["approval", "choice"] }).notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "answered", "expired", "cancelled"] })
      .notNull()
      .default("pending"),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    conversationAgentId: text("conversation_agent_id").references(() => conversationAgents.id, { onDelete: "set null" }),
    orchestratorTaskId: text("orchestrator_task_id"),
    payloadJson: text("payload_json").notNull(),
    responseJson: text("response_json"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at")
  },
  (table) => ({
    conversationIdIdx: index("agent_interactions_conversation_id_idx").on(table.conversationId)
  })
);

export const agentExternalSessions = sqliteTable(
  "agent_external_sessions",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    platform: text("platform").notNull(),
    externalSessionId: text("external_session_id").notNull(),
    capabilitiesJson: text("capabilities_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => ({
    externalSessionIdx: uniqueIndex("agent_external_sessions_unique_idx").on(
      table.conversationId,
      table.agentId,
      table.platform
    )
  })
);

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol", { enum: ["anthropic", "openai_compatible"] }).notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  defaultModel: text("default_model").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastCheckStatus: text("last_check_status", { enum: ["ok", "error", "unchecked"] })
    .notNull()
    .default("unchecked"),
  lastCheckMessage: text("last_check_message"),
  lastCheckedAt: integer("last_checked_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const orchestratorSettings = sqliteTable("orchestrator_settings", {
  id: text("id").primaryKey(),
  plannerProviderId: text("planner_provider_id").references(() => providers.id, {
    onDelete: "set null"
  }),
  updatedAt: integer("updated_at").notNull()
});

export const orchestratorRuns = sqliteTable(
  "orchestrator_runs",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userMessageId: text("user_message_id").references(() => messages.id),
    mode: text("mode").notNull(),
    goal: text("goal").notNull(),
    status: text("status", { enum: ["planning", "awaiting_user", "running", "done", "error", "cancelled"] })
      .notNull()
      .default("planning"),
    planJson: text("plan_json"),
    evaluationJson: text("evaluation_json"),
    clarificationRound: integer("clarification_round").notNull().default(0),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at")
  },
  (table) => ({
    conversationIdIdx: index("orchestrator_runs_conversation_id_idx").on(table.conversationId)
  })
);

export const orchestratorTasks = sqliteTable(
  "orchestrator_tasks",
  {
    id: text("id").primaryKey(),
    orchestratorRunId: text("orchestrator_run_id")
      .notNull()
      .references(() => orchestratorRuns.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    assigneeConversationAgentId: text("assignee_conversation_agent_id")
      .notNull()
      .references(() => conversationAgents.id),
    roundId: text("round_id").notNull(),
    role: text("role").notNull(),
    description: text("description").notNull(),
    permission: text("permission").notNull().default("readonly"),
    dependsOnJson: text("depends_on_json"),
    status: text("status", { enum: ["pending", "running", "awaiting_interaction", "done", "error", "cancelled"] })
      .notNull()
      .default("pending"),
    resultMessageId: text("result_message_id").references(() => messages.id),
    resultSummary: text("result_summary"),
    error: text("error"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at")
  },
  (table) => ({
    conversationIdIdx: index("orchestrator_tasks_conversation_id_idx").on(table.conversationId)
  })
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    path: text("path"),
    metadata: text("metadata"),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    conversationIdIdx: index("artifacts_conversation_id_idx").on(table.conversationId),
    messageIdIdx: index("artifacts_message_id_idx").on(table.messageId)
  })
);

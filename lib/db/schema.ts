import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    role: text("role").notNull().default("primary"),
    lockedAt: integer("locked_at").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => ({
    conversationAgentIdx: uniqueIndex("conversation_agents_unique_idx").on(
      table.conversationId,
      table.agentId
    )
  })
);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
  authorName: text("author_name").notNull(),
  agentId: text("agent_id").references(() => agents.id),
  content: text("content").notNull(),
  status: text("status", { enum: ["pending", "running", "done", "error", "cancelled"] })
    .notNull()
    .default("done"),
  createdAt: integer("created_at").notNull()
});

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

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  status: text("status", { enum: ["pending", "running", "done", "error", "cancelled"] })
    .notNull()
    .default("pending"),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const artifacts = sqliteTable("artifacts", {
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
});

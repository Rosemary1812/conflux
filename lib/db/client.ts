import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import { seedAgents } from "@/lib/db/seed";

const dataDir = path.join(process.cwd(), "data");
const dbPath = process.env.AGENTHUB_DB_PATH ?? path.join(dataDir, "agenthub.sqlite");

let initialized = false;
let sqlite: Database.Database | undefined;

export function getDb() {
  if (!sqlite) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
  }

  if (!initialized) {
    migrate(sqlite);
    seedAgents(drizzle(sqlite, { schema }));
    initialized = true;
  }

  return drizzle(sqlite, { schema });
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('single', 'group')),
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('empty', 'running', 'done', 'preview')),
      locked_agent_id TEXT REFERENCES agents(id),
      workspace_path TEXT NOT NULL DEFAULT '',
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_agents (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      role TEXT NOT NULL DEFAULT 'primary',
      locked_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(conversation_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
      author_name TEXT NOT NULL,
      agent_id TEXT REFERENCES agents(id),
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'awaiting_interaction', 'done', 'error', 'cancelled')),
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_interactions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('approval', 'choice')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'answered', 'expired', 'cancelled')),
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      conversation_agent_id TEXT REFERENCES conversation_agents(id) ON DELETE SET NULL,
      orchestrator_task_id TEXT,
      payload_json TEXT NOT NULL,
      response_json TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS agent_external_sessions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      platform TEXT NOT NULL,
      external_session_id TEXT NOT NULL,
      capabilities_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(conversation_id, agent_id, platform)
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('anthropic', 'openai_compatible')),
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      default_model TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_check_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (last_check_status IN ('ok', 'error', 'unchecked')),
      last_check_message TEXT,
      last_checked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orchestrator_settings (
      id TEXT PRIMARY KEY,
      planner_provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orchestrator_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_message_id TEXT REFERENCES messages(id),
      mode TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'awaiting_user', 'running', 'done', 'error', 'cancelled')),
      plan_json TEXT,
      evaluation_json TEXT,
      clarification_round INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS orchestrator_tasks (
      id TEXT PRIMARY KEY,
      orchestrator_run_id TEXT NOT NULL REFERENCES orchestrator_runs(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      assignee_conversation_agent_id TEXT NOT NULL REFERENCES conversation_agents(id),
      round_id TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT NOT NULL,
      permission TEXT NOT NULL DEFAULT 'readonly',
      depends_on_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'awaiting_interaction', 'done', 'error', 'cancelled')),
      result_message_id TEXT REFERENCES messages(id),
      result_summary TEXT,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      path TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
      ON messages(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS message_attachments_message_idx
      ON message_attachments(message_id);

    CREATE INDEX IF NOT EXISTS agent_interactions_conversation_status_idx
      ON agent_interactions(conversation_id, status, created_at);

    CREATE INDEX IF NOT EXISTS agent_external_sessions_lookup_idx
      ON agent_external_sessions(conversation_id, agent_id, platform);

    CREATE INDEX IF NOT EXISTS providers_protocol_enabled_idx
      ON providers(protocol, enabled);

    CREATE INDEX IF NOT EXISTS orchestrator_runs_conversation_idx
      ON orchestrator_runs(conversation_id, started_at);

    CREATE INDEX IF NOT EXISTS orchestrator_tasks_run_idx
      ON orchestrator_tasks(orchestrator_run_id, status);

    CREATE INDEX IF NOT EXISTS orchestrator_tasks_agent_idx
      ON orchestrator_tasks(assignee_conversation_agent_id, status);
  `);

  ensureColumn(database, "conversations", "archived_at", "INTEGER");
  ensureColumn(database, "conversations", "workspace_path", "TEXT NOT NULL DEFAULT ''");
  ensureAgentRunsAwaitingInteraction(database);
  ensureProviderColumns(database);
  ensureConversationAgentsV2Migration(database);
  ensureMessagesV2Migration(database);
  ensureAgentRunsV2Column(database);
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

  if (!columns.some((current) => current.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureProviderColumns(database: Database.Database) {
  ensureColumn(database, "providers", "last_check_status", "TEXT NOT NULL DEFAULT 'unchecked'");
  ensureColumn(database, "providers", "last_check_message", "TEXT");
  ensureColumn(database, "providers", "last_checked_at", "INTEGER");
}

function ensureAgentRunsAwaitingInteraction(database: Database.Database) {
  const createSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs'")
    .get() as { sql?: string } | undefined;

  if (createSql?.sql?.includes("awaiting_interaction")) {
    return;
  }

  database.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE agent_runs_next (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'awaiting_interaction', 'done', 'error', 'cancelled')),
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO agent_runs_next (
      id,
      conversation_id,
      agent_id,
      status,
      started_at,
      finished_at,
      error,
      created_at,
      updated_at
    )
    SELECT
      id,
      conversation_id,
      agent_id,
      status,
      started_at,
      finished_at,
      error,
      created_at,
      updated_at
    FROM agent_runs;

    DROP TABLE agent_runs;
    ALTER TABLE agent_runs_next RENAME TO agent_runs;
    PRAGMA foreign_keys = ON;
  `);
}

function ensureConversationAgentsV2Migration(database: Database.Database) {
  const columns = database
    .prepare("PRAGMA table_info(conversation_agents)")
    .all() as Array<{ name: string }>;

  if (columns.some((c) => c.name === "alias")) {
    return;
  }

  database.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE conversation_agents_next (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      alias TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'primary',
      role_hint TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      joined_at INTEGER,
      locked_at INTEGER NOT NULL,
      runtime_context_json TEXT,
      created_at INTEGER NOT NULL
    );

    INSERT INTO conversation_agents_next (
      id, conversation_id, agent_id, alias, display_name, role, status, joined_at, locked_at, runtime_context_json, created_at
    )
    SELECT
      ca.id,
      ca.conversation_id,
      ca.agent_id,
      COALESCE(a.slug, 'unknown') AS alias,
      COALESCE(a.name, 'Unknown') AS display_name,
      ca.role,
      'active' AS status,
      COALESCE(ca.locked_at, ca.created_at) AS joined_at,
      ca.locked_at,
      NULL AS runtime_context_json,
      ca.created_at
    FROM conversation_agents ca
    LEFT JOIN agents a ON ca.agent_id = a.id;

    DROP TABLE conversation_agents;
    ALTER TABLE conversation_agents_next RENAME TO conversation_agents;

    CREATE UNIQUE INDEX conversation_agents_alias_unique_idx ON conversation_agents(conversation_id, alias);
    CREATE INDEX conversation_agents_agent_idx ON conversation_agents(conversation_id, agent_id);

    PRAGMA foreign_keys = ON;
  `);
}

function ensureMessagesV2Migration(database: Database.Database) {
  ensureColumn(database, "messages", "author_conversation_agent_id", "TEXT REFERENCES conversation_agents(id) ON DELETE SET NULL");
  ensureColumn(database, "messages", "orchestrator_task_id", "TEXT");

  const createSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
    .get() as { sql?: string } | undefined;

  if (createSql?.sql?.includes("'orchestrator'")) {
    return;
  }

  database.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE messages_next (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool', 'orchestrator')),
      author_name TEXT NOT NULL,
      agent_id TEXT REFERENCES agents(id),
      author_conversation_agent_id TEXT REFERENCES conversation_agents(id) ON DELETE SET NULL,
      orchestrator_task_id TEXT,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled')),
      created_at INTEGER NOT NULL
    );

    INSERT INTO messages_next (
      id, conversation_id, role, author_name, agent_id, author_conversation_agent_id, orchestrator_task_id, content, status, created_at
    )
    SELECT
      id, conversation_id, role, author_name, agent_id, author_conversation_agent_id, orchestrator_task_id, content, status, created_at
    FROM messages;

    DROP TABLE messages;
    ALTER TABLE messages_next RENAME TO messages;

    CREATE INDEX messages_conversation_created_idx ON messages(conversation_id, created_at);

    PRAGMA foreign_keys = ON;
  `);
}

function ensureAgentRunsV2Column(database: Database.Database) {
  ensureColumn(database, "agent_runs", "conversation_agent_id", "TEXT REFERENCES conversation_agents(id) ON DELETE SET NULL");
}

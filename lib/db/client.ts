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
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled')),
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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
  `);

  ensureColumn(database, "conversations", "archived_at", "INTEGER");
  ensureColumn(database, "conversations", "workspace_path", "TEXT NOT NULL DEFAULT ''");
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;

  if (!columns.some((current) => current.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

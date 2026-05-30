import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath =
  process.env.AGENTHUB_DB_PATH ?? path.join(root, "..", "data", "agenthub.sqlite");

const db = new Database(dbPath, { readonly: true });
const convId = "3a6fb8f6-5684-4392-956f-e98e66f1a9b7";

const sessions = db
  .prepare(`SELECT * FROM agent_external_sessions WHERE conversation_id = ?`)
  .all(convId);
const runs = db
  .prepare(`SELECT id, status, error, started_at, finished_at FROM agent_runs WHERE conversation_id = ? ORDER BY created_at DESC`)
  .all(convId);

console.log("sessions", JSON.stringify(sessions, null, 2));
console.log("runs", JSON.stringify(runs, null, 2));

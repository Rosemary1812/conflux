import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.AGENTHUB_DB_PATH ?? path.join(process.cwd(), "data", "agenthub.sqlite");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

safeAlter("agents", "is_system", "INTEGER NOT NULL DEFAULT 1");
safeAlter("agents", "system_prompt", "TEXT NOT NULL DEFAULT ''");
safeAlter("agents", "capabilities", "TEXT");
safeAlter("agents", "avatar_kind", "TEXT");
safeAlter("agents", "avatar_value", "TEXT");
safeAlter("agents", "permission_mode", "TEXT NOT NULL DEFAULT 'readonly'");
safeAlter("agents", "tool_profile", "TEXT");

db.exec(`
  UPDATE agents
  SET
    avatar_kind = COALESCE(avatar_kind, 'system'),
    avatar_value = COALESCE(avatar_value, slug)
  WHERE is_system = 1;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('built-in', 'user')),
    version INTEGER NOT NULL DEFAULT 1,
    source_attachment_id TEXT REFERENCES message_attachments(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE(agent_id, skill_id)
  );
`);

const now = Date.now();
const seedSkill = db.prepare(`
  INSERT INTO skills (id, slug, name, description, body, kind, version, source_attachment_id, created_at, updated_at)
  VALUES (@id, @slug, @name, @description, '', 'built-in', 1, NULL, @now, @now)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    kind = 'built-in',
    updated_at = excluded.updated_at
`);

seedSkill.run({
  id: "skill_agent_creator",
  slug: "agent-creator",
  name: "Agent Creator",
  description: "Create a custom Agent through a guided conversation.",
  now
});
seedSkill.run({
  id: "skill_skill_creator",
  slug: "skill-creator",
  name: "Skill Creator",
  description: "Create a reusable slash-command Skill.",
  now
});

const seedAgent = db.prepare(`
  INSERT INTO agents (id, slug, name, platform, description, enabled, is_system, system_prompt, capabilities, avatar_kind, avatar_value, permission_mode, tool_profile, created_at, updated_at)
  VALUES (@id, @slug, @name, @platform, @description, 1, 1, '', NULL, 'system', @slug, 'readonly', NULL, @now, @now)
  ON CONFLICT(slug) DO UPDATE SET
    name = excluded.name,
    platform = excluded.platform,
    description = excluded.description,
    enabled = 1,
    is_system = 1,
    avatar_kind = 'system',
    avatar_value = excluded.slug,
    updated_at = excluded.updated_at
`);

seedAgent.run({
  id: "agent_creator_system",
  slug: "agent-creator",
  name: "Agent Creator",
  platform: "claude_code",
  description: "Conflux built-in /agent-creator workflow. Carries Choice cards for the guided Agent creation flow.",
  now
});

for (const table of ["agents", "skills", "agent_skills"]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.length > 0;

  console.log(`\n[${table}] ${exists ? "exists" : "missing"}`);

  for (const column of columns) {
    const required = column.notnull ? " NOT NULL" : "";
    const defaultValue = column.dflt_value === null ? "" : ` DEFAULT ${column.dflt_value}`;
    console.log(`- ${column.name}: ${column.type}${required}${defaultValue}`);
  }
}

console.log("\n[built-in skills]");
console.table(db.prepare("SELECT slug, kind, version FROM skills WHERE kind = 'built-in' ORDER BY slug").all());

console.log("\n[built-in system agents]");
console.table(
  db
    .prepare("SELECT slug, name, platform, is_system FROM agents WHERE is_system = 1 ORDER BY slug")
    .all()
);

db.close();

function safeAlter(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((current) => current.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/db/schema";
import { agents } from "@/lib/db/schema";

const builtinAgents = [
  {
    id: "agent_claude_code",
    slug: "claude-code",
    name: "Claude Code",
    platform: "claude_code",
    description: "Claude Code CLI adapter placeholder for V1 single-chat execution."
  },
  {
    id: "agent_codex",
    slug: "codex",
    name: "Codex",
    platform: "codex",
    description: "Codex CLI adapter placeholder for V1 single-chat execution."
  },
  {
    id: "agent_hermes",
    slug: "hermes",
    name: "Hermes",
    platform: "hermes",
    description: "Hermes agent adapter placeholder."
  },
  {
    id: "agent_openclaw",
    slug: "openclaw",
    name: "OpenClaw",
    platform: "openclaw",
    description: "OpenClaw agent adapter placeholder."
  }
] as const;

export function seedAgents(db: BetterSQLite3Database<typeof schema>) {
  const now = Date.now();

  for (const agent of builtinAgents) {
    db.insert(agents)
      .values({
        ...agent,
        enabled: true,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: agents.slug,
        set: {
          name: agent.name,
          platform: agent.platform,
          description: agent.description,
          enabled: true,
          updatedAt: now
        }
      })
      .run();
  }
}

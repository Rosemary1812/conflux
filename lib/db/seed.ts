import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { agents, skills } from "@/lib/db/schema";

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
    id: "agent_opencode",
    slug: "opencode",
    name: "OpenCode",
    platform: "opencode",
    description: "OpenCode CLI adapter for V1 single-chat execution."
  }
] as const;

const builtinSkills = [
  {
    id: "skill_agent_creator",
    slug: "agent-creator",
    name: "Agent Creator",
    description: "Create a custom Agent through a guided conversation.",
    body: ""
  },
  {
    id: "skill_skill_creator",
    slug: "skill-creator",
    name: "Skill Creator",
    description: "Create a reusable slash-command Skill.",
    body: ""
  }
] as const;

export function seedAgents(db: BetterSQLite3Database<typeof schema>) {
  const now = Date.now();

  for (const agent of builtinAgents) {
    db.insert(agents)
      .values({
        ...agent,
        enabled: true,
        isSystem: true,
        systemPrompt: "",
        capabilities: null,
        avatarKind: "system",
        avatarValue: agent.slug,
        permissionMode: "readonly",
        toolProfile: null,
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
          isSystem: true,
          systemPrompt: "",
          capabilities: null,
          avatarKind: "system",
          avatarValue: agent.slug,
          permissionMode: "readonly",
          toolProfile: null,
          updatedAt: now
        }
      })
      .run();
  }

  for (const skill of builtinSkills) {
    db.insert(skills)
      .values({
        ...skill,
        kind: "built-in",
        version: 1,
        sourceAttachmentId: null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: skills.slug,
        set: {
          name: skill.name,
          description: skill.description,
          kind: "built-in",
          body: skill.body,
          updatedAt: now
        }
      })
      .run();
  }

  db.update(agents)
    .set({
      enabled: false,
      updatedAt: now
    })
    .where(eq(agents.slug, "openclaw"))
    .run();
}

import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { skills } from "@/lib/db/schema";
import type { SkillSummary } from "@/lib/skills/types";

const builtinFallbacks: SkillSummary[] = [
  {
    id: "skill_agent_creator",
    slug: "agent-creator",
    name: "Agent Creator",
    description: "Create a custom Agent through a guided conversation.",
    kind: "built-in",
    version: 1
  },
  {
    id: "skill_skill_creator",
    slug: "skill-creator",
    name: "Skill Creator",
    description: "Create a reusable slash-command Skill.",
    kind: "built-in",
    version: 1
  }
];

export function getSkills(): SkillSummary[] {
  const rows = getDb().select().from(skills).orderBy(asc(skills.slug)).all();
  const bySlug = new Map<string, SkillSummary>();

  for (const skill of builtinFallbacks) {
    bySlug.set(skill.slug, skill);
  }

  for (const skill of rows) {
    bySlug.set(skill.slug, {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      kind: skill.kind,
      version: skill.version
    });
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function getSkillBySlug(slug: string) {
  return getSkills().find((skill) => skill.slug === slug) ?? null;
}

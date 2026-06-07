import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { getSkillBySlug } from "@/lib/skills/registry";

export function runSkill({
  slug,
  conversationId,
  userMessageId,
  input
}: {
  slug: string;
  conversationId: string;
  userMessageId: string;
  input: string;
}) {
  const skill = getSkillBySlug(slug);

  if (!skill) {
    return { handled: false as const };
  }

  console.info(`[skills] ${slug} requested`, { conversationId, userMessageId, hasInput: Boolean(input.trim()) });

  const now = Date.now();
  getDb()
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      conversationId,
      role: "assistant",
      authorName: "Conflux Skill",
      content: `/${slug} 已识别。当前 Phase 只接入命令路由骨架；真实引导流程将在后续 Phase 实现。`,
      status: "done",
      createdAt: now
    })
    .run();

  getDb()
    .update(conversations)
    .set({
      status: "done",
      updatedAt: now
    })
    .where(eq(conversations.id, conversationId))
    .run();

  return { handled: true as const };
}

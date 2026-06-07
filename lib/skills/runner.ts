import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { getSkillBySlug } from "@/lib/skills/registry";
import { runAgentCreator } from "@/lib/skills/agent-creator/runner";

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

  if (slug === "agent-creator") {
    void runAgentCreator({
      conversationId,
      userMessageId,
      text: input
    }).then((result) => {
      if (result.kind === "ignored") {
        appendAssistant(
          conversationId,
          `/agent-creator 当前无法启动：${result.reason}。\n提示：本 Phase 仅在单聊工作；如需自建 Agent，请先在单聊中调起。`
        );
      } else if (result.kind === "error") {
        appendAssistant(
          conversationId,
          `Agent Creator 暂时遇到问题：${result.error}`
        );
      } else if (result.kind === "cancelled") {
        appendAssistant(conversationId, "Agent Creator 已取消。");
      }
    });
    return { handled: true as const };
  }

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

function appendAssistant(conversationId: string, content: string) {
  const now = Date.now();
  getDb()
    .insert(messages)
    .values({
      id: crypto.randomUUID(),
      conversationId,
      role: "assistant",
      authorName: "Conflux Skill",
      content,
      status: "done",
      createdAt: now
    })
    .run();
  getDb()
    .update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();
}

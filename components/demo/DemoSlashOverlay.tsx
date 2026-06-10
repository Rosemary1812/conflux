"use client";

import { useEffect, useState } from "react";
import { SlashCommandPanel } from "@/components/chat/SlashCommandPanel";
import type { SkillSummary } from "@/lib/skills/types";

const builtinSkills: SkillSummary[] = [
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

// 演示中只让 slash 菜单露脸一小会儿,模拟"用户敲完 / 选中并回车"之后菜单自动收回
const VISIBLE_DURATION_MS = 1500;

export function DemoSlashOverlay() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), VISIBLE_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "relative",
        width: "min(100%, var(--chat-max-width))",
        margin: "0 auto",
        height: 0
      }}
    >
      <SlashCommandPanel activeIndex={0} onSelect={() => {}} skills={builtinSkills} />
    </div>
  );
}

"use client";

import type { SkillSummary } from "@/lib/skills/types";

type SlashCommandPanelProps = {
  activeIndex: number;
  skills: SkillSummary[];
  onSelect: (skill: SkillSummary) => void;
};

export function SlashCommandPanel({ activeIndex, skills, onSelect }: SlashCommandPanelProps) {
  if (skills.length === 0) {
    return null;
  }

  return (
    <div className="slash-panel" role="listbox" aria-label="斜杠命令">
      {skills.map((skill, index) => (
        <button
          aria-selected={index === activeIndex}
          className={index === activeIndex ? "slash-option active" : "slash-option"}
          key={skill.slug}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(skill);
          }}
          role="option"
          type="button"
        >
          <span className="slash-command">/{skill.slug}</span>
          <span className="slash-copy">
            <strong>{skill.name}</strong>
            <small>{skill.description}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

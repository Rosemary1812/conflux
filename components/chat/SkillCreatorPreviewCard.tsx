"use client";

import { Check, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";
import type { SkillDraft } from "@/lib/skills/skill-creator/types";

export type SkillCreatorPreviewCardProps = {
  draft: SkillDraft;
  status: "preview" | "saving" | "done" | "error";
  error?: string;
  onSave: () => Promise<void> | void;
  onRegenerate: (instruction?: string) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
};

export function SkillCreatorPreviewCard({
  draft,
  status,
  error,
  onSave,
  onRegenerate,
  onCancel
}: SkillCreatorPreviewCardProps) {
  const [isBusy, setIsBusy] = useState(false);

  async function run(action: () => Promise<void> | void) {
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="interaction-card skill-creator-preview">
      <div className="interaction-header">
        <span className="interaction-kicker">Skill Creator · 预览</span>
        <strong>{draft.name}（/{draft.slug}）</strong>
      </div>

      <dl className="interaction-details">
        <div>
          <dt>名称</dt>
          <dd>{draft.name}</dd>
        </div>
        <div>
          <dt>命令</dt>
          <dd>/{draft.slug}</dd>
        </div>
        <div>
          <dt>描述</dt>
          <dd>{draft.description}</dd>
        </div>
        <div>
          <dt>Skill 正文</dt>
          <dd className="skill-creator-body">{draft.body}</dd>
        </div>
      </dl>

      {error ? <p className="agent-creator-error">{error}</p> : null}

      <div className="interaction-actions">
        <button
          className="secondary-button compact"
          disabled={isBusy || status === "saving"}
          onClick={() => void run(onCancel)}
          type="button"
        >
          <X size={14} />
          取消
        </button>
        <button
          className="message-action-button"
          disabled={isBusy || status === "saving"}
          onClick={() => void run(() => onRegenerate())}
          type="button"
        >
          <RotateCcw size={14} />
          再改一下
        </button>
        <button
          className="primary-button compact"
          disabled={isBusy || status === "saving"}
          onClick={() => void run(onSave)}
          type="button"
        >
          {status === "done" ? <Check size={14} /> : <Save size={14} />}
          {status === "saving" ? "保存中..." : status === "done" ? "已保存" : "保存"}
        </button>
      </div>
    </section>
  );
}

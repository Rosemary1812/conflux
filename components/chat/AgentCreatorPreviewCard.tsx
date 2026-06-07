"use client";

import { Check, RotateCcw, Save, X } from "lucide-react";
import { useState } from "react";
import type { AgentDraft } from "@/lib/skills/agent-creator/types";

export type AgentCreatorPreviewCardProps = {
  draft: AgentDraft;
  status: "preview" | "saving" | "done" | "error";
  error?: string;
  onSave: () => Promise<void> | void;
  onRegenerate: (instruction?: string) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
};

export function AgentCreatorPreviewCard({
  draft,
  status,
  error,
  onSave,
  onRegenerate,
  onCancel
}: AgentCreatorPreviewCardProps) {
  const [dangerConfirmed, setDangerConfirmed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [showDanger, setShowDanger] = useState(false);

  const isDangerous = draft.tool_profile === "executor";
  const canSave = !isDangerous || dangerConfirmed;

  async function handleSave() {
    if (isDangerous && !dangerConfirmed) {
      setShowDanger(true);
      return;
    }
    setIsBusy(true);
    try {
      await onSave();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRegenerate() {
    setIsBusy(true);
    try {
      await onRegenerate();
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCancel() {
    setIsBusy(true);
    try {
      await onCancel();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="interaction-card agent-creator-preview">
      <div className="interaction-header">
        <span className="interaction-kicker">Agent Creator · 预览</span>
        <strong>{draft.display_name}（@{draft.alias}）</strong>
      </div>

      <dl className="interaction-details">
        <div>
          <dt>名称</dt>
          <dd>{draft.name}</dd>
        </div>
        <div>
          <dt>描述</dt>
          <dd>{draft.description}</dd>
        </div>
        <div>
          <dt>权限</dt>
          <dd>{draft.permission_mode === "readonly" ? "只读" : "可读写"}</dd>
        </div>
        <div>
          <dt>工具档位</dt>
          <dd>
            {draft.tool_profile}
            {isDangerous ? <span className="agent-creator-danger-tag">⚠️ 高危</span> : null}
          </dd>
        </div>
        <div>
          <dt>能力标签</dt>
          <dd>{draft.capabilities.length > 0 ? draft.capabilities.join("、") : "（无）"}</dd>
        </div>
        <div>
          <dt>头像</dt>
          <dd>{draft.avatar.value}（默认 emoji；自定义头像将在后续设置页开放）</dd>
        </div>
        <div>
          <dt>系统提示词</dt>
          <dd className="agent-creator-prompt">{draft.system_prompt}</dd>
        </div>
      </dl>

      {isDangerous && showDanger ? (
        <label className="agent-creator-danger-confirm">
          <input
            checked={dangerConfirmed}
            onChange={(event) => setDangerConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>我了解 executor 档位会允许 Agent 执行任意命令，包括 rm -rf 等高危操作。</span>
        </label>
      ) : null}

      {error ? <p className="agent-creator-error">{error}</p> : null}

      <div className="interaction-actions">
        <button
          className="secondary-button compact"
          disabled={isBusy || status === "saving"}
          onClick={handleCancel}
          type="button"
        >
          <X size={14} />
          取消
        </button>
        <button
          className="message-action-button"
          disabled={isBusy || status === "saving"}
          onClick={handleRegenerate}
          type="button"
        >
          <RotateCcw size={14} />
          再改一下
        </button>
        <button
          className="primary-button compact"
          disabled={isBusy || status === "saving" || !canSave}
          onClick={handleSave}
          type="button"
        >
          {status === "done" ? <Check size={14} /> : <Save size={14} />}
          {status === "saving" ? "保存中…" : status === "done" ? "已保存" : "保存"}
        </button>
      </div>
    </section>
  );
}

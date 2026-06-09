"use client";

import { ArrowLeft, Plus, RefreshCcw, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { AgentSummary } from "@/lib/agents/types";
import { listProfileMetas, type ProfileMeta } from "@/lib/skills/agent-creator/profiles";
import { AgentAvatar } from "@/components/agents/AgentAvatar";

export type AgentFormDraft = {
  name: string;
  alias: string;
  description: string;
  systemPrompt: string;
  permissionMode: "readonly" | "editable";
  toolProfile: "readonly" | "code-author" | "executor";
  capabilities: string[];
  avatarKind: "emoji" | "uploaded";
  avatarValue: string;
};

export type AgentFormErrors = Partial<Record<keyof AgentFormDraft, string>>;

const SYSTEM_PROMPT_MAX = 8000;
const CAPABILITY_MAX_ITEMS = 8;
const CAPABILITY_MAX_LENGTH = 24;

type AgentEditPanelProps = {
  data: AgentSummary;
  draft: AgentFormDraft;
  fieldErrors: AgentFormErrors;
  onChange: (patch: Partial<AgentFormDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
  isSaving: boolean;
};

export function AgentEditPanel({
  data,
  draft,
  fieldErrors,
  onChange,
  onSave,
  onCancel,
  onRegenerate,
  isSaving
}: AgentEditPanelProps) {
  const profiles = listProfileMetas();
  const [capabilityInput, setCapabilityInput] = useState("");

  function handleCapabilityKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const trimmed = capabilityInput.trim();
      if (!trimmed) return;
      if (draft.capabilities.length >= CAPABILITY_MAX_ITEMS) return;
      if (trimmed.length > CAPABILITY_MAX_LENGTH) return;
      if (draft.capabilities.includes(trimmed)) {
        setCapabilityInput("");
        return;
      }
      onChange({ capabilities: [...draft.capabilities, trimmed] });
      setCapabilityInput("");
    }
  }

  function removeCapability(tag: string) {
    onChange({ capabilities: draft.capabilities.filter((item) => item !== tag) });
  }

  async function pickUploadedAvatar() {
    try {
      const response = await fetch("/api/attachments/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageOnly: true })
      });
      const payload = (await response.json()) as {
        attachments?: Array<{ path: string; fileName: string; mimeType: string; size: number }>;
        cancelled?: boolean;
        error?: string;
      };
      if (payload.cancelled) return;
      if (payload.error) {
        onChange({ avatarKind: "emoji", avatarValue: "🤖" });
        return;
      }
      const first = payload.attachments?.[0];
      if (!first) return;
      onChange({ avatarKind: "uploaded", avatarValue: first.path });
    } catch {
      onChange({ avatarKind: "emoji", avatarValue: "🤖" });
    }
  }

  function pickEmojiAvatar() {
    const next = window.prompt("输入 emoji 头像（≤ 8 字符）", draft.avatarValue || "🤖");
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    if (trimmed.length > 8) return;
    onChange({ avatarKind: "emoji", avatarValue: trimmed });
  }

  const isExecutor = draft.toolProfile === "executor";

  return (
    <div className="agent-edit-panel">
      <div className="custom-agent-detail-bar">
        <button className="btn ghost" onClick={onCancel} type="button">
          <ArrowLeft size={13} />
          取消编辑
        </button>
        <span>·</span>
        <span>{data.name}</span>
      </div>

      <div className="avatar-picker">
        <AgentAvatar
          agentId={data.id}
          kind={draft.avatarKind}
          value={draft.avatarValue}
          slug={data.slug}
          size={48}
        />
        <div className="avatar-picker-info">
          <strong>
            当前：
            {draft.avatarKind === "uploaded" ? "已上传图片" : `${draft.avatarValue || "🤖"} (emoji)`}
          </strong>
          <small>支持 emoji（≤ 8 字符）或本地图片（jpg/png/webp/gif/svg，≤ 1MB）</small>
        </div>
        <button className="btn" onClick={pickEmojiAvatar} type="button">
          Emoji
        </button>
        <button className="btn" onClick={pickUploadedAvatar} type="button">
          上传图片
        </button>
      </div>

      <div className="edit-form">
        <div>
          <label className="required">名称</label>
          <input
            type="text"
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            maxLength={48}
          />
          {fieldErrors.name ? <div className="field-error">{fieldErrors.name}</div> : null}
        </div>

        <div>
          <label className="required">Alias（@mention 名字）</label>
          <input
            type="text"
            value={draft.alias}
            onChange={(event) => onChange({ alias: event.target.value })}
            maxLength={32}
          />
          <div className="field-hint warn">
            ⚠️ alias 改名只影响新建 @ 提及；历史 conversation_agents 行的 alias 保留。
          </div>
          {fieldErrors.alias ? <div className="field-error">{fieldErrors.alias}</div> : null}
        </div>

        <div>
          <label className="required">描述</label>
          <input
            type="text"
            value={draft.description}
            onChange={(event) => onChange({ description: event.target.value })}
            maxLength={240}
          />
          {fieldErrors.description ? <div className="field-error">{fieldErrors.description}</div> : null}
        </div>

        <div>
          <label className="required">System Prompt（{SYSTEM_PROMPT_MAX} 字符上限）</label>
          <textarea
            value={draft.systemPrompt}
            onChange={(event) => onChange({ systemPrompt: event.target.value })}
            maxLength={SYSTEM_PROMPT_MAX}
          />
          <div className="char-count">
            {draft.systemPrompt.length} / {SYSTEM_PROMPT_MAX}
          </div>
          {fieldErrors.systemPrompt ? <div className="field-error">{fieldErrors.systemPrompt}</div> : null}
        </div>

        <div className="field-row-2">
          <div>
            <label>权限</label>
            <select
              value={draft.permissionMode}
              onChange={(event) =>
                onChange({ permissionMode: event.target.value as AgentFormDraft["permissionMode"] })
              }
            >
              <option value="readonly">readonly</option>
              <option value="editable">editable</option>
            </select>
          </div>
          <div className={isExecutor ? "profile-danger" : ""}>
            <label>工具 profile</label>
            <select
              value={draft.toolProfile}
              onChange={(event) =>
                onChange({ toolProfile: event.target.value as AgentFormDraft["toolProfile"] })
              }
            >
              {profiles.map((profile: ProfileMeta) => (
                <option key={profile.key} value={profile.key}>
                  {profile.key} · {profile.name}
                </option>
              ))}
            </select>
            {isExecutor ? <div className="profile-danger-hint">⚠️ 高危：全权限执行，需谨慎使用</div> : null}
          </div>
        </div>

        <div>
          <label>能力标签（≤ {CAPABILITY_MAX_ITEMS} 个，每项 ≤ {CAPABILITY_MAX_LENGTH} 字符）</label>
          <div className="capability-tag-editor">
            {draft.capabilities.map((tag) => (
              <span className="capability-tag" key={tag}>
                {tag}
                <span
                  className="capability-tag-remove"
                  role="button"
                  tabIndex={0}
                  onClick={() => removeCapability(tag)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") removeCapability(tag);
                  }}
                >
                  <X size={12} />
                </span>
              </span>
            ))}
            <input
              className="capability-tag-input"
              value={capabilityInput}
              onChange={(event) => setCapabilityInput(event.target.value)}
              onKeyDown={handleCapabilityKeyDown}
              placeholder={
                draft.capabilities.length >= CAPABILITY_MAX_ITEMS
                  ? "已达上限"
                  : "输入新标签后回车..."
              }
              disabled={draft.capabilities.length >= CAPABILITY_MAX_ITEMS}
            />
            {draft.capabilities.length < CAPABILITY_MAX_ITEMS ? (
              <button
                className="capability-tag-remove"
                onClick={() => {
                  if (!capabilityInput.trim()) return;
                  handleCapabilityKeyDown({
                    key: "Enter",
                    preventDefault: () => undefined
                  } as unknown as KeyboardEvent<HTMLInputElement>);
                }}
                type="button"
                aria-label="添加标签"
                style={{ background: "none", border: "none", padding: 0 }}
              >
                <Plus size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="regen-block">
          <h6>重新生成 profile（LLM 用当前字段 + 可选说明）</h6>
          <p>不持久化 regen 会话；点击下方按钮触发一次 Planner LLM 调用，结果回填到上方表单。</p>
          <button className="btn" onClick={onRegenerate} type="button" disabled={isSaving}>
            <RefreshCcw size={13} />
            重新生成
          </button>
        </div>

        <div className="form-actions">
          <button className="btn ghost" onClick={onCancel} type="button" disabled={isSaving}>
            取消
          </button>
          <button className="btn primary" onClick={onSave} type="button" disabled={isSaving}>
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

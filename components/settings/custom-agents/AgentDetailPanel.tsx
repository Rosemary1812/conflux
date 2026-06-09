"use client";

import { useState } from "react";
import { ArrowLeft, RefreshCcw, Trash2 } from "lucide-react";
import type { AgentSummary } from "@/lib/agents/types";
import { AgentAvatar } from "@/components/agents/AgentAvatar";

type AgentDeletePrecheck = {
  canDelete: boolean;
  activeRunCount: number;
  conversationCount: number;
};

type AgentDetailPanelProps = {
  data: AgentSummary;
  precheck: AgentDeletePrecheck | null;
  onBack: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  isRegenerating?: boolean;
};

export function AgentDetailPanel({
  data,
  precheck,
  onBack,
  onEdit,
  onRegenerate,
  onDelete,
  isRegenerating = false
}: AgentDetailPanelProps) {
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);
  const SYSTEM_PROMPT_PREVIEW_LINES = 6;

  const systemPromptLines = data.systemPrompt.split("\n");
  const showExpand = systemPromptLines.length > SYSTEM_PROMPT_PREVIEW_LINES;
  const visibleSystemPrompt = systemPromptExpanded
    ? data.systemPrompt
    : systemPromptLines.slice(0, SYSTEM_PROMPT_PREVIEW_LINES).join("\n");

  const canDelete = precheck?.canDelete ?? true;
  const deleteTooltip = precheck && !precheck.canDelete
    ? `该 Agent 还有 ${precheck.activeRunCount} 个任务未完成，请先取消或等待。`
    : "该 Agent 仍在 " + (precheck?.conversationCount ?? 0) + " 个群聊的 roster 中（删除会清掉）";

  return (
    <div className="agent-detail-panel">
      <div className="custom-agent-detail-bar">
        <button className="btn ghost" onClick={onBack} type="button">
          <ArrowLeft size={13} />
          返回列表
        </button>
        <span>·</span>
        <span>{data.name}</span>
      </div>

      <div className="custom-agent-detail-head">
        <AgentAvatar
          kind={data.avatarKind ?? "emoji"}
          value={data.avatarValue ?? "🤖"}
          slug={data.slug}
          size={48}
        />
        <div>
          <h4>{data.name}</h4>
          <div className="custom-agent-row-alias">@{data.slug} · 平台 {data.platform}</div>
        </div>
      </div>

      <div className="custom-agent-detail-section">
        <h5>描述</h5>
        <div className="custom-agent-detail-body">{data.description}</div>
      </div>

      <div className="custom-agent-detail-section">
        <h5>System Prompt（前 8000 字符）</h5>
        <pre className="custom-agent-detail-pre">{visibleSystemPrompt}</pre>
        {showExpand ? (
          <button
            className="btn ghost"
            onClick={() => setSystemPromptExpanded((value) => !value)}
            style={{ marginTop: 6, fontSize: 12 }}
            type="button"
          >
            {systemPromptExpanded ? "收起" : "展开"}
          </button>
        ) : null}
      </div>

      <div className="custom-agent-detail-section">
        <div className="custom-agent-detail-field-row">
          <div>
            <span className="label">权限：</span>
            <span className="value">{data.permissionMode}</span>
          </div>
          <div>
            <span className="label">工具 profile：</span>
            <span className="value">{data.toolProfile ?? "未设置"}</span>
          </div>
        </div>
        {data.capabilities && data.capabilities.length > 0 ? (
          <div className="custom-agent-detail-field-row" style={{ marginTop: 8 }}>
            <div>
              <span className="label">能力：</span>
            </div>
            <div className="custom-agent-row-tags">
              {data.capabilities.map((tag) => (
                <span className="capability-tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="custom-agent-detail-field-row" style={{ marginTop: 8 }}>
          <div>
            <span className="label">头像：</span>
            <span className="value">
              {data.avatarKind === "uploaded"
                ? "已上传图片"
                : data.avatarKind === "emoji"
                  ? `${data.avatarValue ?? "🤖"} (emoji)`
                  : "系统默认"}
            </span>
          </div>
        </div>
      </div>

      <div className="custom-agent-detail-actions">
        <button className="btn" disabled={isRegenerating} onClick={onRegenerate} type="button">
          <RefreshCcw size={13} />
          {isRegenerating ? "生成中..." : "重新生成 profile"}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn primary" disabled={isRegenerating} onClick={onEdit} type="button">
          编辑
        </button>
      </div>

      <div className="custom-agent-danger-zone">
        <h6>删除（不可恢复）</h6>
        <p>{deleteTooltip}</p>
        <div className="custom-agent-delete-wrap">
          <button
            className="btn danger"
            disabled={!canDelete}
            onClick={canDelete ? onDelete : undefined}
            type="button"
          >
            <Trash2 size={13} />
            删除自建 Agent
          </button>
          {!canDelete ? <div className="custom-agent-tooltip">{precheck?.activeRunCount} 个任务未完成</div> : null}
        </div>
      </div>
    </div>
  );
}

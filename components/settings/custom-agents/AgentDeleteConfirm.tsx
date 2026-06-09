"use client";

import { Trash2, X } from "lucide-react";
import type { AgentSummary } from "@/lib/agents/types";
import type { AgentDeletePrecheck } from "@/lib/conversations/service";

type AgentDeleteConfirmProps = {
  data: AgentSummary;
  precheck: AgentDeletePrecheck;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AgentDeleteConfirm({
  data,
  precheck,
  isDeleting,
  onConfirm,
  onCancel
}: AgentDeleteConfirmProps) {
  return (
    <div
      className="custom-agent-confirm-backdrop"
      onClick={isDeleting ? undefined : onCancel}
      role="presentation"
    >
      <div
        className="custom-agent-confirm"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
      >
        <button
          aria-label="关闭"
          className="custom-agent-confirm-close"
          disabled={isDeleting}
          onClick={onCancel}
          type="button"
        >
          <X size={15} />
        </button>
        <h4>删除自建 Agent</h4>
        <p>
          你即将删除 <strong>{data.name}</strong>（<code>@{data.slug}</code>）。
        </p>
        {precheck.conversationUsage.length > 0 ? (
          <>
            <p>该 Agent 仍出现在 {precheck.conversationUsage.length} 个群聊的 roster 中：</p>
            <ul className="custom-agent-confirm-roster">
              {precheck.conversationUsage.map((entry) => (
                <li key={entry.conversationId}>
                  · {entry.title} <span className="custom-agent-confirm-roster-meta">（@{entry.alias}）</span>
                </li>
              ))}
            </ul>
            <p>删除后，这些 roster 会显示"已删除 Agent"。</p>
          </>
        ) : null}
        <p>该 Agent 的历史 run / 消息 / interaction 保留。</p>
        <p className="custom-agent-confirm-warn">⚠️ 此操作不可恢复。</p>

        <div className="custom-agent-confirm-actions">
          <button
            className="btn ghost"
            disabled={isDeleting}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="btn danger"
            disabled={isDeleting}
            onClick={onConfirm}
            type="button"
          >
            <Trash2 size={13} />
            {isDeleting ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

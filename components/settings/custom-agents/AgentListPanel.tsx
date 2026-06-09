"use client";

import { Pencil } from "lucide-react";
import type { SelfBuiltAgentListItem } from "@/lib/agents/types";
import { AgentAvatar } from "@/components/agents/AgentAvatar";

type AgentListPanelProps = {
  agents: SelfBuiltAgentListItem[];
  onSelect: (agentId: string) => void;
  onEdit: (agentId: string) => void;
  isLoading: boolean;
  error: string | null;
};

function formatLastRun(finishedAt: number): string {
  const now = Date.now();
  const diff = now - finishedAt;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  return `${Math.floor(diff / day)} 天前`;
}

export function AgentListPanel({ agents, onSelect, onEdit, isLoading, error }: AgentListPanelProps) {
  if (isLoading) {
    return <p className="desc">加载中...</p>;
  }

  if (error) {
    return <p className="desc" style={{ color: "var(--red)" }}>{error}</p>;
  }

  if (agents.length === 0) {
    return (
      <div className="custom-agent-empty">
        <h4>还没有自建 Agent</h4>
        <p>在单聊里调 <code>/agent-creator</code> 创建一个。</p>
      </div>
    );
  }

  return (
    <div className="custom-agent-list">
      <div className="custom-agent-list-head">
        <span>所有自建 Agent（按更新时间倒序）</span>
        <span>{agents.length} 个</span>
      </div>
      {agents.map((agent) => (
        <div
          className="custom-agent-row"
          key={agent.id}
          onClick={() => onSelect(agent.id)}
        >
          <AgentAvatar kind={agent.avatarKind} value={agent.avatarValue} slug={agent.slug} size={36} />
          <div className="custom-agent-row-main">
            <div className="custom-agent-row-title">
              {agent.name}
              <span className="custom-agent-row-alias">@{agent.slug}</span>
            </div>
            {agent.capabilities && agent.capabilities.length > 0 ? (
              <div className="custom-agent-row-tags">
                {agent.capabilities.map((tag) => (
                  <span className="capability-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="custom-agent-row-meta">
            <span className="label">最后运行</span>
            <span className="value">
              {agent.lastRun ? formatLastRun(agent.lastRun.finishedAt) : "从未"}
            </span>
          </div>
          <button
            className="custom-agent-row-edit"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(agent.id);
            }}
            type="button"
            aria-label={`编辑 ${agent.name}`}
          >
            <Pencil size={12} />
            编辑
          </button>
        </div>
      ))}
    </div>
  );
}

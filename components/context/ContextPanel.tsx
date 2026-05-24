"use client";

import { FileText, GripVertical } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { AgentIcon } from "@/components/agents/AgentIcon";
import type { ConversationSummary, ConversationView, MockMessage } from "@/lib/conversations/types";

type ContextPanelProps = {
  conversation: ConversationSummary | null;
  messages: MockMessage[];
  onResize: (width: number) => void;
  view: ConversationView;
};

export function ContextPanel({ conversation, messages, onResize, view }: ContextPanelProps) {
  const isGroup = view === "group" || view === "new-group";
  const isNew = view === "new-single" || view === "new-group" || (!conversation?.lockedAgent && messages.length === 0);

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const width = Math.min(460, Math.max(240, window.innerWidth - moveEvent.clientX));
      onResize(width);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  return (
    <aside className="context-panel">
      <div className="context-resizer" onMouseDown={handleMouseDown}>
        <GripVertical size={14} />
      </div>
      <div className="context-topbar">
        <h2>{isGroup ? "群聊上下文" : "当前上下文"}</h2>
      </div>

      {isNew ? (
        <NewConversationContext isGroup={isGroup} />
      ) : isGroup ? (
        <GroupContext />
      ) : (
        <SingleContext conversation={conversation} />
      )}
    </aside>
  );
}

function NewConversationContext({ isGroup }: { isGroup: boolean }) {
  return (
    <div className="context-content">
      <section className="context-section">
        <div className="section-title">初始化规则</div>
        <div className="status-card">
          <span className="status-dot idle" />
          <div>
            <strong>{isGroup ? "等待多个 @Agent" : "等待一个 @Agent"}</strong>
            <p>{isGroup ? "Orchestrator 仅在 UI 中自动展示" : "发送成功后锁定当前 Agent"}</p>
          </div>
        </div>
      </section>
      <section className="context-section">
        <div className="section-title">可用 Agent</div>
        <ul className="file-list">
          <li><AgentIcon agent="claude-code" size={18} />Claude Code</li>
          <li><AgentIcon agent="codex" size={18} />Codex</li>
          <li><AgentIcon agent="hermes" size={18} />Hermes</li>
          <li><AgentIcon agent="opencode" size={18} />OpenCode</li>
        </ul>
      </section>
    </div>
  );
}

function SingleContext({ conversation }: { conversation: ConversationSummary | null }) {
  const agent = conversation?.lockedAgent;

  return (
    <div className="context-content">
      <section className="context-section">
        <div className="section-title">Agent 状态</div>
        <div className="status-card">
          <span className="context-agent-icon"><AgentIcon agent={agent?.slug ?? "claude-code"} size={24} /></span>
          <div>
            <strong>{agent?.name ?? "等待锁定 Agent"}</strong>
            <p>{agent ? `已锁定 · ${conversation.status === "running" ? "运行中" : "待命"}` : "首条消息发送后锁定"}</p>
          </div>
        </div>
      </section>
      <section className="context-section">
        <div className="section-title">进度</div>
        <ul className="todo-list">
          <li className="done">会话已落库</li>
          <li className="done">消息历史可刷新恢复</li>
          <li className={conversation?.status === "running" ? undefined : "done"}>SSE 与运行状态已接入</li>
        </ul>
      </section>
      <section className="context-section">
        <div className="section-title">产出文件</div>
        <ul className="file-list">
          <li>
            <FileText size={14} />
            Phase 3 暂不生成产物
          </li>
        </ul>
      </section>
    </div>
  );
}

function GroupContext() {
  return (
    <div className="context-content">
      <section className="context-section">
        <div className="section-title">参与上下文</div>
        <div className="agent-stack-card">
          <AgentState name="Claude Code" status="已完成" tone="done" />
          <AgentState name="Codex" status="进行中（mock）" tone="running" />
          <AgentState name="Orchestrator" status="已分派 2 任务（mock）" tone="orchestrator" />
        </div>
      </section>
      <section className="context-section">
        <div className="section-title">任务分派</div>
        <div className="task-card compact">
          <strong>task_1</strong>
          <p>Claude Code · 设置页 UI</p>
        </div>
        <div className="task-card compact">
          <strong>task_2</strong>
          <p>Codex · API + 测试</p>
        </div>
      </section>
      <section className="context-section">
        <div className="section-title">V1 边界</div>
        <p className="context-note">该页面只展示产品形态，不调用真实 Orchestrator 或多个 Agent。</p>
      </section>
    </div>
  );
}

function AgentState({
  name,
  status,
  tone
}: {
  name: string;
  status: string;
  tone: "done" | "running" | "orchestrator";
}) {
  return (
    <div className="agent-state-row">
      <span className="context-agent-icon">
        {name === "Claude Code" ? (
          <AgentIcon agent="claude-code" size={22} />
        ) : name === "Codex" ? (
          <AgentIcon agent="codex" size={22} />
        ) : (
          <AgentIcon agent="orchestrator" size={22} />
        )}
      </span>
      <div>
        <strong>{name}</strong>
        <p>{status}</p>
      </div>
    </div>
  );
}

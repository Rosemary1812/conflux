"use client";

import { FileText, GripVertical, TerminalSquare, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "@/components/agents/AgentIcon";
import type { ConversationArtifact, ConversationSummary, ConversationView, MockMessage } from "@/lib/conversations/types";

type ContextPanelProps = {
  conversation: ConversationSummary | null;
  draftWorkspacePath?: string;
  mode: "context" | "terminal";
  messages: MockMessage[];
  onCloseTerminal: () => void;
  onResize: (width: number) => void;
  view: ConversationView;
};

export function ContextPanel({
  conversation,
  draftWorkspacePath,
  mode,
  messages,
  onCloseTerminal,
  onResize,
  view
}: ContextPanelProps) {
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
        <h2>{mode === "terminal" ? "Terminal" : isGroup ? "群聊上下文" : "当前上下文"}</h2>
        {mode === "terminal" ? (
          <button aria-label="关闭终端视图" className="icon-button" onClick={onCloseTerminal} type="button">
            <X size={15} />
          </button>
        ) : null}
      </div>

      {mode === "terminal" ? (
        <TerminalView conversation={conversation} />
      ) : isNew ? (
        <NewConversationContext draftWorkspacePath={draftWorkspacePath} isGroup={isGroup} />
      ) : isGroup ? (
        <GroupContext />
      ) : (
        <SingleContext conversation={conversation} messages={messages} />
      )}
    </aside>
  );
}

function NewConversationContext({ draftWorkspacePath, isGroup }: { draftWorkspacePath?: string; isGroup: boolean }) {
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
        <div className="section-title">工作区</div>
        <div className="status-card">
          <FileText size={16} />
          <div>
            <strong>{draftWorkspacePath ? formatWorkspace(draftWorkspacePath) : "未选择"}</strong>
            <p>{draftWorkspacePath ?? "可在发送首条消息前选择 Agent 的活动目录"}</p>
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

function SingleContext({ conversation, messages }: { conversation: ConversationSummary | null; messages: MockMessage[] }) {
  const agent = conversation?.lockedAgent;
  const pendingInteraction = messages.flatMap((message) => message.interactions ?? [])[0];
  const statusText = pendingInteraction
    ? pendingInteraction.kind === "approval"
      ? "等待审批"
      : "等待选择"
    : conversation?.status === "running"
      ? "运行中"
      : "待命";

  return (
    <div className="context-content">
      <section className="context-section">
        <div className="section-title">Agent 状态</div>
        <div className="status-card">
          <span className="context-agent-icon"><AgentIcon agent={agent?.slug ?? "claude-code"} size={24} /></span>
          <div>
            <strong>{agent?.name ?? "等待锁定 Agent"}</strong>
            <p>{agent ? `已锁定 · ${statusText}` : "首条消息发送后锁定"}</p>
          </div>
        </div>
      </section>
      <section className="context-section">
        <div className="section-title">工作区</div>
        <div className="status-card">
          <FileText size={16} />
          <div>
            <strong>{conversation?.workspacePath ? formatWorkspace(conversation.workspacePath) : "未选择"}</strong>
            <p>{conversation?.workspacePath ?? "创建单聊后自动绑定默认目录"}</p>
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
        <ArtifactFileList artifacts={conversation?.artifacts ?? []} />
      </section>
    </div>
  );
}

function ArtifactFileList({ artifacts }: { artifacts: ConversationArtifact[] }) {
  if (artifacts.length === 0) {
    return (
      <ul className="file-list">
        <li>
          <FileText size={14} />
          暂无 Agent 产出文件
        </li>
      </ul>
    );
  }

  return (
    <ul className="file-list">
      {artifacts.map((artifact) => (
        <li key={artifact.id}>
          <FileText size={14} />
          <span title={artifact.path ?? undefined}>{artifact.title}</span>
        </li>
      ))}
    </ul>
  );
}

function TerminalView({ conversation }: { conversation: ConversationSummary | null }) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState(conversation ? "正在连接 Terminal..." : "请先打开一个单聊会话。");

  useEffect(() => {
    if (!conversation || !terminalRef.current) {
      setStatus("请先打开一个单聊会话。");
      return;
    }

    const currentConversation = conversation;
    let socket: WebSocket | null = null;
    let terminal: import("@xterm/xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
    let disposed = false;

    async function connectTerminal() {
      setStatus("正在连接 Terminal...");

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit")
      ]);
      const response = await fetch("/api/terminal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: currentConversation.id })
      });
      const payload = (await response.json()) as { error?: string; url?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Terminal 会话创建失败。");
      }

      if (disposed || !terminalRef.current) {
        return;
      }

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        convertEol: true,
        theme: {
          background: "#1f252b",
          foreground: "#d9e2ec",
          cursor: "#ffffff",
          selectionBackground: "#34515a"
        }
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalRef.current);
      fitAddon.fit();

      socket = new WebSocket(payload.url);
      socket.onopen = () => {
        setStatus(`已连接 · ${formatWorkspace(currentConversation.workspacePath)}`);
        fitAddon?.fit();
      };
      socket.onmessage = (event) => {
        terminal?.write(typeof event.data === "string" ? event.data : "");
      };
      socket.onclose = () => {
        setStatus("Terminal 已断开。");
      };
      socket.onerror = () => {
        setStatus("Terminal 连接失败。");
      };
      terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      });

      window.addEventListener("resize", fitTerminal);
    }

    function fitTerminal() {
      fitAddon?.fit();
    }

    connectTerminal().catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Terminal 连接失败。");
    });

    return () => {
      disposed = true;
      window.removeEventListener("resize", fitTerminal);
      socket?.close();
      terminal?.dispose();
    };
  }, [conversation]);

  return (
    <div className="context-content terminal-view">
      <div className="terminal-status">
        <TerminalSquare size={14} />
        <span>{status}</span>
      </div>
      <div className="terminal-xterm" ref={terminalRef} />
    </div>
  );
}

function formatWorkspace(workspacePath: string) {
  return workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath;
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

"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageStream } from "@/components/chat/MessageStream";
import { ContextPanel } from "@/components/context/ContextPanel";
import { DemoControlBar } from "@/components/demo/DemoControlBar";
import { DemoSlashOverlay } from "@/components/demo/DemoSlashOverlay";
import { ConversationSidebar } from "@/components/shell/ConversationSidebar";
import type { AvailableAgentSummary } from "@/lib/agents/types";
import { DEMO_CASES, type DemoCaseId } from "@/lib/demo/cases";
import { play } from "@/lib/demo/playback";
import { stubComposer, stubContext, stubSidebar, stubStream } from "@/lib/demo/stub-callbacks";
import type { AgentCreatorPreviewSnapshot, DemoSetters } from "@/lib/demo/types";
import type {
  ConversationSummary,
  ConversationView,
  GroupTask,
  MockMessage,
  RosterItem
} from "@/lib/conversations/types";

type DemoShellProps = {
  activeCase: DemoCaseId;
  caseVersion: number;
  onSelectCase: (id: DemoCaseId) => void;
  onReplay: () => void;
};

const FALLBACK_AVAILABLE_AGENTS: AvailableAgentSummary[] = [
  {
    id: "av-claude-code",
    slug: "claude-code",
    name: "Claude Code",
    platform: "claude_code",
    description: "本机 Claude Code",
    isSystem: true,
    avatarKind: "system",
    avatarValue: "claude-code",
    capabilities: null
  },
  {
    id: "av-codex",
    slug: "codex",
    name: "Codex",
    platform: "codex",
    description: "本机 Codex",
    isSystem: true,
    avatarKind: "system",
    avatarValue: "codex",
    capabilities: null
  }
];

export function DemoShell({ activeCase, caseVersion, onSelectCase, onReplay }: DemoShellProps) {
  const [messages, setMessages] = useState<MockMessage[]>([]);
  const [preview, setPreview] = useState<AgentCreatorPreviewSnapshot | null>(null);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [tasks, setTasks] = useState<GroupTask[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgentSummary[]>(
    FALLBACK_AVAILABLE_AGENTS
  );
  const [contextCollapsed, setContextCollapsed] = useState(false);

  const demoCase = DEMO_CASES[activeCase];

  useEffect(() => {
    setMessages([]);
    setPreview(null);
    setRoster(demoCase.initialRoster ?? []);
    setTasks(demoCase.initialTasks ?? []);
    setAvailableAgents(demoCase.initialAvailableAgents ?? FALLBACK_AVAILABLE_AGENTS);

    const setters: DemoSetters = {
      pushMessage: (message) =>
        setMessages((current) => mergeMessage(current, message)),
      patchMessage: (id, patch) =>
        setMessages((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
        ),
      setAgentCreatorPreview: (snapshot) => setPreview(snapshot),
      setRoster: (next) => setRoster(next),
      setTasks: (next) => setTasks(next),
      setAvailableAgents: (next) => setAvailableAgents(next)
    };

    return play(demoCase, setters);
  }, [demoCase, caseVersion]);

  // 录制友好:消息/preview/case 任意变动都把消息流滚到底,
  // 覆盖 MessageStream 默认的"保持 viewport"行为(那个适合 load-more,不适合 demo 自动推进)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const thread = document.querySelector<HTMLDivElement>(".message-thread");
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [messages, preview, activeCase, caseVersion]);

  const conversation: ConversationSummary = demoCase.conversation;
  const view: ConversationView = conversation.mode === "group" ? "group" : "single";
  const rosterAliases = roster.map((member) => member.alias);
  const workspaceStyle = {
    "--context-panel-width": contextCollapsed ? "38px" : "312px"
  } as CSSProperties;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden"
      }}
    >
      <DemoControlBar
        activeCase={activeCase}
        onReplay={onReplay}
        onSelectCase={onSelectCase}
      />
      <div
        className="app-workspace"
        style={{ flex: 1, minHeight: 0, ...workspaceStyle }}
      >
        <ConversationSidebar
          activeConversationId={conversation.id}
          activeView={view}
          conversations={[conversation]}
          {...stubSidebar}
        />
        <section className="chat-surface">
          <MessageStream
            agentCreatorPreview={
              preview
                ? { draft: preview.draft, status: preview.status }
                : undefined
            }
            conversation={conversation}
            error={null}
            isContextCollapsed={contextCollapsed}
            isLoading={false}
            messages={messages}
            roster={roster}
            view={view}
            onToggleContext={() => setContextCollapsed((value) => !value)}
            onToggleTerminal={() => {
              /* 演示模式不允许真实 terminal 连接 */
            }}
            {...stubStream}
          />
          {activeCase === "slash" ? <DemoSlashOverlay key={caseVersion} /> : null}
          <Composer
            disabled={false}
            error={null}
            isGroup={view === "group"}
            isNewConversation={false}
            isRunning={false}
            rosterAliases={rosterAliases}
            workspacePath={conversation.workspacePath}
            {...stubComposer}
          />
        </section>
        <ContextPanel
          availableAgents={availableAgents}
          conversation={conversation}
          mode="context"
          messages={messages}
          roster={roster}
          tasks={tasks}
          view={view}
          {...stubContext}
        />
      </div>
    </div>
  );
}

function mergeMessage(current: MockMessage[], message: MockMessage): MockMessage[] {
  const index = current.findIndex((entry) => entry.id === message.id);
  if (index >= 0) {
    const next = current.slice();
    next[index] = message;
    return next;
  }
  return [...current, message];
}

"use client";

import { PanelRightClose, PanelRightOpen, TerminalSquare } from "lucide-react";
import { ConversationSetup } from "@/components/chat/ConversationSetup";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { ConversationSummary, ConversationView, MockMessage } from "@/lib/conversations/types";
import { groupMessages } from "@/lib/mock/group-conversation";

type MessageStreamProps = {
  conversation: ConversationSummary | null;
  draftWorkspacePath?: string;
  error: string | null;
  isContextCollapsed: boolean;
  isLoading: boolean;
  messages: MockMessage[];
  onRegenerate?: (messageId: string) => Promise<void>;
  onToggleContext: () => void;
  onToggleTerminal: () => void;
  view: ConversationView;
};

export function MessageStream({
  conversation,
  draftWorkspacePath,
  error,
  isContextCollapsed,
  isLoading,
  messages,
  onRegenerate,
  onToggleContext,
  onToggleTerminal,
  view
}: MessageStreamProps) {
  const isNew = view === "new-single" || view === "new-group" || (!conversation?.lockedAgent && messages.length === 0);
  const isGroup = view === "group" || view === "new-group";
  const title = getTitle(view, conversation);
  const workspacePath = conversation?.workspacePath ?? draftWorkspacePath;

  return (
    <div className="message-stream">
      <header className="chat-header">
        <div>
          <h1>{title}</h1>
          {isGroup ? (
            <div className="header-meta">
              <span>群聊预览态</span>
              <span>V1 不接真实 Orchestrator</span>
            </div>
          ) : (
            <div className="header-meta">
              <span>{conversation?.lockedAgent ? `${conversation.lockedAgent.name} 已锁定` : "空白单聊"}</span>
              <span>当前工作区 {formatWorkspace(workspacePath)}</span>
            </div>
          )}
        </div>
        {isGroup ? <span className="preview-badge">V1 仅 UI</span> : null}
        <div className="header-tools">
          <button
            aria-label={isContextCollapsed ? "展开右侧栏" : "收起右侧栏"}
            className="icon-button"
            onClick={onToggleContext}
            type="button"
          >
            {isContextCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
          </button>
          <button aria-label="打开终端" className="icon-button" onClick={onToggleTerminal} type="button">
            <TerminalSquare size={17} />
          </button>
        </div>
      </header>

      <div className="message-area">
        {isLoading ? (
          <div className="message-thread">
            <div className="empty-state">正在加载会话...</div>
          </div>
        ) : isNew ? (
          <ConversationSetup view={isGroup ? "new-group" : "new-single"} />
        ) : (
          <div className="message-thread">
            <div className="message-date">今天</div>
            {(isGroup ? groupMessages : messages).map((message) => (
              <MessageBubble key={message.id} message={message} onRegenerate={isGroup ? undefined : onRegenerate} />
            ))}
          </div>
        )}
        {error ? <div className="inline-error">{error}</div> : null}
      </div>
    </div>
  );
}

function formatWorkspace(workspacePath?: string) {
  if (!workspacePath) {
    return "未选择";
  }

  return workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? workspacePath;
}

function getTitle(view: ConversationView, conversation: ConversationSummary | null) {
  switch (view) {
    case "new-single":
      return "新建聊天";
    case "new-group":
      return "新建群聊";
    case "group":
      return "全栈功能开发";
    default:
      return conversation?.title ?? "新建聊天";
  }
}

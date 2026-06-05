"use client";

import { Loader2, PanelRightClose, PanelRightOpen, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { ConversationSetup } from "@/components/chat/ConversationSetup";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { ConversationSummary, ConversationView, MockMessage, RosterItem } from "@/lib/conversations/types";
import type { InteractionDecision } from "@/lib/interactions/types";

type MessageStreamProps = {
  conversation: ConversationSummary | null;
  draftWorkspacePath?: string;
  error: string | null;
  hasMoreMessages?: boolean;
  isContextCollapsed: boolean;
  isLoading: boolean;
  isLoadingMore?: boolean;
  messages: MockMessage[];
  onLoadMore?: () => void;
  onRegenerate?: (messageId: string) => Promise<void>;
  onRespondInteraction?: (interactionId: string, decision: InteractionDecision) => Promise<void>;
  onStopAgent?: (conversationAgentId: string) => Promise<void>;
  onToggleContext: () => void;
  onToggleTerminal: () => void;
  roster?: RosterItem[];
  view: ConversationView;
};

export function MessageStream({
  conversation,
  draftWorkspacePath,
  error,
  hasMoreMessages,
  isContextCollapsed,
  isLoading,
  isLoadingMore,
  messages,
  onLoadMore,
  onRegenerate,
  onRespondInteraction,
  onStopAgent,
  onToggleContext,
  onToggleTerminal,
  roster,
  view
}: MessageStreamProps) {
  const isGroup = view === "group" || view === "new-group";
  const isNew =
    view === "new-single" ||
    view === "new-group" ||
    (!isGroup && !conversation?.lockedAgent && messages.length === 0);
  const title = getTitle(view, conversation);
  const workspacePath = conversation?.workspacePath ?? draftWorkspacePath;
  const threadRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef(0);

  const handleScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el || !onLoadMore || isLoadingMore || !hasMoreMessages) return;

    if (el.scrollTop < 80) {
      prevScrollHeight.current = el.scrollHeight;
      onLoadMore();
    }
  }, [onLoadMore, isLoadingMore, hasMoreMessages]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;

    const newScrollHeight = el.scrollHeight;
    const heightDiff = newScrollHeight - prevScrollHeight.current;
    if (heightDiff > 0 && prevScrollHeight.current > 0) {
      el.scrollTop = heightDiff;
    }
  }, [messages.length]);

  return (
    <div className="message-stream">
      <header className="chat-header">
        <div>
          <h1>{title}</h1>
          <div className="header-meta">
            <span>
              {isGroup
                ? conversation?.title ?? "群聊"
                : conversation?.lockedAgent
                  ? `${conversation.lockedAgent.name} 已锁定`
                  : "空白单聊"}
            </span>
            <span>当前工作区 {formatWorkspace(workspacePath)}</span>
          </div>
        </div>
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
          <div className="message-thread" onScroll={handleScroll} ref={threadRef}>
            {hasMoreMessages ? (
              <div className="load-more-hint">
                {isLoadingMore ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    <span>加载中...</span>
                  </>
                ) : (
                  <span>向上滚动加载更多</span>
                )}
              </div>
            ) : null}
            <div className="message-date">今天</div>
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onRegenerate={onRegenerate}
                onRespondInteraction={onRespondInteraction}
                onStopAgent={onStopAgent}
                roster={roster}
              />
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
      return conversation?.title ?? "群聊";
    default:
      return conversation?.title ?? "新建聊天";
  }
}

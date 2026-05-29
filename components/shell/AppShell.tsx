"use client";

import { useEffect, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageStream } from "@/components/chat/MessageStream";
import { ContextPanel } from "@/components/context/ContextPanel";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { ConversationSidebar } from "@/components/shell/ConversationSidebar";
import type { AttachmentReference, ConversationSummary, ConversationView, MockMessage } from "@/lib/conversations/types";
import type { ConversationStreamEvent } from "@/lib/conversations/stream-bus";
import type { AgentInteraction, InteractionDecision } from "@/lib/interactions/types";

export function AppShell() {
  const [view, setView] = useState<ConversationView>("new-single");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MockMessage[]>([]);
  const [pendingInteractions, setPendingInteractions] = useState<AgentInteraction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [contextMode, setContextMode] = useState<"context" | "terminal">("context");
  const [contextWidth, setContextWidth] = useState(312);
  const [draftWorkspacePath, setDraftWorkspacePath] = useState<string | undefined>();

  const isGroup = view === "group" || view === "new-group";
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const isActiveConversationRunning = activeConversation?.status === "running";
  const messagesWithInteractions = attachInteractions(messages, pendingInteractions);
  const isNewConversation =
    view === "new-single" || view === "new-group" || (!activeConversation?.lockedAgent && messages.length === 0);

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (!activeConversationId || isGroup) {
      setMessages([]);
      setPendingInteractions([]);
      return;
    }

    void loadMessages(activeConversationId);
    void loadPendingInteractions(activeConversationId);
  }, [activeConversationId, isGroup]);

  useEffect(() => {
    if (!activeConversationId || isGroup) {
      return;
    }

    const events = new EventSource(`/api/conversations/${activeConversationId}/stream`);

    events.addEventListener("message_replace", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ConversationStreamEvent;

      if (payload.type !== "message_replace") {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId
            ? { ...message, body: payload.content, status: payload.status }
            : message
        )
      );
    });

    events.addEventListener("message_delta", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ConversationStreamEvent;

      if (payload.type !== "message_delta") {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId ? { ...message, body: `${message.body}${payload.delta}` } : message
        )
      );
    });

    events.addEventListener("message_status", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ConversationStreamEvent;

      if (payload.type !== "message_status") {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === payload.messageId ? { ...message, status: payload.status } : message
        )
      );
    });

    events.addEventListener("run_status", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ConversationStreamEvent;

      if (payload.type !== "run_status") {
        return;
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeConversationId
            ? {
              ...conversation,
              status:
                payload.status === "running" || payload.status === "awaiting_interaction"
                  ? "running"
                  : "done"
            }
            : conversation
        )
      );

      if (payload.status !== "running" && payload.status !== "awaiting_interaction") {
        void loadConversations();
        void loadMessages(activeConversationId);
      }
    });

    events.addEventListener("interaction_requested", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ConversationStreamEvent;

      if (payload.type !== "interaction_requested") {
        return;
      }

      setPendingInteractions((current) => [
        ...current.filter((interaction) => interaction.id !== payload.interaction.id),
        payload.interaction
      ]);
    });

    events.addEventListener("interaction_resolved", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ConversationStreamEvent;

      if (payload.type !== "interaction_resolved") {
        return;
      }

      setPendingInteractions((current) =>
        current.filter((interaction) => interaction.id !== payload.interactionId)
      );
    });

    events.onerror = () => {
      // Let EventSource keep its built-in retry behavior.
      // Closing here makes the stream permanently dead after a transient error.
    };

    return () => events.close();
  }, [activeConversationId, isGroup]);

  async function loadConversations(selectFirst = false) {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/conversations");
      const payload = (await response.json()) as { conversations?: ConversationSummary[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "加载会话失败。");
      }

      const nextConversations = payload.conversations ?? [];
      setConversations(nextConversations);

      if (selectFirst && nextConversations[0]) {
        setActiveConversationId(nextConversations[0].id);
        setView("single");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载会话失败。");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadMessages(conversationId: string) {
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${conversationId}/messages`);
      const payload = (await response.json()) as { messages?: MockMessage[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "加载消息失败。");
      }

      setMessages(payload.messages ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载消息失败。");
    }
  }

  async function loadPendingInteractions(conversationId: string) {
    try {
      const response = await fetch(`/api/conversations/${conversationId}/interactions?status=pending`);
      const payload = (await response.json()) as { interactions?: AgentInteraction[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "加载交互请求失败。");
      }

      setPendingInteractions(payload.interactions ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载交互请求失败。");
    }
  }

  function createSingleConversation() {
    setError(null);
    setDraftWorkspacePath(undefined);
    setActiveConversationId(null);
    setMessages([]);
    setView("new-single");
  }

  async function sendMessage(content: string, attachments: AttachmentReference[] = []) {
    if (isGroup) {
      return false;
    }
    setError(null);

    try {
      let conversationId = activeConversationId;
      const workspacePath = activeConversation?.workspacePath ?? draftWorkspacePath;

      if (!workspacePath) {
        setError("请先选择当前工作区。");
        return false;
      }

      if (!conversationId) {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "single", workspacePath })
        });
        const payload = (await response.json()) as { conversation?: ConversationSummary; error?: string };

        if (!response.ok || !payload.conversation) {
          throw new Error(payload.error ?? "创建会话失败。");
        }

        conversationId = payload.conversation.id;
        setActiveConversationId(conversationId);
        setDraftWorkspacePath(payload.conversation.workspacePath);
      }

      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content, attachments })
      });
      const payload = (await response.json()) as {
        conversation?: ConversationSummary;
        messages?: MockMessage[];
        run?: { runId: string; assistantMessageId: string };
        error?: string;
      };

      if (!response.ok || !payload.conversation || !payload.messages) {
        throw new Error(payload.error ?? "发送消息失败。");
      }

      setConversations((current) => [
        payload.conversation!,
        ...current.filter((conversation) => conversation.id !== payload.conversation!.id)
      ]);
      setMessages(payload.messages);
      setPendingInteractions([]);
      setActiveConversationId(payload.conversation.id);
      setDraftWorkspacePath(payload.conversation.workspacePath);
      setView("single");
      return true;
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "发送消息失败。");
      return false;
    }
  }

  async function stopMessage() {
    if (!activeConversationId) {
      return;
    }

    setError(null);

    try {
      const response = await fetch(`/api/conversations/${activeConversationId}/stop`, {
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "停止生成失败。");
      }

      markConversationIdle(activeConversationId);
      await loadMessages(activeConversationId);
      await loadConversations();
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "停止生成失败。");
      markConversationIdle(activeConversationId);
    }
  }

  async function regenerateMessage(messageId: string) {
    setError(null);

    try {
      const response = await fetch(`/api/messages/${messageId}/regenerate`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        conversation?: ConversationSummary;
        messages?: MockMessage[];
        error?: string;
      };

      if (!response.ok || !payload.conversation || !payload.messages) {
        throw new Error(payload.error ?? "重新生成失败。");
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === payload.conversation!.id ? payload.conversation! : conversation
        )
      );
      setMessages(payload.messages);
      setPendingInteractions([]);
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : "重新生成失败。");
    }
  }

  async function respondInteraction(interactionId: string, decision: InteractionDecision) {
    setError(null);
    setPendingInteractions((current) => current.filter((interaction) => interaction.id !== interactionId));

    try {
      const response = await fetch(`/api/interactions/${interactionId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision)
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "提交回应失败。");
      }
    } catch (respondError) {
      setError(respondError instanceof Error ? respondError.message : "提交回应失败。");
      if (activeConversationId) {
        void loadPendingInteractions(activeConversationId);
      }
    }
  }

  async function renameConversation(conversationId: string, title: string) {
    await updateConversation(conversationId, { title }, "重命名会话失败。");
  }

  async function archiveConversation(conversationId: string, archived: boolean) {
    await updateConversation(conversationId, { archived }, archived ? "归档会话失败。" : "取消归档失败。");

    if (archived && activeConversationId === conversationId) {
      setActiveConversationId(null);
      setMessages([]);
      setView("new-single");
    }
  }

  async function updateWorkspacePath(conversationId: string, workspacePath: string) {
    await updateConversation(conversationId, { workspacePath }, "更新工作区失败。");
    setDraftWorkspacePath(workspacePath);
  }

  async function chooseWorkspacePath() {
    setError(null);

    try {
      const response = await fetch("/api/workspace/select", {
        method: "POST"
      });
      const payload = (await response.json()) as {
        cancelled?: boolean;
        error?: string;
        workspacePath?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "选择工作区失败。");
      }

      if (payload.cancelled || !payload.workspacePath) {
        return null;
      }

      return payload.workspacePath;
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "选择工作区失败。");
      return null;
    }
  }

  async function selectWorkspacePath(conversationId: string) {
    const workspacePath = await chooseWorkspacePath();

    if (!workspacePath) {
      return;
    }

    await updateWorkspacePath(conversationId, workspacePath);
  }

  async function selectDraftWorkspacePath() {
    const workspacePath = await chooseWorkspacePath();

    if (workspacePath) {
      setDraftWorkspacePath(workspacePath);
    }
  }

  async function deleteConversation(conversationId: string) {
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "删除会话失败。");
      }

      setConversations((current) => current.filter((item) => item.id !== conversationId));

      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
        setView("new-single");
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除会话失败。");
    }
  }

  async function updateConversation(
    conversationId: string,
    updates: { title?: string; archived?: boolean; workspacePath?: string },
    fallbackMessage: string
  ) {
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      const payload = (await response.json()) as { conversation?: ConversationSummary; error?: string };

      if (!response.ok || !payload.conversation) {
        throw new Error(payload.error ?? fallbackMessage);
      }

      setConversations((current) =>
        current
          .map((conversation) =>
            conversation.id === payload.conversation!.id ? payload.conversation! : conversation
          )
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : fallbackMessage);
    }
  }

  return (
    <main
      className="app-workspace"
      style={
        {
          "--context-panel-width": contextCollapsed ? "38px" : `${contextWidth}px`
        } as React.CSSProperties
      }
    >
      <ConversationSidebar
        activeConversationId={activeConversationId}
        activeView={view}
        conversations={conversations}
        onArchiveConversation={archiveConversation}
        onCreateSingle={createSingleConversation}
        onDeleteConversation={deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        onRenameConversation={renameConversation}
        onSelectConversation={(conversationId) => {
          setActiveConversationId(conversationId);
          setDraftWorkspacePath(conversations.find((conversation) => conversation.id === conversationId)?.workspacePath);
          setView("single");
        }}
        onSelectView={(nextView) => {
          setView(nextView);
          if (nextView !== "single") {
            setActiveConversationId(null);
            setDraftWorkspacePath(undefined);
          }
        }}
      />
      <section className="chat-surface">
        <MessageStream
          conversation={activeConversation}
          draftWorkspacePath={draftWorkspacePath}
          error={error}
          isContextCollapsed={contextCollapsed}
          isLoading={isLoading}
          messages={messagesWithInteractions}
          onRegenerate={regenerateMessage}
          onRespondInteraction={respondInteraction}
          onToggleContext={() => setContextCollapsed((value) => !value)}
          onToggleTerminal={() => {
            setContextCollapsed(false);
            setContextMode((value) => (value === "terminal" ? "context" : "terminal"));
          }}
          view={view}
        />
        <Composer
          disabled={view === "group"}
          error={error}
          isGroup={isGroup}
          isNewConversation={isNewConversation}
          isRunning={isActiveConversationRunning}
          workspacePath={activeConversation?.workspacePath ?? draftWorkspacePath}
          onSend={sendMessage}
          onStop={stopMessage}
          onWorkspaceSelect={
            activeConversationId
              ? () => selectWorkspacePath(activeConversationId)
              : selectDraftWorkspacePath
          }
        />
      </section>
      {!contextCollapsed ? (
        <ContextPanel
          conversation={activeConversation}
          draftWorkspacePath={draftWorkspacePath}
          mode={contextMode}
          messages={messagesWithInteractions}
          onResize={setContextWidth}
          onCloseTerminal={() => setContextMode("context")}
          view={view}
        />
      ) : null}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );

  function markConversationIdle(conversationId: string) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, status: "done" } : conversation
      )
    );
    setMessages((current) =>
      current.map((message) =>
        message.status === "running" ? { ...message, status: "cancelled" } : message
      )
    );
    setPendingInteractions([]);
  }
}

function attachInteractions(messages: MockMessage[], interactions: AgentInteraction[]) {
  if (interactions.length === 0) {
    return messages;
  }

  return messages.map((message) => {
    const messageInteractions = interactions.filter((interaction) => interaction.messageId === message.id);

    if (messageInteractions.length === 0) {
      return message;
    }

    return {
      ...message,
      interactions: messageInteractions
    };
  });
}

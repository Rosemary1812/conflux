"use client";

import { useEffect, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageStream } from "@/components/chat/MessageStream";
import { ContextPanel } from "@/components/context/ContextPanel";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { ConversationSidebar } from "@/components/shell/ConversationSidebar";
import type { ConversationSummary, ConversationView, MockMessage } from "@/lib/conversations/types";

export function AppShell() {
  const [view, setView] = useState<ConversationView>("new-single");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MockMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [contextWidth, setContextWidth] = useState(312);

  const isGroup = view === "group" || view === "new-group";
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  const isNewConversation =
    view === "new-single" || view === "new-group" || (!activeConversation?.lockedAgent && messages.length === 0);

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (!activeConversationId || isGroup) {
      setMessages([]);
      return;
    }

    void loadMessages(activeConversationId);
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

  async function createSingleConversation() {
    setError(null);

    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "single" })
      });
      const payload = (await response.json()) as { conversation?: ConversationSummary; error?: string };

      if (!response.ok || !payload.conversation) {
        throw new Error(payload.error ?? "创建会话失败。");
      }

      setConversations((current) => [payload.conversation!, ...current]);
      setActiveConversationId(payload.conversation.id);
      setMessages([]);
      setView("single");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建会话失败。");
    }
  }

  async function sendMessage(content: string) {
    if (isGroup) {
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      let conversationId = activeConversationId;

      if (!conversationId) {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "single" })
        });
        const payload = (await response.json()) as { conversation?: ConversationSummary; error?: string };

        if (!response.ok || !payload.conversation) {
          throw new Error(payload.error ?? "创建会话失败。");
        }

        conversationId = payload.conversation.id;
        setActiveConversationId(conversationId);
      }

      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, content })
      });
      const payload = (await response.json()) as {
        conversation?: ConversationSummary;
        messages?: MockMessage[];
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
      setActiveConversationId(payload.conversation.id);
      setView("single");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "发送消息失败。");
    } finally {
      setIsSending(false);
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
    updates: { title?: string; archived?: boolean },
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
          setView("single");
        }}
        onSelectView={(nextView) => {
          setView(nextView);
          if (nextView !== "single") {
            setActiveConversationId(null);
          }
        }}
      />
      <section className="chat-surface">
        <MessageStream
          conversation={activeConversation}
          error={error}
          isContextCollapsed={contextCollapsed}
          isLoading={isLoading}
          messages={messages}
          onToggleContext={() => setContextCollapsed((value) => !value)}
          view={view}
        />
        <Composer
          disabled={view === "group"}
          error={error}
          isGroup={isGroup}
          isNewConversation={isNewConversation}
          isRunning={isSending}
          onSend={sendMessage}
        />
      </section>
      <ContextPanel
        collapsed={contextCollapsed}
        conversation={activeConversation}
        messages={messages}
        onResize={setContextWidth}
        onToggle={() => setContextCollapsed((value) => !value)}
        view={view}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}

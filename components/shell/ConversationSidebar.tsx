"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Search,
  Settings,
  Trash2,
  UsersRound
} from "lucide-react";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { mockConversations } from "@/lib/mock/conversations";
import type { ConversationSummary, ConversationView } from "@/lib/conversations/types";

type ConversationSidebarProps = {
  activeConversationId: string | null;
  activeView: ConversationView;
  conversations: ConversationSummary[];
  onCreateSingle: () => void;
  onArchiveConversation: (conversationId: string, archived: boolean) => void;
  onDeleteConversation: (conversationId: string) => void;
  onOpenSettings: () => void;
  onRenameConversation: (conversationId: string, title: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onSelectView: (view: ConversationView) => void;
};

export function ConversationSidebar({
  activeConversationId,
  activeView,
  conversations,
  onCreateSingle,
  onArchiveConversation,
  onDeleteConversation,
  onOpenSettings,
  onRenameConversation,
  onSelectConversation,
  onSelectView
}: ConversationSidebarProps) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const groupConversations = mockConversations.filter((conversation) => conversation.mode === "group");
  const activeConversations = conversations.filter((conversation) => !conversation.archivedAt);
  const archivedConversations = conversations.filter((conversation) => conversation.archivedAt);
  const deleteTarget = conversations.find((conversation) => conversation.id === deleteTargetId) ?? null;

  function startRename(conversation: ConversationSummary) {
    setRenamingId(conversation.id);
    setRenameTitle(conversation.title);
    setOpenMenuId(null);
  }

  function submitRename(conversationId: string) {
    onRenameConversation(conversationId, renameTitle);
    setRenamingId(null);
    setRenameTitle("");
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameTitle("");
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <div className="brand-title">Conflux</div>
          <div className="brand-kicker">IM-first agent workspace</div>
        </div>
      </div>

      <label className="search-box">
        <Search size={15} />
        <input aria-label="搜索会话" placeholder="搜索" type="search" />
        <kbd>⌘K</kbd>
      </label>

      <div className="sidebar-actions">
        <button
          className={activeView === "new-single" ? "sidebar-link active" : "sidebar-link"}
          onClick={onCreateSingle}
          type="button"
        >
          <MessageSquarePlus size={16} />
          <span>新建聊天</span>
        </button>
        <button
          className={activeView === "new-group" ? "sidebar-link active" : "sidebar-link"}
          onClick={() => onSelectView("new-group")}
          type="button"
        >
          <UsersRound size={16} />
          <span>新建群聊</span>
        </button>
      </div>

      <div className="conversation-list">
        <div className="section-head">
          <span>聊天</span>
          <span>⌄</span>
        </div>
        {[...activeConversations, ...groupConversations].map((conversation) => {
          const view = conversation.mode === "group" ? "group" : "single";
          const active =
            conversation.mode === "group"
              ? activeView === "group"
              : activeView === "single" && activeConversationId === conversation.id;

          return (
            <div
              className={active ? "conversation-item active" : "conversation-item"}
              key={conversation.id}
            >
              {renamingId === conversation.id ? (
                <RenameForm
                  onCancel={cancelRename}
                  onChange={setRenameTitle}
                  onSubmit={() => submitRename(conversation.id)}
                  value={renameTitle}
                />
              ) : (
                <button
                  className="conversation-main"
                  onClick={() =>
                    conversation.mode === "group" ? onSelectView(view) : onSelectConversation(conversation.id)
                  }
                  type="button"
                >
                  <ConversationAvatar label={conversation.avatar} mode={conversation.mode} />
                  <span className="conversation-meta">
                    <span className="conversation-title-row">
                      <span className="conversation-title">{conversation.title}</span>
                      <StatusMarker status={conversation.status} />
                    </span>
                    <span className="conversation-preview">{conversation.preview}</span>
                  </span>
                </button>
              )}
              {conversation.mode === "single" ? (
                <ConversationMenu
                  archived={false}
                  conversation={conversation}
                  isOpen={openMenuId === conversation.id}
                  onArchive={() => {
                    onArchiveConversation(conversation.id, true);
                    setOpenMenuId(null);
                  }}
                  onClose={() => setOpenMenuId(null)}
                  onRename={() => startRename(conversation)}
                  onRequestDelete={() => {
                    setDeleteTargetId(conversation.id);
                    setOpenMenuId(null);
                  }}
                  onToggle={() => {
                    setDeleteTargetId(null);
                    setOpenMenuId((current) => (current === conversation.id ? null : conversation.id));
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="archived-section">
        <button
          className="archived-row"
          onClick={() => {
            setDeleteTargetId(null);
            setOpenMenuId(null);
            setArchivedOpen((value) => !value);
          }}
          type="button"
        >
          <span>
            <Archive size={15} />
            已归档
          </span>
          <span className="tag">{archivedConversations.length}</span>
        </button>
        {archivedOpen ? (
          <div className="archived-list">
            {archivedConversations.length === 0 ? (
              <div className="archived-empty">暂无归档会话</div>
            ) : (
              archivedConversations.map((conversation) => {
                const active = activeView === "single" && activeConversationId === conversation.id;

                return (
                  <div className={active ? "conversation-item active" : "conversation-item"} key={conversation.id}>
                    {renamingId === conversation.id ? (
                      <RenameForm
                        onCancel={cancelRename}
                        onChange={setRenameTitle}
                        onSubmit={() => submitRename(conversation.id)}
                        value={renameTitle}
                      />
                    ) : (
                      <button
                        className="conversation-main"
                        onClick={() => onSelectConversation(conversation.id)}
                        type="button"
                      >
                        <ConversationAvatar label={conversation.avatar} mode={conversation.mode} />
                        <span className="conversation-meta">
                          <span className="conversation-title-row">
                            <span className="conversation-title">{conversation.title}</span>
                            <StatusMarker status={conversation.status} />
                          </span>
                          <span className="conversation-preview">{conversation.preview}</span>
                        </span>
                      </button>
                    )}
                    <ConversationMenu
                      archived
                      conversation={conversation}
                      isOpen={openMenuId === conversation.id}
                      onArchive={() => {
                        onArchiveConversation(conversation.id, false);
                        setOpenMenuId(null);
                      }}
                      onClose={() => setOpenMenuId(null)}
                      onRename={() => startRename(conversation)}
                      onRequestDelete={() => {
                        setDeleteTargetId(conversation.id);
                        setOpenMenuId(null);
                      }}
                      onToggle={() => {
                        setDeleteTargetId(null);
                        setOpenMenuId((current) => (current === conversation.id ? null : conversation.id));
                      }}
                    />
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      <div className="sidebar-profile">
        <button className="profile-trigger" onClick={onOpenSettings} type="button">
          <Settings size={16} />
          <span>设置</span>
        </button>
      </div>
      {deleteTarget ? (
        <DeleteConversationDialog
          conversation={deleteTarget}
          onCancel={() => setDeleteTargetId(null)}
          onConfirm={() => {
            onDeleteConversation(deleteTarget.id);
            setDeleteTargetId(null);
          }}
        />
      ) : null}
    </aside>
  );
}

function ConversationMenu({
  archived,
  conversation,
  isOpen,
  onArchive,
  onClose,
  onRename,
  onRequestDelete,
  onToggle
}: {
  archived: boolean;
  conversation: ConversationSummary;
  isOpen: boolean;
  onArchive: () => void;
  onClose: () => void;
  onRename: () => void;
  onRequestDelete: () => void;
  onToggle: () => void;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (wrapRef.current?.contains(target)) {
        return;
      }
      onClose();
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, onClose]);

  return (
    <span className="conversation-menu-wrap" ref={wrapRef}>
      <button
        aria-label={`${conversation.title} 更多操作`}
        className="conversation-menu"
        onClick={onToggle}
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen ? (
        <span className="conversation-menu-popover">
          <button onClick={onRename} type="button">
            <Pencil size={14} />
            编辑会话名称
          </button>
          <button onClick={onArchive} type="button">
            {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {archived ? "取消归档" : "归档"}
          </button>
          <button className="danger" onClick={onRequestDelete} type="button">
            <Trash2 size={14} />
            删除
          </button>
        </span>
      ) : null}
    </span>
  );
}

function DeleteConversationDialog({
  conversation,
  onCancel,
  onConfirm
}: {
  conversation: ConversationSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="delete-dialog-backdrop" role="presentation">
      <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <h2 id="delete-dialog-title">确认删除？</h2>
        <p>
          删除后，对话以及该对话中产生的消息、运行记录和产物都会一起删除。此操作不可恢复。
        </p>
        <div className="delete-dialog-target">{conversation.title}</div>
        <div className="delete-dialog-actions">
          <button className="danger" onClick={onConfirm} type="button">
            删除
          </button>
          <button onClick={onCancel} type="button">
            取消
          </button>
        </div>
      </section>
    </div>
  );
}

function RenameForm({
  onCancel,
  onChange,
  onSubmit,
  value
}: {
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  return (
    <form
      className="conversation-rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        autoFocus
        aria-label="会话名称"
        maxLength={80}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      <span className="conversation-rename-actions">
        <button type="submit">保存</button>
        <button onClick={onCancel} type="button">
          取消
        </button>
      </span>
    </form>
  );
}

function ConversationAvatar({ label, mode }: { label: string; mode: "single" | "group" }) {
  if (mode === "group") {
    const parts = label.split(" ");

    return (
      <span className="avatar-stack" aria-hidden="true">
        {parts.map((part) => (
          <span key={part}>
            <AgentIcon agent={part} size={18} />
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="avatar" aria-hidden="true">
      <AgentIcon agent={label} size={22} />
    </span>
  );
}

function StatusMarker({ status }: { status: "running" | "done" | "preview" | "empty" }) {
  if (status === "running") {
    return <span className="status-dot running" aria-label="运行中" />;
  }

  if (status === "done") {
    return <Check className="status-check" size={14} aria-label="已完成" />;
  }

  if (status === "preview") {
    return <span className="status-badge">预览</span>;
  }

  return null;
}

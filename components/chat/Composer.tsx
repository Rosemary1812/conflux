"use client";

import { ArrowUp, FileUp, FolderGit2, ImagePlus, Loader2, Square, X } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import type { AttachmentReference } from "@/lib/conversations/types";

type ComposerProps = {
  disabled: boolean;
  error: string | null;
  isGroup: boolean;
  isNewConversation: boolean;
  isRunning: boolean;
  rosterAliases?: string[];
  workspacePath?: string;
  onSend: (content: string, attachments?: AttachmentReference[]) => Promise<boolean>;
  onStop: () => Promise<void>;
  onWorkspaceSelect?: () => Promise<void>;
};

export function Composer({
  disabled,
  error,
  isGroup,
  isNewConversation,
  isRunning,
  rosterAliases,
  workspacePath,
  onSend,
  onStop,
  onWorkspaceSelect
}: ComposerProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<AttachmentReference[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  const contentRef = useRef(content);
  const attachmentsRef = useRef(attachments);
  const displayWorkspace = workspacePath ?? "未选择";
  const placeholder = isGroup
    ? isNewConversation
      ? "@claude-code @codex 帮我并行做设置页 UI 和接口校验"
      : "继续对话，@ 已入群 Agent 的 alias"
    : isNewConversation
      ? "@claude-code 帮我 review 当前分支改动"
      : "继续补测试、帮我 review 这段代码，或整理当前产物到工作区";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    if (isRunning) {
      await onStop();
      return;
    }

    if (isSending) {
      return;
    }

    if (!content.trim() && attachments.length === 0) {
      return;
    }

    setValidationError(null);

    if (isGroup && !isNewConversation && rosterAliases && rosterAliases.length > 0) {
      const mentions = extractMentions(content);
      const normalizedRosterAliases = rosterAliases.map((alias) => alias.toLowerCase());
      const unknown = mentions.filter((m) => !normalizedRosterAliases.includes(m));
      if (unknown.length > 0) {
        setValidationError(`@${unknown[0]} 不在当前群聊中。可用 alias：${normalizedRosterAliases.map((alias) => `@${alias}`).join("、")}`);
        return;
      }
    }

    const sentContent = content;
    const sentAttachments = attachments;
    setIsSending(true);
    contentRef.current = "";
    attachmentsRef.current = [];
    setContent("");
    setAttachments([]);

    try {
      const sent = await onSend(sentContent, sentAttachments);

      if (!sent && contentRef.current === "" && attachmentsRef.current.length === 0) {
        contentRef.current = sentContent;
        attachmentsRef.current = sentAttachments;
        setContent(sentContent);
        setAttachments(sentAttachments);
      }
    } finally {
      setIsSending(false);
    }
  }

  async function handleWorkspaceClick() {
    if (!onWorkspaceSelect || disabled || isSelectingWorkspace) {
      return;
    }

    setIsSelectingWorkspace(true);
    try {
      await onWorkspaceSelect();
    } finally {
      setIsSelectingWorkspace(false);
    }
  }

  async function selectAttachments(imageOnly = false) {
    setAttachmentError(null);

    try {
      const response = await fetch("/api/attachments/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageOnly })
      });
      const payload = (await response.json()) as {
        attachments?: AttachmentReference[];
        cancelled?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "选择附件失败。");
      }

      if (payload.cancelled || !payload.attachments?.length) {
        return;
      }

      const nextAttachments = payload.attachments
        .filter((attachment) => !imageOnly || attachment.mimeType.startsWith("image/"))
        .map((attachment) =>
          isExternalPath(attachment.path, workspacePath)
            ? { ...attachment, allowExternal: confirmExternalAttachment(attachment.path) }
            : attachment
        )
        .filter((attachment) => !isExternalPath(attachment.path, workspacePath) || attachment.allowExternal);

      setAttachments((current) => {
        const updated = [...current, ...nextAttachments].slice(0, 8);
        attachmentsRef.current = updated;
        return updated;
      });
    } catch (selectError) {
      setAttachmentError(selectError instanceof Error ? selectError.message : "选择附件失败。");
    }
  }

  function removeAttachment(index: number) {
    setAttachments((current) => {
      const updated = current.filter((_, currentIndex) => currentIndex !== index);
      attachmentsRef.current = updated;
      return updated;
    });
  }

  return (
    <div className={disabled ? "composer-wrap disabled" : "composer-wrap"}>
      <div className="composer-status">
        <span>
          {isSending
            ? "正在发送..."
            : validationError ?? attachmentError ?? error ?? "Cmd+Enter 发送"}
        </span>
      </div>
      <form className="composer-shell" onSubmit={handleSubmit}>
        {attachments.length > 0 ? (
          <div className="attachment-preview-list">
            {attachments.map((attachment, index) => (
              <span className="attachment-preview" key={`${attachment.path}-${attachment.size}-${index}`}>
                <span>{attachment.fileName}</span>
                <small>{formatBytes(attachment.size)}</small>
                <button aria-label={`移除 ${attachment.fileName}`} onClick={() => removeAttachment(index)} type="button">
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          disabled={disabled}
          onChange={(event) => {
            contentRef.current = event.target.value;
            setContent(event.target.value);
            if (validationError) {
              setValidationError(null);
            }
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholder}
          rows={3}
          value={content}
        />
        <div className="composer-toolbar">
          <button
            aria-label="选择图片路径"
            className={disabled ? "tool-button disabled" : "tool-button"}
            disabled={disabled}
            onClick={() => selectAttachments(true)}
            type="button"
          >
            <ImagePlus size={17} />
          </button>
          <button
            aria-label="选择附件路径"
            className={disabled ? "tool-button disabled" : "tool-button"}
            disabled={disabled}
            onClick={() => selectAttachments()}
            type="button"
          >
            <FileUp size={17} />
          </button>
          <button
            className="workspace-pill"
            disabled={disabled || !onWorkspaceSelect || isSelectingWorkspace}
            onClick={handleWorkspaceClick}
            type="button"
          >
            {isSelectingWorkspace ? <Loader2 size={16} className="spin" /> : <FolderGit2 size={16} />}
            <span>
              <small>当前工作区</small>
              <strong>{isSelectingWorkspace ? "正在打开…" : displayWorkspace}</strong>
            </span>
          </button>
          <button
            aria-label={isRunning ? "停止生成" : "发送消息"}
            className={isRunning ? "send-button stop" : "send-button"}
            disabled={disabled || isSending || (!isRunning && !content.trim() && attachments.length === 0)}
            type="submit"
          >
            {isRunning ? <Square size={15} /> : <ArrowUp size={17} />}
          </button>
        </div>
      </form>
    </div>
  );
}

function extractMentions(text: string): string[] {
  const matches = text.match(/@[a-zA-Z0-9_-]+/g);
  return matches ? matches.map((m) => m.slice(1).toLowerCase()) : [];
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isExternalPath(filePath: string, workspacePath?: string) {
  if (!workspacePath) {
    return true;
  }

  const normalizedWorkspace = normalizePath(workspacePath);
  const normalizedFile = normalizePath(filePath);
  return normalizedFile !== normalizedWorkspace && !normalizedFile.startsWith(`${normalizedWorkspace}/`);
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function confirmExternalAttachment(filePath: string) {
  return window.confirm(`该附件不在当前工作区内，是否仍要作为上下文提供给 Agent？\n\n${filePath}`);
}

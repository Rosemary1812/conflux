"use client";

import { ArrowUp, FileUp, FolderGit2, ImagePlus, Square } from "lucide-react";
import { FormEvent, useState } from "react";
import { workspacePath } from "@/lib/mock/conversations";

type ComposerProps = {
  disabled: boolean;
  error: string | null;
  isGroup: boolean;
  isNewConversation: boolean;
  isRunning: boolean;
  onSend: (content: string) => Promise<void>;
};

export function Composer({ disabled, error, isGroup, isNewConversation, isRunning, onSend }: ComposerProps) {
  const [content, setContent] = useState("");
  const placeholder = disabled
    ? "V1 群聊只展示结构；V2 再接入 @agent 与真实分派"
    : isGroup
      ? "@claude-code @codex 帮我并行做设置页 UI 和接口校验"
      : isNewConversation
        ? "@claude-code 帮我 review 当前分支改动"
        : "继续补测试、帮我 review 这段代码，或整理当前产物到工作区";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!content.trim() || disabled || isRunning) {
      return;
    }

    const nextContent = content;
    setContent("");
    await onSend(nextContent);
  }

  return (
    <div className={disabled ? "composer-wrap disabled" : "composer-wrap"}>
      <div className="composer-status">
        {disabled ? <span>群聊预览模式，发送已禁用</span> : <span>{error ?? "Cmd+Enter 发送"}</span>}
      </div>
      <form className="composer-shell" onSubmit={handleSubmit}>
        <textarea
          disabled={disabled || isRunning}
          onChange={(event) => setContent(event.target.value)}
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
          <button aria-label="上传图片" className="tool-button" disabled={disabled} type="button">
            <ImagePlus size={17} />
          </button>
          <button aria-label="上传附件" className="tool-button" disabled={disabled} type="button">
            <FileUp size={17} />
          </button>
          <button className="workspace-pill" disabled={disabled} type="button">
            <FolderGit2 size={16} />
            <span>
              <small>当前工作区</small>
              <strong>{workspacePath}</strong>
            </span>
          </button>
          <button
            aria-label={isRunning ? "停止生成" : "发送消息"}
            className={isRunning ? "send-button stop" : "send-button"}
            disabled={disabled || !content.trim()}
            type="submit"
          >
            {isRunning ? <Square size={15} /> : <ArrowUp size={17} />}
          </button>
        </div>
      </form>
    </div>
  );
}

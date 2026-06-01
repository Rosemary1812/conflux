"use client";

import { Check, Copy, FileText, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { ArtifactCard } from "@/components/chat/ArtifactCard";
import { InteractionApprovalCard } from "@/components/chat/InteractionApprovalCard";
import { InteractionChoiceCard } from "@/components/chat/InteractionChoiceCard";
import type { MockMessage, RosterItem } from "@/lib/conversations/types";
import type { InteractionDecision } from "@/lib/interactions/types";
import { Square } from "lucide-react";

type MessageBubbleProps = {
  message: MockMessage;
  roster?: RosterItem[];
  onRegenerate?: (messageId: string) => Promise<void>;
  onRespondInteraction?: (interactionId: string, decision: InteractionDecision) => Promise<void>;
  onStopAgent?: (conversationAgentId: string) => Promise<void>;
};

export function MessageBubble({ message, roster, onRegenerate, onRespondInteraction, onStopAgent }: MessageBubbleProps) {
  const tone = message.tone ?? "agent";
  const canRegenerate = tone === "agent" && message.status !== "running" && Boolean(onRegenerate);

  const rosterMember = message.authorConversationAgentId
    ? roster?.find((r) => r.id === message.authorConversationAgentId)
    : undefined;

  const senderName =
    tone === "orchestrator"
      ? "Orchestrator"
      : rosterMember
        ? rosterMember.displayName ?? rosterMember.alias
        : message.author;

  const senderAvatar =
    tone === "orchestrator" ? "orchestrator" : rosterMember ? rosterMember.slug : message.avatar;

  const canStop =
    message.status === "running" && message.authorConversationAgentId && onStopAgent;

  return (
    <div className={`message-row ${tone}`}>
      {tone !== "user" ? (
        <span className={`message-avatar ${tone}`}>
          {senderAvatar ? <AgentIcon agent={senderAvatar} size={25} /> : null}
        </span>
      ) : null}
      <div className="message-body">
        <div className="message-sender">
          {tone !== "user" ? <span className="sender-name">{senderName}</span> : null}
          {message.time ? <span>{message.time}</span> : null}
          {canRegenerate ? (
            <button className="message-action-button" onClick={() => onRegenerate?.(message.id)} type="button">
              <RotateCcw size={13} />
              重新生成
            </button>
          ) : null}
          {canStop ? (
            <button
              className="message-action-button stop"
              onClick={() => onStopAgent?.(message.authorConversationAgentId!)}
              type="button"
            >
              <Square size={12} />
              停止
            </button>
          ) : null}
        </div>
        <div className="message-bubble">
          <RichText text={message.body} />
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
          {message.code ? (
            <pre>
              <code>{message.code}</code>
            </pre>
          ) : null}
          {message.artifacts?.length ? <ArtifactCard artifacts={message.artifacts} /> : null}
          {message.artifact ? <ArtifactCard artifacts={legacyArtifact(message.artifact)} /> : null}
        </div>
        {message.interactions?.map((interaction) =>
          interaction.kind === "approval" ? (
            <InteractionApprovalCard
              interaction={interaction}
              key={interaction.id}
              onRespond={onRespondInteraction ?? noopRespond}
            />
          ) : (
            <InteractionChoiceCard
              interaction={interaction}
              key={interaction.id}
              onRespond={onRespondInteraction ?? noopRespond}
            />
          )
        )}
      </div>
    </div>
  );
}

async function noopRespond() {
  return undefined;
}

function legacyArtifact(artifact: NonNullable<MockMessage["artifact"]>) {
  return artifact.files.map((file, index) => ({
    id: `${artifact.title}-${file}-${index}`,
    type: "file",
    title: file,
    description: artifact.description,
    path: file
  }));
}

function AttachmentList({ attachments }: { attachments: NonNullable<MockMessage["attachments"]> }) {
  return (
    <div className="message-attachments">
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith("image/");

        return (
          <div
            className={isImage ? "message-attachment image" : "message-attachment"}
            key={attachment.id}
            title={attachment.path}
          >
            <FileText size={17} />
            <span>
              <strong>{attachment.fileName}</strong>
              <small>{formatBytes(attachment.size)} · {attachment.path}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
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

function RichText({ text }: { text: string }) {
  const components = useMemo<Components>(
    () => ({
      code({ children, className }) {
        const code = String(children).replace(/\n$/, "");
        const language = /language-([a-zA-Z0-9_-]+)/.exec(className ?? "")?.[1];

        if (!language) {
          return <code>{children}</code>;
        }

        return <CodeBlock code={code} language={language} />;
      }
    }),
    []
  );

  return (
    <div className="markdown-body">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const { codeToHtml } = await import("shiki");
        const nextHtml = await codeToHtml(code, {
          lang: normalizeLanguage(language),
          theme: "github-dark"
        });

        if (!cancelled) {
          setHtml(nextHtml);
        }
      } catch {
        if (!cancelled) {
          setHtml(null);
        }
      }
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <figure className="code-block">
      <figcaption>
        <span>{language || "text"}</span>
        <button onClick={copyCode} type="button">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </figcaption>
      {html ? (
        <div className="code-block-html" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </figure>
  );
}

function normalizeLanguage(language?: string) {
  const normalized = language?.toLowerCase() || "text";

  if (normalized === "shell" || normalized === "ps1" || normalized === "powershell") {
    return "bash";
  }

  if (normalized === "tsx" || normalized === "typescriptreact") {
    return "tsx";
  }

  return normalized;
}

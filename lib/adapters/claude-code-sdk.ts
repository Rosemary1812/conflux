import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { formatAttachmentContext, type AdapterRunParams, type AgentAdapter, type AgentEvent } from "@/lib/adapters/types";
import { getAnthropicRuntimeProvider } from "@/lib/providers/service";
import { getProfileMeta } from "@/lib/skills/agent-creator/profiles";
import type { ToolProfile } from "@/lib/skills/agent-creator/types";

export const claudeCodeSdkAdapter: AgentAdapter = {
  platform: "claude_code",
  capabilities: {
    supportsApproval: "none",
    supportsChoice: "none"
  },
  async healthcheck() {
    const provider = getAnthropicRuntimeProvider();

    return {
      ok: Boolean(provider),
      message: provider
        ? `自建 Agent SDK Provider 可用：${provider.name} / ${provider.defaultModel}`
        : "自建 Agent SDK 需要先配置 enabled anthropic Provider。",
      capabilities: this.capabilities
    };
  },
  async inspectRuntime() {
    const provider = getAnthropicRuntimeProvider();

    if (!provider) {
      return {
        available: false,
        modelName: "unknown",
        source: "unknown",
        message: "未配置 enabled anthropic Provider。"
      };
    }

    return {
      available: true,
      modelName: provider.defaultModel || "unknown",
      source: "env",
      message: `自建 Agent SDK 将使用 ${provider.name}。`
    };
  },
  run(params) {
    return runClaudeCodeSdk(params);
  }
};

async function* runClaudeCodeSdk(params: AdapterRunParams): AsyncIterable<AgentEvent> {
  yield { type: "run_status", status: "running" };

  const provider = getAnthropicRuntimeProvider();

  if (!provider) {
    yield {
      type: "message_error",
      error: "自建 Agent SDK 需要 enabled anthropic Provider。请先在设置页配置 Anthropic Provider。"
    };
    return;
  }

  const abortController = new AbortController();
  const abort = () => abortController.abort(params.signal.reason);

  if (params.signal.aborted) {
    abort();
  } else {
    params.signal.addEventListener("abort", abort, { once: true });
  }

  try {
    const profile = getProfileMeta(resolveToolProfile(params));
    const messages = query({
      prompt: buildPrompt(params, Boolean(params.externalSessionId)),
      options: {
        abortController,
        allowDangerouslySkipPermissions: profile.allowDangerouslySkipPermissions,
        allowedTools: profile.allowedTools,
        cwd: params.workspacePath,
        disallowedTools: profile.disallowedTools,
        env: buildSdkEnv(provider),
        includePartialMessages: true,
        maxTurns: 50,
        model: provider.defaultModel,
        permissionMode: profile.permissionMode,
        resume: params.externalSessionId,
        settingSources: [],
        systemPrompt: buildSystemPrompt(params),
        tools: { type: "preset", preset: "claude_code" }
      }
    });
    let savedSessionId = params.externalSessionId ?? "";
    let streamedText = false;
    let producedText = false;
    let sawError = false;

    for await (const message of messages) {
      const sessionId = sessionIdFromSdkMessage(message);

      if (sessionId && sessionId !== savedSessionId) {
        savedSessionId = sessionId;
        params.saveExternalSessionId(sessionId, {
          source: "claude_agent_sdk_custom",
          providerId: provider.id,
          model: provider.defaultModel
        });
      }

      const event = eventFromSdkMessage(message, { streamedText });

      if (!event) {
        continue;
      }

      if (event.type === "text_delta") {
        streamedText = true;
        producedText = true;
      }

      if (event.type === "message_error") {
        sawError = true;
      }

      yield event;
    }

    if (!sawError && !producedText) {
      yield {
        type: "message_error",
        error: "自建 Agent SDK 未返回 assistant 文本。请检查 Anthropic Provider 与模型兼容性。"
      };
      return;
    }

    if (!sawError) {
      yield { type: "message_done" };
    }
  } catch (error) {
    if (params.signal.aborted || abortController.signal.aborted) {
      yield { type: "message_cancelled" };
      return;
    }

    yield {
      type: "message_error",
      error: error instanceof Error ? error.message : "自建 Agent SDK 运行失败。"
    };
  } finally {
    params.signal.removeEventListener("abort", abort);
  }
}

function resolveToolProfile(params: AdapterRunParams): ToolProfile {
  if (params.agent.toolProfile === "readonly" || params.agent.toolProfile === "code-author" || params.agent.toolProfile === "executor") {
    return params.agent.toolProfile;
  }

  return params.agent.permissionMode === "editable" ? "code-author" : "readonly";
}

function buildSdkEnv(provider: ReturnType<typeof getAnthropicRuntimeProvider> & {}) {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: provider.apiKey,
    ANTHROPIC_BASE_URL: provider.baseUrl,
    CLAUDE_AGENT_SDK_CLIENT_APP: "agenthub/0.1.0"
  };
}

function eventFromSdkMessage(
  message: SDKMessage,
  options: { streamedText: boolean }
): AgentEvent | null {
  if (message.type === "stream_event") {
    const delta = extractStreamDelta(message.event);

    return delta ? { type: "text_delta", delta } : null;
  }

  if (message.type === "assistant") {
    if (message.error) {
      return { type: "message_error", error: `自建 Agent SDK 运行失败：${message.error}` };
    }

    if (options.streamedText) {
      return null;
    }

    const text = extractText(message.message.content);
    return text ? { type: "text_delta", delta: text } : null;
  }

  if (message.type === "result" && message.is_error) {
    return { type: "message_error", error: resultErrorText(message) };
  }

  return null;
}

function buildPrompt(params: AdapterRunParams, resumed: boolean) {
  const recentMessages = resumed
    ? params.messages.filter((message) => message.role === "user").slice(-1)
    : params.messages.slice(-12);
  const attachmentContext = formatAttachmentContext(params.attachments);

  return [
    recentMessages
      .map((message) => {
        const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System";
        return `${role}: ${message.content}`;
      })
      .join("\n\n"),
    attachmentContext ? `\n\nUser attachments:\n${attachmentContext}` : ""
  ].join("");
}

function buildSystemPrompt(params: AdapterRunParams) {
  return [
    params.agent.systemPrompt.trim() || "You are a custom AgentHub agent. Follow the user's request within your configured permissions.",
    "",
    "You are running inside AgentHub as a user-created agent.",
    "Use the current working directory as the only project workspace unless the user explicitly provides another path.",
    "V3.4 does not yet provide AgentHub inline Approval or Choice bridging for this custom-agent adapter; keep user-facing questions concise in normal text."
  ].join("\n");
}

function sessionIdFromSdkMessage(message: SDKMessage) {
  const record = message as unknown as Record<string, unknown>;
  const sessionId = record.session_id ?? record.sessionId;

  return typeof sessionId === "string" ? sessionId : "";
}

function extractStreamDelta(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;

  if (record.type === "content_block_delta") {
    return extractText(record.delta);
  }

  if (record.type === "text_delta") {
    return extractText(record);
  }

  return "";
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(extractText).join("");
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") {
    return record.text;
  }

  if (record.content) {
    return extractText(record.content);
  }

  return "";
}

function resultErrorText(message: Extract<SDKMessage, { type: "result" }>) {
  if (message.subtype === "success" && typeof message.result === "string") {
    return message.result;
  }

  if ("errors" in message && Array.isArray(message.errors)) {
    return message.errors.join("; ");
  }

  return "自建 Agent SDK 运行失败。";
}

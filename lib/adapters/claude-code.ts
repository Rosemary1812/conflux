import { createSdkMcpServer, query, tool, type CanUseTool, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatAttachmentContext, type AgentAdapter, type AgentEvent, type AdapterRunParams } from "@/lib/adapters/types";

export const claudeCodeAdapter: AgentAdapter = {
  platform: "claude_code",
  capabilities: {
    supportsApproval: "native",
    supportsChoice: "native"
  },
  async healthcheck() {
    return {
      ok: true,
      message: "Claude Agent SDK 可用，支持 Approval / Choice。",
      capabilities: this.capabilities
    };
  },
  run(params) {
    return runClaudeCode(params);
  }
};

async function* runClaudeCode(params: AdapterRunParams): AsyncIterable<AgentEvent> {
  yield { type: "run_status", status: "running" };

  const abortController = new AbortController();
  const abort = () => abortController.abort(params.signal.reason);

  if (params.signal.aborted) {
    abort();
  } else {
    params.signal.addEventListener("abort", abort, { once: true });
  }

  try {
    const messages = query({
      prompt: buildPrompt(params, Boolean(params.externalSessionId)),
      options: {
        abortController,
        canUseTool: createPermissionHandler(params),
        cwd: params.workspacePath,
        mcpServers: {
          agenthub_interactions: createChoiceServer(params)
        },
        permissionMode: "default",
        systemPrompt: [
          "You are running inside AgentHub.",
          "When you need the user to choose between options, call the MCP tool `request_choice` from the `agenthub_interactions` server instead of asking in plain text.",
          "Use the tool for A/B/C/D decisions, implementation direction, or any question that blocks continued execution."
        ].join("\n"),
        toolConfig: {
          askUserQuestion: { previewFormat: "markdown" }
        },
        tools: { type: "preset", preset: "claude_code" },
        ...(params.externalSessionId ? { resume: params.externalSessionId } : {})
      }
    });
    let savedSessionId = params.externalSessionId ?? "";

    for await (const message of messages) {
      const sessionId = sessionIdFromSdkMessage(message);

      if (sessionId && sessionId !== savedSessionId) {
        savedSessionId = sessionId;
        params.saveExternalSessionId(sessionId, { source: "claude_agent_sdk" });
      }

      const event = eventFromSdkMessage(message);

      if (event) {
        yield event;
      }
    }

    yield { type: "message_done" };
  } catch (error) {
    if (params.signal.aborted || abortController.signal.aborted) {
      yield { type: "message_cancelled" };
      return;
    }

    yield {
      type: "message_error",
      error: error instanceof Error ? error.message : "Claude Agent SDK 运行失败。"
    };
  } finally {
    params.signal.removeEventListener("abort", abort);
  }
}

function createPermissionHandler(params: AdapterRunParams): CanUseTool {
  return async (toolName, input, options) => {
    const decision = await params.requestInteraction({
      kind: "approval",
      messageId: "",
      payload: {
        action: actionForTool(toolName),
        summary: options.title ?? options.displayName ?? `Claude Code 请求使用 ${toolName}`,
        command: commandFromInput(input),
        path: pathFromInput(input, options.blockedPath),
        risk: options.description ?? options.decisionReason ?? "该操作需要用户确认后才能继续。"
      }
    });

    if (decision.kind === "approval" && decision.approved) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID
      };
    }

    return {
      behavior: "deny",
      message: "用户在 AgentHub 中拒绝了该操作。"
    };
  };
}

function createChoiceServer(params: AdapterRunParams) {
  return createSdkMcpServer({
    name: "agenthub_interactions",
    version: "0.1.0",
    instructions: "Use request_choice whenever the run needs the user to choose before continuing.",
    alwaysLoad: true,
    tools: [
      tool(
        "request_choice",
        "Ask the AgentHub user to choose one option before continuing the same run.",
        {
          prompt: z.string().min(1),
          options: z
            .array(
              z.object({
                id: z.string().min(1).optional(),
                label: z.string().min(1),
                description: z.string().optional()
              })
            )
            .min(2)
            .max(4),
          allowCustom: z.boolean().optional()
        },
        async (args) => {
          const decision = await params.requestInteraction({
            kind: "choice",
            messageId: "",
            payload: {
              prompt: args.prompt,
              options: args.options.map((option, index) => ({
                id: option.id ?? `option_${index + 1}`,
                label: option.label,
                description: option.description
              })),
              allowCustom: args.allowCustom ?? true
            }
          });

          if (decision.kind !== "choice") {
            return {
              content: [{ type: "text", text: "No choice was provided." }]
            };
          }

          const answer = decision.customText || decision.selectedOptionIds.join(", ");

          return {
            content: [{ type: "text", text: answer || "No choice was selected." }]
          };
        },
        { alwaysLoad: true }
      )
    ]
  });
}

function eventFromSdkMessage(message: SDKMessage): AgentEvent | null {
  if (message.type === "assistant") {
    const text = extractText(message.message.content);

    if (text) {
      return { type: "text_delta", delta: text };
    }

    if (message.error) {
      return { type: "message_error", error: `Claude Code 运行失败：${message.error}` };
    }
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

function sessionIdFromSdkMessage(message: SDKMessage) {
  const record = message as unknown as Record<string, unknown>;
  const sessionId = record.session_id ?? record.sessionId;

  return typeof sessionId === "string" ? sessionId : "";
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

  return "Claude Code 运行失败。";
}

function actionForTool(toolName: string) {
  const normalized = toolName.toLowerCase();

  if (normalized.includes("bash") || normalized.includes("shell")) {
    return "run_command";
  }

  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("patch")) {
    return "write_file";
  }

  if (normalized.includes("web") || normalized.includes("fetch")) {
    return "network";
  }

  return "tool_use";
}

function commandFromInput(input: Record<string, unknown>) {
  const command = input.command ?? input.cmd ?? input.script;
  return typeof command === "string" ? command : undefined;
}

function pathFromInput(input: Record<string, unknown>, blockedPath?: string) {
  const filePath = input.file_path ?? input.path ?? input.notebook_path ?? blockedPath;
  return typeof filePath === "string" ? filePath : undefined;
}

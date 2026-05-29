import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { join } from "node:path";

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
  type ToolCallUpdate
} from "@agentclientprotocol/sdk";

import {
  formatAttachmentContext,
  type AgentAdapter,
  type AgentEvent,
  type AdapterRunParams
} from "@/lib/adapters/types";
import { runProcess } from "@/lib/adapters/process-runner";
import type { InteractionDecision } from "@/lib/interactions/types";

const opencodeCommand = resolveOpenCodeCommand();
const OPENCODE_QUEUE_SETTLE_MS = 100;

export const openCodeAdapter: AgentAdapter = {
  platform: "opencode",
  capabilities: {
    supportsApproval: "native",
    supportsChoice: "native"
  },
  async healthcheck() {
    try {
      const result = await runOpenCode(["--version"], { timeoutMs: 8000 });
      const version = result.stdout.trim() || result.stderr.trim();

      return {
        ok: result.exitCode === 0,
        message: result.exitCode === 0 ? `OpenCode CLI 可用：${version}` : version || "opencode --version 执行失败。",
        capabilities: this.capabilities
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "OpenCode CLI 检测失败。",
        capabilities: this.capabilities
      };
    }
  },
  run(params) {
    return runOpenCodeAdapter(params);
  }
};

async function* runOpenCodeAdapter(params: AdapterRunParams): AsyncIterable<AgentEvent> {
  const health = await openCodeAdapter.healthcheck();

  if (!health.ok) {
    yield { type: "message_error", error: health.message };
    return;
  }

  yield { type: "run_status", status: "running" };

  const queue = new AsyncEventQueue<AgentEvent>();
  let promptSettled = false;
  let stderr = "";
  const child = spawn(opencodeCommand, ["acp", "--cwd", params.workspacePath], {
    cwd: params.workspacePath,
    env: process.env,
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const abort = () => child.kill();

  if (params.signal.aborted) {
    abort();
  } else {
    params.signal.addEventListener("abort", abort, { once: true });
  }

  child.stderr.on("data", (data: Buffer) => {
    stderr = `${stderr}${data.toString("utf8")}`;
  });
  child.on("error", (error) => queue.fail(error));
  child.on("close", (code, signal) => {
    if (!promptSettled) {
      const detail = stderr.trim() || `OpenCode process closed before prompt completed (${signal ?? code ?? "unknown"}).`;
      queue.fail(new Error(detail));
      return;
    }

    queue.end();
  });

  const client = new AgentHubAcpClient(params, queue);
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  );
  const connection = new ClientSideConnection(() => client, stream);
  let sessionId = "";
  let promptCompleted = false;
  let assistantTextReceived = false;
  let resumedSession = false;

  try {
    const initialized = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        elicitation: {
          form: {}
        }
      }
    });
    const agentCapabilities = asRecord(initialized.agentCapabilities);
    const sessionCapabilities = asRecord(agentCapabilities.sessionCapabilities);
    const canResumeSession = Boolean(sessionCapabilities.resume);
    const canLoadSession = Boolean(agentCapabilities.loadSession);

    if (params.externalSessionId && canResumeSession) {
      try {
        await connection.resumeSession({
          sessionId: params.externalSessionId,
          cwd: params.workspacePath,
          mcpServers: []
        });
        sessionId = params.externalSessionId;
        resumedSession = true;
      } catch {
        sessionId = "";
      }
    }

    if (!sessionId && params.externalSessionId && canLoadSession) {
      try {
        await connection.loadSession({
          sessionId: params.externalSessionId,
          cwd: params.workspacePath,
          mcpServers: []
        });
        sessionId = params.externalSessionId;
        resumedSession = true;
      } catch {
        sessionId = "";
      }
    }

    if (!sessionId) {
      const session = await connection.newSession({
        cwd: params.workspacePath,
        mcpServers: []
      });
      sessionId = session.sessionId;
    }
    params.saveExternalSessionId(sessionId, {
      loadSession: canLoadSession,
      resumeSession: canResumeSession,
      resumedSession
    });

    let promptFailure: Error | null = null;
    const promptPromise = connection
      .prompt({
        sessionId,
        prompt: [{ type: "text", text: buildPrompt(params, resumedSession) }]
      })
      .then(
        (result) => {
          promptSettled = true;
          promptCompleted = true;
          endQueueAfterPendingUpdates(queue);
          return result;
        },
        (error) => {
          promptSettled = true;
          promptFailure = error instanceof Error ? error : new Error("OpenCode prompt failed.");
          queue.fail(promptFailure);
          return null;
        }
      );

    while (true) {
      const event = await queue.next();

      if (!event) {
        break;
      }

      if (event.type === "text_delta") {
        assistantTextReceived = true;
      }
      yield event;
    }

    const result = await promptPromise;

    if (promptFailure) {
      throw promptFailure;
    }

    if (!result) {
      yield { type: "message_error", error: "OpenCode prompt did not return a result." };
      return;
    }

    if (result.stopReason === "cancelled") {
      yield { type: "message_cancelled" };
      return;
    }

    if (result.stopReason === "refusal") {
      yield { type: "message_error", error: "OpenCode refused to continue this turn." };
      return;
    }

    if (!assistantTextReceived) {
      const resultText = extractText(result);

      if (resultText) {
        yield { type: "text_delta", delta: resultText };
        yield { type: "message_done" };
        return;
      }

      yield { type: "message_error", error: "OpenCode completed without returning assistant text." };
      return;
    }

    yield { type: "message_done" };
  } catch (error) {
    if (params.signal.aborted) {
      yield { type: "message_cancelled" };
      return;
    }

    yield {
      type: "message_error",
      error: error instanceof Error ? error.message : "OpenCode ACP 运行失败。"
    };
  } finally {
    params.signal.removeEventListener("abort", abort);

    if (sessionId && !promptCompleted) {
      await connection.cancel({ sessionId }).catch(() => undefined);
    }

    child.kill();
    await connection.closed.catch(() => undefined);
  }
}

class AgentHubAcpClient implements Client {
  constructor(
    private readonly params: AdapterRunParams,
    private readonly queue: AsyncEventQueue<AgentEvent>
  ) {}

  async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const decision = await this.params.requestInteraction({
      kind: "approval",
      messageId: "",
      payload: {
        action: actionForToolCall(request.toolCall),
        summary: request.toolCall.title ?? "OpenCode 请求权限。",
        command: commandFromToolCall(request.toolCall),
        path: pathFromToolCall(request.toolCall),
        risk: optionsSummary(request.options)
      }
    });

    if (decision.kind !== "approval") {
      return { outcome: { outcome: "cancelled" } };
    }

    return {
      outcome: {
        outcome: "selected",
        optionId: selectPermissionOption(request.options, decision.approved)
      }
    };
  }

  async sessionUpdate(notification: SessionNotification) {
    const event = eventFromSessionUpdate(notification.update);

    if (event) {
      this.queue.push(event);
    }
  }

  async unstable_createElicitation(request: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    if (request.mode === "url") {
      return this.createUrlElicitation(request);
    }

    const { propertyName, options, allowCustom } = choiceOptionsFromElicitation(request);
    const decision = await this.params.requestInteraction({
      kind: "choice",
      messageId: "",
      payload: {
        prompt: request.message,
        options,
        allowCustom
      }
    });

    if (decision.kind !== "choice" || decision.selectedOptionIds.includes("decline")) {
      return { action: "decline" };
    }

    return {
      action: "accept",
      content: contentFromChoiceDecision(propertyName, decision, options)
    };
  }

  private async createUrlElicitation(request: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    const url = request.mode === "url" ? request.url : "";
    const decision = await this.params.requestInteraction({
      kind: "choice",
      messageId: "",
      payload: {
        prompt: [request.message, url ? `URL: ${url}` : ""].filter(Boolean).join("\n"),
        options: [
          { id: "accept", label: "继续", description: "已完成外部页面操作，继续当前 run。" },
          { id: "decline", label: "拒绝", description: "不继续该外部输入请求。" }
        ],
        allowCustom: true
      }
    });

    if (decision.kind !== "choice" || decision.selectedOptionIds.includes("decline")) {
      return { action: "decline" };
    }

    return {
      action: "accept",
      content: decision.customText ? { value: decision.customText } : {}
    };
  }
}

function runOpenCode(
  args: string[],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {}
) {
  return runProcess(opencodeCommand, args, {
    cwd: process.cwd(),
    signal: options.signal,
    shell: process.platform === "win32",
    timeoutMs: options.timeoutMs,
    onStdout: options.onStdout,
    onStderr: options.onStderr
  });
}

function buildPrompt(params: AdapterRunParams, resumed: boolean) {
  const recentMessages = resumed
    ? params.messages.filter((message) => message.role === "user").slice(-1)
    : params.messages.slice(-12);
  const attachmentContext = formatAttachmentContext(params.attachments);

  return [
    [
      "You are running inside AgentHub.",
      "When a user choice or structured input is required, use ACP elicitation instead of asking in plain text.",
      "Approval and choice requests are handled by AgentHub inline cards."
    ].join("\n"),
    recentMessages
      .map((message) => {
        const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System";
        return `${role}: ${message.content}`;
      })
      .join("\n\n"),
    attachmentContext ? `\n\nUser attachments:\n${attachmentContext}` : ""
  ].join("\n\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function eventFromSessionUpdate(update: SessionUpdate): AgentEvent | null {
  if (update.sessionUpdate === "agent_message_chunk") {
    const text = extractText(update.content);

    if (text) {
      return { type: "text_delta", delta: text };
    }
  }

  if (update.sessionUpdate === "tool_call" && update.status === "failed") {
    return { type: "message_error", error: `${update.title} failed.` };
  }

  if (update.sessionUpdate === "tool_call_update" && update.status === "failed") {
    return { type: "message_error", error: `${update.title ?? update.toolCallId} failed.` };
  }

  return null;
}

function endQueueAfterPendingUpdates(queue: AsyncEventQueue<AgentEvent>) {
  setTimeout(() => queue.end(), OPENCODE_QUEUE_SETTLE_MS);
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

  if (typeof record.value === "string") {
    return record.value;
  }

  if (record.content) {
    return extractText(record.content);
  }

  if (record.message) {
    return extractText(record.message);
  }

  if (record.output) {
    return extractText(record.output);
  }

  if (record.result) {
    return extractText(record.result);
  }

  return "";
}

function actionForToolCall(toolCall: ToolCallUpdate) {
  switch (toolCall.kind) {
    case "execute":
      return "run_command";
    case "edit":
    case "delete":
    case "move":
      return "write_file";
    default:
      return "tool_use";
  }
}

function commandFromToolCall(toolCall: ToolCallUpdate) {
  const raw = toolCall.rawInput;

  if (typeof raw === "string") {
    return raw;
  }

  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const command = record.command ?? record.cmd ?? record.input;

  if (Array.isArray(command)) {
    return command.map(String).join(" ");
  }

  return typeof command === "string" ? command : undefined;
}

function pathFromToolCall(toolCall: ToolCallUpdate) {
  const location = toolCall.locations?.[0]?.path;

  if (location) {
    return location;
  }

  const raw = toolCall.rawInput;

  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const path = record.path ?? record.file ?? record.filePath;

  return typeof path === "string" ? path : undefined;
}

function optionsSummary(options: PermissionOption[]) {
  return options.map((option) => `${option.name} (${option.kind})`).join(", ");
}

function selectPermissionOption(options: PermissionOption[], approved: boolean) {
  const preferredKinds = approved ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];

  for (const kind of preferredKinds) {
    const option = options.find((candidate) => candidate.kind === kind);

    if (option) {
      return option.optionId;
    }
  }

  return options[0]?.optionId ?? "";
}

function choiceOptionsFromElicitation(request: CreateElicitationRequest) {
  const schema = request.mode === "form" ? request.requestedSchema : {};
  const properties = schema.properties ?? {};
  const [propertyName = "value", property = { type: "string" }] = Object.entries(properties)[0] ?? [];
  const enumOptions = enumValuesFromProperty(property);

  if (enumOptions.length > 0) {
    return {
      propertyName,
      options: enumOptions.map((option, index) => ({
        id: option.value,
        label: option.label || option.value || `Option ${index + 1}`,
        description: option.description
      })),
      allowCustom: false
    };
  }

  return {
    propertyName,
    options: [
      { id: "accept", label: "继续", description: "提供输入并继续当前 run。" },
      { id: "decline", label: "拒绝", description: "拒绝该输入请求。" }
    ],
    allowCustom: true
  };
}

function enumValuesFromProperty(property: unknown) {
  const record = property && typeof property === "object" ? (property as Record<string, unknown>) : {};
  const enumValues = Array.isArray(record.enum) ? record.enum.map(String) : [];
  const titledValues = Array.isArray(record.oneOf)
    ? record.oneOf.map((item) => {
        const candidate = item && typeof item === "object" ? (item as Record<string, unknown>) : {};

        return {
          value: String(candidate.const ?? candidate.enum ?? candidate.title ?? ""),
          label: String(candidate.title ?? candidate.const ?? ""),
          description: typeof candidate.description === "string" ? candidate.description : undefined
        };
      })
    : [];

  if (titledValues.length > 0) {
    return titledValues.filter((item) => item.value);
  }

  return enumValues.map((value) => ({ value, label: value, description: undefined }));
}

function contentFromChoiceDecision(
  propertyName: string,
  decision: InteractionDecision,
  options: Array<{ id: string; label: string }>
) {
  if (decision.kind !== "choice") {
    return {};
  }

  if (decision.customText) {
    return { [propertyName]: decision.customText };
  }

  const selected = decision.selectedOptionIds[0];
  const value = options.find((option) => option.id === selected)?.id ?? selected;

  return { [propertyName]: value };
}

function resolveOpenCodeCommand() {
  if (process.env.AGENTHUB_OPENCODE_COMMAND) {
    return process.env.AGENTHUB_OPENCODE_COMMAND;
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    const npmGlobalExe = join(process.env.APPDATA, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");

    if (existsSync(npmGlobalExe)) {
      return npmGlobalExe;
    }
  }

  return process.platform === "win32" ? "opencode.cmd" : "opencode";
}

class AsyncEventQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | null) => void> = [];
  private closed = false;
  private error: Error | null = null;

  push(item: T) {
    const waiter = this.waiters.shift();

    if (waiter) {
      waiter(item);
      return;
    }

    this.items.push(item);
  }

  fail(error: Error) {
    this.error = error;
    this.end();
  }

  next() {
    const item = this.items.shift();

    if (item) {
      return Promise.resolve(item);
    }

    if (this.error) {
      return Promise.reject(this.error);
    }

    if (this.closed) {
      return Promise.resolve(null);
    }

    return new Promise<T | null>((resolve) => this.waiters.push(resolve));
  }

  end() {
    this.closed = true;

    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }
}

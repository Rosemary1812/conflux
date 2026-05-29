import { formatAttachmentContext, type AgentAdapter, type AgentEvent, type AdapterRunParams } from "@/lib/adapters/types";
import { JsonRpcProcessClient, type JsonRpcMessage, isJsonRpcRequest } from "@/lib/adapters/json-rpc-process";
import { commandExists, runProcess } from "@/lib/adapters/process-runner";
import type { InteractionDecision } from "@/lib/interactions/types";

const codexCommand = process.platform === "win32" ? "codex.cmd" : "codex";

export const codexAdapter: AgentAdapter = {
  platform: "codex",
  capabilities: {
    supportsApproval: "native",
    supportsChoice: "native"
  },
  async healthcheck() {
    if (!(await commandExists("codex"))) {
      return { ok: false, message: "未在 PATH 中找到 Codex CLI。", capabilities: this.capabilities };
    }

    try {
      const result = await runProcess(codexCommand, ["--version"], {
        shell: process.platform === "win32",
        timeoutMs: 8000
      });
      const version = result.stdout.trim() || result.stderr.trim();

      return {
        ok: result.exitCode === 0,
        message: result.exitCode === 0 ? `Codex CLI 可用：${version}` : version || "codex --version 执行失败。",
        capabilities: this.capabilities
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Codex CLI 检测失败。",
        capabilities: this.capabilities
      };
    }
  },
  run(params) {
    return runCodex(params);
  }
};

async function* runCodex(params: AdapterRunParams): AsyncIterable<AgentEvent> {
  const health = await codexAdapter.healthcheck();

  if (!health.ok) {
    yield { type: "message_error", error: health.message };
    return;
  }

  yield { type: "run_status", status: "running" };

  const client = new JsonRpcProcessClient(codexCommand, ["app-server", "--listen", "stdio://"], {
    cwd: params.workspacePath,
    shell: process.platform === "win32",
    signal: params.signal
  });
  const queue = new AsyncEventQueue<AgentEvent>();
  let completed = false;
  let failed: string | null = null;
  let emittedText = "";
  let threadId = "";

  const unsubscribe = client.onMessage((message) => {
    void handleCodexMessage({
      client,
      message,
      params,
      queue,
      pushText(delta) {
        emittedText = `${emittedText}${delta}`;
        queue.push({ type: "text_delta", delta });
      },
      getEmittedText() {
        return emittedText;
      },
      markCompleted() {
        completed = true;
        queue.end();
      },
      markFailed(error) {
        failed = error;
        completed = true;
        queue.end();
      }
    });
  });

  try {
    await client.request("initialize", {
      clientInfo: {
        name: "agenthub",
        title: "AgentHub",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: []
      }
    });

    const threadStart = asRecord(
      await client.request("thread/start", {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        cwd: params.workspacePath,
        baseInstructions: [
          "You are running inside AgentHub.",
          "When you need the user to choose before continuing, use the request_user_input tool instead of asking in plain text.",
          "Approval and user-input requests are handled by AgentHub inline cards."
        ].join("\n"),
        sandbox: "workspace-write",
        ephemeral: true,
        sessionStartSource: "startup"
      })
    );
    threadId = String(asRecord(threadStart.thread).id ?? "");

    const turnStart = asRecord(
      await client.request("turn/start", {
        threadId,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        cwd: params.workspacePath,
        input: [{ type: "text", text: buildPrompt(params), text_elements: [] }]
      })
    );
    const turn = asRecord(turnStart.turn);

    if (turn.status === "completed") {
      completed = true;
      queue.end();
    }

    while (!completed) {
      const event = await queue.next();

      if (!event) {
        break;
      }

      yield event;
    }

    while (true) {
      const event = await queue.next();

      if (!event) {
        break;
      }

      yield event;
    }

    if (failed) {
      yield { type: "message_error", error: failed };
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
      error: error instanceof Error ? error.message : "Codex app-server 运行失败。"
    };
  } finally {
    unsubscribe();
    if (threadId) {
      await client.request("thread/unsubscribe", { threadId }).catch(() => undefined);
    }
    client.close();
    await client.waitForClose().catch(() => undefined);
  }
}

async function handleCodexMessage({
  client,
  message,
  params,
  queue,
  pushText,
  getEmittedText,
  markCompleted,
  markFailed
}: {
  client: JsonRpcProcessClient;
  message: JsonRpcMessage;
  params: AdapterRunParams;
  queue: AsyncEventQueue<AgentEvent>;
  pushText(delta: string): void;
  getEmittedText(): string;
  markCompleted(): void;
  markFailed(error: string): void;
}) {
  if (isJsonRpcRequest(message)) {
    await handleCodexRequest(client, message, params);
    return;
  }

  if (!("method" in message)) {
    return;
  }

  const paramsRecord = asRecord(message.params);

  if (message.method === "item/agentMessage/delta") {
    const delta = paramsRecord.delta;

    if (typeof delta === "string" && delta) {
      pushText(delta);
    }
    return;
  }

  if (message.method === "item/completed") {
    const text = extractThreadItemText(paramsRecord.item);
    const missingText = completionSuffix(text, getEmittedText());

    if (missingText) {
      pushText(missingText);
    }
    return;
  }

  if (message.method === "turn/completed") {
    const turn = asRecord(paramsRecord.turn);
    const error = asRecord(turn.error);

    if (turn.status === "failed") {
      markFailed(String(error.message ?? "Codex turn failed."));
      return;
    }

    markCompleted();
  }
}

async function handleCodexRequest(
  client: JsonRpcProcessClient,
  request: { id: string | number; method: string; params?: unknown },
  params: AdapterRunParams
) {
  try {
    if (request.method === "item/commandExecution/requestApproval") {
      const requestParams = asRecord(request.params);
      const decision = await requestApproval(params, {
        action: "run_command",
        summary: String(requestParams.reason ?? "Codex 请求执行命令。"),
        command: typeof requestParams.command === "string" ? requestParams.command : undefined,
        path: typeof requestParams.cwd === "string" ? requestParams.cwd : undefined
      });
      client.respond(request.id, { decision: approvalDecision(decision) });
      return;
    }

    if (request.method === "item/fileChange/requestApproval") {
      const requestParams = asRecord(request.params);
      const decision = await requestApproval(params, {
        action: "write_file",
        summary: String(requestParams.reason ?? "Codex 请求修改文件。"),
        path: typeof requestParams.grantRoot === "string" ? requestParams.grantRoot : undefined
      });
      client.respond(request.id, { decision: approvalDecision(decision) });
      return;
    }

    if (request.method === "item/permissions/requestApproval") {
      const requestParams = asRecord(request.params);
      const permissions = asRecord(requestParams.permissions);
      const decision = await requestApproval(params, {
        action: "tool_use",
        summary: String(requestParams.reason ?? "Codex 请求扩展权限。"),
        path: typeof requestParams.cwd === "string" ? requestParams.cwd : undefined,
        risk: JSON.stringify(permissions)
      });

      if (decision.kind === "approval" && decision.approved) {
        client.respond(request.id, {
          permissions: {
            network: permissions.network ?? undefined,
            fileSystem: permissions.fileSystem ?? undefined
          },
          scope: "turn"
        });
      } else {
        client.respond(request.id, {
          permissions: {},
          scope: "turn",
          strictAutoReview: true
        });
      }
      return;
    }

    if (request.method === "item/tool/requestUserInput") {
      const response = await requestUserInput(params, asRecord(request.params));
      client.respond(request.id, response);
      return;
    }

    if (request.method === "mcpServer/elicitation/request") {
      const response = await requestElicitation(params, asRecord(request.params));
      client.respond(request.id, response);
      return;
    }

    client.respondError(request.id, `AgentHub does not support Codex request method ${request.method}.`);
  } catch (error) {
    client.respondError(request.id, error instanceof Error ? error.message : "Codex request failed.");
  }
}

function requestApproval(
  params: AdapterRunParams,
  payload: {
    action: string;
    summary: string;
    command?: string;
    path?: string;
    risk?: string;
  }
) {
  return params.requestInteraction({
    kind: "approval",
    messageId: "",
    payload
  });
}

async function requestUserInput(params: AdapterRunParams, requestParams: Record<string, unknown>) {
  const questions = Array.isArray(requestParams.questions) ? requestParams.questions.map(asRecord) : [];
  const firstQuestion = questions[0] ?? {};
  const options = Array.isArray(firstQuestion.options) ? firstQuestion.options.map(asRecord) : [];
  const choiceOptions = options.map((option, index) => ({
    id: `option_${index + 1}`,
    label: String(option.label ?? `Option ${index + 1}`),
    description: typeof option.description === "string" ? option.description : undefined
  }));

  const decision = await params.requestInteraction({
    kind: "choice",
    messageId: "",
    payload: {
      prompt: String(firstQuestion.question ?? "请选择下一步。"),
      options: choiceOptions.length > 0 ? choiceOptions : [
        { id: "yes", label: "继续", description: "继续当前 run。" },
        { id: "no", label: "停止", description: "不继续当前操作。" }
      ],
      allowCustom: Boolean(firstQuestion.isOther ?? true)
    }
  });

  const questionId = String(firstQuestion.id ?? "answer");

  return {
    answers: {
      [questionId]: {
        answers: answerValues(decision, choiceOptions)
      }
    }
  };
}

async function requestElicitation(params: AdapterRunParams, requestParams: Record<string, unknown>) {
  const decision = await params.requestInteraction({
    kind: "choice",
    messageId: "",
    payload: {
      prompt: String(requestParams.message ?? "Codex 需要用户输入。"),
      options: [
        { id: "accept", label: "允许", description: "继续当前请求。" },
        { id: "decline", label: "拒绝", description: "拒绝该请求。" }
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

function approvalDecision(decision: InteractionDecision) {
  return decision.kind === "approval" && decision.approved ? "accept" : "decline";
}

function answerValues(decision: InteractionDecision, options: Array<{ id: string; label: string }>) {
  if (decision.kind !== "choice") {
    return [];
  }

  if (decision.customText) {
    return [decision.customText];
  }

  return decision.selectedOptionIds.map((id) => options.find((option) => option.id === id)?.label ?? id);
}

function buildPrompt(params: AdapterRunParams) {
  const recentMessages = params.messages.slice(-12);
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

function extractThreadItemText(value: unknown): string {
  const item = asRecord(value);

  if (item.type !== "agentMessage") {
    return "";
  }

  return typeof item.text === "string" ? item.text : "";
}

function completionSuffix(completedText: string, emittedText: string) {
  if (!completedText || completedText === emittedText || emittedText.includes(completedText)) {
    return "";
  }

  if (completedText.startsWith(emittedText)) {
    return completedText.slice(emittedText.length);
  }

  if (emittedText.endsWith(completedText)) {
    return "";
  }

  return emittedText ? "" : completedText;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

class AsyncEventQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | null) => void> = [];
  private closed = false;

  push(item: T) {
    const waiter = this.waiters.shift();

    if (waiter) {
      waiter(item);
      return;
    }

    this.items.push(item);
  }

  next() {
    const item = this.items.shift();

    if (item) {
      return Promise.resolve(item);
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

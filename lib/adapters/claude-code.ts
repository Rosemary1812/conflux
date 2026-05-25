import { formatAttachmentContext, type AgentAdapter, type AgentEvent, type AdapterRunParams } from "@/lib/adapters/types";
import { commandExists, runProcess } from "@/lib/adapters/process-runner";

export const claudeCodeAdapter: AgentAdapter = {
  platform: "claude_code",
  async healthcheck() {
    if (!(await commandExists("claude"))) {
      return { ok: false, message: "未在 PATH 中找到 claude CLI。" };
    }

    try {
      const result = await runProcess("claude", ["--version"], { timeoutMs: 8000 });
      const version = result.stdout.trim() || result.stderr.trim();

      return {
        ok: result.exitCode === 0,
        message: result.exitCode === 0 ? `Claude Code 可用：${version}` : version || "claude --version 执行失败。"
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Claude Code 检测失败。"
      };
    }
  },
  run(params) {
    return runClaudeCode(params);
  }
};

async function* runClaudeCode(params: AdapterRunParams): AsyncIterable<AgentEvent> {
  const health = await claudeCodeAdapter.healthcheck();

  if (!health.ok) {
    yield { type: "message_error", error: health.message };
    return;
  }

  yield { type: "run_status", status: "running" };

  const events: AgentEvent[] = [];
  let stdoutBuffer = "";
  let emittedText = false;

  const processPromise = runProcess(
    "claude",
    [
      "-p",
      buildPrompt(params),
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "plan",
      "--add-dir",
      params.workspacePath
    ],
    {
      cwd: params.workspacePath,
      signal: params.signal,
      timeoutMs: 10 * 60 * 1000,
      onStdout(chunk) {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = eventFromClaudeLine(line, emittedText);

          if (event.type === "text_delta") {
            emittedText = true;
          }

          if (event.type !== "empty") {
            events.push(event);
          }
        }
      }
    }
  );

  while (true) {
    while (events.length > 0) {
      yield events.shift()!;
    }

    const result = await Promise.race([
      processPromise.then((value) => ({ type: "done" as const, value })),
      delay(100, params.signal).then(() => ({ type: "tick" as const }))
    ]);

    if (result.type === "done") {
      while (events.length > 0) {
        yield events.shift()!;
      }

      if (stdoutBuffer.trim()) {
        const event = eventFromClaudeLine(stdoutBuffer.trim(), emittedText);

        if (event.type === "text_delta") {
          emittedText = true;
        }

        if (event.type !== "empty") {
          yield event;
        }
      }

      if (result.value.exitCode !== 0) {
        yield {
          type: "message_error",
          error: result.value.stderr.trim() || `Claude Code exited with code ${result.value.exitCode}.`
        };
        return;
      }

      yield { type: "message_done" };
      return;
    }
  }
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

function eventFromClaudeLine(line: string, emittedText: boolean): AgentEvent | { type: "empty" } {
  try {
    const payload = JSON.parse(line) as unknown;
    const error = extractError(payload);

    if (error) {
      return { type: "message_error", error };
    }

    const text = extractText(payload);

    if (text && (!emittedText || isLikelyDelta(payload))) {
      return { type: "text_delta", delta: text };
    }
  } catch {
    if (line.trim()) {
      return { type: "text_delta", delta: line };
    }
  }

  return { type: "empty" };
}

function isLikelyDelta(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const type = String(record.type ?? "");
  return type.includes("delta") || type === "text_delta";
}

function extractError(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = String(record.type ?? "");

  if (type.includes("error")) {
    return String(record.error ?? record.message ?? "Claude Code 运行失败。");
  }

  return null;
}

function extractText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.result === "string") {
    return record.result;
  }

  if (Array.isArray(record.content)) {
    return record.content.map(extractText).join("");
  }

  if (record.message) {
    return extractText(record.message);
  }

  if (record.delta) {
    return extractText(record.delta);
  }

  return "";
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Run cancelled.", "AbortError"));
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Run cancelled.", "AbortError"));
      },
      { once: true }
    );
  });
}

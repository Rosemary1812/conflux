import type { AgentAdapter, AgentEvent, AdapterRunParams } from "@/lib/adapters/types";
import { commandExists, runProcess } from "@/lib/adapters/process-runner";

const codexCommand = process.platform === "win32" ? "codex.cmd" : "codex";

export const codexAdapter: AgentAdapter = {
  platform: "codex",
  async healthcheck() {
    if (!(await commandExists("codex"))) {
      return { ok: false, message: "未在 PATH 中找到 Codex CLI。" };
    }

    try {
      const result = await runProcess(codexCommand, ["--version"], {
        shell: process.platform === "win32",
        timeoutMs: 8000
      });
      const version = result.stdout.trim() || result.stderr.trim();

      return {
        ok: result.exitCode === 0,
        message: result.exitCode === 0 ? `Codex CLI 可用：${version}` : version || "codex --version 执行失败。"
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Codex CLI 检测失败。"
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

  const events: AgentEvent[] = [];
  let stdoutBuffer = "";
  let stderr = "";
  let emitted = false;

  const processPromise = runProcess(
    codexCommand,
    [
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "-C",
      params.workspacePath,
      "-"
    ],
    {
      cwd: params.workspacePath,
      input: buildPrompt(params.messages),
      shell: process.platform === "win32",
      signal: params.signal,
      timeoutMs: 10 * 60 * 1000,
      onStdout(chunk) {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = eventFromCodexLine(line, emitted);

          if (event.type === "text_delta") {
            emitted = true;
          }

          if (event.type !== "empty") {
            events.push(event);
          }
        }
      },
      onStderr(chunk) {
        stderr += chunk;
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
        const event = eventFromCodexLine(stdoutBuffer.trim(), emitted);

        if (event.type !== "empty") {
          yield event;
        }
      }

      if (result.value.exitCode !== 0) {
        yield {
          type: "message_error",
          error: stderr.trim() || result.value.stderr.trim() || `Codex exited with code ${result.value.exitCode}.`
        };
        return;
      }

      yield { type: "message_done" };
      return;
    }
  }
}

function buildPrompt(messages: AdapterRunParams["messages"]) {
  const recentMessages = messages.slice(-12);

  return recentMessages
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System";
      return `${role}: ${message.content}`;
    })
    .join("\n\n");
}

function eventFromCodexLine(line: string, emitted: boolean): AgentEvent | { type: "empty" } {
  try {
    const payload = JSON.parse(line) as CodexJsonEvent;

    if (payload.type === "item.completed" && payload.item?.type === "agent_message" && payload.item.text) {
      return {
        type: "text_delta",
        delta: emitted ? "" : payload.item.text
      };
    }

    if (payload.type === "error") {
      return { type: "message_error", error: payload.message ?? "Codex 运行失败。" };
    }
  } catch {
    if (line.trim()) {
      return { type: "text_delta", delta: line };
    }
  }

  return { type: "empty" };
}

type CodexJsonEvent = {
  type?: string;
  message?: string;
  item?: {
    type?: string;
    text?: string;
  };
};

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

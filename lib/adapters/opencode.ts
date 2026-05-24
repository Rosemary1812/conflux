import { existsSync } from "node:fs";
import { join } from "node:path";

import type { AgentAdapter, AgentEvent, AdapterRunParams } from "@/lib/adapters/types";
import { runProcess } from "@/lib/adapters/process-runner";

const opencodeCommand = resolveOpenCodeCommand();

export const openCodeAdapter: AgentAdapter = {
  platform: "opencode",
  async healthcheck() {
    try {
      const result = await runOpenCode(["--version"], { timeoutMs: 8000 });
      const version = result.stdout.trim() || result.stderr.trim();

      return {
        ok: result.exitCode === 0,
        message: result.exitCode === 0 ? `OpenCode CLI 可用：${version}` : version || "opencode --version 执行失败。"
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "OpenCode CLI 检测失败。"
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

  const events: AgentEvent[] = [];
  let stdoutBuffer = "";
  let stderr = "";

  const processPromise = runOpenCode(
    ["run", "--format", "json", "--dir", params.workspacePath, buildPrompt(params.messages)],
    {
      signal: params.signal,
      timeoutMs: 10 * 60 * 1000,
      onStdout(chunk) {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = eventFromOpenCodeLine(line);

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
        const event = eventFromOpenCodeLine(stdoutBuffer.trim());

        if (event.type !== "empty") {
          yield event;
        }
      }

      if (result.value.exitCode !== 0) {
        yield {
          type: "message_error",
          error: stderr.trim() || result.value.stderr.trim() || `OpenCode exited with code ${result.value.exitCode}.`
        };
        return;
      }

      yield { type: "message_done" };
      return;
    }
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
    timeoutMs: options.timeoutMs,
    onStdout: options.onStdout,
    onStderr: options.onStderr
  });
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

function eventFromOpenCodeLine(line: string): AgentEvent | { type: "empty" } {
  try {
    const payload = JSON.parse(line) as OpenCodeJsonEvent;

    if (payload.type === "text" && typeof payload.part?.text === "string") {
      return { type: "text_delta", delta: payload.part.text };
    }

    if (payload.type === "error") {
      return { type: "message_error", error: payload.error ?? payload.message ?? "OpenCode 运行失败。" };
    }
  } catch {
    if (line.trim()) {
      return { type: "text_delta", delta: line };
    }
  }

  return { type: "empty" };
}

type OpenCodeJsonEvent = {
  type?: string;
  error?: string;
  message?: string;
  part?: {
    text?: string;
  };
};

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

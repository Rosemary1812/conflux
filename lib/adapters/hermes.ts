import type { AgentAdapter, AgentEvent, AdapterRunParams } from "@/lib/adapters/types";
import { runProcess } from "@/lib/adapters/process-runner";

const wslDistro = process.env.AGENTHUB_HERMES_WSL_DISTRO ?? "Ubuntu-24.04";

export const hermesAdapter: AgentAdapter = {
  platform: "hermes",
  async healthcheck() {
    try {
      const result = await runHermesShell("command -v hermes && hermes --version", { timeoutMs: 60000 });
      const output = result.stdout.trim() || result.stderr.trim();

      return {
        ok: result.exitCode === 0,
        message: result.exitCode === 0 ? `Hermes 可用：${firstLine(output)}` : output || "Hermes 检测失败。"
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Hermes 检测失败。"
      };
    }
  },
  run(params) {
    return runHermes(params);
  }
};

async function* runHermes(params: AdapterRunParams): AsyncIterable<AgentEvent> {
  const health = await hermesAdapter.healthcheck();

  if (!health.ok) {
    yield { type: "message_error", error: health.message };
    return;
  }

  yield { type: "run_status", status: "running" };

  const result = await runHermesShell(`cd "${toWslPath(params.workspacePath)}" && hermes --oneshot ${shellQuote(buildPrompt(params.messages))}`, {
    signal: params.signal,
    timeoutMs: 10 * 60 * 1000
  });

  if (result.exitCode !== 0) {
    yield {
      type: "message_error",
      error: result.stderr.trim() || result.stdout.trim() || `Hermes exited with code ${result.exitCode}.`
    };
    return;
  }

  const text = result.stdout.trim();

  if (text) {
    yield { type: "text_delta", delta: text };
  }

  yield { type: "message_done" };
}

function runHermesShell(
  script: string,
  options: {
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
) {
  return runProcess("wsl.exe", ["-d", wslDistro, "--", "bash", "-lc", script], {
    env: options.env,
    signal: options.signal,
    timeoutMs: options.timeoutMs
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

function toWslPath(workspacePath: string) {
  const normalized = workspacePath.replace(/\\/g, "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);

  if (!match) {
    return normalized;
  }

  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function firstLine(value: string) {
  return value.split(/\r?\n/).find(Boolean) ?? "Hermes CLI 已安装。";
}

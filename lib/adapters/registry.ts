import type { AgentAdapter } from "@/lib/adapters/types";
import { claudeCodeAdapter } from "@/lib/adapters/claude-code";
import { codexAdapter } from "@/lib/adapters/codex";
import { unavailableCliAdapter } from "@/lib/adapters/fallback";
import { fakeAdapter } from "@/lib/adapters/fake";
import { hermesAdapter } from "@/lib/adapters/hermes";
import { openCodeAdapter } from "@/lib/adapters/opencode";
import type { AgentPlatform } from "@/lib/agents/types";

const adapters: Record<AgentPlatform | "fake", AgentAdapter> = {
  fake: fakeAdapter,
  claude_code: claudeCodeAdapter,
  codex: codexAdapter,
  hermes: hermesAdapter,
  opencode: openCodeAdapter
};
const legacyOpenClawAdapter = unavailableCliAdapter("openclaw", "openclaw");

export function getAdapter(platform: AgentPlatform | string) {
  if (process.env.AGENTHUB_ADAPTER_MODE === "fake") {
    return adapters.fake;
  }

  if (platform === "openclaw") {
    return legacyOpenClawAdapter;
  }

  return adapters[platform as AgentPlatform];
}

export function listAdapters() {
  return [adapters.claude_code, adapters.codex, adapters.hermes, adapters.opencode];
}

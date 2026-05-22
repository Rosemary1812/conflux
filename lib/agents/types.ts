export type AgentPlatform = "claude_code" | "codex" | "hermes" | "openclaw";

export type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  platform: AgentPlatform;
  description: string;
};

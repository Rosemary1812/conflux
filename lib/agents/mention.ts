import type { AgentSummary } from "@/lib/agents/types";

export type MentionParseResult =
  | { ok: true; mentions: AgentSummary[] }
  | { ok: false; error: string };

const mentionPattern = /@([a-zA-Z0-9][a-zA-Z0-9_-]*)/g;

const aliases: Record<string, string> = {
  claude: "claude-code",
  claude_code: "claude-code",
  claude_code_cli: "claude-code",
  "claude-code": "claude-code",
  codex: "codex",
  hermes: "hermes",
  opencode: "opencode",
  open_code: "opencode",
  "open-code": "opencode"
};

export function parseAgentMentions(content: string, agents: AgentSummary[]): MentionParseResult {
  const slugs = [...content.matchAll(mentionPattern)].map((match) => normalizeMention(match[1]));
  const uniqueSlugs = Array.from(new Set(slugs));

  const mentions = uniqueSlugs.map((slug) => agents.find((agent) => agent.id === slug || slugFor(agent) === slug));
  const missingSlug = uniqueSlugs.find((_, index) => !mentions[index]);

  if (missingSlug) {
    return { ok: false, error: `未知 Agent：@${missingSlug}` };
  }

  return { ok: true, mentions: mentions.filter((agent): agent is AgentSummary => Boolean(agent)) };
}

export function slugFor(agent: Pick<AgentSummary, "id" | "name">) {
  if (agent.id.startsWith("agent_")) {
    return agent.id.replace(/^agent_/, "").replaceAll("_", "-");
  }

  return agent.name.toLowerCase().replace(/\s+/g, "-");
}

function normalizeMention(value: string) {
  const normalized = value.toLowerCase();
  return aliases[normalized] ?? normalized;
}

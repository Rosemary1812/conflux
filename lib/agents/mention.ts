import type { AgentSummary } from "@/lib/agents/types";

export type MentionParseResult =
  | { ok: true; mentions: AgentSummary[] }
  | { ok: false; error: string };

export type RosterMention = {
  agent: AgentSummary;
  alias: string;
  displayName: string;
};

export type RosterParseResult =
  | { ok: true; mentions: RosterMention[] }
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

export function parseAgentMentionsForRoster(content: string, agents: AgentSummary[]): RosterParseResult {
  const slugs = [...content.matchAll(mentionPattern)].map((match) => normalizeMention(match[1]));

  if (slugs.length === 0) {
    return { ok: false, error: "首条消息必须 @ 两个或以上 Agent。" };
  }

  const resolvedAgents = slugs.map((slug) => ({
    slug,
    agent: agents.find((agent) => agent.id === slug || slugFor(agent) === slug)
  }));

  const missing = resolvedAgents.find((item) => !item.agent);
  if (missing) {
    return { ok: false, error: `未知 Agent：@${missing.slug}` };
  }

  const totalBySlug = new Map<string, number>();
  for (const item of resolvedAgents) {
    const agent = item.agent!;
    const baseSlug = slugFor(agent);
    totalBySlug.set(baseSlug, (totalBySlug.get(baseSlug) ?? 0) + 1);
  }

  const slugCount = new Map<string, number>();
  const mentions: RosterMention[] = [];

  for (const item of resolvedAgents) {
    const agent = item.agent!;
    const baseSlug = slugFor(agent);
    const count = (slugCount.get(baseSlug) ?? 0) + 1;
    slugCount.set(baseSlug, count);

    const alias = count === 1 ? baseSlug : `${baseSlug}-${count}`;
    const displayName = (totalBySlug.get(baseSlug) ?? 0) > 1 ? `${agent.name} ${count}` : agent.name;
    mentions.push({ agent, alias, displayName });
  }

  return { ok: true, mentions };
}

export function parseAgentAliasMentions(
  content: string,
  rosterAliases: string[]
): { ok: true; aliases: string[] } | { ok: false; error: string } {
  const rawAliases = [...content.matchAll(mentionPattern)].map((match) => match[1].toLowerCase());
  const normalizedRosterAliases = rosterAliases.map((alias) => alias.toLowerCase());

  if (rawAliases.length === 0) {
    return { ok: true, aliases: [] };
  }

  const unknownAlias = rawAliases.find((alias) => !normalizedRosterAliases.includes(alias));
  if (unknownAlias) {
    const availableAliases = normalizedRosterAliases.map((alias) => `@${alias}`).join("、");
    return {
      ok: false,
      error: `@${unknownAlias} 不在当前群聊中。请使用当前群聊成员 alias：${availableAliases}`
    };
  }

  return { ok: true, aliases: rawAliases };
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

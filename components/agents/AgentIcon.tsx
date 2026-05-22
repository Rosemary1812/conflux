import { ClaudeCode, Codex, HermesAgent, OpenClaw } from "@lobehub/icons";

type AgentIconProps = {
  agent: string;
  size?: number;
};

export function AgentIcon({ agent, size = 24 }: AgentIconProps) {
  const normalized = agent.toLowerCase();

  if (normalized === "claude-code" || normalized === "claudecode" || normalized === "cc") {
    return <ClaudeCode.Color size={size} />;
  }

  if (normalized === "codex" || normalized === "cx") {
    return <Codex.Avatar size={size} />;
  }

  if (normalized === "hermes" || normalized === "hermes-agent") {
    return <HermesAgent.Avatar size={size} />;
  }

  if (normalized === "openclaw" || normalized === "open-claw") {
    return <OpenClaw.Color size={size} />;
  }

  if (normalized === "orchestrator" || normalized === "o") {
    return (
      <img
        alt=""
        className="agent-icon-image"
        height={size}
        src="/assets/agents/orchestrator.svg"
        width={size}
      />
    );
  }

  return <span className="agent-icon-fallback">{agent.slice(0, 2).toUpperCase()}</span>;
}

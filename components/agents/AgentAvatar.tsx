import { AgentIcon } from "@/components/agents/AgentIcon";

type AgentAvatarKind = "system" | "emoji" | "uploaded";

type AgentAvatarProps = {
  kind: AgentAvatarKind;
  value: string;
  slug?: string;
  size?: number;
};

export function AgentAvatar({ kind, value, slug, size = 24 }: AgentAvatarProps) {
  if (kind === "system") {
    return <AgentIcon agent={slug ?? value} size={size} />;
  }

  if (kind === "uploaded") {
    return (
      <img
        alt=""
        className="agent-avatar-image"
        height={size}
        src={`/api/attachments/${value}/preview`}
        width={size}
        onError={(event) => {
          (event.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  return (
    <span className="agent-avatar-emoji" style={{ fontSize: Math.round(size * 0.7) }}>
      {value || "🤖"}
    </span>
  );
}

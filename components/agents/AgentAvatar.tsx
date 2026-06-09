import { AgentIcon } from "@/components/agents/AgentIcon";

type AgentAvatarKind = "system" | "emoji" | "uploaded";

type AgentAvatarProps = {
  kind: AgentAvatarKind;
  value: string;
  slug?: string;
  size?: number;
  /** V3.6：当 kind='uploaded' 时，传入 agent id 以走 /api/agents/:id/avatar 真实预览流 */
  agentId?: string;
};

export function AgentAvatar({ kind, value, slug, size = 24, agentId }: AgentAvatarProps) {
  if (kind === "system") {
    return <AgentIcon agent={slug ?? value} size={size} />;
  }

  if (kind === "uploaded") {
    const src = agentId ? `/api/agents/${agentId}/avatar` : `/api/attachments/${value}/preview`;
    return (
      <img
        alt=""
        className="agent-avatar-image"
        height={size}
        src={src}
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

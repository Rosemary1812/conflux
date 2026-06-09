export type AgentVisualStyle = {
  avatarBg: "panel" | "transparent";
  bubbleBadge: "live" | "none";
  showCapabilityInRoster: boolean;
};

export const SYSTEM_AGENT_STYLE: AgentVisualStyle = {
  avatarBg: "panel",
  bubbleBadge: "none",
  showCapabilityInRoster: false
};

export const CUSTOM_AGENT_STYLE: AgentVisualStyle = {
  avatarBg: "panel",
  bubbleBadge: "live",
  showCapabilityInRoster: true
};

export function styleFor(item: { isSystem: boolean }): AgentVisualStyle {
  return item.isSystem ? SYSTEM_AGENT_STYLE : CUSTOM_AGENT_STYLE;
}

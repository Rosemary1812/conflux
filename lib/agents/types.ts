export type AgentPlatform = "claude_code" | "codex" | "hermes" | "opencode";

export type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  platform: AgentPlatform;
  description: string;
  isSystem: boolean;
  systemPrompt: string;
  permissionMode: "readonly" | "editable";
  toolProfile: "readonly" | "code-author" | "executor" | null;
};

export type AgentAvatarKind = "system" | "emoji" | "uploaded";

export type AvailableAgentSummary = {
  id: string;
  slug: string;
  name: string;
  platform: AgentPlatform;
  description: string;
  isSystem: boolean;
  avatarKind: AgentAvatarKind;
  avatarValue: string;
  capabilities: string[] | null;
};

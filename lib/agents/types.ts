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
  /** V3.6 起由 `toAgentSummary` 填充；orchestrator runtime 对象可能不带。 */
  avatarKind?: AgentAvatarKind;
  /** V3.6 起由 `toAgentSummary` 填充；orchestrator runtime 对象可能不带。 */
  avatarValue?: string;
  /** V3.6 起由 `toAgentSummary` 填充；orchestrator runtime 对象可能不带。 */
  capabilities?: string[] | null;
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

export type SelfBuiltAgentListItem = AvailableAgentSummary & {
  systemPromptSummary: string;
  lastRun: {
    runId: string;
    conversationId: string;
    finishedAt: number;
    status: "done" | "error" | "cancelled";
  } | null;
  createdAt: number;
  updatedAt: number;
};

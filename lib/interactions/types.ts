export type InteractionKind = "approval" | "choice";

export type InteractionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "answered"
  | "expired"
  | "cancelled";

export type ApprovalPayload = {
  action: "write_file" | "run_command" | "tool_use" | "network" | string;
  summary: string;
  path?: string;
  command?: string;
  risk?: string;
};

export type ChoicePayload = {
  prompt: string;
  options: Array<{ id: string; label: string; description?: string }>;
  allowCustom?: boolean;
  multiSelect?: boolean;
};

export type InteractionDecision =
  | { kind: "approval"; approved: boolean }
  | { kind: "choice"; selectedOptionIds: string[]; customText?: string };

export type AgentInteractionContext = {
  conversationId: string;
  runId: string;
  messageId: string;
  agentId: string;
  conversationAgentId?: string | null;
  orchestratorTaskId?: string | null;
};

export type AgentInteraction = AgentInteractionContext & {
  id: string;
  kind: InteractionKind;
  status: InteractionStatus;
  payload: ApprovalPayload | ChoicePayload;
  response?: InteractionDecision | null;
  createdAt: number;
  resolvedAt?: number | null;
};

export type PendingAgentInteraction = AgentInteractionContext & {
  kind: InteractionKind;
  payload: ApprovalPayload | ChoicePayload;
};

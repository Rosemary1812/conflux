import type { AgentPlatform } from "@/lib/agents/types";
import type { InteractionDecision, PendingAgentInteraction } from "@/lib/interactions/types";

export type AdapterHealth = {
  ok: boolean;
  message: string;
  capabilities?: AdapterCapabilities;
};

export type AdapterInteractionSupport = "native" | "none";

export type AdapterCapabilities = {
  supportsApproval: AdapterInteractionSupport;
  supportsChoice: AdapterInteractionSupport;
};

export type AdapterMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
};

export type AdapterAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
};

export function formatAttachmentContext(attachments: AdapterAttachment[]) {
  if (attachments.length === 0) {
    return "";
  }

  const lines = attachments.map((attachment, index) => {
    const kind = attachment.mimeType.startsWith("image/") ? "image" : "file";
    return `${index + 1}. [${kind}] ${attachment.fileName} (${attachment.mimeType}, ${attachment.size} bytes): ${attachment.path}`;
  });

  return [
    "Attached files for the latest user message are available on local disk.",
    "Use these paths as part of the user's message; do not claim no attachment was provided.",
    ...lines
  ].join("\n");
}

export type ArtifactPayload = {
  type: string;
  title: string;
  description?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "artifact_created"; artifact: ArtifactPayload }
  | { type: "run_status"; status: string }
  | { type: "interaction_required"; interaction: PendingAgentInteraction }
  | { type: "interaction_resolved"; interactionId: string }
  | { type: "message_done" }
  | { type: "message_error"; error: string }
  | { type: "message_cancelled" };

export type AdapterRunParams = {
  runId: string;
  conversationId: string;
  workspacePath: string;
  messages: AdapterMessage[];
  attachments: AdapterAttachment[];
  externalSessionId?: string;
  signal: AbortSignal;
  requestInteraction(interaction: Omit<PendingAgentInteraction, "conversationId" | "runId" | "agentId">): Promise<InteractionDecision>;
  saveExternalSessionId(sessionId: string, capabilities?: Record<string, unknown>): void;
};

export type AgentAdapter = {
  platform: AgentPlatform | string;
  capabilities: AdapterCapabilities;
  healthcheck(): Promise<AdapterHealth>;
  run(params: AdapterRunParams): AsyncIterable<AgentEvent>;
};

export const noInteractionCapabilities: AdapterCapabilities = {
  supportsApproval: "none",
  supportsChoice: "none"
};

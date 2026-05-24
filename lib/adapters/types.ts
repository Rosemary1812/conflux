import type { AgentPlatform } from "@/lib/agents/types";

export type AdapterHealth = {
  ok: boolean;
  message: string;
};

export type AdapterMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
};

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
  | { type: "message_done" }
  | { type: "message_error"; error: string }
  | { type: "message_cancelled" };

export type AdapterRunParams = {
  runId: string;
  conversationId: string;
  workspacePath: string;
  messages: AdapterMessage[];
  attachments: [];
  signal: AbortSignal;
};

export type AgentAdapter = {
  platform: AgentPlatform | string;
  healthcheck(): Promise<AdapterHealth>;
  run(params: AdapterRunParams): AsyncIterable<AgentEvent>;
};

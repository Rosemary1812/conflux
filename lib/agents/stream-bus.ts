import type { AgentSummary } from "@/lib/agents/types";

export type AgentStreamEvent =
  | { type: "agent_updated"; agentId: string; agent: AgentSummary }
  | { type: "agent_deleted"; agentId: string };

type Listener = (event: AgentStreamEvent) => void;

type AgentEmitterHost = {
  listeners: Set<Listener>;
};

function getEmitter(): AgentEmitterHost {
  const globalRef = globalThis as typeof globalThis & { __agentEmitter?: AgentEmitterHost };
  if (!globalRef.__agentEmitter) {
    globalRef.__agentEmitter = { listeners: new Set<Listener>() };
  }
  return globalRef.__agentEmitter;
}

export function subscribeAgentEvents(listener: Listener): () => void {
  const emitter = getEmitter();
  emitter.listeners.add(listener);
  return () => {
    emitter.listeners.delete(listener);
  };
}

export function publishAgentEvent(event: AgentStreamEvent): void {
  const emitter = getEmitter();
  for (const listener of emitter.listeners) {
    listener(event);
  }
}

import type { AgentInteraction, InteractionDecision, InteractionStatus } from "@/lib/interactions/types";

export type ConversationStreamEvent =
  | {
      type: "message_replace";
      messageId: string;
      content: string;
      status: "running" | "done" | "error" | "cancelled";
    }
  | {
      type: "message_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "message_status";
      messageId: string;
      status: "running" | "done" | "error" | "cancelled";
      error?: string;
    }
  | {
      type: "run_status";
      runId: string;
      status: "running" | "awaiting_interaction" | "done" | "error" | "cancelled";
      error?: string;
    }
  | {
      type: "interaction_requested";
      interaction: AgentInteraction;
    }
  | {
      type: "interaction_resolved";
      interactionId: string;
      status: InteractionStatus;
      response?: InteractionDecision;
    };

type Listener = (event: ConversationStreamEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeToConversation(conversationId: string, listener: Listener) {
  const conversationListeners = listeners.get(conversationId) ?? new Set<Listener>();
  conversationListeners.add(listener);
  listeners.set(conversationId, conversationListeners);

  return () => {
    conversationListeners.delete(listener);

    if (conversationListeners.size === 0) {
      listeners.delete(conversationId);
    }
  };
}

export function publishConversationEvent(conversationId: string, event: ConversationStreamEvent) {
  const conversationListeners = listeners.get(conversationId);

  if (!conversationListeners) {
    return;
  }

  for (const listener of conversationListeners) {
    listener(event);
  }
}

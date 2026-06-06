import type { AgentInteraction, InteractionDecision, InteractionStatus } from "@/lib/interactions/types";
import type { MockMessage } from "@/lib/conversations/types";

export type ConversationStreamEvent =
  | {
      type: "message_replace";
      messageId: string;
      content: string;
      status: "running" | "done" | "error" | "cancelled";
      message?: MockMessage;
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
    }
  | {
      type: "task_created";
      taskId: string;
      runId: string;
      assigneeAlias: string;
      role: string;
      description: string;
    }
  | {
      type: "task_status";
      taskId: string;
      status: string;
      error?: string;
    }
  | {
      type: "task_result";
      taskId: string;
      messageId: string;
      summary?: string;
    }
  | {
      type: "orchestrator_summary";
      runId: string;
      messageId: string;
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

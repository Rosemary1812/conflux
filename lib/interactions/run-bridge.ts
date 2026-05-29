import type { AgentInteraction, InteractionDecision } from "@/lib/interactions/types";

type PendingWaiter = {
  resolve: (decision: InteractionDecision) => void;
  reject: (error: Error) => void;
};

const globalWaitersKey = "__agenthubInteractionWaiters";
const globalState = globalThis as typeof globalThis & {
  [globalWaitersKey]?: Map<string, PendingWaiter>;
};
const waiters = (globalState[globalWaitersKey] ??= new Map<string, PendingWaiter>());

export function hasInteractionWaiter(interactionId: string) {
  return waiters.has(interactionId);
}

export function waitForInteractionResponse(interaction: AgentInteraction, signal: AbortSignal) {
  return new Promise<InteractionDecision>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Run cancelled.", "AbortError"));
      return;
    }

    const abort = () => {
      waiters.delete(interaction.id);
      reject(new DOMException("Run cancelled.", "AbortError"));
    };

    waiters.set(interaction.id, {
      resolve(decision) {
        signal.removeEventListener("abort", abort);
        resolve(decision);
      },
      reject(error) {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    });

    signal.addEventListener("abort", abort, { once: true });
  });
}

export function resumeInteraction(interactionId: string, decision: InteractionDecision) {
  const waiter = waiters.get(interactionId);

  if (!waiter) {
    return false;
  }

  waiters.delete(interactionId);
  waiter.resolve(decision);
  return true;
}

export function rejectInteractionWaiter(interactionId: string, error: Error) {
  const waiter = waiters.get(interactionId);

  if (!waiter) {
    return false;
  }

  waiters.delete(interactionId);
  waiter.reject(error);
  return true;
}

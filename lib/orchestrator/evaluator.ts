import type { OrchestratorTaskRecord, TaskEvaluation } from "./types";

export function evaluateTaskResult(task: OrchestratorTaskRecord, messageContent: string): TaskEvaluation {
  if (task.status === "error" || task.status === "cancelled") {
    return {
      ok: false,
      feedback: task.error || `Task ended with status: ${task.status}`,
      needsRevision: task.role === "implement" || task.role === "review"
    };
  }

  if (!messageContent || messageContent.trim().length < 10) {
    return {
      ok: false,
      feedback: "Agent produced an empty or extremely short response.",
      needsRevision: task.role === "implement"
    };
  }

  // P0: basic heuristic — assume success for most tasks unless clearly failing keywords
  const failureKeywords = ["error", "failed", "unable to", "cannot", "exception", "sorry"];
  const lower = messageContent.toLowerCase();
  const hasFailure = failureKeywords.some((kw) => lower.includes(kw));

  if (hasFailure) {
    return {
      ok: false,
      feedback: "Agent response indicates potential failure. Please review and retry if needed.",
      needsRevision: task.role === "implement" || task.role === "review"
    };
  }

  return {
    ok: true,
    needsRevision: false
  };
}

export function shouldRevise(evaluation: TaskEvaluation): boolean {
  return !evaluation.ok && evaluation.needsRevision;
}

export function createRevisionTask(originalTask: OrchestratorTaskRecord, feedback: string) {
  return {
    id: `${originalTask.id}-revise`,
    assigneeConversationAgentId: originalTask.assigneeConversationAgentId,
    role: originalTask.role,
    description: `Revise previous work based on feedback:\n${feedback}\n\nOriginal task:\n${originalTask.description}`,
    permission: originalTask.permission as "readonly" | "editable" | "restricted-editable"
  };
}

import type { OrchestratorTaskRecord, TaskEvaluation } from "./types";

export function evaluateTaskResult(task: OrchestratorTaskRecord, messageContent: string): TaskEvaluation {
  if (task.status === "error" || task.status === "cancelled") {
    return {
      ok: false,
      feedback: task.error || `Task ended with status: ${task.status}`,
      needsRevision: false
    };
  }

  if (!messageContent || messageContent.trim().length < 10) {
    return {
      ok: false,
      feedback: "Agent produced an empty or extremely short response.",
      needsRevision: false
    };
  }

  return {
    ok: true,
    needsRevision: false
  };
}

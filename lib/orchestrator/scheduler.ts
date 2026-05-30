import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { orchestratorTasks } from "@/lib/db/schema";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import type { OrchestratorPlan } from "./types";

export function createTasksFromPlan(plan: OrchestratorPlan, orchestratorRunId: string, conversationId: string) {
  const db = getDb();
  const now = Date.now();
  const roundId = `round-${now}`;

  for (const task of plan.tasks) {
    db.insert(orchestratorTasks)
      .values({
        id: task.id,
        orchestratorRunId,
        conversationId,
        assigneeConversationAgentId: "", // filled by caller after roster lookup
        roundId,
        role: task.role,
        description: task.description,
        permission: task.permission,
        dependsOnJson: task.dependsOn ? JSON.stringify(task.dependsOn) : null,
        status: "pending"
      })
      .run();
  }

  return roundId;
}

export function updateTaskStatus(
  taskId: string,
  status: "pending" | "running" | "awaiting_interaction" | "done" | "error" | "cancelled",
  options?: { resultMessageId?: string; resultSummary?: string; error?: string }
) {
  const db = getDb();
  const now = Date.now();
  const updates: Partial<typeof orchestratorTasks.$inferInsert> = { status };

  if (status === "running") {
    updates.startedAt = now;
  }
  if (["done", "error", "cancelled"].includes(status)) {
    updates.finishedAt = now;
  }
  if (options?.resultMessageId) {
    updates.resultMessageId = options.resultMessageId;
  }
  if (options?.resultSummary) {
    updates.resultSummary = options.resultSummary;
  }
  if (options?.error) {
    updates.error = options.error;
  }

  db.update(orchestratorTasks).set(updates).where(eq(orchestratorTasks.id, taskId)).run();

  const task = db.select().from(orchestratorTasks).where(eq(orchestratorTasks.id, taskId)).get();
  if (task) {
    publishConversationEvent(task.conversationId, {
      type: "task_status",
      taskId,
      status,
      error: options?.error
    });
  }
}

export function getRunnableTasks(runId: string) {
  const db = getDb();
  const tasks = db
    .select()
    .from(orchestratorTasks)
    .where(eq(orchestratorTasks.orchestratorRunId, runId))
    .all();

  const doneTasks = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));

  return tasks.filter((t) => {
    if (t.status !== "pending") return false;
    const deps = t.dependsOnJson ? (JSON.parse(t.dependsOnJson) as string[]) : [];
    return deps.every((d) => doneTasks.has(d));
  });
}

export function areAllTasksTerminal(runId: string): boolean {
  const db = getDb();
  const tasks = db
    .select()
    .from(orchestratorTasks)
    .where(eq(orchestratorTasks.orchestratorRunId, runId))
    .all();

  return tasks.length > 0 && tasks.every((t) => ["done", "error", "cancelled"].includes(t.status));
}

export function getTaskById(taskId: string) {
  return getDb().select().from(orchestratorTasks).where(eq(orchestratorTasks.id, taskId)).get();
}

export function listTasksForRun(runId: string) {
  return getDb()
    .select()
    .from(orchestratorTasks)
    .where(eq(orchestratorTasks.orchestratorRunId, runId))
    .all();
}

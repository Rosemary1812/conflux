import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { orchestratorRuns, orchestratorTasks, messages, conversations, conversationAgents } from "@/lib/db/schema";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import { setTaskCompletedCallback } from "@/lib/conversations/runs";
import { buildOrchestratorContext } from "./context";
import { planOrchestratorRound, generateOrchestratorChat } from "./planner";
import { validatePlan } from "./validator";
import {
  updateTaskStatus,
  getRunnableTasks,
  areAllTasksTerminal,
  getTaskById,
  listTasksForRun
} from "./scheduler";

import { invokeAgentForTask } from "./invoker";
import { aggregateResults } from "./aggregator";
import type { OrchestratorPlan, OrchestratorTaskRecord } from "./types";

setTaskCompletedCallback((taskId, status, messageId, error) => {
  void handleTaskCompleted(taskId, status, messageId, error);
});

export async function processGroupMessage(
  conversationId: string,
  userMessageId: string,
  content: string
): Promise<void> {
  const context = buildOrchestratorContext(conversationId);

  if (context.roster.length === 0) {
    throw new Error("Roster is empty. Initialize the group chat with at least 2 agents first.");
  }

  const plan = await planOrchestratorRound(context, content);

  if (plan.phase === "clarify") {
    await handleClarify(conversationId, userMessageId, plan, content);
    return;
  }

  if (plan.phase === "chat") {
    await handleChat(conversationId, userMessageId, content, context);
    return;
  }

  const validation = validatePlan(plan, context.roster);
  if (!validation.ok) {
    await handleValidationError(conversationId, userMessageId, validation.error);
    return;
  }

  await executePlan(conversationId, userMessageId, plan, context);
}

async function handleClarify(
  conversationId: string,
  userMessageId: string,
  plan: OrchestratorPlan,
  originalContent: string
) {
  const db = getDb();
  const now = Date.now();

  const latestRun = db
    .select()
    .from(orchestratorRuns)
    .where(eq(orchestratorRuns.conversationId, conversationId))
    .orderBy(desc(orchestratorRuns.startedAt))
    .limit(1)
    .get();

  const nextRound = (latestRun?.clarificationRound || 0) + 1;
  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();

  db.insert(orchestratorRuns)
    .values({
      id: runId,
      conversationId,
      userMessageId,
      mode: "single_agent",
      goal: originalContent,
      status: "awaiting_user",
      clarificationRound: nextRound,
      startedAt: now
    })
    .run();

  const questions =
    plan.clarificationQuestions && plan.clarificationQuestions.length > 0
      ? plan.clarificationQuestions
      : ["能否补充更多细节，以便我更好地安排任务？"];
  const content = questions.join("\n\n");

  db.insert(messages)
    .values({
      id: messageId,
      conversationId,
      role: "orchestrator",
      authorName: "Orchestrator",
      content,
      status: "done",
      createdAt: now + 1
    })
    .run();

  db.update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();

  publishConversationEvent(conversationId, {
    type: "message_replace",
    messageId,
    content,
    status: "done"
  });
}

async function handleChat(
  conversationId: string,
  _userMessageId: string,
  originalContent: string,
  context: ReturnType<typeof buildOrchestratorContext>
) {
  const db = getDb();
  const now = Date.now();
  const messageId = crypto.randomUUID();

  const reply = await generateOrchestratorChat(context, originalContent);

  db.insert(messages)
    .values({
      id: messageId,
      conversationId,
      role: "orchestrator",
      authorName: "Orchestrator",
      content: reply,
      status: "done",
      createdAt: now
    })
    .run();

  db.update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();

  publishConversationEvent(conversationId, {
    type: "message_replace",
    messageId,
    content: reply,
    status: "done"
  });
}

async function handleValidationError(conversationId: string, userMessageId: string, error: string) {
  const db = getDb();
  const now = Date.now();
  const messageId = crypto.randomUUID();

  db.insert(messages)
    .values({
      id: messageId,
      conversationId,
      role: "orchestrator",
      authorName: "Orchestrator",
      content: `计划校验失败：${error}`,
      status: "done",
      createdAt: now
    })
    .run();

  db.update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .run();

  publishConversationEvent(conversationId, {
    type: "message_replace",
    messageId,
    content: `计划校验失败：${error}`,
    status: "done"
  });
}

async function executePlan(
  conversationId: string,
  userMessageId: string,
  plan: OrchestratorPlan,
  context: ReturnType<typeof buildOrchestratorContext>
) {
  const db = getDb();
  const now = Date.now();
  const runId = crypto.randomUUID();

  db.insert(orchestratorRuns)
    .values({
      id: runId,
      conversationId,
      userMessageId,
      mode: plan.mode,
      goal: plan.goal,
      status: "running",
      planJson: JSON.stringify(plan),
      startedAt: now
    })
    .run();

  const aliasToConversationAgentId = new Map(
    context.roster.map((r) => [r.alias, r.conversationAgentId])
  );

  const now2 = Date.now();
  const roundId = `round-${now2}`;
  for (const task of plan.tasks) {
    const conversationAgentId = aliasToConversationAgentId.get(task.assigneeAlias);
    if (!conversationAgentId) {
      db.insert(orchestratorTasks)
        .values({
          id: task.id,
          orchestratorRunId: runId,
          conversationId,
          assigneeConversationAgentId: "",
          roundId,
          role: task.role,
          description: task.description,
          permission: task.permission,
          dependsOnJson: task.dependsOn ? JSON.stringify(task.dependsOn) : null,
          status: "error",
          error: `Unknown assignee alias: ${task.assigneeAlias}`
        })
        .run();

      publishConversationEvent(conversationId, {
        type: "task_created",
        taskId: task.id,
        runId,
        assigneeAlias: task.assigneeAlias,
        role: task.role,
        description: task.description
      });

      publishConversationEvent(conversationId, {
        type: "task_status",
        taskId: task.id,
        status: "error",
        error: `Unknown assignee alias: ${task.assigneeAlias}`
      });
      continue;
    }

    db.insert(orchestratorTasks)
      .values({
        id: task.id,
        orchestratorRunId: runId,
        conversationId,
        assigneeConversationAgentId: conversationAgentId,
        roundId,
        role: task.role,
        description: task.description,
        permission: task.permission,
        dependsOnJson: task.dependsOn ? JSON.stringify(task.dependsOn) : null,
        status: "pending"
      })
      .run();
  }

  dispatchRunnableTasks(runId, conversationId, context.workspacePath);
}

async function dispatchRunnableTasks(
  runId: string,
  conversationId: string,
  workspacePath: string
) {
  const runnable = getRunnableTasks(runId);

  for (const task of runnable) {
    if (!task.assigneeConversationAgentId) continue;

    updateTaskStatus(task.id, "running");

    const ca = getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();

    if (ca?.status !== "running") {
      getDb()
        .update(conversations)
        .set({ status: "running", updatedAt: Date.now() })
        .where(eq(conversations.id, conversationId))
        .run();
    }

    try {
      const { runId: agentRunId, messageId } = invokeAgentForTask({
        conversationId,
        task: task as unknown as OrchestratorTaskRecord,
        workspacePath
      });

      publishConversationEvent(conversationId, {
        type: "task_created",
        taskId: task.id,
        runId: agentRunId,
        assigneeAlias:
          getDb()
            .select({ alias: conversationAgents.alias })
            .from(conversationAgents)
            .where(eq(conversationAgents.id, task.assigneeConversationAgentId))
            .get()?.alias || "",
        role: task.role,
        description: task.description
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      updateTaskStatus(task.id, "error", { error });
    }
  }
}

async function handleTaskCompleted(
  taskId: string,
  status: "done" | "error" | "cancelled",
  messageId?: string,
  error?: string
) {
  const db = getDb();
  const task = getTaskById(taskId);
  if (!task) return;

  updateTaskStatus(taskId, status, {
    resultMessageId: messageId,
    error
  });

  if (status === "error") {
    const allTasks = listTasksForRun(task.orchestratorRunId);
    for (const t of allTasks) {
      if (t.status !== "pending") continue;
      const deps = t.dependsOnJson ? (JSON.parse(t.dependsOnJson) as string[]) : [];
      if (deps.includes(taskId)) {
        updateTaskStatus(t.id, "cancelled", { error: "dependency_failed" });
      }
    }
  }

  if (areAllTasksTerminal(task.orchestratorRunId)) {
    await finalizeOrchestratorRun(task.orchestratorRunId);
  } else {
    // Try to dispatch more tasks that may now have their dependencies satisfied
    const run = db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, task.orchestratorRunId)).get();
    if (run) {
      const conv = db.select().from(conversations).where(eq(conversations.id, task.conversationId)).get();
      dispatchRunnableTasks(task.orchestratorRunId, task.conversationId, conv?.workspacePath || process.cwd());
    }
  }
}

async function finalizeOrchestratorRun(runId: string) {
  const db = getDb();
  const run = db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, runId)).get();
  if (!run || run.status !== "running") return;

  const tasks = listTasksForRun(runId);
  const messageMap = new Map<string, string>();

  for (const task of tasks) {
    if (task.resultMessageId) {
      const msg = db.select({ content: messages.content }).from(messages).where(eq(messages.id, task.resultMessageId)).get();
      if (msg) {
        messageMap.set(task.resultMessageId, msg.content);
      }
    }
  }

  const summary = aggregateResults(tasks as unknown as OrchestratorTaskRecord[], messageMap, run.mode);
  const now = Date.now();
  const summaryMessageId = crypto.randomUUID();

  db.insert(messages)
    .values({
      id: summaryMessageId,
      conversationId: run.conversationId,
      role: "orchestrator",
      authorName: "Orchestrator",
      content: "",
      status: "running",
      createdAt: now
    })
    .run();

  publishConversationEvent(run.conversationId, {
    type: "message_replace",
    messageId: summaryMessageId,
    content: "",
    status: "running"
  });

  const chunkSize = 50;
  for (let i = 0; i < summary.length; i += chunkSize) {
    const chunk = summary.slice(i, i + chunkSize);
    db.update(messages)
      .set({ content: sql`content || ${chunk}` })
      .where(eq(messages.id, summaryMessageId))
      .run();

    publishConversationEvent(run.conversationId, {
      type: "message_delta",
      messageId: summaryMessageId,
      delta: chunk
    });
  }

  db.update(messages)
    .set({ status: "done" })
    .where(eq(messages.id, summaryMessageId))
    .run();

  db.update(orchestratorRuns)
    .set({ status: "done", finishedAt: now })
    .where(eq(orchestratorRuns.id, runId))
    .run();

  db.update(conversations)
    .set({ status: "done", updatedAt: now })
    .where(eq(conversations.id, run.conversationId))
    .run();

  publishConversationEvent(run.conversationId, {
    type: "orchestrator_summary",
    runId,
    messageId: summaryMessageId
  });

  publishConversationEvent(run.conversationId, {
    type: "message_status",
    messageId: summaryMessageId,
    status: "done"
  });
}

export function getOrchestratorRunStatus(runId: string) {
  const db = getDb();
  const run = db.select().from(orchestratorRuns).where(eq(orchestratorRuns.id, runId)).get();
  if (!run) return null;

  const tasks = listTasksForRun(runId);
  return {
    run,
    tasks
  };
}

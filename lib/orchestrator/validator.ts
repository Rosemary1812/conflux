import type { OrchestratorPlan, RosterMember } from "./types";

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validatePlan(plan: OrchestratorPlan, roster: RosterMember[]): ValidationResult {
  const aliases = new Set(roster.map((r) => r.alias));

  for (const task of plan.tasks) {
    if (!aliases.has(task.assigneeAlias)) {
      return { ok: false, error: `Task "${task.id}" assigned to unknown alias "${task.assigneeAlias}".` };
    }
  }

  const taskIds = new Set(plan.tasks.map((t) => t.id));
  for (const task of plan.tasks) {
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        if (!taskIds.has(dep)) {
          return { ok: false, error: `Task "${task.id}" depends on unknown task "${dep}".` };
        }
      }
    }
  }

  if (hasCycle(plan.tasks)) {
    return { ok: false, error: "Task dependencies contain a cycle." };
  }

  if (plan.mode === "single_agent" && plan.tasks.length !== 1) {
    return { ok: false, error: "single_agent mode must have exactly 1 task." };
  }

  if (plan.mode === "implement_review") {
    if (plan.tasks.length !== 2) {
      return { ok: false, error: "implement_review mode must have exactly 2 tasks." };
    }
    const implement = plan.tasks.find((t) => t.role === "implement" || t.permission === "editable");
    if (!implement) {
      return { ok: false, error: "implement_review mode requires an implement task with editable permission." };
    }
    const member = roster.find((r) => r.alias === implement.assigneeAlias);
    if (member && member.capabilities.supportsApproval === "none") {
      return { ok: false, error: `Agent "${implement.assigneeAlias}" does not support approval interactions and cannot be assigned implement tasks.` };
    }
  }

  if (plan.mode === "compare" && plan.tasks.length !== 2) {
    return { ok: false, error: "compare mode must have exactly 2 tasks." };
  }

  return { ok: true };
}

function hasCycle(tasks: OrchestratorPlan["tasks"]): boolean {
  const adj = new Map<string, string[]>();
  for (const task of tasks) {
    adj.set(task.id, task.dependsOn || []);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(id: string): boolean {
    visited.add(id);
    recStack.add(id);
    for (const neighbor of adj.get(id) || []) {
      if (!visited.has(neighbor) && dfs(neighbor)) return true;
      if (recStack.has(neighbor)) return true;
    }
    recStack.delete(id);
    return false;
  }

  for (const id of adj.keys()) {
    if (!visited.has(id) && dfs(id)) return true;
  }
  return false;
}

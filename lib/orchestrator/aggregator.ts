import type { OrchestratorTaskRecord } from "./types";

export function aggregateResults(tasks: OrchestratorTaskRecord[], messageMap: Map<string, string>): string {
  const lines: string[] = [];

  const successful = tasks.filter((t) => t.status === "done");
  const failed = tasks.filter((t) => t.status === "error" || t.status === "cancelled");

  if (successful.length === 0) {
    lines.push("本次调度未产生有效结果。各任务状态如下：");
    for (const task of tasks) {
      lines.push(`- ${task.role}: ${task.status}${task.error ? `（${task.error}）` : ""}`);
    }
    return lines.join("\n");
  }

  if (successful.length === 1) {
    const task = successful[0];
    const content = task.resultMessageId ? messageMap.get(task.resultMessageId) : "";
    lines.push(`我已安排 ${task.role} 完成任务。以下是简要总结：`);
    lines.push("");
    lines.push(content?.slice(0, 600) || task.resultSummary || "（无内容）");
    if (content && content.length > 600) {
      lines.push("...");
    }
  } else {
    lines.push("各 Agent 已完成分派任务，综合结论如下：");
    lines.push("");

    for (const task of successful) {
      const content = task.resultMessageId ? messageMap.get(task.resultMessageId) : "";
      lines.push(`**${task.role}** (${task.permission})：`);
      lines.push(content?.slice(0, 400) || task.resultSummary || "（无内容）");
      if (content && content.length > 400) {
        lines.push("...");
      }
      lines.push("");
    }
  }

  if (failed.length > 0) {
    lines.push("---");
    lines.push("以下任务未成功完成：");
    for (const task of failed) {
      lines.push(`- ${task.role}: ${task.error || task.status}`);
    }
  }

  return lines.join("\n");
}

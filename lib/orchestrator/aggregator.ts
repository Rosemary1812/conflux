import type { OrchestratorTaskRecord } from "./types";

export function aggregateResults(
  tasks: OrchestratorTaskRecord[],
  messageMap: Map<string, string>,
  mode?: string
): string {
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

  switch (mode) {
    case "single_agent": {
      const task = successful[0];
      const content = task.resultMessageId ? messageMap.get(task.resultMessageId) : "";
      lines.push(content?.slice(0, 800) || task.resultSummary || "（无内容）");
      if (content && content.length > 800) {
        lines.push("...");
      }
      break;
    }
    case "parallel_investigation": {
      lines.push("从不同角度得到以下结果：");
      lines.push("");
      for (const task of successful) {
        const content = task.resultMessageId ? messageMap.get(task.resultMessageId) : "";
        lines.push(`**${task.role}**：`);
        lines.push(content?.slice(0, 400) || task.resultSummary || "（无内容）");
        if (content && content.length > 400) {
          lines.push("...");
        }
        lines.push("");
      }
      break;
    }
    case "implement_review": {
      const implement = successful.find((t) => t.role === "implement");
      const review = successful.find((t) => t.role === "review");
      if (implement) {
        const content = implement.resultMessageId ? messageMap.get(implement.resultMessageId) : "";
        lines.push("**实现结果**：");
        lines.push(content?.slice(0, 600) || implement.resultSummary || "（无内容）");
        if (content && content.length > 600) {
          lines.push("...");
        }
        lines.push("");
      }
      if (review) {
        const content = review.resultMessageId ? messageMap.get(review.resultMessageId) : "";
        lines.push("**审查意见**：");
        lines.push(content?.slice(0, 600) || review.resultSummary || "（无内容）");
        if (content && content.length > 600) {
          lines.push("...");
        }
        lines.push("");
      }
      lines.push("**综合结论**：实现与审查均已完成，请根据审查意见决定是否需要调整。");
      break;
    }
    case "compare": {
      lines.push("对比结果如下：");
      lines.push("");
      for (const task of successful) {
        const content = task.resultMessageId ? messageMap.get(task.resultMessageId) : "";
        lines.push(`**${task.role}**：`);
        lines.push(content?.slice(0, 400) || task.resultSummary || "（无内容）");
        if (content && content.length > 400) {
          lines.push("...");
        }
        lines.push("");
      }
      break;
    }
    case "pipeline": {
      const taskMap = new Map(successful.map((t) => [t.id, t]));
      const visited = new Set<string>();
      const sorted: OrchestratorTaskRecord[] = [];
      function visit(t: OrchestratorTaskRecord) {
        if (visited.has(t.id)) return;
        visited.add(t.id);
        const deps = t.dependsOnJson ? (JSON.parse(t.dependsOnJson) as string[]) : [];
        for (const depId of deps) {
          const dep = taskMap.get(depId);
          if (dep) visit(dep);
        }
        sorted.push(t);
      }
      for (const t of successful) visit(t);

      lines.push("按执行顺序得到以下结果：");
      lines.push("");
      for (const task of sorted) {
        const content = task.resultMessageId ? messageMap.get(task.resultMessageId) : "";
        lines.push(`**${task.role}**：`);
        lines.push(content?.slice(0, 400) || task.resultSummary || "（无内容）");
        if (content && content.length > 400) {
          lines.push("...");
        }
        lines.push("");
      }
      break;
    }
    default: {
      lines.push("各 Agent 已完成分派任务，综合结论如下：");
      lines.push("");
      for (const task of successful) {
        const content = task.resultMessageId ? messageMap.get(task.resultMessageId) : "";
        lines.push(`**${task.role}**：`);
        lines.push(content?.slice(0, 400) || task.resultSummary || "（无内容）");
        if (content && content.length > 400) {
          lines.push("...");
        }
        lines.push("");
      }
    }
  }

  if (failed.length > 0) {
    lines.push("---");
    lines.push("以下任务未成功完成：");
    for (const task of failed) {
      lines.push(`- **${task.role}**：${task.error || task.status}`);
    }
  }

  return lines.join("\n");
}

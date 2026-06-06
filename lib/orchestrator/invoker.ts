import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { conversationAgents, agents } from "@/lib/db/schema";
import { startAgentRun } from "@/lib/conversations/runs";
import type { AgentSummary } from "@/lib/agents/types";
import type { AdapterAttachment } from "@/lib/adapters/types";
import type { OrchestratorTaskRecord } from "./types";
import { buildTaskContext } from "./context";

export function invokeAgentForTask({
  conversationId,
  task,
  workspacePath,
  attachments = []
}: {
  conversationId: string;
  task: OrchestratorTaskRecord;
  workspacePath: string;
  attachments?: AdapterAttachment[];
}): { runId: string; messageId: string } {
  const db = getDb();

  const conversationAgent = db
    .select()
    .from(conversationAgents)
    .where(eq(conversationAgents.id, task.assigneeConversationAgentId))
    .get();

  if (!conversationAgent) {
    throw new Error(`Conversation agent not found: ${task.assigneeConversationAgentId}`);
  }

  const agentRow = db.select().from(agents).where(eq(agents.id, conversationAgent.agentId)).get();

  if (!agentRow) {
    throw new Error(`Agent not found: ${conversationAgent.agentId}`);
  }

  const agent: AgentSummary = {
    id: agentRow.id,
    slug: agentRow.slug,
    name: agentRow.name,
    platform: agentRow.platform as AgentSummary["platform"],
    description: agentRow.description
  };

  const context = buildTaskContext(task, 2000);
  const taskPrompt = buildSubAgentPrompt(task.description, context);

  const run = startAgentRun({
    conversationId,
    agent,
    workspacePath,
    attachments,
    conversationAgentId: task.assigneeConversationAgentId,
    orchestratorTaskId: task.id,
    taskPrompt
  });

  return { runId: run.runId, messageId: run.assistantMessageId };
}

function buildSubAgentPrompt(taskDescription: string, context: string) {
  return [
    "<角色边界>",
    "你是 AgentHub 群聊中被 Orchestrator 分派的子 Agent，不是 Orchestrator。",
    "只执行当前任务，不要继续拆分任务、不要声明会启动或调度其他 Agent。",
    "如果任务需要用户确认或选择，使用 AgentHub 的 Approval / Choice 交互机制。",
    "</角色边界>",
    context ? `<上下文>\n${context}\n</上下文>` : "",
    `<任务>\n${taskDescription}\n</任务>`
  ].filter(Boolean).join("\n\n");
}

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { conversationAgents, agents } from "@/lib/db/schema";
import { startAgentRun } from "@/lib/conversations/runs";
import type { AgentSummary } from "@/lib/agents/types";
import type { AdapterAttachment, AdapterMessage } from "@/lib/adapters/types";
import type { OrchestratorTaskRecord } from "./types";

export function invokeAgentForTask({
  conversationId,
  task,
  workspacePath,
  contextMessages,
  attachments = []
}: {
  conversationId: string;
  task: OrchestratorTaskRecord;
  workspacePath: string;
  contextMessages: AdapterMessage[];
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

  const run = startAgentRun({
    conversationId,
    agent,
    workspacePath,
    attachments,
    conversationAgentId: task.assigneeConversationAgentId,
    orchestratorTaskId: task.id,
    taskPrompt: task.description
  });

  return { runId: run.runId, messageId: run.assistantMessageId };
}

import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { conversations, conversationAgents, messages, agents } from "@/lib/db/schema";
import { getAdapter } from "@/lib/adapters/registry";
import type { OrchestratorContext, RosterMember } from "./types";

export function buildOrchestratorContext(conversationId: string): OrchestratorContext {
  const db = getDb();

  const conversation = db.select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const rosterRows = db
    .select()
    .from(conversationAgents)
    .where(eq(conversationAgents.conversationId, conversationId))
    .orderBy(conversationAgents.joinedAt)
    .all();

  const roster: RosterMember[] = rosterRows.map((ca) => {
    const agent = db.select().from(agents).where(eq(agents.id, ca.agentId)).get();
    const adapter = agent ? getAdapter(agent.platform) : null;
    return {
      conversationAgentId: ca.id,
      alias: ca.alias,
      agent: agent
        ? {
            id: agent.id,
            slug: agent.slug,
            name: agent.name,
            platform: agent.platform as RosterMember["agent"]["platform"],
            description: agent.description
          }
        : {
            id: ca.agentId,
            slug: ca.alias,
            name: ca.displayName || ca.alias,
            platform: "claude_code" as const,
            description: ""
          },
      capabilities: adapter?.capabilities ?? { supportsApproval: "none", supportsChoice: "none" },
      status: ca.status
    };
  });

  const messageRows = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .all();

  const history = messageRows.map((m) => {
    const alias = m.authorConversationAgentId
      ? rosterRows.find((r) => r.id === m.authorConversationAgentId)?.alias
      : undefined;
    return {
      role: m.role as OrchestratorContext["history"][number]["role"],
      content: m.content,
      authorName: m.authorName,
      alias
    };
  });

  return {
    conversationId,
    workspacePath: conversation.workspacePath || process.cwd(),
    roster,
    history
  };
}

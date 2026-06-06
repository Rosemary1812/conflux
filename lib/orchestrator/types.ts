import type { AgentSummary } from "@/lib/agents/types";
import type { AdapterCapabilities } from "@/lib/adapters/types";

export type OrchestratorPhase = "clarify" | "execute" | "chat";

export type OrchestratorMode =
  | "single_agent"
  | "parallel_investigation"
  | "compare"
  | "implement_review"
  | "pipeline";

export type PlannerTask = {
  id: string;
  assigneeAlias: string;
  role: string;
  description: string;
  permission?: "readonly" | "editable" | "restricted-editable";
  dependsOn?: string[];
};

export type OrchestratorPlan = {
  phase: OrchestratorPhase;
  mode: OrchestratorMode;
  goal: string;
  tasks: PlannerTask[];
  clarificationQuestions?: string[];
};

export type RosterMember = {
  conversationAgentId: string;
  alias: string;
  displayName: string;
  agent: AgentSummary;
  capabilities: AdapterCapabilities;
  status: string;
};

export type OrchestratorContext = {
  conversationId: string;
  workspacePath: string;
  roster: RosterMember[];
  history: Array<{
    role: "user" | "assistant" | "orchestrator" | "system";
    content: string;
    authorName?: string;
    alias?: string;
  }>;
};

export type TaskEvaluation = {
  ok: boolean;
  feedback?: string;
  needsRevision: boolean;
};

export type OrchestratorTaskRecord = {
  id: string;
  orchestratorRunId: string;
  conversationId: string;
  assigneeConversationAgentId: string;
  roundId: string;
  role: string;
  description: string;
  permission: string;
  dependsOnJson: string | null;
  status: string;
  resultMessageId: string | null;
  resultSummary: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
};

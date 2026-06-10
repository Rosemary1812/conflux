import type { AvailableAgentSummary } from "@/lib/agents/types";
import type { ConversationSummary, GroupTask, MockMessage, RosterItem } from "@/lib/conversations/types";
import type { AgentDraft } from "@/lib/skills/agent-creator/types";

export type DemoCaseId = "single" | "slash" | "group";

export type AgentCreatorPreviewSnapshot = {
  draft: AgentDraft;
  status: "preview" | "saving" | "done";
};

export type DemoStep =
  | { kind: "message"; at: number; message: MockMessage }
  | {
      kind: "typing";
      at: number;
      placeholder: MockMessage;
      resolvedAt: number;
      finalPatch: Partial<MockMessage>;
    }
  | { kind: "preview-open"; at: number; draft: AgentDraft }
  | { kind: "preview-status"; at: number; status: "preview" | "saving" | "done" }
  | { kind: "available-agents"; at: number; agents: AvailableAgentSummary[] }
  | { kind: "context-update"; at: number; roster?: RosterItem[]; tasks?: GroupTask[] };

export type DemoCase = {
  id: DemoCaseId;
  title: string;
  preview: string;
  mode: "single" | "group";
  conversation: ConversationSummary;
  initialRoster?: RosterItem[];
  initialTasks?: GroupTask[];
  initialAvailableAgents?: AvailableAgentSummary[];
  steps: DemoStep[];
};

export type DemoSetters = {
  pushMessage(message: MockMessage): void;
  patchMessage(id: string, patch: Partial<MockMessage>): void;
  setAgentCreatorPreview(snapshot: AgentCreatorPreviewSnapshot | null): void;
  setRoster(roster: RosterItem[]): void;
  setTasks(tasks: GroupTask[]): void;
  setAvailableAgents(agents: AvailableAgentSummary[]): void;
};

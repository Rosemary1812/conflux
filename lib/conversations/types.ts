import type { AgentInteraction } from "@/lib/interactions/types";

export type ConversationMode = "single" | "group";

export type ConversationView = "new-single" | "single" | "new-group" | "group";

export type ConversationSummary = {
  id: string;
  mode: ConversationMode;
  title: string;
  preview: string;
  status: "running" | "done" | "preview" | "empty";
  avatar: string;
  workspacePath: string;
  artifacts?: ConversationArtifact[];
  lockedAgent?: {
    id: string;
    slug: string;
    name: string;
    platform: string;
    description: string;
  } | null;
  archivedAt?: number | null;
  updatedAt?: number;
};

export type MockMessage = {
  id: string;
  author: string;
  avatar?: string;
  role?: string;
  tone?: "user" | "agent" | "orchestrator" | "event";
  status?: "running" | "done" | "preview" | "error" | "cancelled";
  time?: string;
  body: string;
  attachments?: MessageAttachment[];
  artifacts?: ConversationArtifact[];
  interactions?: AgentInteraction[];
  code?: string;
  authorConversationAgentId?: string;
  artifact?: {
    title: string;
    description: string;
    files: string[];
  };
  tasks?: Array<{
    id: string;
    owner: string;
    title: string;
    status: string;
  }>;
};

export type RosterItem = {
  id: string;
  alias: string;
  displayName: string;
  status: "active" | "idle" | "running" | "unavailable";
  slug: string;
  isSystem: boolean;
  avatarKind: "system" | "emoji" | "uploaded";
  avatarValue: string;
  capabilities: string[] | null;
};

export type GroupTask = {
  id: string;
  assigneeAlias: string;
  role: string;
  description: string;
  status: string;
  error?: string;
  summary?: string;
};

export type MessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
};

export type AttachmentReference = {
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  allowExternal?: boolean;
};

export type ConversationArtifact = {
  id: string;
  type: string;
  title: string;
  description: string;
  path?: string | null;
};

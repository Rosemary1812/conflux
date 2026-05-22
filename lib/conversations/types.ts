export type ConversationMode = "single" | "group";

export type ConversationView = "new-single" | "single" | "new-group" | "group";

export type ConversationSummary = {
  id: string;
  mode: ConversationMode;
  title: string;
  preview: string;
  status: "running" | "done" | "preview" | "empty";
  avatar: string;
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
  status?: "running" | "done" | "preview";
  time?: string;
  body: string;
  code?: string;
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

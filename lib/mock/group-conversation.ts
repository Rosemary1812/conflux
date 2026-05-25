import type { ConversationSummary } from "@/lib/conversations/types";
import { workspacePath } from "@/lib/mock/conversations";

export const groupConversationPreview: ConversationSummary = {
  id: "group-preview",
  mode: "group",
  title: "群聊静态预览",
  preview: "V1 仅 UI，不接 Orchestrator",
  status: "preview",
  avatar: "CC CX",
  workspacePath
};

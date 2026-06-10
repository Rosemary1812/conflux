import type { ConversationView } from "@/lib/conversations/types";

const noop = () => {};
const noopAsync = async () => {};

export const stubSidebar = {
  onCreateSingle: noop,
  onSelectView: (_view: ConversationView) => {},
  onSelectConversation: (_id: string) => {},
  onArchiveConversation: (_id: string, _archived: boolean) => {},
  onDeleteConversation: (_id: string) => {},
  onRenameConversation: (_id: string, _title: string) => {},
  onOpenSettings: noop
};

export const stubStream = {
  onLoadMore: noop,
  onRegenerate: noopAsync,
  onRespondInteraction: noopAsync,
  onStopAgent: noopAsync,
  onAgentCreatorCancel: noopAsync,
  onAgentCreatorRegenerate: noopAsync,
  onAgentCreatorSave: noopAsync,
  onSkillCreatorCancel: noopAsync,
  onSkillCreatorRegenerate: noopAsync,
  onSkillCreatorSave: noopAsync
};

export const stubComposer = {
  onSend: async () => false,
  onStop: noopAsync,
  onWorkspaceSelect: noopAsync
};

export const stubContext = {
  onCloseTerminal: noop,
  onResize: (_width: number) => {}
};

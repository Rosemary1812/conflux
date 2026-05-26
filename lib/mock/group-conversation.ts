import type { ConversationSummary, MockMessage } from "@/lib/conversations/types";
import { workspacePath } from "@/lib/mock/conversations";

/** V1 群聊侧栏唯一 mock 会话（静态预览，不接 API） */
export const groupConversations: ConversationSummary[] = [
  {
    id: "group-fullstack",
    mode: "group",
    title: "全栈功能开发",
    preview: "群聊 UI 已就位，V2 再接 Orchestrator",
    status: "preview",
    avatar: "claude-code codex",
    workspacePath
  }
];

/** @deprecated 使用 groupConversations[0] */
export const groupConversationPreview: ConversationSummary = groupConversations[0];

export const groupMessages: MockMessage[] = [
  {
    id: "g1",
    author: "你",
    tone: "user",
    time: "14:35",
    body: "@claude-code @codex 帮我实现用户设置页：前端表单 + API 校验，并补测试。"
  },
  {
    id: "g2",
    author: "Orchestrator",
    avatar: "orchestrator",
    role: "系统",
    tone: "orchestrator",
    time: "14:35",
    body: "V1 仅展示编排形态：Orchestrator 会作为独立身份出现，但不会调用真实调度。",
    tasks: [
      { id: "task_1", owner: "Claude Code", title: "设置页 UI", status: "已完成" },
      { id: "task_2", owner: "Codex", title: "API + 测试", status: "进行中（mock）" }
    ]
  },
  {
    id: "g3",
    author: "Claude Code",
    avatar: "claude-code",
    role: "已完成",
    status: "done",
    body: "已生成 `app/settings/page.tsx`，完成头像、语言切换与 provider 列表 UI。"
  },
  {
    id: "g4",
    author: "Codex",
    avatar: "codex",
    role: "进行中",
    status: "running",
    body: "Mock：正在写入 `app/api/settings/route.ts` 与 `settings.test.ts`。"
  }
];

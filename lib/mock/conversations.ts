import type { ConversationSummary, MockMessage } from "@/lib/conversations/types";

export const workspacePath = "D:\\coding\\agent\\AgentHub";

export const mockConversations: ConversationSummary[] = [
  {
    id: "single-react-refactor",
    mode: "single",
    title: "React 组件重构",
    preview: "Claude Code 正在运行 lint，并回写 Button 组件",
    status: "running",
    avatar: "claude-code",
    workspacePath
  },
  {
    id: "single-tests",
    mode: "single",
    title: "单元测试补全",
    preview: "Codex 已生成 3 个测试文件，并给出总结",
    status: "done",
    avatar: "codex",
    workspacePath
  },
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

export const singleMessages: MockMessage[] = [
  {
    id: "u1",
    author: "你",
    tone: "user",
    time: "14:28",
    body: "帮我把 `Button.tsx` 改成支持 `loading` 和 `disabled`，保持现有 API，并补一份最小测试。"
  },
  {
    id: "a1",
    author: "Claude Code",
    avatar: "claude-code",
    role: "执行中",
    status: "running",
    time: "14:29",
    body: "我会先读取现有组件，再补充状态变体，并把生成文件整理成一组产物。",
    code: `export function Button({ loading, disabled, children, ...props }) {
  return (
    <button disabled={disabled || loading} {...props}>
      {loading ? "Loading..." : children}
    </button>
  );
}`,
    artifact: {
      title: "本轮产物",
      description:
        "已生成 components/ui/Button.tsx 与 components/ui/Button.test.tsx，后续将继续执行 lint。",
      files: ["components/ui/Button.tsx", "components/ui/Button.test.tsx"]
    }
  },
  {
    id: "a2",
    author: "Claude Code",
    avatar: "claude-code",
    role: "工具事件",
    tone: "event",
    body: "正在运行 `npm run typecheck`，稍后会回传结果。"
  }
];

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

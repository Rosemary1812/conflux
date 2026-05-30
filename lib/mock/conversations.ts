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


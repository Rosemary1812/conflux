import type { AvailableAgentSummary } from "@/lib/agents/types";
import type { DemoCase } from "@/lib/demo/types";
import type { AgentDraft } from "@/lib/skills/agent-creator/types";

const draft: AgentDraft = {
  name: "Frontend Reviewer",
  alias: "frontend-reviewer",
  display_name: "Frontend Reviewer",
  description: "专注 React / TypeScript 前端评审,重点关注 WCAG 可访问性与渲染性能。",
  system_prompt:
    "你是一名资深的 React/TypeScript 前端评审专家。\n面对一次代码改动:\n1. 先按 WCAG 2.2 AA 检查可访问性,逐条列出违规与建议修复\n2. 再从渲染路径(reconciliation / memoization / hooks 依赖)分析潜在性能问题\n3. 仅输出结构化结论 + 优先级,不要直接改代码",
  permission_mode: "readonly",
  capabilities: ["a11y", "performance", "react", "typescript"],
  tool_profile: "readonly",
  avatar: { kind: "emoji", value: "🤖" }
};

const baseAvailable: AvailableAgentSummary[] = [
  {
    id: "av-claude-code",
    slug: "claude-code",
    name: "Claude Code",
    platform: "claude_code",
    description: "本机 Claude Code",
    isSystem: true,
    avatarKind: "system",
    avatarValue: "claude-code",
    capabilities: null
  },
  {
    id: "av-codex",
    slug: "codex",
    name: "Codex",
    platform: "codex",
    description: "本机 Codex",
    isSystem: true,
    avatarKind: "system",
    avatarValue: "codex",
    capabilities: null
  }
];

const afterCreate: AvailableAgentSummary[] = [
  ...baseAvailable,
  {
    id: "av-frontend-reviewer",
    slug: "frontend-reviewer",
    name: "Frontend Reviewer",
    platform: "claude_code",
    description: draft.description,
    isSystem: false,
    avatarKind: "emoji",
    avatarValue: "🤖",
    capabilities: draft.capabilities
  }
];

export const caseSlash: DemoCase = {
  id: "slash",
  title: "/agent-creator · 新建 Frontend Reviewer",
  preview: "对话式创建一个自建 Agent,创建完成即可在群聊 @ 它",
  mode: "single",
  conversation: {
    id: "demo-slash",
    mode: "single",
    title: "/agent-creator · 新建 Frontend Reviewer",
    preview: "对话式创建一个自建 Agent",
    status: "running",
    avatar: "claude-code",
    workspacePath: "D:\\projects\\my-blog",
    lockedAgent: {
      id: "agent-claude-code",
      slug: "claude-code",
      name: "Claude Code",
      platform: "claude_code",
      description: "本机 Claude Code"
    }
  },
  initialAvailableAgents: baseAvailable,
  steps: [
    {
      kind: "message",
      at: 200,
      message: {
        id: "u1",
        author: "你",
        tone: "user",
        time: "14:32",
        body: "/agent-creator"
      }
    },
    {
      kind: "typing",
      at: 1000,
      placeholder: {
        id: "ac1",
        author: "Agent Creator",
        avatar: "agent-creator",
        tone: "agent",
        status: "running",
        time: "14:32",
        body: "你好,我可以帮你创建一个新的 Agent。请告诉我:它面向哪类任务?需要什么权限?有没有具体能力标签?"
      },
      resolvedAt: 2400,
      finalPatch: {
        body: "你好,我可以帮你创建一个新的 Agent。请告诉我:它面向哪类任务?需要什么权限?有没有具体能力标签?"
      }
    },
    {
      kind: "message",
      at: 4400,
      message: {
        id: "u2",
        author: "你",
        tone: "user",
        time: "14:33",
        body: "我要一个前端代码评审 Agent,只读权限,专注 React / TypeScript,重点看可访问性和渲染性能。"
      }
    },
    {
      kind: "typing",
      at: 5400,
      placeholder: {
        id: "ac2",
        author: "Agent Creator",
        avatar: "agent-creator",
        tone: "agent",
        status: "running",
        time: "14:33",
        body: "明白。我整理了一份草稿,你检查一下右边卡片里的字段。确认无误就保存。"
      },
      resolvedAt: 6800,
      finalPatch: {
        body: "明白。我整理了一份草稿,你检查一下下面卡片里的字段。确认无误就保存。"
      }
    },
    {
      kind: "preview-open",
      at: 7200,
      draft
    },
    {
      kind: "preview-status",
      at: 11200,
      status: "saving"
    },
    {
      kind: "preview-status",
      at: 12800,
      status: "done"
    },
    {
      kind: "available-agents",
      at: 13000,
      agents: afterCreate
    },
    {
      kind: "message",
      at: 13800,
      message: {
        id: "ac3",
        author: "Agent Creator",
        avatar: "agent-creator",
        tone: "agent",
        status: "done",
        time: "14:34",
        body: "已创建 `@frontend-reviewer`。你现在可以在群聊用 `@frontend-reviewer` 唤起它,也可以在新建单聊里选中它。"
      }
    }
  ]
};

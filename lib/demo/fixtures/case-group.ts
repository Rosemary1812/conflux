import type { AvailableAgentSummary } from "@/lib/agents/types";
import type { GroupTask, RosterItem } from "@/lib/conversations/types";
import type { DemoCase } from "@/lib/demo/types";

const rosterClaude: RosterItem = {
  id: "ca-claude-code",
  alias: "claude-code",
  displayName: "Claude Code",
  status: "active",
  slug: "claude-code",
  isSystem: true,
  avatarKind: "system",
  avatarValue: "claude-code",
  capabilities: null
};

const rosterReviewer: RosterItem = {
  id: "ca-frontend-reviewer",
  alias: "frontend-reviewer",
  displayName: "Frontend Reviewer",
  status: "active",
  slug: "frontend-reviewer",
  isSystem: false,
  avatarKind: "emoji",
  avatarValue: "🤖",
  capabilities: ["a11y", "performance", "react", "typescript"]
};

const roster: RosterItem[] = [rosterClaude, rosterReviewer];

const tasksPending: GroupTask[] = [
  {
    id: "task_1",
    assigneeAlias: "claude-code",
    role: "executor",
    description: "修复登录页 label 未绑定 htmlFor 与 Tab 跳过的可访问性问题",
    status: "pending"
  },
  {
    id: "task_2",
    assigneeAlias: "frontend-reviewer",
    role: "reviewer",
    description: "评审 task_1 的改动,补充 a11y / 性能建议",
    status: "pending"
  }
];

const tasksClaudeRunning: GroupTask[] = [
  { ...tasksPending[0], status: "running" },
  tasksPending[1]
];

const tasksClaudeDone: GroupTask[] = [
  { ...tasksPending[0], status: "done", summary: "已为 2 处 label 补 htmlFor + 调整 z-index" },
  { ...tasksPending[1], status: "running" }
];

const tasksAllDone: GroupTask[] = [
  tasksClaudeDone[0],
  { ...tasksPending[1], status: "done", summary: "通过,补 2 条建议(对比度 / focus-visible)" }
];

const availableAgents: AvailableAgentSummary[] = [
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
    id: "av-frontend-reviewer",
    slug: "frontend-reviewer",
    name: "Frontend Reviewer",
    platform: "claude_code",
    description: "前端评审 Agent",
    isSystem: false,
    avatarKind: "emoji",
    avatarValue: "🤖",
    capabilities: rosterReviewer.capabilities
  }
];

export const caseGroup: DemoCase = {
  id: "group",
  title: "登录页 a11y 修复(协同)",
  preview: "Orchestrator 编排:Claude Code 修复 → Frontend Reviewer 评审",
  mode: "group",
  conversation: {
    id: "demo-group",
    mode: "group",
    title: "登录页 a11y 修复(协同)",
    preview: "Orchestrator 编排:Claude Code 修复 → Frontend Reviewer 评审",
    status: "running",
    avatar: "claude-code frontend-reviewer",
    workspacePath: "D:\\projects\\my-blog"
  },
  initialRoster: roster,
  initialTasks: [],
  initialAvailableAgents: availableAgents,
  steps: [
    {
      kind: "message",
      at: 200,
      message: {
        id: "u1",
        author: "你",
        tone: "user",
        time: "15:01",
        body: "@claude-code @frontend-reviewer 登录页的「忘记密码」链接在移动端被表单遮挡,而且键盘 Tab 也跳过了它。先定位修复,再帮我评审改动是否还有其它可访问性问题。"
      }
    },
    {
      kind: "context-update",
      at: 600,
      tasks: tasksPending
    },
    {
      kind: "message",
      at: 1200,
      message: {
        id: "o1",
        author: "Orchestrator",
        avatar: "orchestrator",
        tone: "orchestrator",
        status: "done",
        time: "15:01",
        body: "已规划 2 个任务:`task_1` 由 @claude-code 定位并修复;`task_2` 由 @frontend-reviewer 在 task_1 完成后做评审。任务进度见右侧栏「任务分派」。"
      }
    },
    {
      kind: "context-update",
      at: 1800,
      tasks: tasksClaudeRunning
    },
    {
      kind: "typing",
      at: 2200,
      placeholder: {
        id: "c1",
        author: "Claude Code",
        avatar: "claude-code",
        tone: "agent",
        status: "running",
        time: "15:02",
        body: "正在读取 `app/login/page.tsx` 与 `login.module.css`…",
        authorConversationAgentId: rosterClaude.id
      },
      resolvedAt: 4800,
      finalPatch: {
        body: "找到了两处问题:\n1. `.forgot-link` 用了 `position: absolute` + 较低的 `z-index`,在移动端被表单容器遮挡\n2. 链接上挂了 `tabIndex={-1}`,导致键盘焦点被跳过\n修复方案:把 z-index 提到表单之上、移除负向 tabIndex、补 `aria-label`。",
        code: `// app/login/page.tsx
-<a className="forgot-link" tabIndex={-1} href="/forgot">
-  忘记密码
-</a>
+<a className="forgot-link" href="/forgot" aria-label="找回密码">
+  忘记密码
+</a>

// login.module.css
 .forgot-link {
   position: absolute;
-  z-index: 1;
+  z-index: 5;
+  padding: 8px;       /* 增加可点区域,改善移动端误触 */
 }`,
        artifacts: [
          {
            id: "art-login-page",
            type: "file",
            title: "page.tsx",
            description: "修正 tabIndex 与 aria-label",
            path: "app/login/page.tsx"
          },
          {
            id: "art-login-css",
            type: "file",
            title: "login.module.css",
            description: "提高 z-index,补 padding",
            path: "app/login/login.module.css"
          }
        ]
      }
    },
    {
      kind: "context-update",
      at: 5200,
      tasks: tasksClaudeDone
    },
    {
      kind: "typing",
      at: 5800,
      placeholder: {
        id: "f1",
        author: "Frontend Reviewer",
        avatar: "frontend-reviewer",
        tone: "agent",
        status: "running",
        time: "15:02",
        body: "正在评审 task_1 的改动…",
        authorConversationAgentId: rosterReviewer.id
      },
      resolvedAt: 8800,
      finalPatch: {
        body: "评审结果:\n- ✓ Tab 顺序问题已解决\n- ✓ 移动端遮挡已解决\n- ⚠️ 对比度:`.forgot-link` 当前 `color: #999` 在白底 < 4.5:1,**建议改为 `#595959`**(WCAG AA)\n- ⚠️ 建议补 `:focus-visible` 样式提升键盘用户的视觉反馈",
        authorConversationAgentId: rosterReviewer.id
      }
    },
    {
      kind: "context-update",
      at: 9200,
      tasks: tasksAllDone
    },
    {
      kind: "message",
      at: 9800,
      message: {
        id: "o2",
        author: "Orchestrator",
        avatar: "orchestrator",
        tone: "orchestrator",
        status: "done",
        time: "15:03",
        body: "两个任务已完成。`@frontend-reviewer` 提出了 2 条增强建议,是否让 `@claude-code` 继续应用?"
      }
    }
  ]
};

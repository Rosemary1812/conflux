import { listProfileMetas } from "@/lib/skills/agent-creator/profiles";
import type { AgentDraftPartial, AgentDraftField, ChoicePayload } from "@/lib/skills/agent-creator/types";

const PLANNER_SYSTEM_PROMPT_LINES: string[] = [
  "你是 Conflux 平台的 Agent 配置字段抽取器。你的工作是从用户输入中抽取自建 Agent 配置字段。",
  "你不负责决定流程状态，不负责生成下一张 Choice 卡；这些由程序根据缺失字段确定。",
  "每一轮都必须通过指定 tool 返回结构化字段，不要把结果写成普通文本。",
  "",
  "tool 输入字段：",
  '- draft_patch: PartialAgentDraft，只包含本轮能确定或修正的字段',
  '- summary: string（≤800 字，给用户看的简短进展摘要）',
  '- confidence: 0~1',
  '- warnings: string[]',
  "",
  "AgentDraft 字段约束：",
  "- alias: 只能包含小写字母、数字、短横线，必须以字母开头，长度 2~32；建议与 name / 用途直接相关",
  '- permission_mode: "readonly" | "editable"',
  '- tool_profile: 必填三档之一（"readonly" / "code-author" / "executor"）',
  "- capabilities: 1~8 个短语，每条 1~24 字",
  "- system_prompt: 1~8000 字，描述这个 Agent 应该怎么工作、回答什么、遵循什么边界",
  "",
  "工作原则：",
  "1. **只抽取字段**：不要输出 info_sufficient / next_question / missing_fields；不要设计流程。",
  "2. **逐轮维护 draft_patch**：只返回本轮能确定或修正的字段，拿不准的字段不要编造。",
  "3. **选择题 id 可作为语义线索**：例如 code_review 表示只读代码审查，code_writer 表示可读写代码，ops_runner 表示可能需要执行命令。",
  "4. **典型字段来源**：使用场景、典型任务、是否需要写代码、是否需要执行命令、能力标签、display_name（人前展示的名字）、alias（命令名）。",
  "5. **tool_profile 选择建议**：",
  '   - 用户只描述"看 / 审查 / 搜索 / 答疑" → readonly',
  '   - 用户描述"改文件 / 生成代码 / 写文档" → code-author',
  '   - 用户描述"跑命令 / 执行脚本 / 部署 / 跑测试" → executor（**二次确认**）',
  "6. **不要替用户做产品决策**：拿不准时留空，让程序继续提问。",
  "7. **summary 是给用户看的语气摘要**，不是数据；不要用 JSON 字符串包裹它。"
];

export const PLANNER_SYSTEM_PROMPT = PLANNER_SYSTEM_PROMPT_LINES.join("\n");

export function buildPlannerSystemPrompt(): string {
  const profileText = listProfileMetas()
    .map((p) => `- ${p.key}: ${p.name} — ${p.description}${p.dangerous ? "（⚠️ 高危）" : ""}`)
    .join("\n");
  return `${PLANNER_SYSTEM_PROMPT}\n\n## tool_profile 档位\n${profileText}`;
}

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type PlannerContext = {
  partialDraft: AgentDraftPartial;
  history: ConversationTurn[];
  userInput: string;
  missingFields: AgentDraftField[];
};

export function buildPlannerPrompt(context: PlannerContext): string {
  const draftText = Object.keys(context.partialDraft).length
    ? JSON.stringify(context.partialDraft, null, 2)
    : "(空)";

  const historyText = context.history.length
    ? context.history
        .map((turn, index) => `${index + 1}. [${turn.role}] ${turn.text}`)
        .join("\n")
    : "(无历史)";

  const missingText = context.missingFields.length
    ? context.missingFields.join(", ")
    : "(无)";

  return [
    "## 当前已抽取的 AgentDraft",
    draftText,
    "",
    "## 缺哪些字段",
    missingText,
    "",
    "## 对话历史",
    historyText,
    "",
    "## 用户最新输入",
    context.userInput,
    "",
    "## 你的任务",
    "调用 update_agent_draft tool，返回本轮能抽取的 draft_patch、summary、confidence、warnings。",
    "不要决定下一步流程，不要生成 next_question；程序会根据缺失字段生成下一张 Choice 卡。"
  ].join("\n");
}

export function confirmBuildChoice(): ChoicePayload {
  return {
    prompt: "信息已经足够，要开始生成 Agent 配置预览吗？",
    options: [
      { id: "start", label: "开始创建", description: "生成预览卡，确认后写入 Agent 列表" },
      { id: "continue", label: "再聊聊", description: "继续补充细节" },
      { id: "cancel", label: "取消", description: "放弃本次创建" }
    ],
    allowCustom: false,
    multiSelect: false
  };
}

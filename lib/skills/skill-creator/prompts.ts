import type { ChoicePayload, SkillDraftField, SkillDraftPartial } from "@/lib/skills/skill-creator/types";

const SKILL_CREATOR_SYSTEM_PROMPT_LINES = [
  "你是 Conflux 平台的 Skill 草稿生成器。你的工作是根据用户描述生成可保存的 slash-command Skill。",
  "你不负责决定流程状态，不负责生成下一张 Choice 卡；这些由程序根据缺失字段确定。",
  "每一轮都必须通过指定 tool 返回结构化字段，不要把结果写成普通文本。",
  "",
  "tool 输入字段：",
  "- draft_patch: PartialSkillDraft，只包含本轮能确定或修正的字段",
  "- summary: string（≤800 字，给用户看的简短进展摘要）",
  "- confidence: 0~1",
  "- warnings: string[]",
  "",
  "SkillDraft 字段约束：",
  "- name: 1~64 字，清楚表达 Skill 名称",
  "- slug: 只能包含小写字母、数字、短横线，必须以字母开头，长度 2~31；不要带斜杠",
  "- description: 1~240 字，一句话说明 Skill 用途",
  "- body: 20~12000 字，写成可执行的 Skill 指令正文，包含角色、输入、处理步骤、输出格式和边界",
  "",
  "工作原则：",
  "1. 只生成 / 修正 draft_patch，不要输出 info_sufficient / next_question / missing_fields。",
  "2. 用户只描述目标时，你可以主动生成完整 Skill body。",
  "3. 用户贴出已有正文时，可以整理成更清晰的 Skill body，但不要改变用户明确要求。",
  "4. slug 要短、可记、语义明确，例如 prd-summarizer、meeting-actions、code-review-notes。",
  "5. 拿不准的字段不要编造；留空让程序继续提问。",
  "6. 不要设计上传文件流程；/skill-creator 只做对话式生成。"
];

export const SKILL_CREATOR_SYSTEM_PROMPT = SKILL_CREATOR_SYSTEM_PROMPT_LINES.join("\n");

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export type SkillCreatorPromptContext = {
  partialDraft: SkillDraftPartial;
  history: ConversationTurn[];
  userInput: string;
  missingFields: SkillDraftField[];
};

export function buildSkillCreatorSystemPrompt() {
  return SKILL_CREATOR_SYSTEM_PROMPT;
}

export function buildSkillCreatorPrompt(context: SkillCreatorPromptContext) {
  const draftText = Object.keys(context.partialDraft).length
    ? JSON.stringify(context.partialDraft, null, 2)
    : "(空)";
  const historyText = context.history.length
    ? context.history.map((turn, index) => `${index + 1}. [${turn.role}] ${turn.text}`).join("\n")
    : "(无历史)";
  const missingText = context.missingFields.length ? context.missingFields.join(", ") : "(无)";

  return [
    "## 当前已生成的 SkillDraft",
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
    "调用 update_skill_draft tool，返回本轮能生成或修正的 draft_patch、summary、confidence、warnings。",
    "不要决定下一步流程，不要生成 next_question；程序会根据缺失字段生成下一张 Choice 卡。"
  ].join("\n");
}

export function confirmBuildChoice(): ChoicePayload {
  return {
    prompt: "Skill 草稿已经足够，要生成预览吗？",
    options: [
      { id: "start", label: "生成预览", description: "查看 Skill 内容，确认后保存" },
      { id: "continue", label: "再聊聊", description: "继续补充或调整 Skill 需求" },
      { id: "cancel", label: "取消", description: "放弃本次创建" }
    ],
    allowCustom: false,
    multiSelect: false
  };
}

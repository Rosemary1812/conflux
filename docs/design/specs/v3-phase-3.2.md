# V3.2 /agent-creator C0 设计稿

> 范围：本设计稿只覆盖 `/agent-creator` 的引导创建流程、状态机、Planner LLM 结构化抽取、Choice 卡桥接、预览卡与保存契约。  
> 明确不覆盖：Claude Agent SDK 启动、SDK `canUseTool` / Approval 桥接、群聊接入、自建 Agent 运行时效果。这些属于 V3.4 / V3.5。

## 1. 阶段目标与边界

`/agent-creator` 是 Conflux 平台内置 Skill/workflow。用户在单聊中输入 `/agent-creator` 后，系统进入一个 AskUserQuestion 风格的主动引导流程：

1. 创建阶段调用 Planner Provider API，把用户自然语言需求抽取为 `AgentDraft`。
2. 信息不足时，Planner LLM 返回 `next_question`，后端渲染为 V1.5 已有的 Choice 卡。
3. 信息充足时，进入 `confirm_build`，让用户确认是否生成预览。
4. 用户确认后展示 `AgentCreatorPreviewCard`，允许保存、再改一下、取消、重新生成 profile。
5. 用户点保存后写入 `agents` 表：`platform='claude_code'`、`is_system=0`、`enabled=1`。
6. 保存完成只产生可管理的自建 Agent 记录；后续运行这个自建 Agent 时才启动 Claude Agent SDK。

关键约束：

- `/agent-creator` 只在 `conversation.mode === 'single'` 时生效；群聊中 `/agent-creator` 仍按普通文本处理。
- V3.2 使用 Planner Provider API 做结构化抽取，不使用 Claude Agent SDK。
- 自建 Agent 的底层平台固定为 `claude_code`，但 SDK option 映射、Provider `protocol='anthropic'` 校验、per-run env 注入均留到 V3.4。
- Choice / Approval 不新增交互系统，复用 V1.5 `agent_interactions`。
- V3.2 不引入头像选择；创建时统一给默认头像。上传 / 修改头像放到后续“自定义 Agent 设置页”。

## 2. TypeScript 类型与 Zod Schema

以下代码块是 C1 实现时的契约草案，建议落到 `lib/skills/agent-creator/types.ts` 或与 `state.ts` 同目录的类型文件中。字段命名与 `lib/db/schema.ts` 的 `agents` 表保持对齐。

```ts
import { z } from "zod";

export const agentCreatorStateSchema = z.enum([
  "idle",
  "collecting",
  "confirm_build",
  "preview",
  "saving",
  "done",
  "cancelled"
]);

export type AgentCreatorState = z.infer<typeof agentCreatorStateSchema>;

export const agentCreatorEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("USER_INPUT"),
    text: z.string().min(1),
    messageId: z.string()
  }),
  z.object({
    type: z.literal("CHOICE_RESPONDED"),
    interactionId: z.string(),
    selectedOptionIds: z.array(z.string()).default([]),
    customText: z.string().optional()
  }),
  z.object({
    type: z.literal("LLM_RESPONSE"),
    response: z.lazy(() => plannerLLMResponseSchema)
  }),
  z.object({
    type: z.literal("USER_CONFIRMED")
  }),
  z.object({
    type: z.literal("USER_CANCELLED"),
    reason: z.string().optional()
  }),
  z.object({
    type: z.literal("USER_REGENERATE_PROFILE"),
    instruction: z.string().optional()
  })
]);

export type AgentCreatorEvent = z.infer<typeof agentCreatorEventSchema>;

export const permissionModeSchema = z.enum(["readonly", "editable"]);

export const toolProfileSchema = z.enum(["readonly", "code-author", "executor"]);

export const avatarSchema = z.object({
  kind: z.literal("emoji"),
  value: z.literal("🤖")
});

export const agentDraftSchema = z.object({
  name: z.string().min(1).max(48),
  alias: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/),
  display_name: z.string().min(1).max(48),
  description: z.string().min(1).max(240),
  system_prompt: z.string().min(1).max(8000),
  permission_mode: permissionModeSchema,
  capabilities: z.array(z.string().min(1).max(24)).max(8),
  tool_profile: toolProfileSchema,
  avatar: avatarSchema.default({ kind: "emoji", value: "🤖" }),
  provider_hint: z
    .object({
      protocol: z.literal("anthropic").optional(),
      base_url_note: z.string().optional()
    })
    .optional()
});

export type AgentDraft = z.infer<typeof agentDraftSchema>;

export const choicePayloadSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional()
    })
  ),
  allowCustom: z.boolean().optional(),
  multiSelect: z.boolean().optional()
});

export type ChoicePayload = z.infer<typeof choicePayloadSchema>;

export const plannerLLMResponseSchema = z.object({
  intent: z.literal("agent_creator"),
  info_sufficient: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(800),
  draft: agentDraftSchema.partial().optional(),
  next_question: choicePayloadSchema.optional(),
  missing_fields: z
    .array(
      z.enum([
        "name",
        "alias",
        "display_name",
        "description",
        "system_prompt",
        "permission_mode",
        "capabilities",
        "tool_profile",
        "avatar"
      ])
    )
    .default([]),
  warnings: z.array(z.string()).default([])
});

export type PlannerLLMResponse = z.infer<typeof plannerLLMResponseSchema>;
```

### 字段说明

| 类型 | 字段 | 说明 |
| --- | --- | --- |
| `AgentCreatorState` | `idle` | 未开始或 session 未创建 |
| `AgentCreatorState` | `collecting` | 正在通过 Planner LLM + Choice 卡收集需求 |
| `AgentCreatorState` | `confirm_build` | 信息充足，等待用户确认生成预览 |
| `AgentCreatorState` | `preview` | 已形成完整 `AgentDraft`，等待保存 / 再改 / 取消 |
| `AgentCreatorState` | `saving` | 正在写入 `agents` 表 |
| `AgentCreatorState` | `done` | 保存完成 |
| `AgentCreatorState` | `cancelled` | 用户取消或流程终止 |
| `AgentDraft.permission_mode` | `readonly` / `editable` | Conflux 产品层权限；首版只暴露两档给用户 |
| `AgentDraft.tool_profile` | `readonly` / `code-author` / `executor` | Conflux 内部 profile；到 SDK option 的映射由 V3.4 使用 |
| `PlannerLLMResponse.next_question` | `ChoicePayload` | 直接转为 `agent_interactions.kind='choice'` 的 `payload_json` |
| `PlannerLLMResponse.draft` | `Partial<AgentDraft>` | collecting 阶段可部分返回；preview / saving 前必须通过完整 `agentDraftSchema` |

## 3. Planner LLM Response 契约

Planner Provider API 的 system prompt 需要强约束模型只返回 JSON，并主动判断 `info_sufficient`：

```json
{
  "intent": "agent_creator",
  "info_sufficient": false,
  "confidence": 0.72,
  "summary": "用户想创建一个代码审查 Agent，偏向只读分析。",
  "draft": {
    "name": "Code Reviewer",
    "alias": "code-reviewer",
    "display_name": "代码审查助手",
    "description": "审查代码变更并指出风险。",
    "permission_mode": "readonly",
    "capabilities": ["代码审查", "风险识别"],
    "tool_profile": "readonly"
  },
  "next_question": {
    "prompt": "这个 Agent 是否需要直接修改文件？",
    "options": [
      { "id": "readonly", "label": "只读审查", "description": "只分析和建议，不改文件" },
      { "id": "editable", "label": "允许改文件", "description": "可以生成并应用代码修改" }
    ],
    "allowCustom": true,
    "multiSelect": false
  },
  "missing_fields": ["system_prompt"],
  "warnings": []
}
```

当 `info_sufficient=true` 时：

- `draft` 必须足够接近完整 `AgentDraft`。
- `next_question` 可以为空。
- runner 创建一张确认 Choice 卡，问题固定为“信息已经足够，要开始生成 Agent 配置预览吗？”。
- 确认卡选项固定为：
  - `start`: 开始创建
  - `continue`: 再聊聊
  - `cancel`: 取消

## 4. 状态机转移表

| 当前状态 | 事件 | 条件 | 动作 | 下一状态 |
| --- | --- | --- | --- | --- |
| `idle` | `USER_INPUT` | 单聊中触发 `/agent-creator` | 创建 creator session；调用 Planner Provider API | `collecting` |
| `idle` | `USER_CANCELLED` | 任意 | 不创建 session | `cancelled` |
| `collecting` | `LLM_RESPONSE` | `info_sufficient=false` 且有 `next_question` | 写 `agent_interactions(kind='choice')`；SSE 推送 `interaction_requested`；记录 `current_interaction_id` | `collecting` |
| `collecting` | `CHOICE_RESPONDED` | 回应当前 `current_interaction_id` | 合并用户选择 / 自定义文本；再次调用 Planner Provider API | `collecting` |
| `collecting` | `LLM_RESPONSE` | `info_sufficient=true` 且 `draft` 可补齐核心字段 | 写确认 Choice 卡：开始 / 再聊聊 / 取消 | `confirm_build` |
| `collecting` | `USER_CANCELLED` | 任意 | 标记 session 取消；取消未决 interaction | `cancelled` |
| `confirm_build` | `CHOICE_RESPONDED` | 选择 `start` | 校验完整 `AgentDraft`；生成预览消息 | `preview` |
| `confirm_build` | `CHOICE_RESPONDED` | 选择 `continue` 或有 `customText` | 把用户补充输入送 Planner Provider API | `collecting` |
| `confirm_build` | `CHOICE_RESPONDED` | 选择 `cancel` | 标记 session 取消 | `cancelled` |
| `confirm_build` | `USER_CANCELLED` | 任意 | 标记 session 取消 | `cancelled` |
| `preview` | `USER_CONFIRMED` | `AgentDraft` 完整且 alias 不冲突 | 进入保存流程 | `saving` |
| `preview` | `USER_REGENERATE_PROFILE` | 用户要求“再改一下”或“换一档 profile” | 带当前 draft 和用户指令再次调用 Planner Provider API | `collecting` |
| `preview` | `USER_CANCELLED` | 任意 | 标记 session 取消 | `cancelled` |
| `saving` | `USER_CONFIRMED` | 内部保存成功 | 插入 `agents` 行；写完成消息 | `done` |
| `saving` | `USER_CONFIRMED` | alias 冲突 / schema 校验失败 | 写 Choice 卡要求换 alias 或补字段 | `collecting` |
| `saving` | `USER_CANCELLED` | 用户中断或保存失败需要取消 | 不写入或回滚未完成写入 | `cancelled` |
| `done` | 任意事件 | 终态 | 忽略或提示已完成 | `done` |
| `cancelled` | 任意事件 | 终态 | 忽略或提示已取消 | `cancelled` |

实现注意：

- `saving` 的外部触发仍来自 UI 的保存动作，但状态机内部应把 DB 写入视为一次原子动作；写成功后才能进入 `done`。
- `current_interaction_id` 只允许指向一个 pending Choice；收到过期 interaction 的回应时应返回明确错误，不改变状态。
- `AgentDraft` 的 `alias` 必须与 `agents.slug` 唯一索引一致；冲突时不进入 `saving`，而是回到 `collecting` 引导换名。

## 5. API Endpoint 字段表

V3.2 默认不新增 endpoint。`/agent-creator` 作为内置 Skill/workflow 挂在 V3.1 的 slash runner 后面，入口和交互回应复用现有 API。

| API / 数据通道 | 方向 | 复用字段 | V3.2 用法 | 是否新增 |
| --- | --- | --- | --- | --- |
| `POST /api/messages` | 前端 -> 后端 | `conversationId`、`content`、`attachments` | 用户发送 `/agent-creator` 或后续文本；V3.1 runner 识别单聊 slash 命令后调起 workflow | 否 |
| `POST /api/messages` | 后端内部 | `messageId`、`conversationId` | creator session 绑定触发消息，后续预览 / 完成提示可写 assistant 或 system 消息 | 否 |
| `agent_interactions` 表 | 后端 -> 前端 | `kind='choice'`、`payload_json`、`status='pending'`、`conversation_id`、`message_id`、`run_id`、`agent_id` | 承载 Planner LLM 的 `next_question` 与“开始创建”确认卡 | 否 |
| `POST /api/interactions/:id/respond` | 前端 -> 后端 | `selectedOptionIds`、`customText` | 用户回答 Choice 卡；runner 读取 response 后推进状态机 | 否 |
| SSE `interaction_requested` | 后端 -> 前端 | `interaction` | 通知消息流渲染 `InteractionChoiceCard` | 否 |
| SSE `interaction_resolved` | 后端 -> 前端 | `interactionId`、`status` | 用户回应后更新 Choice 卡状态 | 否 |
| `agents` 表 | 后端写入 | `slug`、`name`、`platform`、`description`、`enabled`、`is_system`、`system_prompt`、`capabilities`、`avatar_kind`、`avatar_value`、`permission_mode`、`tool_profile` | 保存预览时插入自建 Agent：`platform='claude_code'`、`is_system=0`、`enabled=1` | 否 |
| Planner Provider API | 后端 -> Provider | `messages`、`model`、`json schema` | 仅用于抽取 `PlannerLLMResponse`；不等同于自建 Agent runtime | 否，复用 V2 Provider |

### 保存写入字段

| `agents` 字段 | 来源 | 固定值 / 转换 |
| --- | --- | --- |
| `id` | 后端生成 | `crypto.randomUUID()` 或现有 id helper |
| `slug` | `AgentDraft.alias` | 写入前查重 |
| `name` | `AgentDraft.name` | 原样写入 |
| `platform` | V3.2 固定 | `claude_code` |
| `description` | `AgentDraft.description` | 原样写入 |
| `enabled` | V3.2 固定 | `1` |
| `is_system` | V3.2 固定 | `0` |
| `system_prompt` | `AgentDraft.system_prompt` | 8000 字符上限 |
| `capabilities` | `AgentDraft.capabilities` | JSON string |
| `avatar_kind` | V3.2 固定 | `emoji` |
| `avatar_value` | V3.2 固定 | `🤖` |
| `permission_mode` | `AgentDraft.permission_mode` | `readonly` / `editable` |
| `tool_profile` | `AgentDraft.tool_profile` | `readonly` / `code-author` / `executor` |
| `created_at` / `updated_at` | 后端 | 当前时间戳 |

## 6. UI 组件 Props

### 6.1 `SlashCommandPanel`

V3.1 已有组件，本阶段只补足 props 契约，避免后续为了 `/agent-creator` 再拆接口。

```ts
import type { SkillSummary } from "@/lib/skills/types";

export type SlashCommandPanelProps = {
  activeIndex: number;
  skills: SkillSummary[];
  query: string;
  disabled?: boolean;
  onSelect: (skill: SkillSummary) => void;
  onHover?: (index: number) => void;
};
```

| Prop | 说明 |
| --- | --- |
| `activeIndex` | 键盘上下选择的当前项 |
| `skills` | 来自 Skill registry 的候选项，包含内置 `agent-creator` |
| `query` | 当前 slash 后输入，用于高亮或空态文案 |
| `disabled` | 会话不允许 slash 命令时禁用；群聊场景通常不渲染 |
| `onSelect` | 选择 Skill 后把 `/${slug}` 写入 composer 并提交或准备提交 |
| `onHover` | 鼠标 hover 时同步 `activeIndex` |

### 6.2 `AgentCreatorPreviewCard`

预览卡是消息流 inline 卡片，不是设置页表单。首版必须展示所有核心字段、风险提示和三个主动作。

```ts
export type AgentCreatorPreviewCardProps = {
  draft: AgentDraft;
  status: "preview" | "saving" | "done" | "error";
  error?: string;
  requireDangerConfirm?: boolean;
  dangerConfirmed?: boolean;
  onDangerConfirmedChange?: (checked: boolean) => void;
  onSave: () => void;
  onRegenerate: (instruction?: string) => void;
  onCancel: () => void;
};
```

| Prop | 说明 |
| --- | --- |
| `draft` | Planner LLM 抽取并经 schema 校验后的完整草稿 |
| `status` | 控制按钮 loading、完成态、错误态 |
| `error` | alias 冲突、保存失败、schema 失败等错误展示 |
| `requireDangerConfirm` | `tool_profile='executor'` 时为 true，保存前必须确认 |
| `dangerConfirmed` | 高危 profile 二次确认状态 |
| `onSave` | 写入 `agents` 表；触发 `USER_CONFIRMED` |
| `onRegenerate` | “再改一下 / 换一档 profile”；触发 `USER_REGENERATE_PROFILE` |
| `onCancel` | 取消 workflow；触发 `USER_CANCELLED` |

### 6.3 `AgentAvatarPicker`（后移到自定义 Agent 设置页）

V3.2 `/agent-creator` 不渲染 `AgentAvatarPicker`，只写默认头像。头像上传 / 修改能力放到后续“自定义 Agent 设置页”，届时再实现该组件。这里保留 props 草案，作为设置页阶段的接口边界，不计入 V3.2 主线验收。

```ts
export type AgentAvatarPickerProps = {
  currentKind: "emoji" | "uploaded";
  currentValue: string;
  emojiOptions?: string[];
  uploadedPreviewUrl?: string;
  disabled?: boolean;
  maxUploadBytes?: number; // default: 1 * 1024 * 1024
  acceptedMimeTypes?: Array<"image/jpeg" | "image/png" | "image/webp" | "image/gif">;
  onChange: (avatar: AgentDraft["avatar"]) => void;
  onUploadRequest?: (file: File) => Promise<AgentDraft["avatar"]>;
};
```

| Prop | 说明 |
| --- | --- |
| `currentKind` | 当前头像类型 |
| `currentValue` | emoji 字符或 uploaded handle |
| `emojiOptions` | 首版默认 16 个 emoji |
| `uploadedPreviewUrl` | 上传图片预览地址 |
| `disabled` | 保存中禁用 |
| `maxUploadBytes` | 上传上限，默认 1MB |
| `acceptedMimeTypes` | jpg/png/webp/gif |
| `onChange` | 选择 emoji 或上传成功后更新 Agent 编辑表单 |
| `onUploadRequest` | 复用附件上传能力，返回 uploaded avatar |

## 7. 调用序列

```text
User
  -> POST /api/messages content="/agent-creator ..."
  -> message route detects built-in skill in single conversation
  -> runSkill("agent-creator", conversationId, userMessageId)
  -> AgentCreatorRunner creates session(state=collecting)
  -> Planner Provider API returns PlannerLLMResponse

if info_sufficient=false:
  -> create agent_interactions(kind="choice", payload=next_question)
  -> SSE interaction_requested
  -> user responds through POST /api/interactions/:id/respond
  -> runner receives CHOICE_RESPONDED
  -> Planner Provider API called again

if info_sufficient=true:
  -> create confirm_build Choice card(start / continue / cancel)
  -> user selects start
  -> render AgentCreatorPreviewCard(state=preview)
  -> user saves
  -> insert agents(platform="claude_code", is_system=0)
  -> state=done
```

## 8. 未决问题

| 问题 | 当前建议 | 阶段 |
| --- | --- | --- |
| creator session 是否需要持久化表 | V3.2 首版可用内存 Map；若刷新恢复很重要，再补 `agent_creator_sessions` 表 | C1 实现前确认 |
| `agent_interactions.agent_id` 如何填写 | `agent_interactions.agent_id` 有外键，必须指向真实 `agents.id`。V3.2 建议 seed 一个 `agent-creator` 系统 Agent 记录，专门承载内置 creator workflow 的 Choice 卡；不要使用 `__creator__` 这类假 id | C1 必须解决 |
| 上传头像放在哪个阶段 | 已定：V3.2 不做头像选择，只写默认 `emoji=🤖`；上传 / 修改头像放到后续“自定义 Agent 设置页” | 后续设置页阶段 |
| `permission_mode='editable'` 与 `tool_profile='executor'` 的产品关系 | UI 对用户只讲 readonly/editable；executor 作为内部高危 profile，需要二次确认 | C6 |
| Planner Provider 选择来源 | 默认复用 V2 Orchestrator Planner Provider；若未配置，提示先配置 Provider，不新增 endpoint | C2 |
| 保存完成后是否自动把自建 Agent 加入当前单聊 | 不自动加入。V3.2 只创建；V3.4 / V3.5 再定义运行入口 | 后续阶段 |

## 9. 验收标准

- 设计稿存在于 `docs/design/specs/v3-phase-3.2.md`。
- 文档包含 `AgentCreatorState`、`AgentCreatorEvent`、`PlannerLLMResponse`、`ChoicePayload`、`AgentDraft` 的 TypeScript 类型与 Zod schema。
- 文档包含 `idle / collecting / confirm_build / preview / saving / done / cancelled` 的状态机转移表。
- 文档明确 V3.2 默认不新增 endpoint，并复用 `/api/messages` 与 `POST /api/interactions/:id/respond` / `agent_interactions`。
- 文档包含 `SlashCommandPanel`、`AgentCreatorPreviewCard` 的 V3.2 props；`AgentAvatarPicker` 仅作为后续设置页 props 草案保留，不在 V3.2 实现。
- 文档明确 V3.2 不启动 Claude Agent SDK；用户确认保存后只写 `agents` 表，后续运行时 SDK 接入归 V3.4。

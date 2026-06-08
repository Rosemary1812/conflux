# V3.3 /skill-creator C0 设计稿

> 范围：本设计稿只覆盖 `/skill-creator` 的对话式 Skill 生成流程、状态机、LLM 结构化抽取、Choice 卡桥接、预览卡与保存契约。  
> 明确不覆盖：设置页里的手动新增 / 上传 / 编辑 / 删除 Skill，Skill marketplace，共享和版本历史。

## 1. 阶段目标与边界

`/skill-creator` 是一个对话式生成服务：用户用自然语言描述想要的 Skill，系统通过 LLM 生成 `SkillDraft`，程序负责校验、补问、预览与保存。

它不是手动添加 Skill 的入口。手动粘贴完整 Skill、上传 markdown / yaml、编辑已有 Skill、删除 Skill 等能力放到设置页 Skill 管理阶段。

## 2. 类型与 Schema

```ts
export type SkillCreatorState =
  | "collecting"
  | "confirm_build"
  | "preview"
  | "saving"
  | "done"
  | "cancelled";

export type SkillDraft = {
  name: string;
  slug: string;
  description: string;
  body: string;
};

export type SkillDraftField = "name" | "slug" | "description" | "body";

export type SkillCreatorExtractionResult = {
  summary?: string;
  draft_patch?: Partial<SkillDraft>;
  confidence?: number;
  warnings?: string[];
};

export type SkillCreatorSession = {
  conversationId: string;
  userMessageId: string;
  state: SkillCreatorState;
  draft: Partial<SkillDraft>;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  currentInteractionId: string | null;
  lastSummary: string;
  createdAt: number;
  updatedAt: number;
};
```

`slug` 规则：`^[a-z][a-z0-9-]{1,30}$`。保存前必须查 `skills.slug` 唯一性。

## 3. LLM 契约

LLM 只做字段生成 / 修正，不负责流程判断。

必须使用 tool call：

```ts
tool name: update_skill_draft
input: SkillCreatorExtractionResult
```

LLM 可生成：

- `name`
- `slug`
- `description`
- `body`

LLM 不返回：

- `info_sufficient`
- `next_question`
- `missing_fields`
- `state`

这些全部由程序根据 `draft` 和 DB 校验结果决定。

## 4. 状态机

| 当前状态 | 事件 | 程序动作 | 下一状态 |
| --- | --- | --- | --- |
| `collecting` | 用户发 `/skill-creator ...` | 创建 session，调用 LLM tool，合并 `draft_patch`，计算缺失字段 | `collecting` 或 `confirm_build` |
| `collecting` | Choice 回应 / 用户补充 | 写入 history，调用 LLM tool，合并 `draft_patch` | `collecting` 或 `confirm_build` |
| `collecting` | LLM 失败 | 创建恢复 Choice：重说一遍 / 手动补字段 / 取消 | `collecting` |
| `confirm_build` | 用户选“开始创建” | 校验 draft 完整性与 slug 唯一性 | `preview` |
| `confirm_build` | 用户选“再聊聊” | 写入用户补充，重新调用 LLM | `collecting` |
| `confirm_build` | 用户选“取消” | 取消 session | `cancelled` |
| `preview` | 用户点保存 | 插入 `skills` 行 | `saving` → `done` |
| 任意非终态 | `/cancel` | 取消 pending interaction，清理 session | `cancelled` |

## 5. 缺字段补问

程序生成 Choice 卡，不让 LLM 生成 `next_question`。

| 缺字段 | 问法 |
| --- | --- |
| `name` | “这个 Skill 叫什么？” |
| `slug` | “命令名用哪个？”并提示只能小写字母、数字、短横线 |
| `description` | “用一句话描述这个 Skill 的用途。” |
| `body` | “这个 Skill 应该如何工作？你可以描述输入、输出格式和边界。” |
| slug 冲突 | “这个命令名已存在，换一个？” |

信息齐全后，程序创建 `confirm_build` Choice：

- 开始创建
- 再聊聊
- 取消

## 6. API 与数据写入

复用：

- `POST /api/messages`
- `POST /api/interactions/:id/respond`
- `agent_interactions(kind='choice')`
- SSE `interaction_requested`

新增：

- `GET /api/skill-creator/:conversationId/session`
- `POST /api/skill-creator/:conversationId/save`
- `POST /api/skill-creator/:conversationId/regenerate`
- `POST /api/skill-creator/:conversationId/cancel`

保存写入 `skills`：

| skills 字段 | 来源 |
| --- | --- |
| `id` | `crypto.randomUUID()` |
| `slug` | `SkillDraft.slug` |
| `name` | `SkillDraft.name` |
| `description` | `SkillDraft.description` |
| `body` | `SkillDraft.body` |
| `kind` | 固定 `user` |
| `version` | 固定 `1` |
| `source_attachment_id` | 固定 `null`，上传入口不属于 `/skill-creator` |
| `created_at` / `updated_at` | 当前时间戳 |

## 7. UI 组件 Props

```ts
export type SkillCreatorPreviewCardProps = {
  draft: SkillDraft;
  status: "preview" | "saving" | "done" | "error";
  error?: string;
  onSave: () => Promise<void> | void;
  onRegenerate: (instruction?: string) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
};
```

预览卡展示：

- name
- slug
- description
- body 摘要 / 可滚动正文
- 保存
- 再改一下
- 取消

## 8. 验收标准

- 单聊输入 `/skill-creator <自然语言描述>` 后进入生成流程。
- LLM 通过 tool call 返回 `draft_patch`，代码不从普通文本里抽 JSON。
- 字段不足时由程序创建 Choice 卡继续补问。
- 字段齐全后进入确认卡，用户确认后展示预览卡。
- 保存后 `skills` 表新增 `kind='user'` 行。
- 创建后该 Skill 出现在 `/` 命令面板。
- slug 非法或冲突时给出明确提示并可继续修改。
- `/skill-creator` 不提供上传入口，`source_attachment_id` 保存为 `null`。
- typecheck / build 通过。

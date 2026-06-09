# V3.6 自定义 Agent 设置页 C0 设计稿

> 范围：本设计稿覆盖 `SettingsModal` → "自建 Agent" Tab 从静态占位做实：列表 / 编辑 / 删除 / 重新生成 profile / 重命名 alias，并接上 V3.5 留降级到 🤖 的 `avatarKind=uploaded` 真实预览。
> 明确不覆盖：V3.7（SDK Approval/Choice 桥接）、V3.4（profile 抽取的 prompt 流程本身；V3.6 只**复用** V3.2 prompts/state 重生成 profile，不再调 `/agent-creator` 引导对话）、Diff 视图、版本历史。

## 1. 阶段目标与边界

V3.6 的目标是把"自建 Agent"从静态演示面板升级为可运营的设置入口：用户能在不写 SQL 的情况下看到、编辑、重新生成、删除所有自建 Agent。GroupContext / MessageBubble / NewConversationContext 在 V3.5 已经接住 V3.6 的数据形态，本阶段不再触碰。

明确边界：

- **V3.6 复用** V3.5 已落的 `RosterItem` / `AvailableAgentSummary` / `AgentVisualStyle` / `AgentAvatar`（V3 计划 §三 G4 + V3.5 视觉差决策）。
- **V3.6 复用** V3.2 的 `lib/skills/agent-creator/prompts.ts` 与 `state.ts` 中的 Planner LLM 抽取逻辑；不做"对话式 regen"，只做"一键 regen → LLM 输出新 profile → 用户在设置页表单确认或丢弃"。
- **V3.6 不动** `lib/adapters/claude-code-sdk.ts`、Orchestrator、Planner、Skill registry。
- **V3.6 不引入** 软删除 / 归档 / 跨账户共享 / 操作历史 / Diff 视图。

本阶段验收范围：

- 设置页"自建 Agent" Tab 列出所有 `is_system=0` Agent。
- 编辑面板支持改 `name` / `alias` / `description` / `system_prompt` / `permission_mode` / `capabilities` / `tool_profile` / `avatar`（emoji 或上传图片），保存走 `PATCH /api/agents/:id`。
- 删除走 `DELETE /api/agents/:id`，二次确认；存在未完成 run 时按钮置灰（Q6 决策）。
- 重新生成 profile：调 V3.2 Planner LLM 用当前表单字段 + 用户可选 instruction 重新抽取，把结果回填到表单（不直接落库），用户点"保存"才 PATCH。
- `avatarKind=uploaded` 真实接入：选择本地图片 → 服务端 `/api/agents/:id/avatar` 暴露预览流 → `AgentAvatar`（V3.5）`kind='uploaded'` 分支落到这条流。
- 内置 system Agent 不出现在设置页。

## 2. 类型设计（C0-1）

### 2.1 复用 V3.5 类型（**只读引用，不重定义**）

V3.6 全部消费方都从 V3.5 拿这些类型，**不在 V3.6 再写一遍**：

| 类型 | 来源 | V3.6 用途 |
| --- | --- | --- |
| `AgentSummary` | `lib/agents/types.ts:3-13` | 设置页"详情"展示（systemPrompt / permissionMode / toolProfile） |
| `AvailableAgentSummary` | `lib/agents/types.ts:17-27` | 设置页列表行展示（不漏 systemPrompt） |
| `AgentAvatarKind` | `lib/agents/types.ts:15` | PATCH body 的 `avatarKind` 字段 |
| `AgentVisualStyle` | `components/agents/AgentVisualStyle.ts` | 设置页列表 / 编辑面板头像背景对齐 |
| `AgentAvatar` | `components/agents/AgentAvatar.tsx` | 列表行 / 编辑预览 / 删除确认头像 |
| `capabilitiesSchema` | `lib/agents/avatar-schema.ts` | PATCH body 校验 capabilities |
| `AgentDraft` | `lib/skills/agent-creator/types.ts:41-62` | regen profile 输出的 schema |
| `AgentDraftPartial` | `lib/skills/agent-creator/types.ts:64-65` | regen 的 LLM 响应 patch |
| `ToolProfile` | `lib/skills/agent-creator/types.ts:15` | 工具 profile 选项 |
| `listProfileMetas` | `lib/skills/agent-creator/profiles.ts:65-67` | 编辑面板 profile 下拉 |
| `parseCapabilitiesJson` | `lib/agents/avatar-schema.ts:10-24` | service 层 listAgentSelfBuilt 时 capabilities 解析 |

### 2.2 新增：编辑表单与 API 契约

`lib/agents/edit-schema.ts`（新）：

```ts
import { z } from "zod";
import { avatarKindSchema, capabilitiesSchema } from "@/lib/agents/avatar-schema";
import { toolProfileSchema, permissionModeSchema } from "@/lib/skills/agent-creator/types";

const slugSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, "alias 只能包含小写字母、数字与短横线，且以字母开头");

const nameSchema = z.string().min(1).max(48);
const descriptionSchema = z.string().min(1).max(240);
const systemPromptSchema = z.string().min(1).max(8000);

export const agentUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    alias: slugSchema.optional(),
    description: descriptionSchema.optional(),
    systemPrompt: systemPromptSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
    toolProfile: toolProfileSchema.optional(),
    capabilities: capabilitiesSchema.optional(),
    avatarKind: avatarKindSchema.optional(),
    avatarValue: z.string().min(1).max(1024).optional()
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "至少要改一个字段。"
  )
  .refine(
    (value) => {
      // avatarKind='emoji' → value 是 emoji 字符；avatarKind='uploaded' → value 是本地绝对路径
      if (!value.avatarKind || !value.avatarValue) return true;
      if (value.avatarKind === "emoji") {
        return value.avatarValue.length <= 8;
      }
      if (value.avatarKind === "uploaded") {
        return /^([a-zA-Z]:\\|\/)[^\x00]+$/.test(value.avatarValue);
      }
      return true;
    },
    "avatar 与 avatarKind 不匹配。"
  );

export type AgentUpdateRequest = z.infer<typeof agentUpdateSchema>;
```

`avatarValue` 校验规则：

| `avatarKind` | 校验 |
| --- | --- |
| `system` | 不允许在 PATCH 里改（编辑面板禁掉 system 选项；后端再次拒绝） |
| `emoji` | 长度 ≤ 8（够用绝大部分单/双字符 emoji + ZWJ 序列） |
| `uploaded` | Windows 盘符开头 `C:\...` 或 POSIX 绝对路径 `/...`；非空 |

### 2.3 新增：删除前置检查

`lib/agents/types.ts` 新增：

```ts
export type AgentDeletePrecheck = {
  canDelete: boolean;
  agent: AgentSummary;
  activeRuns: Array<{
    runId: string;
    conversationId: string;
    status: "pending" | "running" | "awaiting_interaction";
    title: string;
  }>;
  conversationUsage: Array<{ conversationId: string; title: string; rosterCount: number }>;
};

export type AgentDeleteResponse =
  | { ok: true; agentId: string; cascadedRoster: number; cancelledRuns: number }
  | { ok: false; error: string };
```

返回结构的不变面：

- `canDelete=true` 时调用方可继续 DELETE；`canDelete=false` 时前端用 `activeRuns` 列表展示 tooltip。
- `conversationUsage` 用于在删除前告诉用户"该 Agent 仍在 N 个群聊的 roster 中"——删除后会从这些 roster 清掉。

### 2.4 新增：regenerate profile 契约

复用 V3.2 `PlannerLLMResponse` 的 `draft_patch` 输出。V3.6 不调 `/agent-creator` 引导对话；新建一个**纯 LLM 调用 + Zod 校验**的小函数：

`lib/agents/regenerate.ts`（新）：

```ts
import { z } from "zod";
import { agentDraftPartialSchema } from "@/lib/skills/agent-creator/types";

export const regenerateRequestSchema = z.object({
  instruction: z.string().max(500).optional()
});

export type RegenerateProfileRequest = z.infer<typeof regenerateRequestSchema>;

export type RegenerateProfileResponse = {
  draft: z.infer<typeof agentDraftPartialSchema>;
  summary: string;
  warnings: string[];
};
```

V3.6 不持久化"regen 会话"——一次 LLM 调用、出 patch、回填表单。**与 V3.2 引导流的区别**：(a) 不维护 `state`/`history`；(b) 不调 Choice 卡；(c) 不写 `agent_interactions`；(d) 失败时直接返回 error 给前端。

### 2.5 列表行展示类型

复用 V3.5 的 `AvailableAgentSummary` 作为列表行的最小可展示字段；详情面板再叠加 `AgentSummary` 的运行时字段。

`lib/agents/types.ts` 不新增类型；UI 层组装 `AgentListItem`：

```ts
// 仅 UI 组件内组装，不在 lib 层定义
type AgentListItem = AvailableAgentSummary & {
  lastRun: { runId: string; conversationId: string; finishedAt: number; status: "done" | "error" | "cancelled" } | null;
  systemPromptSummary: string; // systemPrompt 前 80 字符（仅当用户点开详情时取）
};
```

`lastRun` 来自一次 `agent_runs` 反向 join：

```sql
SELECT r.id AS runId, r.conversation_id, r.status, r.finished_at
FROM agent_runs r
WHERE r.agent_id = ?
  AND r.status IN ('done','error','cancelled')
ORDER BY r.finished_at DESC
LIMIT 1
```

> `systemPromptSummary` 不在 list 阶段取，避免把 systemPrompt 扩散到列表渲染；详情面板按需取。

## 3. 状态机（C0-2）

`CustomAgentsPanel` 顶层状态：`mode ∈ { list, edit }`。`edit` 模式内嵌套子状态：

```
[list]
  ├─ 点击 "新建"（V3.6 不做创建入口；保留 V3.2 /agent-creator 单一入口；按钮不展示）
  ├─ 点击列表行 → [edit.preview]
  └─ 点 "重新生成 profile" / "删除" → 在 [edit.*] 子状态内

[edit]
  ├─ preview        详情视图（只读，4 个操作按钮：编辑 / 重新生成 / 删除 / 关闭）
  ├─ editing        表单可编辑（保存 / 取消按钮）
  ├─ saving         PATCH 进行中
  ├─ saving-error   PATCH 失败，回退到 editing 并显示错误
  ├─ regenerating   LLM 调用中
  ├─ regen-preview  LLM 出 patch，自动跳到 editing 并预填表单
  ├─ regen-error    LLM 失败，回退到 preview
  ├─ delete-confirm 弹二次确认
  ├─ deleting       DELETE 进行中
  └─ delete-error   DELETE 失败，回退到 preview
```

转移表（状态 × 事件 → 下一状态）：

| 当前 | 事件 | 下一 | 备注 |
| --- | --- | --- | --- |
| `list` | `ROW_CLICK` | `edit.preview` | 进入详情 |
| `edit.preview` | `EDIT` | `edit.editing` | 复制 AgentSummary 到 draft |
| `edit.preview` | `REGENERATE` | `edit.regenerating` | 携带可选 instruction 调 LLM |
| `edit.preview` | `DELETE` | `edit.delete-confirm` | 先做 precheck（Q6） |
| `edit.preview` | `CLOSE` | `list` | 关闭按钮 |
| `edit.editing` | `SAVE` | `edit.saving` | PATCH |
| `edit.editing` | `CANCEL` | `edit.preview` | 丢弃改动 |
| `edit.saving` | PATCH 成功 | `edit.preview` | 重新拉 AgentSummary 替换缓存 |
| `edit.saving` | PATCH 失败 | `edit.saving-error` | 显示错误 |
| `edit.saving-error` | `RETRY` | `edit.saving` | 保留 draft |
| `edit.saving-error` | `CANCEL` | `edit.preview` | 丢弃改动 |
| `edit.regenerating` | LLM 成功 | `edit.regen-preview` → 立即 `edit.editing` | 预填 draft |
| `edit.regenerating` | LLM 失败 | `edit.regen-error` | 详情仍可读 |
| `edit.regen-error` | `RETRY` | `edit.regenerating` |  |
| `edit.regen-error` | `CANCEL` | `edit.preview` |  |
| `edit.delete-confirm` | 确认 | `edit.deleting` | DELETE |
| `edit.delete-confirm` | 取消 | `edit.preview` |  |
| `edit.deleting` | DELETE 成功 | `list` |  |
| `edit.deleting` | DELETE 失败 | `edit.delete-error` |  |

> 与 V3.2 /agent-creator 状态机的关系：V3.6 的"regen"复用 V3.2 的 Planner 抽取 prompt，但**不维护 session 状态**——LLM 输入 = 当前 AgentSummary 字段 + 用户 instruction；LLM 输出 = `agentDraftPartialSchema` 解析的 patch。所以 V3.6 的 regen 是无状态函数调用。

## 4. API 字段表（C0-3）

### 4.1 `GET /api/agents/self-built`

请求：无 query。

响应：

```ts
{
  agents: Array<{
    id: string;
    slug: string;
    name: string;
    platform: AgentPlatform;
    description: string;
    isSystem: false;          // 强类型
    avatarKind: AgentAvatarKind;
    avatarValue: string;
    capabilities: string[] | null;
    permissionMode: "readonly" | "editable";
    toolProfile: "readonly" | "code-author" | "executor" | null;
    systemPromptSummary: string;  // 头 80 字符
    lastRun: { runId: string; conversationId: string; finishedAt: number; status: "done" | "error" | "cancelled" } | null;
    createdAt: number;
    updatedAt: number;
  }>
}
```

实现位置：

- `app/api/agents/self-built/route.ts`（新）
- `lib/conversations/service.ts:listAgents`（46-62）旁加 `listSelfBuiltAgents()`：DB SELECT `is_system=0 ORDER BY updated_at DESC` → `toAgentSummary` + 反向 join `agent_runs` 取 `lastRun` + `parseCapabilitiesJson` 解析 capabilities + `systemPrompt.slice(0, 80)`
- **不**复用 `listAvailableAgents`（V3.5 给 `NewConversationContext` 用）：它的 `toAvailableAgentSummary` 不暴露 `systemPrompt / permissionMode / toolProfile`，不适合编辑面板预填

### 4.2 `GET /api/agents/:id`

请求：路径参数 `id`，无 body。

响应：

```ts
{
  agent: AgentSummary  // 完整字段（含 systemPrompt）
}
```

实现位置：`app/api/agents/[id]/route.ts`（新）→ `GET` handler。

错误：

| 情况 | HTTP | 错误体 |
| --- | --- | --- |
| agent 不存在 | 404 | `{ error: "Agent 不存在" }` |
| agent 是 system | 403 | `{ error: "内置 Agent 不可编辑" }` |

### 4.3 `GET /api/agents/:id/precheck-delete`

请求：路径参数 `id`，无 body。

响应：`AgentDeletePrecheck`（§2.3）。

实现位置：`app/api/agents/[id]/precheck-delete/route.ts`（新）。

逻辑：

1. SELECT agent；不存在 → 404；`is_system=true` → 403。
2. SELECT `agent_runs` WHERE `agent_id=? AND status IN ('pending','running','awaiting_interaction')` → `activeRuns`。`title` 来自 `conversations.title` 反向 join。
3. SELECT `conversation_agents` WHERE `agent_id=?` → 按 `conversationId` 分组 count → `conversationUsage`（`title` 从 conversations 取）。
4. `canDelete = activeRuns.length === 0`。

> 用途：前端删除按钮 `disabled` 状态、tooltip 文案。**先调 precheck 再决定是否显示确认弹窗**——active runs 存在时直接置灰按钮，不弹窗。

### 4.4 `PATCH /api/agents/:id`

请求：路径参数 `id`，body `AgentUpdateRequest`（§2.2）。

响应：

```ts
{ agent: AgentSummary }
```

实现位置：`app/api/agents/[id]/route.ts`（新）→ `PATCH` handler。

逻辑：

1. SELECT agent；不存在 → 404；`is_system=true` → 403。
2. `agentUpdateSchema.safeParse(body)`；失败 → 400 + Zod issues。
3. alias 唯一性：若 body 改了 alias 且新 alias 与其他 `agents.slug` 冲突 → 409 + `alias "X" 已被占用`。
4. 字段映射：body 用 camelCase（`systemPrompt` / `permissionMode` / `toolProfile` / `avatarKind` / `avatarValue`），DB 列用 snake_case（`system_prompt` / `permission_mode` / `tool_profile` / `avatar_kind` / `avatar_value`）；`capabilities` 是 string[] ↔ JSON.stringify。
5. `agent_skills` 不动（V3.6 不调整 skill 引用）；`agent_runs` 不动（已存 run 引用 agent_id；alias 改动不重写历史 run）。
6. UPDATE；返回最新 row 转 `AgentSummary`。
7. 发 SSE `agent_updated` 事件（V3.5 群聊 @ 提及后无需刷新——roster 拿的是 alias，与 agents.slug 解耦；alias 改名后旧 conversation 的 `conversation_agents.alias` 行保留原值，前端显示仍按 roster 表来）。

错误：

| 情况 | HTTP | 错误体 |
| --- | --- | --- |
| agent 不存在 | 404 | `{ error: "Agent 不存在" }` |
| agent 是 system | 403 | `{ error: "内置 Agent 不可编辑" }` |
| Zod 校验失败 | 400 | `{ error: string, issues: ZodIssue[] }` |
| alias 冲突 | 409 | `{ error: 'alias "X" 已被占用' }` |
| avatarKind='system' | 400 | `{ error: "avatarKind 不允许改为 system" }` |
| avatarKind='uploaded' 但路径不存在 | 400 | `{ error: "avatar 路径不可读" }` |

### 4.5 `DELETE /api/agents/:id`

请求：路径参数 `id`，无 body。

响应：`AgentDeleteResponse`（§2.3）。

实现位置：`app/api/agents/[id]/route.ts`（新）→ `DELETE` handler。

级联（V3 主计划 §三 V3.4 范围，本阶段实现）：

1. SELECT agent；不存在 → 404；`is_system=true` → 403。
2. **强制 precheck**：内部再跑一次 precheck-delete 逻辑（不调 HTTP），`activeRuns.length > 0` → 409 + `还有 N 个未完成 run`。
3. `agent_runs` 不删除（保留历史记录；`agent_id` 引用在 Drizzle schema 是 `.references(() => agents.id)` 没设 onDelete，物理保留）。
4. `agent_external_sessions` 不删除（同上）。
5. `agent_interactions` 不删除（历史 interaction 记录保留）。
6. `agent_skills` 删除（Drizzle schema 是 `onDelete: 'cascade'`，自动）。
7. `messages.agent_id` 引用保留（无 onDelete action 的 dangling FK）；前端按 `agent=null` 显示"已删除 Agent"。
8. **`conversation_agents.agent_id` 引用保留**（schema `.references(() => agents.id)` 无 onDelete action）；V3.6 决策：把 `conversation_agents.agent_id` 保留原值（dangle），但**在 roster 序列化时**（`getConversationRoster`）按"agent 行已删"返回 `{ isSystem: false, avatarKind: 'system', avatarValue: '__deleted__', capabilities: null, displayName: '已删除 Agent' }`。`__deleted__` 走 `AgentAvatar` 降级到 🤖。**不**触发 DB 写。
9. `DELETE FROM agents WHERE id = ?`。
10. 返回 `{ ok: true, agentId, cascadedRoster: 0, cancelledRuns: 0 }`（本阶段 cascadedRoster/cancelledRuns 恒为 0；预留字段为 V3.7+ 软删除留口子）。

错误：

| 情况 | HTTP | 错误体 |
| --- | --- | --- |
| agent 不存在 | 404 | `{ error: "Agent 不存在" }` |
| agent 是 system | 403 | `{ error: "内置 Agent 不可删除" }` |
| active runs 存在 | 409 | `{ error: "还有 N 个未完成 run，请先取消或等待", activeRunCount: N }` |

### 4.6 `POST /api/agents/:id/regenerate-profile`

请求：路径参数 `id`，body `RegenerateProfileRequest`（§2.4）。

响应：`RegenerateProfileResponse`（§2.4）。

实现位置：`app/api/agents/[id]/regenerate-profile/route.ts`（新）。

逻辑：

1. SELECT agent；不存在 → 404；`is_system=true` → 403。
2. **复用** `lib/skills/agent-creator/prompts.ts:buildPlannerPrompt` 与 `callAnthropicPlanner` / `callOpenAIPlanner`——抽到 `lib/agents/regenerate.ts` 的 `regenerateAgentProfile(agent, instruction, provider)` 函数，**不带 state**。
3. 构造 LLM 输入：用当前 `agent` 字段填 `partialDraft`；`history` 留空；`userInput` = `instruction ?? "请基于当前字段重新生成"`；`missingFields` = `computeMissingFields(partialDraft)`（V3.2 state.ts 已有，纯函数；不影响 session 状态）。
4. 调 LLM；`agentDraftPartialSchema.safeParse(draft_patch)` 校验。
5. 解析失败 → 500 + 错误。
6. 成功 → 返回 `{ draft, summary, warnings }`。**不落库**。

错误：

| 情况 | HTTP | 错误体 |
| --- | --- | --- |
| agent 不存在 | 404 | `{ error: "Agent 不存在" }` |
| agent 是 system | 403 | `{ error: "内置 Agent 不可重新生成 profile" }` |
| Zod 校验失败 | 500 | `{ error: 'LLM 输出 schema 不匹配' }` |
| Provider 未配置 | 500 | `{ error: "未配置 Planner Provider" }` |
| LLM 调用失败 | 500 | `{ error: 'Planner API error ...' }` |

### 4.7 `GET /api/agents/:id/avatar`

请求：路径参数 `id`（自建 Agent）；query 可选 `?v=<updatedAt>`（V3.6 暂不接，由浏览器 `Cache-Control` 兜底）。

响应：图片字节流（`image/png` / `image/jpeg` / `image/webp` / `image/gif`），`Content-Type` 与扩展名一致。

实现位置：`app/api/agents/[id]/avatar/route.ts`（新）。

逻辑：

1. SELECT agent；不存在 → 404；`is_system=true` → 403；`avatar_kind !== 'uploaded'` → 400。
2. 读 `agents.avatar_value`（绝对路径），校验：
   - 必须是 `C:\...` 或 `/...` 绝对路径
   - `fs.existsSync(path)` → 否则 404
   - `fs.statSync(path).isFile()` → 否则 400
   - 扩展名必须在白名单（`png / jpg / jpeg / webp / gif / svg`）
   - **安全**：路径必须在 `process.cwd()` 或 `os.homedir()` 子树下（避免用户上传后改路径指向 `/etc/passwd`）。具体规则：
     - Windows：`path.resolve(avatar_value)` 必须以 `path.resolve(process.cwd())` 或 `path.resolve(os.homedir())` 开头
     - POSIX：同上
3. 读取文件 → `NextResponse` 字节流 + `Content-Type` + `Cache-Control: private, max-age=3600`（不同 updatedAt 自动失效，浏览器会重发条件请求）。

错误：

| 情况 | HTTP | 错误体 |
| --- | --- | --- |
| agent 不存在 | 404 | `{ error: "Agent 不存在" }` |
| agent 是 system | 403 | `{ error: "内置 Agent 无上传头像" }` |
| avatarKind 不是 uploaded | 400 | `{ error: "Agent 头像非上传类型" }` |
| 路径不合法（不在白名单目录） | 400 | `{ error: "avatar 路径不在允许范围内" }` |
| 文件不存在 | 404 | `{ error: "avatar 文件不存在" }` |
| 文件过大（> 1MB） | 413 | `{ error: "avatar 文件超过 1MB 限制" }` |

> **不上传 bytes 到服务端**：与 V1.5 附件模型一致——`avatar_value` 存的是本地绝对路径，浏览器通过这个 endpoint 流式获取。文件选择复用 `app/api/attachments/select/route.ts` 的 `imageOnly: true` 模式（V3.6 复用，**不**新建选择器）。

### 4.8 SSE 事件

| 事件 | payload | 触发方 | 消费方 |
| --- | --- | --- | --- |
| `agent_updated` | `{ agentId: string, agent: AgentSummary }` | PATCH 成功后 | 当前 Modal 内 + 其他打开同一 Modal 的客户端（不广播给 message stream） |
| `agent_deleted` | `{ agentId: string }` | DELETE 成功后 | Modal 内 + roster 渲染（V3.5 `RosterItem` 走 `getConversationRoster` 服务端实时降级，不需前端手动 invalidate） |

`agent_updated` / `agent_deleted` **不走** `lib/conversations/stream-bus:publishConversationEvent`（V1 已有，只跟 conversation 绑定）；V3.6 新增 `lib/agents/stream-bus.ts`（新）持 `globalThis` 单例 + `EventEmitter`，只被 SettingsModal 与 AppShell 订阅。

## 5. UI 组件 props（C0-4）

### 5.1 入口位置

保留 SettingsModal 的 "自建 Agent" Tab。**不**做侧栏分组或独立路由。Tab 标题沿用 "自建 Agent"（与 V3 计划 §三 G9 一致）。

### 5.2 `CustomAgentsPanel`（重写 V1 占位）

`components/settings/SettingsModal.tsx:543-562` 整个 `CustomAgentsPanel` 函数体重写为下面 `5.3` + `5.4` + `5.5` 的容器。

```ts
function CustomAgentsPanel(): JSX.Element;
```

内部 state：

```ts
type PanelState =
  | { mode: "list" }
  | { mode: "edit"; agentId: string; sub: EditSubState };

type EditSubState =
  | { kind: "preview"; data: AgentSummary; precheck: AgentDeletePrecheck | null }
  | { kind: "editing"; data: AgentSummary; draft: AgentFormDraft; fieldErrors: Partial<Record<keyof AgentFormDraft, string>> }
  | { kind: "saving"; data: AgentSummary; draft: AgentFormDraft }
  | { kind: "saving-error"; data: AgentSummary; draft: AgentFormDraft; error: string }
  | { kind: "regenerating"; data: AgentSummary; instruction: string }
  | { kind: "regen-error"; data: AgentSummary; instruction: string; error: string }
  | { kind: "delete-confirm"; data: AgentSummary; precheck: AgentDeletePrecheck }
  | { kind: "deleting"; data: AgentSummary }
  | { kind: "delete-error"; data: AgentSummary; error: string };
```

加载流程：

1. 进入 Tab → `GET /api/agents/self-built` → 渲染列表。
2. 点击行 → `GET /api/agents/:id` → 进入 `edit.preview`。
3. 离开 Tab 不卸载 state（Modal 关闭才清空）；Tab 切换回到 `custom` 时复用上次 list 数据 + 重新拉一次后台刷新。

### 5.3 `AgentListPanel`（新组件）

`components/settings/custom-agents/AgentListPanel.tsx`（新）：

```ts
type AgentListPanelProps = {
  agents: Array<AvailableAgentSummary & { lastRun: AgentListItem["lastRun"]; systemPromptSummary: string; createdAt: number; updatedAt: number }>;
  onSelect: (agentId: string) => void;
  isLoading: boolean;
  error: string | null;
};
```

布局：

```
┌─────────────────────────────────────────────────┐
│ 自建 Agent                                       │
│ 共 N 个 · 在单聊用 /agent-creator 创建新的。       │
├─────────────────────────────────────────────────┤
│ [🤖]  React 助手           @react-helper         │
│       代码修改 / 文档更新 / 测试补充     [活跃]  │
│       最后运行：2 小时前 · 群聊 PRD Reviewer  ←   │
├─────────────────────────────────────────────────┤
│ [📄]  Doc Reviewer         @doc-reviewer         │
│       只读审查 / 文档问答 / 引用路径     [空闲]  │
│       最后运行：从未                                │
├─────────────────────────────────────────────────┤
│ ... 空态：                                       │
│   还没有自建 Agent。                              │
│   在单聊里调 /agent-creator 创建一个。             │
└─────────────────────────────────────────────────┘
```

行交互：

- 点击行任意位置 → `onSelect(agentId)`
- 行右侧"最后运行"链接 → 跳到对应 conversation（暂只展示文字 `最后运行：2 小时前 · 群聊 <title>`，点击行为 V3.6 留 TODO；不做 `useRouter().push`）

空态：V3 计划 §三 V3.6 验收 1 描述的引导文案。

### 5.4 `AgentDetailPanel`（新组件）

`components/settings/custom-agents/AgentDetailPanel.tsx`（新）：

```ts
type AgentDetailPanelProps = {
  data: AgentSummary;
  precheck: AgentDeletePrecheck | null;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onClose: () => void;
};
```

布局（preview 状态）：

```
┌─────────────────────────────────────────────────┐
│ ← 返回列表                                        │
│                                                  │
│ [🤖]  React 助手                                 │
│       @react-helper · 平台: claude_code            │
│                                                  │
│ ┌──────── 描述 ────────┐                          │
│ │ 负责 React 组件改造与测试补充。                  │  │
│ └──────────────────────────────────────────────┘  │
│                                                  │
│ ┌──────── System Prompt (前 8000 字符) ────────┐  │
│ │ 你是 React 组件专家。优先给出可直接应用的 UI  │  │
│ │ 代码修改。...                                  │  │
│ │                              [展开 / 收起]    │  │
│ └──────────────────────────────────────────────┘  │
│                                                  │
│ 权限：readonly · 工具 profile：code-author        │
│ 能力：[代码修改] [测试补充] [文档更新] [验证说明]  │
│ 头像：🤖                                         │
│                                                  │
│ 仍在 N 个群聊的 roster 中（删除会清掉）            │
│                                                  │
│ [重新生成 profile]  [编辑]                       │
│                                                  │
│ ──────────────                                   │
│                                                  │
│ 删除（不可恢复）                                  │
│ 删除该 Agent 会清掉其全部 roster 引用。           │
│ [🗑 删除自建 Agent]  ← precheck 失败时置灰        │
│                                                  │
│ [关闭面板]                                       │
└─────────────────────────────────────────────────┘
```

- System Prompt 默认显示前 6 行；点 [展开] 显示全部，scroll 内部。
- 重新生成按钮在 profile=executor 时不变（预览卡红 + 高危已 V3.2 收口）；本阶段 regen 复用 V3.2 prompts 即可。
- 删除按钮 `disabled` 状态 + tooltip 来自 `precheck.activeRuns`。

### 5.5 `AgentEditPanel`（新组件）

`components/settings/custom-agents/AgentEditPanel.tsx`（新）：

```ts
type AgentEditPanelProps = {
  data: AgentSummary;
  draft: AgentFormDraft;
  fieldErrors: Partial<Record<keyof AgentFormDraft, string>>;
  onChange: (patch: Partial<AgentFormDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onAvatarPick: () => Promise<{ kind: "emoji" | "uploaded"; value: string } | null>;
};

type AgentFormDraft = {
  name: string;
  alias: string;
  description: string;
  systemPrompt: string;
  permissionMode: "readonly" | "editable";
  toolProfile: "readonly" | "code-author" | "executor";
  capabilities: string[];          // 已用 capabilitiesSchema 解析
  avatarKind: "system" | "emoji" | "uploaded";
  avatarValue: string;
};
```

布局（editing 状态）：

```
┌─────────────────────────────────────────────────┐
│ ← 取消编辑                                       │
│                                                  │
│ [🤖]  [更换头像]                                 │
│       当前: emoji 🤖                            │
│                                                  │
│ 名称 *                                           │
│ ┌────────────────────────────────────────────┐   │
│ │ React 助手                                  │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ Alias * (@mention 名字，单聊/群聊用)              │
│ ┌────────────────────────────────────────────┐   │
│ │ react-helper                                │   │
│ └────────────────────────────────────────────┘   │
│ ⚠️ alias 改名只影响新建 @ 提及；                  │
│    历史 conversation_agents 行的 alias 保留。     │
│                                                  │
│ 描述 *                                           │
│ ┌────────────────────────────────────────────┐   │
│ │ 负责 React 组件改造与测试补充。              │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ System Prompt * (8000 字符上限)                  │
│ ┌────────────────────────────────────────────┐   │
│ │ 你是 React 组件专家。...                     │   │
│ │                                       ...   │   │
│ │                                  120 / 8000  │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ 权限： [readonly ▼]  工具 profile： [code-author ▼] │
│                                                  │
│ 能力标签（≤ 8 个，每项 ≤ 24 字符）                 │
│ [代码修改 ×] [测试补充 ×] [文档更新 ×] ...        │
│ ┌────────────────────────────────────────────┐   │
│ │ 输入新标签...                                 │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ 重新生成 profile（LLM 用当前字段 + 可选说明）     │
│ ┌────────────────────────────────────────────┐   │
│ │ （可选）让 LLM 重新分析：...                   │   │
│ └────────────────────────────────────────────┘   │
│ [🔄 重新生成]  ← regenerating 时置灰显示 spinner  │
│                                                  │
│                                                  │
│ [取消]                          [保存]            │
└─────────────────────────────────────────────────┘
```

表单字段约束（前端预校验，后端 Zod 复核）：

- 名称：1-48 字符
- alias：2-32 字符，`^[a-z][a-z0-9-]*$`
- 描述：1-240 字符
- systemPrompt：1-8000 字符
- capabilities：≤ 8 项，每项 1-24 字符
- avatarKind=system 灰掉不可选
- avatarKind=uploaded 时，[更换头像] 按钮触发 `onAvatarPick` → 调 `/api/attachments/select` 的 `imageOnly=true` 模式 → 返回本地路径后写入 draft

Capability tag 输入：

- 回车 / 逗号提交当前输入
- 点击 tag 右上角 × 删除
- 视觉沿用 V3.5 `.capability-tag` 类
- 超出 8 个或单 tag > 24 字符时禁用提交 + 红色边框

### 5.6 `AgentDeleteConfirm`（新组件）

`components/settings/custom-agents/AgentDeleteConfirm.tsx`（新）：

```ts
type AgentDeleteConfirmProps = {
  data: AgentSummary;
  precheck: AgentDeletePrecheck;
  onConfirm: () => void;
  onCancel: () => void;
};
```

二次确认弹窗内容：

```
┌─────────────────────────────────────────────────┐
│ 删除自建 Agent                                   │
│                                                  │
│ 你即将删除 React 助手（@react-helper）。         │
│                                                  │
│ 该 Agent 仍出现在 N 个群聊的 roster 中：          │
│   · 群聊 <title A>  (3 个成员)                    │
│   · 群聊 <title B>  (1 个成员)                    │
│ 删除后，这些 roster 会显示"已删除 Agent"。        │
│                                                  │
│ 该 Agent 的历史 run / 消息 / interaction 保留。  │
│                                                  │
│ ⚠️ 此操作不可恢复。                              │
│                                                  │
│              [取消]            [确认删除]         │
└─────────────────────────────────────────────────┘
```

> precheck 阶段已经过滤了 activeRuns（删除按钮根本进不到二次确认弹窗），这里不再列。

### 5.7 CSS 新增类（`app/globals.css`）

```css
/* 自建 Agent 列表行 */
.custom-agent-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.custom-agent-row:hover { background: var(--bg-subtle); }
.custom-agent-row .row-meta { color: var(--text-3); font-size: 12px; }

/* 详情面板字段块 */
.detail-section { margin: 16px 0; }
.detail-section h4 { font-size: 12px; color: var(--text-3); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.detail-section pre { background: var(--bg-input); padding: 10px 12px; border-radius: 6px; font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow: auto; }

/* capability tag 编辑器（沿用 V3.5 视觉） */
.capability-tag-editor { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border: 1px solid var(--border-light); border-radius: 6px; background: var(--bg-input); }
.capability-tag-input { flex: 1; min-width: 100px; border: none; background: transparent; outline: none; }
.capability-tag-remove { cursor: pointer; opacity: 0.6; margin-left: 4px; }
.capability-tag-remove:hover { opacity: 1; }

/* 删除按钮置灰 */
.danger-button[disabled] { opacity: 0.5; cursor: not-allowed; }
```

V3.5 视觉验后若 `.capability-tag` / `.capability-tag-editor` 需要微调，再小步改 V3.6 文件（**不**回滚 V3.5）。

## 6. 原型 HTML 范围

`docs/design/prototypes/v3/custom-agent-settings.html`（静态单文件，无构建）。

包含视图：

1. **设置 Modal 弹起 + 左侧导航**：高亮 "自建 Agent" Tab
2. **列表视图**（`AgentListPanel`）：
   - 3 个示例自建 Agent（react-helper / doc-reviewer / v34-real-smoke）
   - 1 个空态示例
3. **详情视图**（`AgentDetailPanel`）：取 react-helper 进入
   - systemPrompt 折叠态
   - precheck 失败态（active runs 存在）：删除按钮置灰 + tooltip
4. **编辑视图**（`AgentEditPanel`）：从详情点"编辑"
   - 4 个 capability tag + 1 个输入框
   - avatar 区显示 🤖 + "更换头像" 按钮
   - profile=executor 时的红色高危样式
5. **删除二次确认弹窗**：覆盖在 Modal 之上
6. **重新生成 LLM 进度态**：`regenerating` 状态下表单灰掉 + 中央 spinner + "LLM 正在重新分析…"

技术约束：

- 复用 V3.5 原型的 CSS 变量（`--primary / --blue / --bg-panel / --bg-subtle / --text-1 / --text-2 / --text-3 / --border-light / --shadow-sm`）
- 静态 mock 数据，**不**接真 API
- 400 行内，可直接浏览器打开

## 7. 文件落点

| 工作 | 文件 | 备注 |
| --- | --- | --- |
| V3.6 共享 schema | `lib/agents/edit-schema.ts`（新） | `agentUpdateSchema` |
| 删除 precheck / regen 业务 | `lib/agents/regenerate.ts`（新） | `regenerateAgentProfile` + `RegenerateProfileRequest/Response` |
| list / detail / patch / delete service | `lib/conversations/service.ts:48-62` 旁加 | `listSelfBuiltAgents` / `getSelfBuiltAgentById` / `updateSelfBuiltAgent` / `precheckDeleteSelfBuiltAgent` / `deleteSelfBuiltAgent` |
| Agent 流式广播 | `lib/agents/stream-bus.ts`（新） | `agentEmitter`（globalThis 单例） + `publishAgentEvent` / `subscribeAgentEvents` |
| `getConversationRoster` 降级 | `lib/conversations/service.ts:924-961` 现有 | 已删 agent → 走"已删除 Agent"分支（§4.5 步骤 8） |
| `GET /api/agents/self-built` | `app/api/agents/self-built/route.ts`（新） | |
| `GET / PATCH / DELETE /api/agents/:id` | `app/api/agents/[id]/route.ts`（新） |  |
| `GET /api/agents/:id/precheck-delete` | `app/api/agents/[id]/precheck-delete/route.ts`（新） | |
| `POST /api/agents/:id/regenerate-profile` | `app/api/agents/[id]/regenerate-profile/route.ts`（新） | |
| `GET /api/agents/:id/avatar` | `app/api/agents/[id]/avatar/route.ts`（新） | 流式 |
| Custom Agents 面板 3 件套 | `components/settings/custom-agents/AgentListPanel.tsx`（新）<br>`components/settings/custom-agents/AgentDetailPanel.tsx`（新）<br>`components/settings/custom-agents/AgentEditPanel.tsx`（新）<br>`components/settings/custom-agents/AgentDeleteConfirm.tsx`（新） | |
| SettingsModal 集成 | `components/settings/SettingsModal.tsx:543-562` | 整个 `CustomAgentsPanel` 函数体重写 |
| CSS 新类 | `app/globals.css` | §5.7 |
| 原型 HTML | `docs/design/prototypes/v3/custom-agent-settings.html`（新） | |

## 8. 验收标准

**API 验收**：

- `GET /api/agents/self-built` 返回列表只含 `is_system=0` 的 Agent，按 `updated_at DESC` 排序，含 `lastRun` / `systemPromptSummary` 字段；空表返回 `{ agents: [] }`。
- `GET /api/agents/:id` 404 / 403 行为正确；system Agent 返回 403。
- `GET /api/agents/:id/precheck-delete` 准确反映 activeRuns + conversationUsage；`canDelete=false` 时列表里 `activeRuns` 长度 = 0 时仍可删除（边界）。
- `PATCH /api/agents/:id`：每个字段单独改 / 批量改都通；alias 冲突返回 409；avatarKind=system 拒绝；`avatarKind=uploaded` 路径不存在返回 400。
- `DELETE /api/agents/:id`：active runs 存在时 409；删除后 `getConversationRoster` 旧 conversation 显示"已删除 Agent"（🤖 占位），历史 message / run 保留。
- `POST /api/agents/:id/regenerate-profile`：调用后返回的 `draft` 满足 `agentDraftPartialSchema`；不落库。
- `GET /api/agents/:id/avatar`：返回正确 Content-Type；路径不在白名单目录返回 400；文件超 1MB 返回 413。

**UI 验收**：

- 设置页"自建 Agent" Tab 列表正确展示（`docs/state/TOFIX.md` 留的"占位 React 助手"已替换为真实列表）。
- 点击列表行进入详情，详情显示完整 `AgentSummary` 字段。
- 详情点"编辑"进入编辑面板，4 个 capability tag 可增删；avatarKind=emoji / uploaded 切换可工作；profile=executor 时 profile 下拉选项变红（视觉对齐 V3.2）。
- 详情点"删除"：precheck 通过则弹二次确认；precheck 不通过则按钮置灰 + tooltip。
- 二次确认弹窗列出该 Agent 所在群聊的 title 列表。
- 重新生成 profile 按钮触发 LLM 调用，spinner → 自动跳到编辑面板预填 draft。

**集成验收**：

- 编辑 systemPrompt 后保存，**新建群聊** @ 该 Agent 走 SDK run → 回复内容反映新 systemPrompt。
- 重新生成 profile 后用户在编辑面板点"保存"才落库；不点保存则旧值保留。
- `avatarKind=uploaded` 真实生效：浏览器打开 `http://localhost:3000` 群聊右栏 → 自建 Agent 卡片显示真实图片（不再降级 🤖）。
- `avatarKind=uploaded` 删除自建 Agent 后再访问 `/api/agents/:id/avatar` 返回 404。
- 内置 system Agent 不出现在设置页列表（`is_system=1` 过滤）。
- `npm run typecheck` / `npm run build` / `git diff --check` 通过。

**已知边界**（V3.6 不修）：

- 重新生成 profile 时，若 LLM 输出缺关键字段（如 `tool_profile` 没返回），前端保留原值（patch 浅合并）。`computeMissingFields` 仅在引导流程使用。
- 重新生成 profile 不更新 `avatar` 字段（LLM 不调头像选择器）。
- alias 改名不重写历史 `conversation_agents.alias` 行；旧群聊按 roster 仍走旧 alias @ 提及（保留同 session 内 alias 唯一性约束）。
- `lastRun` 链接到对应 conversation 的"跳到该会话"功能 V3.6 留 TODO（仅文字展示）。
- 删除自建 Agent 不级联删除 `agent_runs` / `agent_external_sessions` / `agent_interactions` / `messages.agent_id`（dangle FK，前端降级显示）。

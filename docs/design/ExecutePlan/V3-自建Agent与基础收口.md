# V3 自建 Agent、Skill 与基础收口

> **状态**：计划草稿（待评审）
> **基线**：2026-06-07
> **范围**：V2.6 搜索会话收口 + V3 自建 Agent / Skill / 斜杠命令 / 群聊接入 / 联系人差异化
> **前置**：V2.5（6-6 群聊多实例隔离）已验收；当前 `ORCHESTRATOR_*` Provider 可用（MiniMax-M3）

---

## 背景

V2 把群聊、Orchestrator、Provider 落地后，平台缺两类"用户可配置的能力"：

1. **自建 Agent** —— 当前 `agents` 表只承载系统预置（Claude Code / Codex / OpenCode / Hermes）。要求文档 `§3` 明确"支持用户自建 Agent（对话式创建，设定 System Prompt + 工具集）"。
2. **Skill（斜杠命令）** —— 当前 Composer 不识别 `/` 开头命令，所有"建 Agent / 建 Skill"流程都没有载体。
3. **V2 漏项** —— `ConversationSidebar` 的搜索框未接 `onChange`，V2 验收时未实际可用。

`roadmap.md` V3 段已写明总目标（自建 Agent + Skill + Diff/部署 P2）；本计划在该方向上落地为可分阶段交付的 Phase，并补充数据模型与 UI 决策。

**技术选型**：自建 Agent（`platform=claude_code`）走 `@anthropic-ai/claude-agent-sdk`（`query()` + `options`），per-run `env` 注入 Provider 配置；详见 `docs/memo/2026-05-23-1600-custom-agent-tech-choice.md`。本计划不再讨论 SDK vs CLI 的取舍，直接沿用该决策。

---

## 一、总体目标

| # | 目标 | 验收锚点 |
|---|------|----------|
| G1 | 单聊中 `/agent-creator` 走**引导对话**创建一个自建 Agent | 用户用自然语言描述需求，LLM 自动抽取结构化字段 + 选定工具 profile；预览卡片确认后 `agents` 多一条 `is_system=0` 行 |
| G2 | 单聊中 `/skill-creator` 走多轮对话创建一个 Skill；支持上传 markdown / yaml 文件作为 Skill 模板 | `skills` 表新增一条；该 Skill 出现在 `/agent-creator` 的"引用 Skill"步骤中 |
| G3 | 自建 Agent 可被加入群聊并被 @ 指派任务 | 群聊中 `@<自建alias>` 走 orchestrator 调度并正常回复（基于 system_prompt + tool_profile） |
| G4 | 自建 Agent 在群聊 UI 中显示头像 + displayName；**能力标签不显示在群聊消息流**（避免臃肿） | `RosterItem` 类型仍带 `capabilities` 字段，但消息流气泡不渲染；能力 tag 仅在"选择 Agent"/"自定义 Agent 设置页"等管理 UI 展示 |
| G5 | 系统 Agent（`@claude-code` 等）在群聊 UI 中不出现"编辑头像 / 编辑标签"按钮 | 差异化渲染逻辑 |
| G6 | 自建 Agent 单聊不开放 | 新建单聊的可选 Agent 列表中不出现自建 Agent |
| G7 | 侧边栏搜索可用，按标题/最近消息内容模糊匹配 | `GET /api/conversations?q=...` 过滤；UI 触发 `onChange` 实时过滤 |
| G8 | **工具 profile 自动选择**（关键设计）：用户不直接选具体工具 | LLM 抽取时从 3–4 档 profile 中选一档；用户可在预览卡换档或在"自定义 Agent"设置页改 |
| G9 | **自定义 Agent 设置页**：列表 / 编辑 / 重新生成 profile / **删除** 自建 Agent | SettingsModal 的"自建 Agent" Tab 从静态占位做实；`PATCH /api/agents/:id`、`DELETE /api/agents/:id` 走通 |

---

## 二、与已有规划的关系

| 来源 | 内容 | 本计划处理 |
|------|------|------------|
| `roadmap.md` V3 段（122–139 行） | `/agent-creator`、`/skill-creator`、`SkillRunner`、自建 Agent 走 SDK + anthropic 协议、Diff/部署 P2 择项 | 全部采纳；本计划把 `/skill-creator` 拆为"内建 Skill + 上传 Skill"两路径 |
| `docs/memo/2026-05-23-1600-custom-agent-tech-choice.md` | SDK 选型、内置/自建 API 来源分离、Provider 协议限制 | 直接沿用 |
| `docs/design/要求.md` §3 | 用户自建 Agent（System Prompt + 工具集）、联系人头像/名称/能力标签 | 全部采纳 |
| V2 验收 | 搜索会话未真正可用 | 归入 V2.6 收口 |

---

## 三、范围（V2.6 + V3.0 ~ V3.3）

### V2.6 · 搜索会话收口（必须先做，工作量小）

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| F1 | P0 | `GET /api/conversations` 接受 `q` 参数，按 `conversations.title` 模糊匹配（SQLite `LIKE`） | `app/api/conversations/route.ts` |
| F2 | P0 | `ConversationSidebar` 搜索框 `input` 加 `onChange` 与受控 `searchTerm` state；过滤 `conversations` 列表 | `components/shell/ConversationSidebar.tsx:79-83` |
| F3 | P1 | 搜索框右侧加 `×` 清空按钮；空态显示"无匹配会话" | 同上 |
| F4 | P1 | `Cmd+K`（mac）/ `Ctrl+K`（win）快捷键 focus 到搜索框 | `app/globals.css` 或全局 keydown listener |

### V3.0 · 数据模型

**`agents` 表扩展**（Drizzle + SQLite migration，幂等 `ALTER TABLE`）：

| 新增列 | 类型 | 说明 |
|--------|------|------|
| `is_system` | INTEGER NOT NULL DEFAULT 1 | 1=系统预置，0=用户自建 |
| `system_prompt` | TEXT NOT NULL DEFAULT '' | **新增**：写给 Agent 的系统提示词（与 `description` 区分：description 展示给用户看，system_prompt 注入 SDK 运行时）。系统 Agent 留空 |
| `capabilities` | TEXT | JSON 数组（`["代码审查","文档撰写"]`），系统 Agent 为 NULL |
| `avatar_kind` | TEXT | `system` / `emoji` / `uploaded`；系统 Agent 为 `system` |
| `avatar_value` | TEXT | `system` 存 slug；`emoji` 存 emoji 字符；`uploaded` 存附件 id（引用 `message_attachments`） |
| `permission_mode` | TEXT NOT NULL DEFAULT 'readonly' | `readonly` / `editable`；仅自建 Agent 可调 |
| `tool_profile` | TEXT | 预定义工具 profile 名（`readonly` / `code-author` / `executor` 等），由 `/agent-creator` 自动选定；具体 profile 定义待 SDK 调研完成（§六 Q1） |

**`skills` 表新建**：

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | TEXT PK | uuid |
| `slug` | TEXT NOT NULL UNIQUE | 命令名（`agent-creator` / `skill-creator` / 用户自定义） |
| `name` | TEXT NOT NULL | 显示名 |
| `description` | TEXT NOT NULL | 一句话描述 |
| `body` | TEXT NOT NULL | Skill 主体（system prompt / instructions） |
| `kind` | TEXT NOT NULL | `built-in` / `user` |
| `version` | INTEGER NOT NULL DEFAULT 1 | 乐观锁；更新自增 |
| `source_attachment_id` | TEXT | 引用 `message_attachments.id`；上传 Skill 时填 |
| `created_at` / `updated_at` | INTEGER | |

**`agent_skills` 关联表新建**（自建 Agent 引用 Skill）：

| 列 | 类型 | 说明 |
|----|------|------|
| `agent_id` | TEXT NOT NULL REFERENCES `agents(id)` | |
| `skill_id` | TEXT NOT NULL REFERENCES `skills(id)` | |
| `created_at` | INTEGER | |
| | UNIQUE(`agent_id`, `skill_id`) | |

**`messages` 表**（V3 复用 V1.5 `orchestrator_task_id`，不新增字段）。

### V3.1 · 斜杠命令系统 + SkillRunner

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| S1 | P0 | `Composer` 检测 `/` 开头消息，弹出命令面板（下拉列表展示已注册 Skill 的 `slug` + 描述） | `components/chat/Composer.tsx` |
| S2 | P0 | 新建 `lib/skills/runner.ts`：负责按 `slug` 解析消息内容、注入 Skill 上下文、调起对应执行器（`AgentCreator` / `SkillCreator`） | `lib/skills/runner.ts`（新） |
| S3 | P0 | 斜杠命令仅在**单聊**生效；群聊中 `/xxx` 当作普通文本发送（避免误触发 orchestrator 派发） | `app/api/messages/route.ts` 入口判断 |
| S4 | P1 | 命令面板支持键盘上下选择 + Enter 确认 + Esc 关闭 | `Composer.tsx` |
| S5 | P1 | **Skill 注册表 + 自动识别**：`lib/skills/registry.ts` 同时承载**内建 Skill**（`agent-creator` / `skill-creator`，代码静态注册）和**用户自定义 Skill**（从 `skills` 表加载，`kind='user'`）。`Composer` 输入 `/` 时面板按 slug 模糊匹配，**用户自定义 Skill 自动出现在面板中**（与系统 Skill 无视觉差异）。新建 Skill 后 `registry` 失效缓存，UI 立即可见 | `lib/skills/registry.ts`（新） |

### V3.2 · /agent-creator（**AskUserQuestion 风格主动引导** + 自动 profile 选择）

**整体流程**：用户调起 → 进入"引导提问"模式 → Planner LLM **每轮主动判断**信息是否充足：

- 信息不足 → emit `{ next_question: { question, options, multiSelect } }`，前端渲染为 **Choice 卡**（复用 V1.5 `InteractionChoiceCard`）
- 信息充足 → emit `{ info_sufficient: true, draft: { ... } }`，前端弹"开始创建"确认 Choice 卡
- 用户确认 → 预览卡片 → 落库

> **设计原则**：
> 1. 用户**不直接选择具体工具**（颗粒度太细、对非专业用户不友好）。LLM 映射到预定义 profile。
> 2. **不**让用户被动触发"差不多了"或"开始创建"——**LLM 主动判断**信息是否充足，足够时主动弹确认。
> 3. **不**用纯对话收集信息——用 AskUserQuestion 风格的 Choice 卡，让用户可以**选选项 / 自由输入**两路并行（与 Claude Agent SDK 的 `AskUserQuestion` 工具体验一致）。
> 4. 复用 V1.5 已有的 `InteractionChoiceCard` 组件，不另起炉灶。

**Planner LLM 响应 schema**（A2 / A3 共用）：

```json
{
  "next_question": null | {
    "header": "≤12 字短标题",
    "question": "完整问题",
    "options": [
      { "label": "选项 1", "description": "说明" },
      { "label": "选项 2", "description": "说明" }
    ],
    "multi_select": false
  },
  "info_sufficient": false,
  "draft": null | {
    "name": "...",
    "alias": "...",
    "display_name": "...",
    "system_prompt": "...",
    "permission_mode": "readonly|editable",
    "capabilities": ["...", "..."],
    "tool_profile": "readonly|code-author|executor"
  }
}
```

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| A1 | P0 | 状态机：`idle` → `collecting`（Choice 提问循环）→ `confirm_build`（信息充足确认）→ `preview`（待确认）→ `saving` → `done` / `cancelled` | `lib/skills/agent-creator/state.ts`（新） |
| A2 | P0 | **引导 prompt + 主动判断**：Planner LLM 用 system prompt 定义"我是 Conflux 的 Agent 配置助手，主动向用户提 2–5 个关键问题（使用场景 / 典型任务 / 是否需要写代码 / 是否需要执行命令 / 能力标签）；每轮响应按上面 schema 返回 JSON；每轮 LLM 自评 `info_sufficient`，足够时**主动**返回 `info_sufficient=true` 而不强制等用户说"差不多了" | `lib/skills/agent-creator/prompts.ts`（新） |
| A3 | P0 | **抽取合并入 A2**：原"一次性 LLM 抽取"逻辑废除。`draft` 字段在 A2 同一轮响应中返回，**LLM 在每轮都维护 draft 的最新版本**（不是最后一刻才生成）。这样 `info_sufficient=true` 触发后无需再调一次 LLM，draft 已是最新 | 同上 |
| A4 | P0 | 预览卡片：消息流中插入"配置预览"卡片，展示所有字段 + 头像 + 选定的 tool_profile + system_prompt 摘要；含"保存"/"再改一下"/"取消"三个操作 | 新组件 `AgentCreatorPreviewCard` |
| A5 | P0 | 保存：用户点"保存"后插入 `agents` 行（`is_system=0`），state 置 `done` | `lib/skills/agent-creator/state.ts` |
| A6 | P0 | `/cancel` 终止：任何一轮用户输入 `/cancel` 终止流程，state 置 `cancelled`，清理中间抽取结果 | 同上 |
| A7 | P1 | alias 唯一性校验：与现有系统 Agent / 自建 Agent 的 `slug` 不能冲突；冲突时引导用户换一个（用 Choice 卡） | 同上 |
| A8 | P1 | avatar 流程：用户在预览前可选 emoji（首版 16 个）或**上传图片**（复用 V1 `/api/attachments/select`，落 `message_attachments`） | `components/agents/AgentIcon.tsx` + 新组件 `AgentAvatarPicker` |
| A9 | P1 | 状态机持久化策略：默认**全内存**（不写 DB，刷新即丢——可接受）；若用户要求"刷新可恢复"，后续升级为 `agent_creator_sessions` 临时表 | 文档说明，代码侧留扩展点 |
| **A10** | **P0** | **Choice 卡承载 AskUserQuestion**：后端把 Planner LLM 返回的 `next_question` 渲染为 V1.5 已有的 `InteractionChoiceCard`（`choice` kind）。用户的选项/输入通过 `agent_interactions.respond` API 回写。`info_sufficient=true` 时弹"开始创建"确认卡（也是一种 Choice 卡，2 个选项：开始 / 再聊聊） | `lib/skills/agent-creator/runner.ts`（新）、`components/chat/MessageBubble.tsx`（已支持 Choice 卡，无需改） |
| A11 | P1 | 抽不到 draft 字段时 fallback：LLM 返回的 `draft` 缺字段时，按缺哪补哪再调一轮 LLM（不重新走整个流程） | `lib/skills/agent-creator/state.ts` |

**单聊限制**：A1–A11 全部在单聊执行；流程开始时校验 `conversation.mode === 'single'`，若否，提示"请在单聊中使用 /agent-creator"。

**与 V1.5 交互的桥接**：在 `agent_creator_sessions` 状态中维护 `current_interaction_id`；调起 Choice 卡时插入 `agent_interactions` 行（`conversation_id`, `kind='choice'`, `payload_json = next_question`，`agent_id` 写一个特殊占位如 `__creator__`，避免污染 agent 列表）。前端已有 SSE / interaction_requested 事件无需改。

### V3.2 · 工具 profile 自动选择（关键子模块）

**用户描述需求 → LLM 抽取 → 映射到预定义 profile**，用户**不直接选**具体工具。

> 调研已完成（见 `docs/memo/2026-06-07-claude-sdk-toolset-research.md`）。SDK 提供的 `permissionMode` 语义清晰：`'plan'` 天然对应 readonly、`'acceptEdits'` 天然对应 code-author、`'bypassPermissions'` 对应 executor。**profile 名是 Conflux 概念**，与 SDK option 映射写在 `lib/skills/agent-creator/profiles.ts`，未来 SDK 升级只改映射表。

**已定档位与映射**：

| V3 profile | `permissionMode` | `allowedTools` | `disallowedTools` | 说明 |
|------------|------------------|----------------|-------------------|------|
| `readonly` | `'plan'` | `['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'AskUserQuestion']` | `['Write', 'Edit', 'Bash']` | 只读审查/搜索，可向用户提问（`plan` 模式自带只读约束，`disallowedTools` 双保险） |
| `code-author` | `'acceptEdits'` | `['Read', 'Glob', 'Grep', 'Edit', 'Write', 'AskUserQuestion']` | `['Bash(rm -rf *)', 'Bash(sudo *)']` | 读 + 改写文件，自动批准 Edit/Write；禁高危命令 |
| `executor` | `'bypassPermissions'` | （全开） | `['Bash(rm -rf /)', 'Bash(sudo *)']` | 全权限；需 `allowDangerouslySkipPermissions: true`；**创建时二次确认** |
| `custom` | — | — | — | V3 暂不开放，留 V3.4 |

> ⚠️ **关键安全项**：所有自建 Agent run 启动时**必须**设 `settingSources: []`，避免加载 `cwd/.claude/` 与 `~/.claude/` 污染（system_prompt、Memory、Hooks）。详见调研 memo §TL;DR.5 / §Open questions O5。

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| P1 | P0 | 实现上面映射表（写 `readonly` / `code-author` / `executor` 三档），返回 `(permissionMode, allowedTools, disallowedTools, allowDangerouslySkipPermissions)` 元组 | `lib/skills/agent-creator/profiles.ts`（新） |
| P2 | P0 | LLM 抽取 prompt 中明确告知"工具权限分档"，让模型从三档里挑一档；输出 `tool_profile` 字段 | `lib/skills/agent-creator/prompts.ts` |
| P3 | P0 | `executor` profile 在预览卡片上标红 + "⚠️ 高危" + 二次确认按钮（用户必须勾"我了解风险"才能保存） | `AgentCreatorPreviewCard` |
| P4 | P1 | 抽取后展示给用户："我打算给这个 Agent 的工具权限是 `{profile}`（说明：…）"；用户不满意可在预览卡上选"换一档" | `AgentCreatorPreviewCard` |
| P5 | P1 | 自建 Agent run 启动时统一注入 `settingSources: []` + `cwd = conversation.workspacePath` + `maxTurns = 50` + `includePartialMessages = true`（Q7 决策：打字机效果） | `lib/adapters/claude-code-sdk.ts` |

### V3.2 · /skill-creator

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| K1 | P0 | 状态机：收集 name / description / body（system prompt / instructions）→ 预览 → 保存 | `lib/skills/skill-creator/state.ts`（新） |
| K2 | P0 | **支持上传 Skill**：用户在配置流程中可选择"上传一个 markdown / yaml 文件"作为 `body`；走 V1 已有的 `/api/attachments/select` 选本地文件，落 `message_attachments`，`skills.source_attachment_id` 引用 | 复用 V1 附件 |
| K3 | P0 | slug 唯一性校验 + 命名规范（小写字母 + 短横线） | 同上 |
| K4 | P1 | Skill 创建后立即在命令面板中可见（缓存 + 失效策略：创建后 5s 内出现，DB 写完即刷新） | `lib/skills/registry.ts` |
| K5 | P2 | Skill 版本号自动 +1；历史版本回看（V3.4 P2） | — |

### V3.3 · 自建 Agent 接入 + 群聊 UI + 自定义 Agent 设置页

**自建 Agent 接入**：

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| C1 | P0 | 新增 `ClaudeCodeAgentSDKAdapter`（与现有 `ClaudeCodeAdapter` 并存）；`agents.platform='claude_code'` 且 `is_system=0` 时使用 | `lib/adapters/claude-code-sdk.ts`（新） |
| C2 | P0 | 启动 run 时从该 Agent 关联的 Provider 读取 `protocol`；**非 `anthropic` 协议**直接拒绝并提示"自建 Claude Code Agent 须绑定 Anthropic 兼容 Provider" | `lib/conversations/runs.ts` |
| C3 | P0 | 透传 `system_prompt`、`model` 到 SDK options；`tool_profile` 通过 `lib/skills/agent-creator/profiles.ts` 映射表转成 `permissionMode` / `allowedTools` / `disallowedTools`（见 V3.2 P1）。`env` 注入 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`；`settingSources: []` 必设；`cwd = conversation.workspacePath`；`maxTurns = 50`；`includePartialMessages = true`（Q7 决策：打字机效果） | `lib/adapters/claude-code-sdk.ts`、`lib/skills/agent-creator/profiles.ts` |
| C4 | P1 | 内置 `@claude-code`（`is_system=1`）行为**不变**：不读自建 Agent 的 Provider 配置，走 V1 现有 `ClaudeCodeAdapter` | 路由层在 `runs.ts` 区分 |

**群聊 UI 接入**：

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| C5 | P0 | `RosterItem` 类型扩展 `avatarKind` / `avatarValue` / `capabilities` 字段 | `lib/conversations/types.ts:54-60` |
| C6 | P0 | `GET /api/conversations/:id/roster` 返回时携带自建 Agent 的展示字段 | `app/api/conversations/[conversationId]/roster/route.ts` |
| C7 | P0 | 群聊"选择 Agent"候选列表：拉取"系统 + 启用且 `is_system=0` 的 Agent"；自建 Agent 显示头像 + displayName（**此管理 UI 可显示 capability tag**） | `components/shell/ConversationSetup.tsx` 或对应组件 |
| C8 | P0 | `GroupContext` 卡片与消息流气泡应用新视觉（自建 vs 系统）；**消息流气泡不显示 capability tag** | `components/context/ContextPanel.tsx`、`MessageBubble.tsx` |
| C9 | P1 | **单聊不接入自建 Agent**：`POST /api/conversations`（单聊模式）的可选 Agent 列表过滤 `is_system=1` | `app/api/conversations/route.ts` |

**联系人差异化（系统 vs 自建）**：

- 系统 Agent：`<AgentIcon agent=slug>` + `name`（来自 `agents.name`），不显示 capability tag，无编辑/删除按钮
- 自建 Agent：`avatar_value`（emoji 或上传图）+ `display_name`（来自 `conversation_agents.display_name`）
- **能力 tag 仅在管理 UI 展示**（"选择 Agent"候选列表、"自定义 Agent"设置页）；**消息流/气泡不展示**（避免臃肿）
- **流式体验差异化**（Q7 决策）：自建 Agent 走 SDK `includePartialMessages: true` 给**打字机效果**（逐 token 增量），V1.5 内置 Agent 是"按 turn 聚合"（整段出现）。两者体验不同，自建 Agent 气泡右上角加一个轻量"实时"角标（蓝色脉冲点）作为视觉提示，避免用户在两个 Agent 之间切换时产生"卡了"的错觉。视觉方案在 V3.3 UI 阶段定稿，UX 原型文件 `docs/design/prototypes/v3/self-built-agent-typewriter.html`（待补）

**自定义 Agent 设置页**（`SettingsModal` → "自建 Agent" Tab，当前是静态占位，需做实）：

| # | 优先级 | 内容 | 涉及文件 |
|---|--------|------|----------|
| S1 | P0 | 列表：拉取 `is_system=0` 的所有 Agent，每行展示头像 + name + capabilities + 创建时间；空态显示"还没有自建 Agent，去单聊里调 /agent-creator 创建一个" | `components/settings/SettingsModal.tsx`（CustomAgentsPanel 改造） |
| S2 | P0 | 编辑：点击某行进入编辑面板，可改 `name` / `display_name` / `avatar` / `system_prompt` / `permission_mode` / `capabilities` / `tool_profile`；保存走 `PATCH /api/agents/:id` | 新建 `app/api/agents/[id]/route.ts` |
| S3 | P0 | 删除：每行"删除"按钮（二次确认），删除该 Agent；级联处理：若该 Agent 在某群聊中曾被加入过，roster 行的 `agent_id` 设为 NULL 并显示"已删除"标记；正在运行的 run 标 `error` | `DELETE /api/agents/:id` + `lib/conversations/runs.ts` |
| S4 | P1 | "重新生成 profile"：编辑面板中加按钮"让 LLM 重新分析我的需求"，复用 `/agent-creator` 抽取 prompt，输出新 profile 给用户确认 | 复用 `lib/skills/agent-creator/prompts.ts` |
| S5 | P1 | "重命名 alias"：编辑面板允许改 alias；改完同步更新所有 `conversation_agents` 行（同一 `agent_id` 的 alias） | 同 S2 |
| S6 | P2 | 操作历史：记录每个自建 Agent 的创建/编辑/删除事件（V3.4） | — |

---

## 四、明确不做

- **Diff 视图、版本历史、对话式局部修改** —— PRD P2，V3.4 评估
- **自建 Agent 单聊** —— 决策不做
- **自建 Agent 跨平台**（Codex / Hermes 自建实例）—— 决策不做（`tech-choice` memo §不纳入范围）
- **Electron / 移动端 / 云端多租户** —— 不在 V3
- **完整部署能力** —— P2
- **本地 HTTP 代理**统一多协议 Provider —— 不做（`tech-choice` memo §当前结论 5）
- **归档自建 Agent**（软删除）—— V3.4 评估，V3 仅做硬删除
- **Skill marketplace / Skill 共享** —— 不在 V3
- **用户直接手动选具体工具**（`allowedTools` 列表）—— 决策不做，工具权限统一由 profile 决定（避免对非专业用户暴露工具颗粒度）

---

## 五、验收标准

### V2.6 收口
- 在侧边栏搜索框输入"设置"，列表只剩标题/预览含"设置"的会话
- `Cmd+K` / `Ctrl+K` focus 到搜索框；按 `×` 清空恢复全量

### V3.0 数据层
- `npx tsx scripts/inspect-db.ts`（或类似脚本）能看到 `agents.is_system`、`agents.capabilities`、`agents.avatar_kind`、`agents.avatar_value`、`agents.permission_mode`、`agents.tool_set_json` 六列
- `skills` 表与 `agent_skills` 表创建成功，旧数据不受影响

### V3.1 斜杠命令
- 单聊 Composer 输入 `/`，弹出面板含 `agent-creator` / `skill-creator` 两个内建 Skill
- 输入 `/unknown` 不弹面板，当作普通文本发送

### V3.2 /agent-creator & /skill-creator
- 走完 `/agent-creator` 全流程后，`agents` 表新增一行（`is_system=0`，含 avatar/capability/permission_mode）
- 走完 `/skill-creator`（粘贴模式）后，`skills` 表新增一行，`kind='user'`
- 走完 `/skill-creator`（上传模式）后，`skills.source_attachment_id` 引用到 `message_attachments` 行
- 任一步输入 `/cancel` 立即终止，state 清理

### V3.3 自建 Agent 接入 + 群聊
- 群聊"选择 Agent"能看到自建 Agent，displayName 与创建时一致
- 群聊中 `@<自建alias>` 走 orchestrator → 自建 Agent 收到任务并基于 system_prompt 回复
- 群聊右栏"参与上下文"中自建 Agent 显示 emoji 头像 + displayName + capability tag；系统 Agent 保持旧视觉
- 单聊"选择 Agent"看不到自建 Agent
- 内置 `@claude-code` 在群聊中行为与 V2.5 一致（不被自建 Agent 的 Provider 配置覆盖）
- 自建 Agent 绑定的 Provider `protocol !== 'anthropic'` 时，run 启动被拒绝并给出明确错误消息

---

## 六、风险与开放问题

> §六 是开放问题清单。Q1 / Q4 在 v3 调研后定稿；Q2 / Q3 / Q5–Q10 在 v5 用户拍板后**全部 ✅ 已定**，只剩实现侧落地。V3 不再有未决决策。

| # | 问题 | 状态 | 决策 |
|---|------|------|------|
| Q1 | Claude Agent SDK 工具集机制 | **✅ 已定** | 详见 `docs/memo/2026-06-07-claude-sdk-toolset-research.md`；profile 映射表见 V3.2 P1 |
| Q2 | Skill 命令面板是否要"输入 / 时弹下拉"？ | **✅ 已定** | **A · 弹面板**（Cursor 风格）：输入 `/` 立即看到候选，支持模糊匹配 + 上下键 + Enter；与 S5 自定义 Skill 自动出现配套 |
| Q3 | 头像图片上传格式 / 大小限制 | **✅ 已定** | `jpg` / `png` / `webp` / `gif`，单张 ≤ 1MB，尺寸 ≤ 512×512（前端等比缩到 512）；UI `<input accept="image/*">`；后端复用 V1 附件 |
| Q4 | 工具 profile 的具体档位 | **✅ 已定**（见 V3.2 P1 表） | `readonly` / `code-author` / `executor` 三档 + V3.4 `custom` 留口子 |
| Q5 | 自建 Agent 的 `system_prompt` 字数上限 | **✅ 已定** | 8000 字符；超出截断 + 提示；提交时前端 + 后端双重校验 |
| Q6 | 自定义 Agent 设置页删除：是否允许"还有未完成 run"时删除？ | **✅ 已定** | **禁止删除**：检测到该 Agent 有 `status IN ('pending','running','awaiting_interaction')` 的 run 时，删除按钮置灰 + tooltip"该 Agent 还有 N 个任务未完成，请先取消或等待"；已完成 run 不影响（保留历史，agent_id 保留） |
| Q7 | 自建 Agent run 是否做"逐 token 流式"（打字机效果）？ | **✅ 已定** | **开**（`includePartialMessages: true`）：自建 Agent 给打字机效果，与 Claude Code CLI 体验一致；V3.3 C3 启动时统一开启。**注意**：这与 V1.5 内置 Agent 的"按 turn 聚合"体验不同，V3 上线时需在自建 Agent 气泡上做轻量视觉标记（如"实时"角标），避免用户误以为内置 Agent 卡了（来自调研 memo O1） |
| Q8 | SDK `AskUserQuestion` 与 Conflux 现有 Choice 卡片怎么映射？ | **✅ 已定** | SDK `{question, options, multiSelect}` 正好对应 V1.5 Choice；SDK `AskUserQuestion` 事件转 `agent_interactions(kind='choice')` 行 + SSE `interaction_requested`；用户答案通过 `POST /api/interactions/:id/respond` 回写 SDK；`multiSelect=true` 暂按 V1.5 单选 fallback 落到 V3.4（来自调研 memo O2） |
| Q9 | `canUseTool` 收到"工具被拒"事件时，Conflux 侧是否弹 Approval 卡片？ | **✅ 已定** | **所有 mode 都接 Approval 卡片**（`bypassPermissions` 永不触发除外，因为全放行）：自建 Agent run 启动时统一注册 `canUseTool` 回调，转 `agent_interactions(kind='approval')` + SSE；用户回应后 `run-bridge` 唤醒 SDK 继续。**完全对齐 V1.5 内置 Agent 的 Approval 体验**，复用 `InteractionApprovalCard` + `run-bridge` Promise 队列（V1.5 §5.3 已留入口，V3 落地桥接）。`acceptEdits` 模式下 `Bash` 跑命令、`plan` 模式下 `Write/Edit/Bash` 都会触发卡片——这是预期行为，不是 bug（来自调研 memo O3） |
| Q10 | `ANTHROPIC_BASE_URL` 与 Provider `base_url` 的格式差异 | **✅ 已定** | **A 先行 + B 兜底**：(1) V3 文档化"绑定 Provider 时 `base_url` 不要带 `/v1`，例 `https://api.minimaxi.com/anthropic`"；(2) V3.2 C3 启动 run 时原样透传给 SDK；(3) 跑出 base_url 相关的 401/404 错误时再升级到 B 方案——后端自动 `replace(/\/v1$/, '')` 兜底；(4) Agent Creator 流程中加一条提示"请确认 Provider 的 base_url 形如 `https://...` 且不含 `/v1`"（来自调研 memo O5） |

---

## 七、实施顺序建议

V3 内容跨度大、跨前后端 + 数据层 + 适配器，单 Agent 不可能一次性做完。按 V1 风格**拆成 9 个 Phase**，每个 Phase 是独立可提交的工作单元（包含若干 commit），Phase 之间按依赖顺序推进。完成本 Phase 验收后再进下一 Phase，避免 UI/DB/SSE/Adapter 同时改动导致问题难定位。

### Phase 难度速查（Agent 必读）

每个 Phase 标题前的 emoji 是给 Agent 看的"上手难度提示"，**不要忽略**：

| 标记 | 含义 | Agent 动作 |
|------|------|------------|
| 🟢 **直接做** | 计划已写到 commit 级、字段级，Agent 拿到计划就能动手 | 读完 Phase 描述 → 按 commit 顺序写代码 → 跑验收 |
| 🟡 **预 plan** | 涉及状态机 / API 契约 / 复杂 UI，**实现前先写设计稿** | 先做 Phase 内的 **C0 设计稿**（TypeScript 类型 + 状态机转移表 + API 字段表 + UI 组件 props），提交为 `docs(plan): Vx.x design draft`；设计稿通过后**再**写 C1+ 实现 |
| 🔴 **重预 plan** | 涉及 SDK 桥接 / 跨子系统集成，**实现前写完整设计稿 + 对齐方案** | 同 🟡，但 C0 设计稿需要更完整：含与 V1.5 / V3.2 / V3.4 等依赖模块的**接口对齐方案**（伪代码或调用序列），并先在对话中与用户对齐 |

| Phase | 标记 | 难度理由 |
|-------|------|----------|
| V2.6 搜索收口 | 🟢 | UI 改动小，commit 边界清晰 |
| V3.0 数据模型 | 🟢 | 列定义已给，Agent 写 Drizzle migration |
| V3.1 斜杠命令骨架 | 🟢 | UI 交互清晰，registry 加载直接 |
| V3.2 /agent-creator | 🟡 | 状态机 + Planner LLM schema + Choice 卡 payload |
| V3.3 /skill-creator | 🟡 | 状态机 + 附件复用 + slug 规范 |
| V3.4 SDK 接入 | 🟡 | 启动参数统一 + profile 映射 + Provider 校验 |
| V3.5 群聊 UI 接入 | 🟡 | roster 扩展 + UI 差异化 + 原型 HTML |
| V3.6 设置页 | 🟡 | API 契约 + 级联处理 + 重新生成 profile 流程 |
| V3.7 Approval 桥接 | 🔴 | canUseTool → V1.5 run-bridge 桥接最复杂，需写完整对齐方案 |

> **设计稿模板**（🟡/🔴 Phase 的 C0 必填，存到 `docs/design/specs/v3-phase-X.Y.md`）：
> 1. TypeScript 类型 + Zod schema（state machine、payload、API request/response）
> 2. 状态机转移表（事件 → 转移 → context 变化）
> 3. API endpoint URL + 字段表（方法 / URL / 必填字段 / 返回结构）
> 4. UI 组件 props + 原型 HTML（如涉及 UI）
> 5. **仅 🔴**：与依赖模块的接口对齐方案（伪代码 / 调用序列）

### 依赖总览

```
[独立支线]                                          [主线]
🟢 V2.6 搜索收口 ── 0.5d

[主线]                                                [并行支线]
🟢 V3.0 数据 ─► 🟢 V3.1 斜杠骨架 ─► 🟡 V3.2 /agent-creator ─► 🟡 V3.4 SDK 接入 ─► 🟡 V3.5 群聊 UI
                                  └─► 🟡 V3.3 /skill-creator  ↗              ├─► 🟡 V3.6 设置页
                                                                                └─► 🔴 V3.7 Approval 桥接
```

工作量估算：V3.0 1d + V3.1 2d + V3.2 3d + V3.3 1.5d + V3.4 2d + V3.5 2d + V3.6 1.5d + V3.7 1.5d = **约 15 工作日**；V2.6 0.5d 独立。

---

### 🟢 Phase V2.6 · 搜索会话收口（0.5d，可最先做）

**目标**：恢复 V2 验收时应可用、但 V2.5 验收时未真正跑通的"侧边栏会话搜索"。

**依赖**：无

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | F1 `GET /api/conversations?q=` 按 `title` / 最新消息内容 `LIKE` 过滤 | `app/api/conversations/route.ts` |
| C1 | F2 `ConversationSidebar` 搜索框 `input` 加 `onChange` + 受控 `searchTerm` state | `components/shell/ConversationSidebar.tsx:79-83` |
| C2 | F3 搜索框右侧 `×` 清空按钮 + 空态"无匹配会话" | 同上 |
| C2 | F4 `Cmd+K` / `Ctrl+K` 全局快捷键 focus 到搜索框 | `app/globals.css` 或全局 keydown listener |

**验收**：

- 输入"设置"列表只剩标题/最新消息含"设置"的会话
- `Cmd+K` / `Ctrl+K` focus 到搜索框；按 `×` 清空恢复全量
- typecheck / build 通过

---

### 🟢 Phase V3.0 · 数据模型（1d，必须最先做）

**目标**：把 §三 V3.0 表结构落库，让后续 Phase 都能跑 migration。

**依赖**：无

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | `agents` 表加 6 列（`is_system` / `system_prompt` / `capabilities` / `avatar_kind` / `avatar_value` / `permission_mode` / `tool_profile`）—— 实际是 7 列，注意"permission_mode" 与"tool_profile"是两个独立列；幂等 `ALTER TABLE` migration | `lib/db/schema.ts`、`lib/db/client.ts` |
| C2 | `skills` 表新建（`id` / `slug` / `name` / `description` / `body` / `kind` / `version` / `source_attachment_id` / `created_at` / `updated_at`） | 同上 |
| C2 | 写入内建 Skill seed：`agent-creator` / `skill-creator`（`kind='built-in'`，`body` 留空占位，V3.1 runner 接上后再填实际 prompt） | `lib/db/seed.ts`（如不存在则新建） |
| C3 | `agent_skills` 关联表新建（`agent_id` / `skill_id` / `created_at`，UNIQUE） | `lib/db/schema.ts` |
| C3 | 更新 `npx tsx scripts/inspect-db.ts`（或类似）能看到新列与新表 | `scripts/inspect-db.ts` |

**验收**：

- `npx tsx scripts/inspect-db.ts` 输出 `agents` 多 7 列、`skills` 与 `agent_skills` 表存在
- 旧 `agents` 数据不丢失（`is_system` 默认 1，系统 Agent 不变）
- typecheck / build 通过；现有 V1 / V2 / V2.5 群聊功能不退化

---

### 🟢 Phase V3.1 · 斜杠命令骨架（2d）

**目标**：让 Composer 输入 `/` 弹命令面板，能识别内建 Skill（agent-creator / skill-creator）和用户自定义 Skill；群聊 `/` 不触发（防止误派发）。

**依赖**：V3.0

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | `lib/skills/registry.ts` 骨架：`getSkills()` 返回 `Skill[]`；先硬编码 agent-creator / skill-creator 两个内建 Skill（不读 DB） | `lib/skills/registry.ts`（新） |
| C1 | `Composer` 检测 `/` 触发命令面板（位置 + 显隐 state） | `components/chat/Composer.tsx` |
| C1 | 面板 UI：列表展示 `slug` + `name` + `description` | 新组件 `components/chat/SlashCommandPanel.tsx` |
| C2 | `registry` 增加 DB 加载：把 `kind='user'` 的 Skill 合并进列表；DB 改完后**缓存失效**（最简方案：每次 `getSkills()` 重读 DB；性能 OK） | `lib/skills/registry.ts` |
| C3 | `lib/skills/runner.ts` 骨架：`runSkill(slug, conversationId, userMessageId)` —— 先只识别 `agent-creator`（跳到 V3.2 真实实现，这里先打 TODO log）；`skill-creator` 同 | `lib/skills/runner.ts`（新） |
| C4 | S3 群聊 `/xxx` 当作普通文本：`POST /api/messages` 入口判断 `conversation.mode === 'group'` 时不调 runner | `app/api/messages/route.ts` |
| C5 | S4 键盘上下选择 + Enter 确认 + Esc 关闭 | `components/chat/SlashCommandPanel.tsx` |
| C5 | 用户选中命令后，把 `/slug xxx` 替换为消息正文 `xxx` 并把 `slug` 作为元数据传给后端 | `Composer.tsx` |

**验收**：

- 单聊 Composer 输入 `/`，弹面板含 `agent-creator` / `skill-creator`
- 输入 `/unknown` 不弹面板，当作普通文本发送
- 键盘 ↑↓ 移动焦点 + Enter 确认 + Esc 关闭
- 群聊输入 `/agent-creator` 当作普通文本发送（不进 runner）
- 创建新 Skill（用 V3.0 之前的 DB 手工插入）后，命令面板立即可见
- typecheck / build 通过

---

### 🟡 Phase V3.2 · /agent-creator 引导对话 + Profile 抽取（3d）

**目标**：跑通 `/agent-creator` 完整引导流程：LLM 主动判断信息充足 → AskUserQuestion 风格 Choice 卡 → 预览 → 保存。

**依赖**：V3.1（runner 骨架）

**C0 设计稿**（必须先于 C1 完成；存到 `docs/design/specs/v3-phase-3.2.md`）：

| 子任务 | 内容 |
|--------|------|
| C0-1 | TypeScript 类型 + Zod schema：`AgentCreatorState`（`idle`/`collecting`/`confirm_build`/`preview`/`saving`/`done`/`cancelled`）、`AgentCreatorEvent`（USER_INPUT / CHOICE_RESPONDED / LLM_RESPONSE / USER_CONFIRMED / USER_CANCELLED / USER_REGENERATE_PROFILE）、`PlannerLLMResponse` Zod schema（与 §三 V3.2 JSON 对齐）、`ChoicePayload`（复用 V1.5）、`AgentDraft`（name/alias/display_name/system_prompt/permission_mode/capabilities/tool_profile） |
| C0-2 | 状态机转移表：每个 `state × event → next_state × context_delta` 显式列出（建议用表格，6 个状态 × 6 类事件 ≈ 30 行）；重点：`collecting` 收到 LLM `next_question != null` → emit Choice 卡；`info_sufficient=true` → `confirm_build` 弹"开始创建"卡；`USER_CONFIRMED` → `preview` 渲染预览卡 |
| C0-3 | API endpoint：不新增（V3.2 走 V1 `/api/messages` + V1.5 `agent_interactions.respond`） |
| C0-4 | UI 组件 props：`SlashCommandPanel`（已 V3.1 C1 起步）、`AgentCreatorPreviewCard`（props: `draft: AgentDraft` / `onSave` / `onRegenerate` / `onCancel`）、`AgentAvatarPicker`（props: `currentKind: 'emoji'\|'uploaded'` / `onChange`） |
| 提交为 | `docs(plan): V3.2 design draft`（独立 commit，先于所有实现 commit） |

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | P1 `lib/skills/agent-creator/profiles.ts` 映射表（readonly / code-author / executor 三档 → SDK options） | `lib/skills/agent-creator/profiles.ts`（新） |
| C2 | A2 `prompts.ts` 引导 prompt：告知 LLM "主动提 2–5 个关键问题（使用场景 / 典型任务 / 是否写代码 / 是否执行命令 / 能力标签）；每轮响应按 §三 V3.2 schema 返回 JSON" | `lib/skills/agent-creator/prompts.ts`（新） |
| C3 | A1 `state.ts` 状态机：`idle` → `collecting` → `confirm_build` → `preview` → `saving` → `done` / `cancelled`；全内存 Map 存中间态 | `lib/skills/agent-creator/state.ts`（新） |
| C3 | A3 抽取出 `draft` 字段与 `next_question` 放同轮响应（LLM 每轮维护 draft 最新版） | `prompts.ts` + `state.ts` |
| C4 | A10 `runner.ts` 把 Planner LLM 的 `next_question` 渲染为 `agent_interactions(kind='choice')` 行 + SSE `interaction_requested`；`info_sufficient=true` 弹"开始创建"确认卡 | `lib/skills/agent-creator/runner.ts`（新） |
| C4 | 单聊校验：流程开始时 `conversation.mode === 'single'`，否则提示"请在单聊中使用 /agent-creator" | `runner.ts` |
| C5 | A11 draft 缺字段 fallback：缺哪补哪再调一轮 LLM（不重走整个流程） | `state.ts` |
| C6 | A4 `AgentCreatorPreviewCard` 组件：消息流 inline 卡片，展示所有字段 + 头像 + tool_profile + system_prompt 摘要 + 三按钮（保存/再改一下/取消） | `components/chat/AgentCreatorPreviewCard.tsx`（新） |
| C6 | P3 `executor` profile 在预览卡上标红 + "⚠️ 高危" + 二次确认勾选 | 同上 |
| C6 | P4 预览卡上可"换一档"（用户改 tool_profile 后回写 state） | 同上 |
| C7 | A5 保存：用户点"保存"后插入 `agents` 行（`is_system=0`），state 置 `done`，发 `message_replace` 事件 | `state.ts` + DB 写入 |
| C7 | A6 `/cancel` 终止：state 置 `cancelled`，清理中间态 | `state.ts` |
| C8 | A7 alias 唯一性校验：与现有 `agents.slug` 冲突时用 Choice 卡引导用户换一个 | `state.ts` |
| C8 | A8 avatar 流程：预览前可选 emoji（首版 16 个）或上传图片（复用 V1 `/api/attachments/select`） | 新组件 `components/agents/AgentAvatarPicker.tsx` |

**验收**：

- 走完 `/agent-creator` 全流程，`agents` 表新增一行（`is_system=0`，含 avatar/capability/permission_mode/tool_profile）
- 流程中 LLM 主动触发 `info_sufficient=true`（不需要用户说"差不多了"）
- 任一步输入 `/cancel` 立即终止，state 清理
- alias 冲突时 Choice 卡引导换名
- `executor` profile 二次确认勾选后才能保存
- typecheck / build 通过

---

### 🟡 Phase V3.3 · /skill-creator（1.5d，可与 V3.2 并行）

**目标**：跑通 `/skill-creator` 完整流程：粘模式 + 上传模式 + 命名规范 + 创建后立即可见。

**依赖**：V3.1（runner 骨架）

**C0 设计稿**（必须先于 C1 完成；存到 `docs/design/specs/v3-phase-3.3.md`）：

| 子任务 | 内容 |
|--------|------|
| C0-1 | TypeScript 类型 + Zod schema：`SkillCreatorState`（`collecting_name` / `collecting_description` / `collecting_body` / `preview` / `saving` / `done` / `cancelled`）、`SkillCreatorEvent`、`SkillDraft`（name / slug / description / body / source_attachment_id）、`SkillSlugRule`（正则 `^[a-z][a-z0-9-]{1,30}$`） |
| C0-2 | 状态机转移表：粘模式（`collecting_body` 用户直接粘贴 markdown）vs 上传模式（`collecting_body` 用户选附件走 V1 `/api/attachments/select` 选文件）→ 都汇聚到 `preview` |
| C0-3 | API endpoint：复用 V1 已有 `/api/attachments/select`（如未实现则在 V3.0 之前确认）；不新增 |
| C0-4 | UI 组件 props：`SkillBodyEditor`（props: `mode: 'paste'\|'upload'` / `value: string` / `attachmentId?: string` / `onChange`）、`SkillCreatorPreviewCard`（props: `draft: SkillDraft` / `onSave` / `onCancel`） |
| 提交为 | `docs(plan): V3.3 design draft`（独立 commit） |

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | K1 `state.ts` 状态机：收集 `name` / `description` / `body` → 预览 → 保存 | `lib/skills/skill-creator/state.ts`（新） |
| C1 | K3 slug 命名规范：小写字母 + 短横线（`^[a-z][a-z0-9-]{1,30}$`），唯一性校验 | 同上 |
| C2 | K2 上传模式：用户在配置流程中可选择"上传 markdown / yaml 文件"作为 `body`；走 V1 已有 `/api/attachments/select` 选本地文件，落 `message_attachments`，`skills.source_attachment_id` 引用 | 复用 V1 附件 + 新组件 `SkillBodyEditor.tsx` |
| C3 | K4 创建后立即在命令面板可见：DB 写完后调用 `registry.invalidateCache()`（V3.1 C2 已埋点） | `lib/skills/skill-creator/state.ts` + `lib/skills/registry.ts` |
| C3 | 预览卡片：name / slug / description / body 摘要 / 上传的源文件名（如果有）/ "保存" / "取消" | 新组件 `SkillCreatorPreviewCard.tsx` |

**验收**：

- 走完 `/skill-creator`（粘贴模式），`skills` 表新增一行，`kind='user'`
- 走完 `/skill-creator`（上传模式），`skills.source_attachment_id` 引用到 `message_attachments` 行
- slug 不符合命名规范时给出明确错误
- 创建后**立即**在 `/` 命令面板看到新 Skill（V3.1 C2 缓存失效机制）
- typecheck / build 通过

---

### 🟡 Phase V3.4 · 自建 Agent SDK 接入（2d）

**目标**：让 V3.2 创建的自建 Agent 真正能跑通 SDK 端到端（单聊场景，验证 SDK 桥接）。

**依赖**：V3.2（profile 抽取有产物可跑）

**C0 设计稿**（必须先于 C1 完成；存到 `docs/design/specs/v3-phase-3.4.md`）：

| 子任务 | 内容 |
|--------|------|
| C0-1 | TypeScript 类型：`ClaudeCodeAgentSDKAdapter`（实现 V1.5 `AgentAdapter` interface）、`SDKRunParams`（prompt / model / systemPrompt / toolProfile / provider / workspacePath / maxTurns / includePartialMessages）、`SDKEvent`（assistant / user / system / result / SDKPartialAssistantMessage；V3.4 C4 起含打字机分片） |
| C0-2 | 启动参数表：每个 SDK option 的取值与来源逐行列出（`settingSources=[]` / `cwd=conversation.workspace_path` / `maxTurns=50` / `includePartialMessages=true` / `env={ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL}` / `permissionMode` / `allowedTools` / `disallowedTools`）；`tool_profile → permissionMode/allowedTools/disallowedTools` 映射表（来自 `profiles.ts`，已在 V3.2 C1 写） |
| C0-3 | API endpoint：不新增（Provider 协议校验在 `lib/conversations/runs.ts` 内做，错误以 SSE `message_status='error'` 推回） |
| C0-4 | UI 组件：N/A（适配器层无 UI 改动） |
| C0-5 | **与 V1.5 `AgentAdapter` interface 对齐方案**：列出 V1.5 `AgentAdapter` 已有方法（`invoke` / `abort` / `streamEvents`），逐个说明 V3.4 的 `ClaudeCodeAgentSDKAdapter` 怎么映射 SDK 的 `for await (message of query())` 流；列出 V1.5 `AgentEvent` 与 SDK 消息类型的转换表 |
| 提交为 | `docs(plan): V3.4 design draft`（独立 commit） |

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | C1 `lib/adapters/claude-code-sdk.ts` 骨架：实现 V1.5 §5.3 `AgentAdapter` 接口；先只跑通"只读 profile + 单轮 LLM 调用"，暂不接 tool | `lib/adapters/claude-code-sdk.ts`（新） |
| C2 | C3 透传 `system_prompt` / `model` 到 SDK options；`tool_profile` 通过 `profiles.ts` 映射；`env` 注入 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | `claude-code-sdk.ts` + `profiles.ts` |
| C3 | C2 Provider 协议校验：`agents.platform='claude_code'` 且 `is_system=0` 时，启动 run 时检查关联 Provider `protocol === 'anthropic'`，否则 `error` + 提示 | `lib/conversations/runs.ts` |
| C4 | P5 启动参数统一注入：`settingSources: []` / `cwd = conversation.workspacePath` / `maxTurns = 50` / `includePartialMessages = true` | `claude-code-sdk.ts` |
| C4 | Q10 base_url 透传：原样塞 `env.ANTHROPIC_BASE_URL`（A 方案先行，遇问题再升级 B 方案） | 同上 |
| C5 | C4 路由层区分：`is_system=0` 走 `ClaudeCodeAgentSDKAdapter`；`is_system=1` 走 V1 已有 `ClaudeCodeAdapter`，**行为不变** | `lib/conversations/runs.ts`（adapter 选择） |
| C6 | 端到端测试：在 V3.2 创建的 `readonly` profile Agent 上发"你好"，确认 SDK 跑通 + 收到回复 + 落库 | — |

**验收**：

- 单聊中发消息给自建 Agent，SDK 子进程启动，LLM 调用成功，回复写入 `messages`
- `permissionMode: 'plan'` 模式下，写文件工具调用被 SDK 拦截（**注意：此 Phase 暂不弹 Approval 卡片，由 SDK 默认 deny**；V3.7 再接 Approval 桥接）
- 内置 `@claude-code`（`is_system=1`）行为与 V2.5 一致
- Provider `protocol !== 'anthropic'` 时 run 启动被拒绝并给出明确错误
- typecheck / build 通过

---

### 🟡 Phase V3.5 · 群聊 UI 接入（2d）

**目标**：自建 Agent 能在群聊中被选入 roster、@ 指派、显示差异化头像；单聊不出现自建 Agent。

**依赖**：V3.4（SDK 跑通才能在群聊里用）

**C0 设计稿**（必须先于 C1 完成；存到 `docs/design/specs/v3-phase-3.5.md`）：

| 子任务 | 内容 |
|--------|------|
| C0-1 | TypeScript 类型：`RosterItem` 扩展字段（`avatarKind: 'system'\|'emoji'\|'uploaded'` / `avatarValue: string` / `capabilities: string[]\|null` / `isSystem: boolean` / `displayName: string`）；`AgentVisualStyle`（系统 vs 自建的视觉常量集合） |
| C0-2 | 状态机：N/A（纯展示层） |
| C0-3 | API endpoint：`GET /api/conversations/:id/roster` 返回新字段；`POST /api/conversations`（单聊模式）可选 Agent 列表过滤 `is_system=1`；具体过滤逻辑在 service 层 |
| C0-4 | UI 组件 + 原型 HTML：(a) `ConversationSetup` 改造（自建 Agent 列表 + 头像 + capability tag）；(b) `GroupContext` 卡片差异化（自建 emoji 头像 + capability tag，系统原图标）；(c) `MessageBubble` 差异化（**消息流不显示 capability tag**，自建 Agent 气泡右上角"实时"角标）；(d) 原型文件 `docs/design/prototypes/v3/self-built-agent-typewriter.html`（HTML + CSS 静态原型） |
| 提交为 | `docs(plan): V3.5 design draft`（独立 commit，原型 HTML 作为附件） |

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | C5 `RosterItem` 类型扩展 `avatarKind` / `avatarValue` / `capabilities` 字段 | `lib/conversations/types.ts:54-60` |
| C2 | C6 `GET /api/conversations/:id/roster` 返回时携带自建 Agent 的展示字段 | `app/api/conversations/[conversationId]/roster/route.ts` |
| C3 | C7 群聊"选择 Agent"候选列表：拉取"系统 + 启用且 `is_system=0` 的 Agent"；自建 Agent 显示头像 + displayName + capability tag（**管理 UI 可显示 tag**） | `components/shell/ConversationSetup.tsx` 或对应组件 |
| C4 | C8 群聊 `GroupContext` 卡片与消息流气泡应用新视觉（自建 vs 系统）；**消息流气泡不显示 capability tag** | `components/context/ContextPanel.tsx`、`MessageBubble.tsx` |
| C5 | C9 单聊不接入自建 Agent：`POST /api/conversations`（单聊模式）的可选 Agent 列表过滤 `is_system=1` | `app/api/conversations/route.ts` |
| C6 | UI 原型文档：`docs/design/prototypes/v3/self-built-agent-typewriter.html`；自建 Agent 气泡右上角"实时"角标（蓝色脉冲点，与 V1.5 内置 Agent 区分） | `docs/design/prototypes/v3/`（新） |
| C7 | 端到端测试：群聊中 `@<自建alias>` 走 orchestrator → SDK run → 自建 Agent 基于 system_prompt 回复 | — |

**验收**：

- 群聊"选择 Agent"能看到自建 Agent，displayName 与创建时一致
- 群聊中 `@<自建alias>` 走 orchestrator → 自建 Agent 收到任务并基于 system_prompt 回复
- 群聊右栏"参与上下文"中自建 Agent 显示 emoji 头像 + displayName + capability tag；系统 Agent 保持旧视觉
- 群聊消息流气泡**不显示** capability tag；自建 Agent 气泡右上角有"实时"角标
- 单聊"选择 Agent"看不到自建 Agent
- 内置 `@claude-code` 在群聊中行为与 V2.5 一致
- typecheck / build 通过

---

### 🟡 Phase V3.6 · 自定义 Agent 设置页（1.5d，可与 V3.5 并行）

**目标**：把 `SettingsModal` → "自建 Agent" Tab 从静态占位做实：列表 / 编辑 / 删除 / 重新生成 profile / 重命名 alias。

**依赖**：V3.0（数据）+ V3.2（profile 抽取产物可重生成）

**C0 设计稿**（必须先于 C1 完成；存到 `docs/design/specs/v3-phase-3.6.md`）：

| 子任务 | 内容 |
|--------|------|
| C0-1 | TypeScript 类型 + Zod schema：`AgentEditFormState`（与 `AgentDraft` 对齐 + 字段级错误状态）、`AgentUpdateRequest`（PATCH body Zod schema）、`AgentDeletePrecheck`（返回值：canDelete / runningRunIds / pendingRunIds）、`RegenerateProfileRequest/Response`（复用 V3.2 `PlannerLLMResponse`） |
| C0-2 | 状态机：`list` 模式 ↔ `edit` 模式（编辑面板内子状态：`view` / `editing` / `saving` / `deleting` / `regenerating`） |
| C0-3 | API endpoint 字段表：(a) `GET /api/agents?is_system=0` 返回 `Agent[]`；(b) `PATCH /api/agents/:id` request/response；(c) `DELETE /api/agents/:id` request/response；(d) `POST /api/agents/:id/regenerate-profile` 复用 V3.2 Planner LLM |
| C0-4 | UI 组件 props：`CustomAgentsPanel`（列表 + 空态）、`AgentEditPanel`（编辑面板，含字段表单 + 删除按钮 + 重新生成 profile 按钮 + 重命名 alias）；删除按钮的"未完成 run 检测"逻辑（Q6 决策） |
| 提交为 | `docs(plan): V3.6 design draft`（独立 commit） |

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | S1 列表：拉取 `is_system=0` 的所有 Agent，每行展示头像 + name + capabilities + 创建时间；空态"还没有自建 Agent，去单聊里调 /agent-creator 创建一个" | `components/settings/SettingsModal.tsx`（CustomAgentsPanel 改造） |
| C1 | `GET /api/agents?is_system=0` API | `app/api/agents/route.ts`（新） |
| C2 | S2 编辑：点击某行进入编辑面板，可改 `name` / `display_name` / `avatar` / `system_prompt` / `permission_mode` / `capabilities` / `tool_profile` | 新建编辑面板组件 `AgentEditPanel.tsx` |
| C2 | `PATCH /api/agents/:id` API | `app/api/agents/[id]/route.ts`（新） |
| C3 | S3 删除：每行"删除"按钮（二次确认），删除该 Agent；Q6 逻辑 —— 检测到该 Agent 有 `status IN ('pending','running','awaiting_interaction')` 的 run 时按钮置灰 + tooltip | `components/settings/SettingsModal.tsx` |
| C3 | `DELETE /api/agents/:id` API + 级联处理：roster 行的 `agent_id` 设为 NULL 并显示"已删除"标记；正在运行的 run 标 `error` | `app/api/agents/[id]/route.ts` + `lib/conversations/runs.ts` |
| C4 | S4 "重新生成 profile"：编辑面板中加按钮"让 LLM 重新分析我的需求"，复用 V3.2 `prompts.ts` 与 `state.ts` | `AgentEditPanel.tsx` |
| C5 | S5 "重命名 alias"：编辑面板允许改 alias；改完同步更新所有 `conversation_agents` 行（同一 `agent_id` 的 alias） | `PATCH /api/agents/:id` 内部实现 |

**验收**：

- 设置页"自建 Agent" Tab 列表正确展示
- 编辑所有字段并保存后，再查 DB 字段值已更新
- 删除二次确认；存在未完成 run 时按钮置灰且不响应点击
- 删除后，roster 中该 Agent 显示"已删除"标记
- "重新生成 profile" 按钮触发 LLM 分析，输出新 profile 给用户确认
- 重命名 alias 后，roster / 群聊 @mention 都能用新 alias
- typecheck / build 通过

---

### 🔴 Phase V3.7 · V1.5 Approval 卡片桥接到 SDK（1.5d，可与 V3.5 / V3.6 并行）

**目标**：把 V1.5 §5.3 留的 `canUseTool` 桥接入口补上 —— SDK 工具被拒时统一转 V1.5 Approval 卡片，用户回应后 SDK 继续。

**依赖**：V3.4（SDK 跑通）+ V1.5（`run-bridge` / `agent_interactions` / `InteractionApprovalCard` 已就位）

**C0 设计稿**（必须先于 C1 完成；存到 `docs/design/specs/v3-phase-3.7.md`）—— 🔴 重预 plan，重点写对齐方案：

| 子任务 | 内容 |
|--------|------|
| C0-1 | TypeScript 类型 + Zod schema：SDK `CanUseTool` 回调签名（`(toolName, input, opts) => Promise<PermissionResult>`）；`ApprovalPayload` 扩展字段（SDK toolName 映射到 V1.5 `action` 的规则表）；`AgentInteraction` 复用（`kind='approval'`，`agent_id` 写自建 Agent id 而非 `__creator__`） |
| C0-2 | run 状态机扩展：`agent_runs.status` 增加 `awaiting_canuse`（与 V1.5 已有 `awaiting_interaction` 区别：前者等 SDK canUseTool 回调，后者等 V1.5 用户 respond）；或在 V1.5 已有 `awaiting_interaction` 复用，看 V1.5 run-bridge 设计 |
| C0-3 | API endpoint：复用 V1.5 `POST /api/interactions/:id/respond`（`InteractionDecision.approved: boolean`） |
| C0-4 | UI 组件：N/A（复用 V1.5 `InteractionApprovalCard` 橙色系卡片） |
| **C0-5** | **🔴 与依赖模块的接口对齐方案**（必须含伪代码 / 调用序列）：(a) V3.4 `ClaudeCodeAgentSDKAdapter` 怎么在 `invokeAgentForTask` 启动时注册 `canUseTool` 回调；(b) 回调被 SDK 触发时怎么调用 V1.5 `lib/interactions/service.ts` 的 `create({ kind: 'approval', payload: ... })` 写 `agent_interactions` 行；(c) 怎么在 `agent_runs.status` 上挂"等待"状态；(d) 用户 `POST respond` 后怎么把决议转成 SDK `PermissionResult` 返回值唤醒 SDK Promise；(e) **挂起 / 唤醒的伪代码**（建议用 30–50 行 TypeScript 写骨架）；(f) **与 V1.5 `run-bridge` Promise 队列的衔接点**（查 V1.5 §5.3 的 `pendingInteraction` Map） |
| **C0-6** | **🔴 C0-5 完成后必须先在对话中与用户对齐**（按 🔴 标记的含义），再进入 C1 实现 |
| 提交为 | `docs(plan): V3.7 design draft`（独立 commit，含对齐方案 + 伪代码） |

**工作**：

| Commit | 内容 | 涉及文件 |
|--------|------|----------|
| C1 | `canUseTool` 回调注册：在 `ClaudeCodeAgentSDKAdapter.invokeAgentForTask` 启动时注册 callback；接 SDK 触发的"工具被拒"事件 | `lib/adapters/claude-code-sdk.ts` |
| C1 | 写 `agent_interactions(kind='approval')` 行（`payload` 用 V1.5 `ApprovalPayload`：`action` / `summary` / `path` / `command` / `risk`） | `lib/interactions/service.ts`（如需要扩展） |
| C2 | `run-bridge` 扩展：在 `canUseTool` 等待期间挂起 run（`agent_runs.status = 'awaiting_interaction'`） | `lib/conversations/runs.ts` + `lib/interactions/run-bridge.ts` |
| C3 | 用户 `POST /api/interactions/:id/respond` 后，`run-bridge` 唤醒 SDK 回调（返回 `allow` / `deny`） | `app/api/interactions/[interactionId]/respond/route.ts`（V1.5 已有，扩展即可） |
| C4 | 端到端测试：`readonly` profile Agent 尝试 `Write` 工具 → SDK 拦截 → Conflux 弹 Approval 卡片 → 用户批准 → SDK 继续并写入文件 | — |
| C4 | `acceptEdits` 模式下 `Bash` 跑命令的 Approval 流程同样跑通 | — |

**验收**：

- `readonly` profile Agent 写文件 → 弹 Approval 卡片 → 批准后写入；拒绝后 Agent 收到 error
- `acceptEdits` profile Agent 跑 `Bash` 命令 → 弹 Approval 卡片 → 批准后命令执行
- `executor` profile Agent 永不弹 Approval 卡片（`bypassPermissions` 永不触发）
- 同一 `run_id` 在 Approval resolve 后继续执行（V1.5 验收标准保留）
- 内置 `@claude-code`（走 V1 已有 `ClaudeCodeAdapter`）行为不变
- typecheck / build 通过

---

### Phase 串行 vs 并行

| Phase | 串行依赖 | 可并行项 |
|-------|----------|----------|
| V2.6 | 无 | 与 V3.0 完全独立 |
| V3.0 | 无 | 与 V2.6 并行；与 V3.1 串行（V3.1 需要 skills 表） |
| V3.1 | V3.0 | — |
| V3.2 | V3.1 | — |
| V3.3 | V3.1 | 与 V3.2 并行（共享 V3.1 runner 骨架） |
| V3.4 | V3.2 | — |
| V3.5 | V3.4 | — |
| V3.6 | V3.0 + V3.2 | 与 V3.5 并行（不依赖 SDK 跑通） |
| V3.7 | V3.4 + V1.5 | 与 V3.5 / V3.6 并行（不依赖 UI 改造） |

**推荐执行顺序**（单 Agent）：

1. V2.6（半天）→ V3.0（1d）→ V3.1（2d）→ V3.2（3d）→ V3.4（2d）→ V3.5（2d）→ V3.6（1.5d）→ V3.7（1.5d）
2. V3.3（1.5d）插在 V3.2 完成后、V3.4 启动前的窗口里做（与 V3.4 串行更安全，但若 Agent 有并行能力可与 V3.4 同步进行）

总跨度：约 15 工作日（单 Agent 串行）/ 约 12 工作日（双 Agent 并行：V3.3 与 V3.4-V3.5 主线 + V3.6/V3.7 与 V3.5 并行）

---

## 八、相关文件索引

| 模块 | 文件 |
|------|------|
| 数据 | `lib/db/schema.ts`、`lib/db/client.ts`（migration） |
| API | `app/api/conversations/route.ts`、`app/api/messages/route.ts`、`app/api/conversations/[conversationId]/roster/route.ts`、`app/api/agents/[id]/route.ts`（新增，PATCH/DELETE 自建 Agent） |
| 适配器 | `lib/adapters/claude-code.ts`（内置）、`lib/adapters/claude-code-sdk.ts`（自建，新增） |
| 运行 | `lib/conversations/runs.ts`（Provider 协议校验、删除级联） |
| 技能运行时 | `lib/skills/runner.ts`、`lib/skills/registry.ts`、`lib/skills/agent-creator/state.ts`、`lib/skills/agent-creator/prompts.ts`、`lib/skills/agent-creator/profiles.ts`、`lib/skills/skill-creator/state.ts`（全部新增） |
| UI | `components/chat/Composer.tsx`、`components/chat/AgentCreatorPreviewCard.tsx`（新增）、`components/chat/AgentAvatarPicker.tsx`（新增）、`components/context/ContextPanel.tsx`、`components/chat/MessageBubble.tsx`、`components/agents/AgentIcon.tsx`、`components/shell/ConversationSidebar.tsx`、`components/settings/SettingsModal.tsx`（CustomAgentsPanel 改造） |
| 类型 | `lib/conversations/types.ts`（`RosterItem` 扩展） |
| 文档 | `docs/design/TECH_DESIGN.md`（补 SDK 工具集小节）、`docs/design/API_CONTRACT.md`（补 `/api/conversations?q=` 与 `/api/agents/:id`）、`roadmap.md`（更新 V3 状态）、`docs/memo/2026-06-07-claude-sdk-toolset-research.md`（调研产出，待写） |

---

## 九、变更日志

- 2026-06-07 v7：**§七 加难度标记系统** —— 每个 Phase 标题前加 🟢 直接做 / 🟡 预 plan / 🔴 重预 plan 三档 emoji；§七 顶部加"难度速查表"显式说明每档含义与 Agent 动作；6 个 🟡/🔴 Phase（V3.2 / V3.3 / V3.4 / V3.5 / V3.6 / V3.7）在 commit 列表前插 **C0 设计稿** 子任务（TypeScript 类型 / 状态机转移表 / API 字段表 / UI 组件 props / 仅 🔴 含与依赖模块的对齐方案），设计稿存到 `docs/design/specs/v3-phase-X.Y.md` 提交为独立 commit。**🔴 标记的含义特别强调**：C0 完成后**先在对话中与用户对齐**再进 C1 实现。3 个 🟢 Phase（V2.6 / V3.0 / V3.1）跳过 C0，Agent 拿到计划直接动手
- 2026-06-07 v6：**§七 从"模块组织"重写为"Phase 拆分"**，按 V1 风格（目标 / 工作 / 验收 / 依赖）拆为 9 个 Phase（V2.6 / V3.0 / V3.1 / V3.2 / V3.3 / V3.4 / V3.5 / V3.6 / V3.7），每个 Phase 含独立 commit 拆分（V3.0 3 个 commit / V3.1 5 个 / V3.2 8 个 / V3.3 3 个 / V3.4 6 个 / V3.5 7 个 / V3.6 5 个 / V3.7 4 个，V2.6 2 个），便于 Agent 逐步执行 + 独立提交。**依赖图**显式列出并行支线（V2.6 与 V3.0 独立；V3.3 与 V3.2 并行；V3.6 / V3.7 在 V3.4 完成后并行）。总跨度约 15 工作日（单 Agent 串行）/ 12 工作日（双 Agent 并行）。v5 决策保留（Q1–Q10 全部 ✅）
- 2026-06-07 v5：§六 8 个开放问题全部 ✅ 已定 —— Q2 弹面板（Cursor 风格）/ Q3 头像 jpg+png+webp+gif ≤1MB ≤512² / Q5 system_prompt 8000 字符上限 / Q6 删除有未完成 run 时禁止 / **Q7 翻转：开打字机效果**（`includePartialMessages: true`，自建 Agent 气泡加"实时"角标与 V1.5 区分）/ Q8 SDK AskUserQuestion → Choice 卡复用 V1.5 / **Q9 升级：所有 mode 都接 Approval 卡片**，复用 V1.5 `run-bridge` 与 `InteractionApprovalCard` / Q10 base_url 先 A（不转换 + UI 标注）后 B（自动 strip `/v1` 兜底）。V3.3 C3 启动参数加 `includePartialMessages: true` + `maxTurns: 50`；"联系人差异化"小节补打字机视觉差异说明。V3 不再有未决决策，进入 V2.6 收口 / V3 实现阶段
- 2026-06-07 v4：依用户反馈收口四处设计 —— (1) G4 + §三 群聊 UI 明确**能力标签不显示在群聊消息流气泡**，仅管理 UI 展示；(2) V3.1 S5 明确 Skill 注册表承载内建 + 用户自定义，**用户自定义 Skill 自动出现在 `/` 命令面板**；(3) V3.2 重写 A2/A3 流程为 **AskUserQuestion 风格主动引导**：Planner LLM 每轮自评 `info_sufficient` 主动触发确认，废除"等用户说差不多了"；(4) 新增 A10 用 V1.5 `InteractionChoiceCard` 承载 `next_question` / `info_sufficient` 两种 Choice 卡；A11 兜底 draft 缺字段 fallback。Profile 映射表与 Open Questions Q7–Q10 沿用 v3
- 2026-06-07 v3：完成 Claude Agent SDK 工具集调研（`docs/memo/2026-06-07-claude-sdk-toolset-research.md`）；V3.2 profile 映射表定稿（`readonly` / `code-author` / `executor` 三档）；V3.3 C3 移除"待调研"标记；§六 收敛
- 2026-06-07 v2：依用户反馈大改 §三 V3.2（引导对话 + profile 自动选择，不让用户选具体工具）、新增 §三 V3.3 "自定义 Agent" 设置页（编辑/删除）、加 `system_prompt` 列、头像支持图片上传、§六 开放问题收敛
- 2026-06-07 v1：初稿。基于 6-6 群聊多实例隔离计划之后的状态。

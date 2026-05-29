# 技术设计（适配器 / 自建 Agent / Provider）

本文档记录 **已决策** 的持久技术约定。产品需求见 `prd初版.md`；讨论过程见 `docs/memo/2026-05-23-1600-custom-agent-tech-choice.md`。

**阶段**：**Provider** 基础设施在 **V2** 落地（Orchestrator 调度 Agent 接 API）；**V3** 自建 Agent 复用同一 Provider 表，但对 `claude_code` 绑定增加协议约束。

## 1. 内置 Agent 与自建 Agent

| 维度 | 内置 Agent（如 `@claude-code`） | 用户自建 Agent（V3） |
| --- | --- | --- |
| 定义 | 平台预置，`is_builtin = true` | `/agent-creator` 持久化，`is_builtin = false` |
| System Prompt | **不覆盖** Claude Code 等产品默认 | 用户定义的 `system_prompt` |
| 权限 | 跟随本机 Agent 运行时默认 / 用户本机配置 | `permission_mode` + 平台映射 |
| API / 鉴权 | 继承本机 CLI 登录态（OAuth / 官方 config） | `platform = claude_code` 时绑定 **Provider**，且该 Provider 须为 **Anthropic 兼容**（见 §3.3）；其他平台走各自适配器 |
| 执行实现 | V1 当前通过本机 CLI 适配器调用；`ClaudeCodeAdapter` 后续可切到 Agent SDK | 按 `platform` 选适配器；`claude_code` 用 Agent SDK，profile=`custom` |

**原则**：内置 Agent 不是「SDK 这个框架」；SDK 仅是 Conflux 在 Node 里调用 Claude Code 运行时的方式。IM 里用户对话的对象始终是 Agent 产品/自建人格，不是 SDK 本身。

## 2. Claude Code 执行：Claude Agent SDK

- 包：`@anthropic-ai/claude-agent-sdk`（TypeScript）；底层 spawn 与 `claude` CLI 同源。
- **V1**：`ClaudeCodeAdapter` 建议直接基于 SDK，减少 `stream-json` 自解析与临时 settings 文件。
- **V3 自建**（`platform = claude_code`）：`query({ prompt, options })`，其中：
  - `options.systemPrompt` ← Agent.`system_prompt`
  - `options.permissionMode` / `allowedTools` / `disallowedTools` / `canUseTool` ← `permission_mode` 映射（见 §4）
  - `options.env` ← Provider 注入（见 §3）
- **不采用**：自研完整 agentic tool loop；**不采用**本地协议代理作为默认路径。
- **不采用**：用 SDK programmatic `agents`（subagent）替代 DB 中的自建 Agent 记录。

### 2.1 `ClaudeCodeAdapter` 两种 profile

```typescript
type ClaudeCodeRunProfile = "builtin" | "custom";

// builtin: 不传 systemPrompt 覆盖；env 不注入用户 Provider
// custom:  传入 agent.system_prompt；env 来自 agent.provider_id
```

## 3. Provider（设置页，V2 基础设施）

Provider 是 Conflux **统一的模型 API 配置**（Base URL + Key + 协议 + 默认模型），在设置页管理，供多个消费者引用。**不等于**「全局只能 Anthropic」。

### 3.1 设置页：支持多种协议

| `protocol` | 说明 | 典型消费者 |
| --- | --- | --- |
| `anthropic` | Anthropic Messages API 兼容（含 OpenRouter Anthropic Skin、国内厂商 Anthropic 端点） | 自建 Agent（`platform = claude_code`）经 Claude Agent SDK `env` 注入 |
| `openai_compatible` | OpenAI Chat Completions 兼容（`/v1/chat/completions` 等） | **OrchestratorPlanner**、调度用自研 Agent（HTTP 客户端，不走 Claude Agent SDK） |
| （扩展） | 实现期可增加，如厂商专用枚举 | 按消费者文档约定 |

| 字段 | 说明 |
| --- | --- |
| `name` | 显示名 |
| `protocol` | 上表枚举 |
| `base_url` | API 根 URL |
| `api_key` | 密钥（存储策略见实现阶段） |
| `default_model` | 默认模型 |
| `enabled` | 是否可用 |

**保存 Provider 时**：按 `protocol` 校验 `base_url` 形态（合法 URL；可警告明显与协议不符的路径）。**允许** 同时存在 Anthropic 与 OpenAI 兼容多条配置。

### 3.2 消费者与阶段

| 消费者 | 阶段 | 调用方式 |
| --- | --- | --- |
| `OrchestratorPlanner`（编排/调度 Agent） | **V2** | 自研 HTTP 客户端 + 用户选的 `openai_compatible` Provider（或平台默认 Provider）；**不**走 Claude Agent SDK |
| 自建 Agent `platform = claude_code` | **V3** | Claude Agent SDK + **仅可绑定 `protocol = anthropic` 的 Provider** |
| 内置 `@claude-code` | V1+ | 默认本机 CLI/OAuth；**不强制**绑定 Provider |

V2 前 PRD 中的 `ORCHESTRATOR_LLM_*` 环境变量，V2 起优先收敛为 **设置页 Provider + 编排服务引用**（可保留 env 作为开发默认）。

### 3.3 自建 Agent 的协议约束（非 Provider 全局约束）

仅当用户自建 Agent 且 **`platform = claude_code`**：

- 创建/编辑时 **只能选择** `protocol = anthropic` 的 Provider。
- 若用户选了 OpenAI 兼容 Provider，**禁止绑定**，UI 提示：*「Claude Code 自建 Agent 须使用 Anthropic 兼容 API；请在设置中添加 Anthropic 风格 Provider，或改用其他底层平台。」*
- **不做** 本地协议代理把 OpenAI Provider 转成 Anthropic 给 Claude Code 用。

其他 `platform`（codex 等）的 Provider 策略在 V3 按各适配器单独约定；V3 前可不绑定 Provider。

### 3.4 运行时 env 映射（`claude_code` 自建 + Anthropic Provider）

每次 `run` 通过 SDK `options.env` 注入（示例，按网关文档调整）：

| env | 来源 |
| --- | --- |
| `ANTHROPIC_BASE_URL` | `provider.base_url` |
| `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` | `provider.api_key`（OpenRouter 等可能要求 `ANTHROPIC_API_KEY=""` 且用 `AUTH_TOKEN`） |
| `ANTHROPIC_MODEL` | Agent.`model_name` ?? `provider.default_model` |

### 3.5 数据模型（补充）

```
Provider
├── id
├── name
├── protocol          (anthropic | openai_compatible | …)
├── base_url
├── api_key_encrypted (实现期定)
├── default_model
└── enabled

OrchestratorConfig（或 settings，V2）
├── planner_provider_id   (FK → Provider，通常 openai_compatible)

Agent（V3 补充）
├── provider_id           (nullable；builtin 为空；自建 claude_code 必填且 FK 须 anthropic)
```

## 4. 权限模式 → SDK 映射（`claude_code`）

权限由 Claude Code **运行时强制执行**，不能仅靠 System Prompt。

| `permission_mode` | SDK 倾向（实现期可微调） |
| --- | --- |
| `readonly` | `permissionMode: "plan"` 或 deny `Edit`/`Write`，allow `Read`/`Grep`/`Glob` 等 |
| `editable` | `permissionMode: "acceptEdits"` + 受控 `Bash` allowlist（PRD：build/test/lint） |
| `restricted-editable` | `Edit(path)` 规则 + 或 `canUseTool` 按 `editable_scopes` 动态校验（优先 SDK） |

细粒度 `tools[]`、MCP、任意 shell：P1/P2，见 PRD §3.6.3。

## 5. 其他平台自建 Agent

| `platform` | 执行方式 |
| --- | --- |
| `codex` | `CodexAdapter`（本机 CLI/API），**不用** Claude Agent SDK |
| `hermes` | `HermesAdapter` |
| `opencode` | `OpenCodeAdapter`（V1 使用 `opencode run --format json --dir <workspace> <prompt>`；CLI 未加入 PATH 时可用 `AGENTHUB_OPENCODE_COMMAND` 指定路径） |

## 6. 参考

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Permissions（CLI/SDK 规则语法）](https://code.claude.com/docs/en/permissions)
- 项目 memo：`docs/memo/2026-05-23-1600-custom-agent-tech-choice.md`

---

## 7. V1 单聊架构（已实现）

> **范围**：IM 单聊端到端——Next.js UI + Route Handlers + SQLite/Drizzle + 适配器 + 进程内 SSE stream-bus + 可选本机 PTY Terminal。  
> **不在 V1**：真实群聊调度、Orchestrator、Provider 表、自建 Agent（见上文 §1–§6）。

### 7.1 总体架构

本机优先：浏览器访问 `localhost` 上的 Next.js；SQLite、Agent CLI、PTY 与 API 同进程。

```
┌─────────────────────────────────────────────────────────────────┐
│  浏览器（React / App Router）                                     │
│  AppShell · MessageStream · Composer · ContextPanel · xterm.js   │
└────────────┬───────────────────────────────┬────────────────────┘
             │ HTTP (REST)                    │ SSE
             ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js Route Handlers（runtime: nodejs）                        │
│  app/api/conversations · messages · …/stream · …/stop           │
│  app/api/terminal/session · app/api/agents/health                 │
└────────────┬───────────────────────────────┬────────────────────┘
             │                                │
             ▼                                ▼
┌────────────────────────┐    ┌───────────────────────────────────┐
│  lib/conversations/    │    │  lib/conversations/stream-bus.ts   │
│  service.ts · runs.ts  │───▶│  进程内 Map pub/sub → SSE 推送      │
└────────────┬───────────┘    └───────────────────────────────────┘
             │
     ┌───────┴────────┐
     ▼                ▼
┌──────────┐   ┌──────────────────────────────────────────────────┐
│ SQLite   │   │  lib/adapters/registry → claude_code / codex /    │
│ Drizzle  │   │  hermes / opencode（fake 模式见环境变量）            │
└──────────┘   └──────────────────────────────────────────────────┘
                          │
                          ▼
               本机 Agent CLI（claude / codex / …）

可选：lib/terminal/websocket-server.ts（127.0.0.1 WebSocket + node-pty）
```

| 变量 | 作用 |
| --- | --- |
| `AGENTHUB_DB_PATH` | 覆盖 SQLite 路径 |
| `AGENTHUB_ADAPTER_MODE=fake` | `getAdapter()` 全局返回 fake |
| `AGENTHUB_ENABLE_TERMINAL=1` | 生产构建仍启用 Terminal |
| `AGENTHUB_OPENCODE_COMMAND` | OpenCode CLI 可执行路径 |

### 7.2 数据模型

定义于 `lib/db/schema.ts`（Drizzle + SQLite）。V1 单聊、V1.5 交互桥接已落地；V2.0 仅定稿后续 migration，不执行破坏性 schema 变更。V2.1 增 Provider / Orchestrator settings；V2.2 执行群聊 roster migration；V2.3 再新增 Orchestrator run/task 表。

| 表 | 要点 |
| --- | --- |
| `agents` | 内置目录：`slug`、`platform`、`enabled`；启动 seed |
| `conversations` | `mode`：`single` \| `group`；`status`：`empty` \| `running` \| `done` \| `preview`；`locked_agent_id`、`workspace_path` |
| `conversation_agents` | V1 单聊锁定行；V2 改为群聊 roster，允许同一 `agent_id` 多实例 |
| `messages` | `role`：user/assistant/system/tool；V2 扩展 `orchestrator` 与 author/task 关联字段 |
| `message_attachments` | 本机 `storage_path` + metadata |
| `agent_runs` | 单次执行；V1.5 `status` 含 `awaiting_interaction`；V2 增 `conversation_agent_id` |
| `agent_interactions` | V1.5 Approval / Choice；含可空 `conversation_agent_id`、`orchestrator_task_id`，V2 直接复用 |
| `agent_external_sessions` | 多轮 CLI/SDK session 复用；V2 Invoker 继续通过 `runs.ts` 使用 |
| `artifacts` | 关联 `conversation`、`message`、`run`；adapter 事件或工作区 diff 快照 |

**V2.0 定稿：V2.2 migration 步骤（conversation_agents / messages / agent_runs）**

1. 在 migration 中临时关闭外键检查，创建新表或使用 SQLite 支持的 `ALTER TABLE` 增量；所有 DDL 在事务内执行。
2. `conversation_agents` 新增：
   - `alias TEXT NOT NULL DEFAULT ''`
   - `display_name TEXT`
   - `role_hint TEXT`
   - `status TEXT NOT NULL DEFAULT 'idle'`
   - `joined_at INTEGER`
   - `runtime_context_json TEXT`
3. 迁移旧数据：对既有单聊行，`alias = agents.slug`，`display_name = agents.name`，`status = 'active'`，`joined_at = COALESCE(locked_at, created_at)`，`role` 继续保留 `primary` 语义。
4. 删除旧唯一约束 `UNIQUE(conversation_id, agent_id)`：SQLite 需重建 `conversation_agents` 表；新约束为 `UNIQUE(conversation_id, alias)`，并新增非唯一索引 `INDEX(conversation_id, agent_id)`。
5. `messages` 新增 `author_conversation_agent_id TEXT`、`orchestrator_task_id TEXT`；`role` 约定扩展为 `orchestrator`。若当前 schema 用文本枚举，文档与类型同步；若有 check constraint，migration 同步放开。
6. `agent_runs` 新增 `conversation_agent_id TEXT`，单聊历史可为空；V2 群聊 sub-agent run 必填。
7. 保留 V1.5 `agent_interactions.conversation_agent_id` / `orchestrator_task_id` 字段，不重建交互表，后续 Invoker 只补写值。
8. 回滚策略：备份旧 `conversation_agents` 表数据；回滚时先确认不存在同一 `conversation_id + agent_id` 多行，否则阻止回滚并提示需人工合并 alias；可移除新增列/索引并恢复旧唯一约束。`messages` 与 `agent_runs` 的新增 nullable 字段可安全丢弃。

**Provider / Orchestrator 新表（后续 Phase）**

- V2.1：`providers`、`orchestrator_settings`。
- V2.3：`orchestrator_runs`、`orchestrator_tasks`。

### 7.3 单聊运行链路

**创建会话**：`POST /api/conversations` → `createConversation()`，默认 `mode=single`；V1/V1.5 中 `mode=group` 直接 400。V2.2 起放开 group 创建，但 V2.0 不改代码。

**首条 @ 锁定**（`sendMessage` / `validateSingleChatMention`）：

- 无 `conversation_agents` 行时：首条须且只能 `@` 一个 Agent，写入 `conversation_agents` 并设置 `conversations.locked_agent_id`。
- 已锁定：正文中的 `@` 必须与锁定 Agent 一致，否则 400。

**V2 alias / mention 设计（V2.2 实现）**：

- `lib/agents/mention.ts` 保留现有 `parseAgentMentions` 作为初始化阶段 slug 解析：群聊首条有效消息必须包含两个或以上有效 Agent slug mention。
- 初始化 roster 时按消息中出现顺序逐个写入 `conversation_agents`：同 slug 第一次 `alias = slug`，第二次 `alias = {slug}-2`，第三次 `alias = {slug}-3`。
- `display_name` 默认取 `agents.name`；重复实例 UI 可显示为 `Name (2)`，但后端调度和后续 @ 均以 alias 为准。
- 初始化后 composer / API 只接受已入群 alias；解析器需要提供 alias 模式，例如 `parseConversationAgentMentions(content, rosterAliases)`。@ 未入群 slug 返回 `V2 暂不支持中途邀请新 Agent，请新建群聊。`
- Orchestrator 不是可 @ 的 Agent；创建群聊后作为控制平面自动加入消息流和右栏状态，不进入用户 mention 候选。

**发消息与 Run**：

1. `POST /api/messages` → `sendMessage()`：校验 mention、写 user 消息与附件、`conversations.status=running`。
2. `startAgentRun()`：插入 `agent_runs`、空 `assistant` 消息（`status=running`），`activeRuns` 注册 `AbortController`，异步 `drainAgentRun()`。
3. `getAdapter(agent.platform).run(...)` 迭代 `AgentEvent` → `handleAgentEvent()` 更新 SQLite 并 `publishConversationEvent()`。
4. 浏览器 `EventSource` → `GET /api/conversations/:id/stream`：先回放进行中 assistant，再订阅 `message_delta` / `message_replace` / `message_status` / `run_status`（15s `ping`）。
5. **停止**：`POST .../stop` → `stopConversationRun()` → `AbortController.abort()`，适配器收到 `signal` 后 `message_cancelled`。
6. **重新生成**：`POST /api/messages/:id/regenerate` → 仅最近一条 assistant、且 agent 与锁定一致；删消息后再次 `startAgentRun()`。

Run 结束后还可根据工作区目录 diff 写入 `artifacts`（`recordWorkspaceArtifacts`）。

**V1.5 交互链路**：adapter 运行中发出 `interaction_required`，`runs.ts` 创建 `agent_interactions` 并把 run 标为 `awaiting_interaction`；`POST /api/interactions/:id/respond` 通过 `run-bridge` 唤醒同一 run。V2 Orchestrator 必须复用这条链路，不允许在 `lib/orchestrator/` 内另写审批/选项状态机。

**V2 Invoker 设计约束**：Orchestrator 调度子 Agent 时只扩展 `startAgentRun({ conversationAgentId, orchestratorTaskId, taskPrompt })` / `drainAgentRun()`，不在 Invoker 里重写 adapter 循环。群聊 stop 在 `runs.ts` 增加 `conversationAgentId -> runId` 或 `taskId -> runId` 索引；单聊 stop 保持无 body。

### 7.4 AgentAdapter 契约

`lib/adapters/types.ts`：

```typescript
type AgentAdapter = {
  platform: AgentPlatform | string;
  capabilities: AdapterCapabilities;
  healthcheck(): Promise<AdapterHealth>;
  run(params: AdapterRunParams): AsyncIterable<AgentEvent>;
  inspectRuntime?(): Promise<AgentRuntimeInfo>;
};

type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "artifact_created"; artifact: ArtifactPayload }
  | { type: "interaction_required"; interaction: Omit<AgentInteraction, "id" | "status" | "response"> }
  | { type: "run_status"; status: string }
  | { type: "message_done" }
  | { type: "message_error"; error: string }
  | { type: "message_cancelled" };
```

`lib/adapters/registry.ts` 按 `platform` 解析；V1/V1.5 内置 Agent 走本机 CLI/OAuth，**不读 Provider**（§3.2）。附件路径经 `formatAttachmentContext()` 注入 prompt 上下文。

`capabilities.supportsApproval` / `supportsChoice` 是 V2 Planner 调度的重要输入：例如 Hermes 若为 `none`，不得作为 `implement_review` 主写 Agent。`inspectRuntime?()` 在 V2.1 实现；返回 unknown model 时 Planner 只按 capability / health / roster 调度，不按模型名硬猜。

SSE 对外事件类型见 `ConversationStreamEvent`（`stream-bus.ts`），与 adapter 事件经 `runs.ts` 映射。V2 新增 `task_created` / `task_status` / `task_result` / `orchestrator_summary`，但子 Agent 文本仍走既有 `message_delta`，Approval / Choice 仍走 V1.5 `interaction_*`。

### 7.5 群聊 V1 边界

| 层 | 行为 |
| --- | --- |
| UI | `lib/mock/group-conversation.ts`；`view` 为 `group` / `new-group` 时不拉消息、不建 SSE、`sendMessage` 与 Composer 禁用；`MessageStream` 展示 mock |
| API | `createConversation({ mode: "group" })`、`sendMessage`、`regenerateMessage` 对 group 会话均 400 |

V2 再对接 Orchestrator 与真实群聊 API。

### 7.6 Terminal（可选）

`POST /api/terminal/session` 签发一次性 token 与 `ws://127.0.0.1:…`；PTY `cwd` 为会话 `workspace_path`。启用条件：`NODE_ENV !== "production"` 或 `AGENTHUB_ENABLE_TERMINAL=1`（`lib/terminal/websocket-server.ts`）。

### 7.7 文件所有权（并行开发）

按 `AGENTS.md`：

| 职责 | 路径 |
| --- | --- |
| UI Shell | `app/`、`components/`（单聊接 API；群聊用 `lib/mock/`） |
| DB / API | `lib/db/`、`lib/conversations/`、`app/api/conversations/`、`app/api/messages/` |
| 适配器 | `lib/adapters/`、`lib/adapters/types.ts` |
| Orchestrator（V2+） | `lib/orchestrator/`，仅依赖适配器接口 |
| 评审 / QA | 问题写入 `docs/state/TOFIX.md` |

REST / SSE 字段约定见 `docs/design/API_CONTRACT.md`。

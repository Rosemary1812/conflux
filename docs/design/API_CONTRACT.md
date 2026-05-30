# AgentHub API 契约（V1 / V1.5 / V2 增量）

本文档描述 AgentHub（Conflux）V1 前后端 HTTP API、V1.5 交互桥接、V2 群聊 / Orchestrator / Provider 增量、SSE 事件流与 WebSocket Terminal 契约。V1 / V1.5 以当前代码实现为准；V2 为实施计划契约草稿，后续 Phase 按本文件落地。实现入口：`app/api/**/route.ts`；业务逻辑：`lib/conversations/service.ts`；Run/SSE：`lib/conversations/runs.ts`、`lib/conversations/stream-bus.ts`；Interaction：`lib/interactions/`；Terminal：`lib/terminal/websocket-server.ts`。

---

## 1. 概述

### 1.1 设计目标

- **单聊（single）**：完整会话、消息、Agent Run、SSE 流式推送。
- **交互桥接（V1.5）**：Approval / Choice 共用 `agent_interactions`、respond API、SSE `interaction_requested` / `interaction_resolved`。
- **适配器层**：统一对接 Claude Code、Codex、Hermes、OpenCode（见 `lib/adapters/types.ts`）。
- **本地优先**：SQLite 持久化、本机工作区、Windows 原生文件/目录选择器。
- **群聊（group）**：V1 仅静态 UI，API 层拒绝 group 相关写操作。
- **V2 群聊**：放开 group 会话与消息链路，接 Orchestrator、Provider、任务状态 SSE；V2.0 仅定稿契约，不实现业务代码。

### 1.2 基础约定

| 项目 | 约定 |
|------|------|
| Base URL | 与 Next.js 应用同源，如 `http://localhost:3000` |
| 请求体 | `Content-Type: application/json`（无体的 GET/DELETE 除外） |
| 响应体 | `application/json`（SSE 除外） |
| 字符编码 | UTF-8 |
| 时间戳 | 毫秒 Unix 时间戳（`number`）；消息 `time` 字段为本地化字符串 |
| ID | UUID v4 |
| 认证 | V1 无用户认证，假定本地可信环境 |
| **Runtime** | **所有 Route Handler 均声明 `export const runtime = "nodejs"`**，依赖 Node.js 文件系统、子进程、PTY 等能力 |

### 1.3 统一错误响应

业务错误与未捕获异常均返回 JSON：

```json
{ "error": "人类可读的错误说明" }
```

| HTTP | 含义 |
|------|------|
| `400` | 参数或业务规则不满足 |
| `404` | 资源不存在 |
| `500` | 未预期服务器错误 |
| `501` | 当前平台未实现（非 Windows 本机选择器） |

`ApiError`（`lib/conversations/service.ts`）由 Route Handler 的 `toErrorResponse` 统一转换；`stop` 端点无错误分支，始终 200。

---

## 2. V1 范围与限制

### 2.1 单聊（已实现）

创建/列表/详情/更新/删除会话；首条消息 `@` 锁定 Agent；发送消息与附件；SSE 流式；停止 Run；重新生成最近一条 Agent 回复；工作区绑定；产物记录；本地 Terminal。

### 2.2 群聊（API 拒绝）

| 操作 | 行为 |
|------|------|
| `POST /api/conversations` 且 `mode: "group"` | **400** — `V1 后端只允许创建 single 会话；群聊保持静态 UI。` |
| `PATCH` / `DELETE` group 会话 | **400** — `V1 只支持管理/删除 single 会话。` |
| `POST /api/messages` 发往 group 会话 | **400** — `V1 群聊只保留静态 UI，不接真实消息 API。` |
| `POST .../regenerate` group 消息 | **400** — `V1 群聊不支持重新生成。` |

群聊 UI 使用 `lib/mock/` 或组件内静态数据；V1 不实现 Orchestrator、Skill、多 Agent 调度。

### 2.3 平台限制

- **工作区/附件选择器**：仅 `win32`；其他平台 **501**。
- **Terminal**：`NODE_ENV !== "production"` 或 `AGENTHUB_ENABLE_TERMINAL=1` 时可用。

### 2.4 会话列表过滤

`GET /api/conversations` 仅返回 `mode === "single"`，且过滤「`status === "empty"` 且未锁定 Agent」的空会话。

### 2.5 V1.5 交互桥接（已实现，V2 复用）

V1.5 增加统一交互模型 `AgentInteraction`，支持 `approval` 与 `choice`。交互由 adapter 运行中触发，run 状态进入 `awaiting_interaction`；用户通过 respond API 回应后，`lib/interactions/run-bridge.ts` 唤醒同一 `agent_run` 继续执行。

V2 不重做本后端链路，只在群聊子 Agent 调用时补写 `conversationAgentId` / `orchestratorTaskId`，并由前端按 `messageId + conversationAgentId` 把卡片挂到对应 Agent 气泡下。

---

## 3. 共享数据模型

### 3.1 AgentSummary

```typescript
type AgentPlatform = "claude_code" | "codex" | "hermes" | "opencode";

type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  platform: AgentPlatform;
  description: string;
};
```

### 3.2 ConversationSummary

```typescript
type ConversationMode = "single" | "group";

type ConversationSummary = {
  id: string;
  mode: ConversationMode;
  title: string;
  preview: string;
  status: "running" | "done" | "preview" | "empty";
  avatar: string;
  workspacePath: string;
  artifacts?: ConversationArtifact[];
  lockedAgent?: AgentSummary | null;
  archivedAt?: number | null;
  updatedAt?: number;
};
```

### 3.3 MockMessage

```typescript
type MockMessage = {
  id: string;
  author: string;
  avatar?: string;
  tone?: "user" | "agent" | "orchestrator" | "event";
  status?: "running" | "done" | "preview" | "error" | "cancelled";
  time?: string;
  body: string;
  attachments?: MessageAttachment[];
  artifacts?: ConversationArtifact[];
};
```

### 3.4 附件

```typescript
type MessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
};

type AttachmentReference = {
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  allowExternal?: boolean;
};

type IncomingAttachment = AttachmentReference; // POST /api/messages 请求体
```

### 3.5 ConversationArtifact / RunHandle

```typescript
type ConversationArtifact = {
  id: string;
  type: string;
  title: string;
  description: string;
  path?: string | null;
};

type RunHandle = { runId: string; assistantMessageId: string };
```

### 3.6 AgentInteraction（V1.5）

```typescript
type InteractionKind = "approval" | "choice";

type AgentInteractionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "answered"
  | "expired"
  | "cancelled";

type AgentInteraction = {
  id: string;
  kind: InteractionKind;
  status: AgentInteractionStatus;
  conversationId: string;
  runId: string;
  messageId: string;
  agentId: string;
  conversationAgentId?: string | null;
  orchestratorTaskId?: string | null;
  payload: ApprovalPayload | ChoicePayload;
  response?: InteractionDecision | null;
  createdAt: number;
  resolvedAt?: number | null;
};

type InteractionDecision =
  | { kind: "approval"; approved: boolean }
  | { kind: "choice"; selectedOptionIds: string[]; customText?: string };
```

### 3.7 V2 群聊增量模型（草稿）

```typescript
type ConversationAgent = {
  id: string;
  conversationId: string;
  agentId: string;
  alias: string; // 初始化 slug，重复实例追加 -2/-3
  displayName: string;
  role: "primary" | "member";
  status: "active" | "idle" | "running" | "unavailable";
  runtimeContext?: AgentRuntimeInfo | null;
};

type OrchestratorTask = {
  id: string;
  orchestratorRunId: string;
  conversationId: string;
  assigneeConversationAgentId: string;
  role: string;
  description: string;
  permission: "read" | "edit" | "run_command" | string;
  status: "pending" | "running" | "awaiting_interaction" | "done" | "error" | "cancelled";
  resultMessageId?: string | null;
};
```

---

## 4. HTTP 端点

### 4.1 GET /api/agents

列出已启用 Agent。

**响应 200**：`{ "agents": AgentSummary[] }`

---

### 4.2 GET /api/agents/health

对各注册适配器执行 `healthcheck()`（`dynamic = "force-dynamic"`）。

**响应 200**：

```json
{
  "health": [
    { "platform": "claude_code", "ok": true, "message": "..." }
  ]
}
```

`AdapterHealth`：`{ ok: boolean; message: string }`。

---

### 4.3 GET /api/conversations

**响应 200**：`{ "conversations": ConversationSummary[] }`（见 §2.4 过滤规则）

---

### 4.4 POST /api/conversations

**请求体**：

```json
{
  "mode": "single",
  "workspacePath": "D:\\projects\\my-app"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `mode` | 否 | 默认 `"single"`；`"group"` → 400 |
| `workspacePath` | 否 | 省略时用 `process.cwd()`；须为已存在目录 |

**响应 201**：`{ "conversation": ConversationSummary }`

**典型 400**：群聊拒绝；工作区路径为空/不存在/非目录。

---

### 4.5 GET /api/conversations/:conversationId

**响应 200**：`{ "conversation": ConversationSummary }`  
**404**：`会话不存在。`

---

### 4.6 PATCH /api/conversations/:conversationId

**请求体**（至少一项）：

```json
{ "title": "...", "archived": true, "workspacePath": "..." }
```

| 字段 | 约束 |
|------|------|
| `title` | 去空白后 1–80 字符 |
| `archived` | `true` 写入 `archivedAt`，`false` 清空 |
| `workspacePath` | 须为已存在目录 |

**响应 200**：`{ "conversation": ConversationSummary }`

**典型 400**：`V1 只支持管理 single 会话。`；名称空/超长；`没有可更新的会话字段。`；工作区校验失败。

---

### 4.7 DELETE /api/conversations/:conversationId

**响应 200**：`{ "ok": true }`  
**典型 400**：`V1 只支持删除 single 会话。`  
**404**：`会话不存在。`

---

### 4.8 GET /api/conversations/:conversationId/messages

**响应 200**：`{ "messages": MockMessage[] }`（按 `createdAt` 升序）  
**404**：会话不存在。

---

### 4.9 POST /api/messages

发送用户消息并启动 Agent Run。

**请求体**：

```json
{
  "conversationId": "uuid",
  "content": "@Claude 帮我看看",
  "attachments": [{ "fileName": "a.png", "mimeType": "image/png", "size": 1024, "path": "...", "allowExternal": false }]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `conversationId` | 是 | |
| `content` | 否* | 与 `attachments` 至少一项非空 |
| `attachments` | 否 | 最多 8 个；默认路径须在工作区内 |

**@ 规则**：首条须 `@` 恰好一个 Agent；锁定后不可切换；未知 Agent → `未知 Agent：@{slug}`。

**响应 201**：

```json
{
  "conversation": ConversationSummary,
  "messages": MockMessage[],
  "run": { "runId": "...", "assistantMessageId": "..." }
}
```

副作用：插入 user 消息；锁定 Agent；创建 `status: "running"` 的 assistant 占位；会话 `status → "running"`；首条可自动改标题。

**典型 400**：缺少 conversationId；消息空；群聊拒绝；@ 规则违反；附件校验失败（路径空/不存在/非文件/不可读/超工作区/超 8 个）。

---

### 4.10 POST /api/messages/:messageId/regenerate

无请求体。删除指定 assistant 消息后启动新 Run。

**响应 201**：同 §4.9（`conversation` + `messages` + `run`）

**典型错误**：

| HTTP | 消息 |
|------|------|
| 404 | 消息不存在。 |
| 400 | 只能重新生成 Agent 回复。 |
| 400 | 当前回复仍在生成中。 |
| 400 | V1 群聊不支持重新生成。 |
| 400 | 只能重新生成当前锁定 Agent 的回复。 |
| 400 | 当前只支持重新生成最近一条 Agent 回复。 |

---

### 4.11 POST /api/conversations/:conversationId/stop

停止当前会话运行中的 Run（abort + 标记 cancelled）。

**响应 200（有 Run）**：`{ "ok": true, "runId": "..." }`  
**响应 200（无 Run）**：`{ "ok": true, "alreadyStopped": true }`

随后 SSE 推送 `message_status: cancelled`、`run_status: cancelled`。

---

### 4.12 POST /api/workspace/select

Windows 本机目录选择器（`FolderBrowserDialog`）。非 Windows → **501** `当前只实现了 Windows 本机目录选择器。`

**响应 200（选中）**：`{ "workspacePath": "..." }`  
**响应 200（取消）**：`{ "cancelled": true }`

---

### 4.13 POST /api/attachments/select

Windows 本机文件多选（`OpenFileDialog`）。非 Windows → **501** `当前只实现了 Windows 本机文件选择器。`

**请求体**：`{ "imageOnly": false }` — `true` 时仅图片扩展名。

**响应 200（选中）**：`{ "attachments": AttachmentReference[] }`  
**响应 200（取消）**：`{ "cancelled": true }`  
**500**：选择失败或非文件（如 `只能选择文件作为附件。`）

---

### 4.14 POST /api/terminal/session

创建一次性 Terminal WebSocket 会话（见 §6）。

**请求体**：`{ "conversationId": "uuid" }`

**响应 200**：`{ "url": "ws://127.0.0.1:{port}/terminal?conversationId=...&token=..." }`

**典型错误**：400 缺少 conversationId；404 会话不存在；500 Terminal 未启用或启动失败。

### 4.15 GET /api/conversations/:conversationId/interactions（V1.5）

列出会话交互，用于刷新后恢复 pending Approval / Choice。V2 群聊继续调用同一端点，但 UI 只在消息流气泡下渲染交互卡片，右栏不提供审批/选择操作。

**Query**：

| 参数 | 说明 |
|------|------|
| `status` | 可选；常用 `pending` |

**响应 200**：

```json
{ "interactions": [] }
```

### 4.16 POST /api/interactions/:interactionId/respond（V1.5）

回应 pending 交互并唤醒同一 run。

**Approval 请求体**：

```json
{ "kind": "approval", "approved": true }
```

**Choice 请求体**：

```json
{ "kind": "choice", "selectedOptionIds": ["option-a"], "customText": "可选补充" }
```

**响应 200**：`{ "interaction": AgentInteraction }`

**典型错误**：

| HTTP | 含义 |
|------|------|
| `400` | decision 与 interaction kind 不匹配，或选项为空 |
| `404` | interaction 不存在 |
| `409` | interaction 已结束，或 run waiter 不可恢复 |

### 4.17 V2 Provider（V2.1 落地）

```text
GET    /api/providers
POST   /api/providers
PATCH  /api/providers/:providerId
DELETE /api/providers/:providerId
POST   /api/providers/:providerId/test
```

`protocol` 至少支持 `anthropic` 与 `openai_compatible`。V2 Orchestrator Planner 可使用 `openai_compatible` 或 `anthropic` Provider；V3 自建 `claude_code` Agent 要求绑定 `anthropic` Provider。

### 4.18 V2 Orchestrator 设置（V2.1 落地）

```text
GET   /api/orchestrator/settings
PATCH /api/orchestrator/settings
```

设置项包含 `plannerProviderId`，通常指向 enabled 的 `openai_compatible` Provider。

### 4.19 V2 群聊与 stop 增量（V2.2+ 落地）

| 端点 | V2 行为 |
|------|---------|
| `POST /api/conversations` | 放开 `{ "mode": "group" }`；新建空群，首条消息初始化 roster |
| `GET /api/conversations` | 返回 single 与 group（可后续补 query 过滤） |
| `POST /api/messages` | group 会话走 Orchestrator；V2.2 可先落库 roster 并返回 501/调度未就绪 |
| `GET /api/conversations/:id/messages` | 返回群聊消息身份字段：`role=orchestrator`、`authorConversationAgentId`、`orchestratorTaskId` |
| `POST /api/conversations/:id/stop` | 单聊保持无 body；群聊 body 为 `{ "conversationAgentId": "uuid" }`，只停该 Agent 当前 run/task |

群聊首条消息规则：必须包含两个或以上有效 Agent slug mention；允许重复同一 slug，生成 `alias` 为 `slug`、`slug-2`、`slug-3`。初始化后只能 @ 已入群 alias；@ 未入群 slug 返回 `V2 暂不支持中途邀请新 Agent，请新建群聊。`

### 4.20 V2 Runtime inspection（V2.1 落地）

```text
GET /api/agents/runtime
```

返回各 adapter 的可选 `inspectRuntime()` 探测结果。`modelName = "unknown"` 时 UI 与 Planner 不按模型名硬猜能力，只按 adapter capabilities 与 availability 调度。

---

## 5. SSE 事件流

### 5.1 端点

```
GET /api/conversations/:conversationId/stream
```

`runtime = "nodejs"`，`dynamic = "force-dynamic"`。

**响应头**：

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

### 5.2 生命周期

1. 发送 `connected`
2. 重放已有 Agent 消息的 `message_replace`（刷新页恢复状态）
3. 订阅 `stream-bus` 实时事件
4. 每 15s 发送 `ping`
5. 断开时取消订阅

> 连接时调用 `listMessages` 校验会话；无效 ID 可能导致流启动失败（500），而非 JSON 404。

### 5.3 格式

```
event: {eventName}
data: {json}

```

### 5.4 事件类型

| event | 说明 | data |
|-------|------|------|
| `connected` | 连接成功 | `{ "ok": true }` |
| `ping` | 心跳 | `{}` |
| `message_delta` | 增量文本 | 见下 |
| `message_replace` | 全量同步 | 见下 |
| `message_status` | 消息状态 | 见下 |
| `run_status` | Run 状态 | 见下 |
| `interaction_requested` | V1.5 交互请求 | `{ "interaction": AgentInteraction }` |
| `interaction_resolved` | V1.5 交互结束 | `{ "interactionId": string, "status": AgentInteractionStatus, "response"?: InteractionDecision }` |

类型定义（`lib/conversations/stream-bus.ts`）：

```typescript
// message_delta
{ type: "message_delta"; messageId: string; delta: string }

// message_replace（连接重放；data 含 type 字段）
{ type: "message_replace"; messageId: string; content: string; status: "running" | "done" | "error" | "cancelled" }

// message_status
{ type: "message_status"; messageId: string; status: "running" | "done" | "error" | "cancelled"; error?: string }

// run_status
{ type: "run_status"; runId: string; status: "running" | "awaiting_interaction" | "done" | "error" | "cancelled"; error?: string }
```

### 5.5 V2 SSE 增量（草稿）

V2 复用 `message_delta` / `message_replace` / `message_status` / `run_status` / `interaction_requested` / `interaction_resolved`。群聊子 Agent 消息仍通过普通消息事件流式输出，消息数据须能关联 `authorConversationAgentId`。

新增事件：

| event | 说明 |
|-------|------|
| `task_created` | Orchestrator 创建任务，右栏任务分派列表追加 |
| `task_status` | 任务状态变化，含 `awaiting_interaction` 与 `cancelled` |
| `task_result` | 单个 task 产出摘要或结果消息引用 |
| `orchestrator_summary` | Orchestrator 汇总完成 |
| `agent_runtime_status` | 可选；roster runtime/health 变化 |

`orchestrator_clarify` 不单独建事件；澄清用 `role=orchestrator` 普通消息 + `orchestrator_runs.status=awaiting_user` 表达。

### 5.6 典型流转

```
POST /api/messages
  → run_status: running
  → message_delta × N
  → message_status: done
  → run_status: done

POST .../stop
  → message_status: cancelled
  → run_status: cancelled

适配器错误
  → message_status: error (+ error)
  → run_status: error (+ error)

V1.5 交互
  → interaction_requested
  → run_status: awaiting_interaction
  → POST /api/interactions/:id/respond
  → interaction_resolved
  → run_status: running

V2 群聊 task
  → task_created
  → task_status: running
  → message_delta × N（子 Agent 气泡）
  → task_status: done / awaiting_interaction / error / cancelled
```

---

## 6. WebSocket Terminal

### 6.1 启用条件

- 开发模式（`NODE_ENV !== "production"`），或
- `AGENTHUB_ENABLE_TERMINAL=1`

未启用时 `ensureTerminalServer()` 抛错 → POST 返回 500。

### 6.2 建连流程

1. `POST /api/terminal/session` 传入 `conversationId`
2. 服务端在 `127.0.0.1:0` 启动/复用 HTTP+WebSocket 服务
3. 生成 UUID token（TTL **30s**），写入内存 Map
4. 返回带 query 的 WebSocket URL

### 6.3 URL 与 Query

```
ws://127.0.0.1:{port}/terminal?conversationId={uuid}&token={uuid}
```

| 参数 | 说明 |
|------|------|
| `conversationId` | 须与 token 绑定一致 |
| `token` | 一次性；过期或 mismatch → `close(1008, "valid terminal token is required")` |

### 6.4 安全与 Shell

- **Origin**：仅 `localhost` / `127.0.0.1` / `::1`
- **cwd**：会话 `workspacePath`
- **Shell**：Windows → `powershell.exe -NoLogo -NoProfile`；Unix → `$SHELL` 或 `bash -l`
- **PTY**：90×28

### 6.5 消息协议

| 方向 | 内容 |
|------|------|
| 服务端 → 客户端 | 首条 `AgentHub Terminal\r\ncwd: {path}\r\n`；之后 PTY 输出；退出时 `[process exited with code N]` |
| 客户端 → 服务端 | 键盘输入，写入 PTY |

启动失败：发送错误文本后 `close(1011)`。客户端断开：kill PTY。

---

## 7. 错误消息速查

### 7.1 群聊拒绝

| HTTP | error |
|------|-------|
| 400 | V1 后端只允许创建 single 会话；群聊保持静态 UI。 |
| 400 | V1 只支持管理 single 会话。 |
| 400 | V1 只支持删除 single 会话。 |
| 400 | V1 群聊只保留静态 UI，不接真实消息 API。 |
| 400 | V1 群聊不支持重新生成。 |

### 7.2 会话 / 消息 / 附件

| HTTP | error |
|------|-------|
| 404 | 会话不存在。 / 消息不存在。 |
| 400 | 缺少 conversationId。 / 消息不能为空。 |
| 400 | 首条消息必须 @ 一个 Agent。 / 单聊首条消息只能 @ 一个 Agent。 |
| 400 | 当前会话已锁定 {name}，不能切换到其他 Agent。 |
| 400 | 未知 Agent：@{slug} |
| 400 | 会话名称不能为空。 / 不能超过 80 个字符。 / 没有可更新的会话字段。 |
| 400 | 工作区路径不能为空。 / 不存在。 / 必须是目录。 |
| 400 | 单条消息最多引用 8 个附件。 |
| 400 | 附件路径不能为空。 / 不存在 / 必须是文件 / 不可读 / 须在工作区内 |

### 7.3 平台

| HTTP | error |
|------|-------|
| 501 | 当前只实现了 Windows 本机目录选择器。 |
| 501 | 当前只实现了 Windows 本机文件选择器。 |
| 500 | 请求处理失败。 |
| 500 | Terminal 只在本地开发模式或显式启用后可用。 |

---

## 8. 端点速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | Agent 列表 |
| GET | `/api/agents/health` | 适配器健康检查 |
| GET | `/api/conversations` | 单聊列表 |
| POST | `/api/conversations` | 新建会话 |
| GET | `/api/conversations/:id` | 会话详情 |
| PATCH | `/api/conversations/:id` | 更新会话 |
| DELETE | `/api/conversations/:id` | 删除会话 |
| GET | `/api/conversations/:id/messages` | 消息列表 |
| GET | `/api/conversations/:id/stream` | SSE |
| POST | `/api/conversations/:id/stop` | 停止 Run |
| POST | `/api/messages` | 发送消息 |
| POST | `/api/messages/:messageId/regenerate` | 重新生成 |
| POST | `/api/workspace/select` | 选工作区（Windows） |
| POST | `/api/attachments/select` | 选附件（Windows） |
| POST | `/api/terminal/session` | 创建 Terminal |
| GET | `/api/conversations/:id/interactions` | V1.5 pending 交互恢复 |
| POST | `/api/interactions/:id/respond` | V1.5 回应 Approval / Choice |
| GET/POST/PATCH/DELETE | `/api/providers` | V2 Provider CRUD |
| POST | `/api/providers/:id/test` | V2 Provider 连通性测试 |
| GET/PATCH | `/api/orchestrator/settings` | V2 Orchestrator Planner 设置 |
| GET | `/api/agents/runtime` | V2 adapter runtime inspection |

---

## 9. 实现映射

| 文件 | 方法 |
|------|------|
| `app/api/agents/route.ts` | GET |
| `app/api/agents/health/route.ts` | GET |
| `app/api/conversations/route.ts` | GET, POST |
| `app/api/conversations/[conversationId]/route.ts` | GET, PATCH, DELETE |
| `app/api/conversations/[conversationId]/messages/route.ts` | GET |
| `app/api/conversations/[conversationId]/stream/route.ts` | GET (SSE) |
| `app/api/conversations/[conversationId]/stop/route.ts` | POST |
| `app/api/messages/route.ts` | POST |
| `app/api/messages/[messageId]/regenerate/route.ts` | POST |
| `app/api/workspace/select/route.ts` | POST |
| `app/api/attachments/select/route.ts` | POST |
| `app/api/terminal/session/route.ts` | POST |

---

## 10. V2.0 契约决议

V2.0 只定稿文档契约，不新建 `lib/orchestrator/`，不放开真实 group 调度，不修改群聊前端接真 API。

### 10.1 V1.5 直接复用点

- 表：`agent_interactions`，含可空 `conversation_agent_id`、`orchestrator_task_id`。
- API：`GET /api/conversations/:id/interactions`、`POST /api/interactions/:id/respond`。
- SSE：`interaction_requested`、`interaction_resolved`；`run_status` 支持 `awaiting_interaction`。
- Run 桥接：respond 后唤醒同一 `agent_run`，V2 Orchestrator 不代批、不代选。

### 10.2 群聊 UI 任务进度位置

任务进度只在右栏 `GroupContext` 的「任务分派」区展示，并由 `task_*` SSE 更新。消息流只展示用户、Orchestrator、子 Agent 气泡，以及气泡下 inline Approval / Choice；禁止把 task-board 嵌入消息流或复用 `lib/mock/group-conversation.ts` 的 `groupMessages[].tasks`。

### 10.3 后续仍不在 V2.0

Provider CRUD、runtime inspection、群聊 schema migration、真实 Orchestrator 调度、群聊 UI 接 API、Skill、Agent CRUD、用户认证、`DELETE /api/messages/:id` 等均由后续 Phase 处理。

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-05-29 | V2.0：补录 V1.5 interaction API/SSE，定稿 V2 group / Provider / Orchestrator / SSE 增量草稿 |
| 2026-05-26 | 基于 V1 代码整理 HTTP、SSE、Terminal 契约；标注 `runtime = "nodejs"` |

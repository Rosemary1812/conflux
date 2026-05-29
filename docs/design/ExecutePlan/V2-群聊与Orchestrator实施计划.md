# V2 群聊与 Orchestrator 实施计划

## 0. 前置：V1.5 交互桥接

**启动 V2 前必须完成** `docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md`：

- 单聊 Approval、Choice 已在消息流 inline 跑通，且为 **同一 `agent_run` resume**。
- 已有 `agent_interactions` 表与 `POST /api/interactions/:id/respond`、SSE `interaction_requested` / `interaction_resolved`。
- 交互记录含可空 `conversation_agent_id`、`orchestrator_task_id`（V1.5 单聊为空，V2 群聊填入）。

V2 **不重做** 交互后端；只接：

- 群聊 Approval UI（右栏聚合，见 `prototypes/v2/approval-ui.html` 群聊 Tab）。
- Orchestrator task 进入 `awaiting_interaction` 时 pause，用户 resolve 后 Invoker 继续。

## 1. 阶段目标

V2 的目标是把 V1 已完成的群聊静态 UI 接成真实可运行链路：用户在一个群聊中 @ 多个 Agent，Orchestrator 负责组织协作，子 Agent 作为群聊成员直接在消息流中回复自己的产出，最后由 Orchestrator 汇总结果。

V2 不追求“所有 Agent 每轮都出场”。群聊必须先由两个或以上 Agent 初始化；初始化后，Orchestrator 可以根据当前回合的实际需要只派其中一个已入群 Agent 执行，也可以组织多个 Agent 协作。

## 2. 产品边界

### 2.1 V2 必做

- 固定成员群聊：群聊初始化时确定参与 Agent。
- 同基础 Agent 多运行时：如 `claude1`、`claude2` 同时存在于一个群聊。
- 子 Agent 在群聊消息流中直接回复结果，显示各自头像、名称、状态和产物。
- Orchestrator 自动生成计划、分派任务、维护任务状态、触发必要的 review / revise、最终汇总。
- Orchestrator 在信息不足时向用户追问细节，直到认为可执行再调度子 Agent；用户未指定 Agent 分工时由 Orchestrator 负责分配。
- Orchestrator 支持在已初始化群聊内只调用一个已入群 Agent，并向用户解释原因。
- Orchestrator 上下文包含每个 Agent 的运行时能力、可用性和可探测到的模型信息。
- Provider 支撑 Orchestrator Planner 调用 LLM，优先使用 `openai_compatible` Provider。
- 群聊工作区选择与单聊一致：发消息前须选定 `workspace_path`，子 Agent 共用该会话工作区。
- 群聊右栏展示真实多 Agent 状态、任务分派和产物汇总（**不在消息流内嵌任务进度卡片**）。
- 每个正在执行的子 Agent 头像旁提供停止按钮；停止后可由用户 `@` 已入群 Agent 手动分配后续任务。

### 2.2 V2 暂不做

- 中途 @ 新 Agent 加入当前群聊。
- 动态重规划无限循环。
- Agent 之间直接互相调用。
- 多 Agent 同轮并发写同一个代码库。
- 复杂失败降级：自动换 Agent、复杂重试策略、跳过继续。
- 代码冲突自动解决。
- 自建 Agent、SkillRunner、`/agent-creator`、`/skill-creator`。
- 多 workspace 隔离。
- 消息流内嵌任务进度卡片（任务状态只在右栏展示，Orchestrator 计划仍以消息气泡呈现）。

如果用户在初始化后 @ 未加入的 Agent，V2 返回明确提示：`V2 暂不支持中途邀请新 Agent，请新建群聊。`

## 3. 群聊语义

### 3.1 初始化

群聊创建时不选择 Agent，只进入空群聊。第一条有效用户消息必须 @ 两个或以上 Agent alias，用于初始化群聊成员。若第一条消息少于两个有效 Agent mention，后端直接拒绝，不进入 Orchestrator Planner。

示例：

```text
@claude1 @claude2 @codex1 帮我分析 V2 Orchestrator 应该怎么设计
```

初始化后写入 `conversation_agents`，后续任务分配必须指向 `conversation_agent_id`，不能只指向底层 `agent_id`。

初始化后的后续消息可以 @ 一个已入群 Agent，也可以不 @。这时 Orchestrator 只在固定 roster 内选择执行者；它可以选择一个 Agent 执行，也可以选择多个 Agent 协作，但不能把未入群 Agent 加入当前会话。

### 3.2 同类 Agent 多实例

同一个基础 Agent 可以在一个群聊里有多个运行时实例：

```text
Agent: Claude Code
ConversationAgent: claude1
ConversationAgent: claude2
```

两个实例共享底层平台配置，但拥有独立的：

- `conversation_agent_id`
- alias
- 展示名称
- 消息身份
- 任务状态
- run 记录

V2 不强制为同类实例分配不同 workspace。

### 3.3 子 Agent 必须在消息流中回复

Orchestrator 不能吞掉子 Agent 的结果后统一转述。正确消息流应该是：

```text
用户：
@claude1 @claude2 帮我讨论这个方案

Orchestrator：
我会分两路处理：
- claude1：分析技术架构
- claude2：分析产品边界

Claude 1：
这里的核心架构风险是...

Claude 2：
从产品体验看...

Orchestrator：
综合两边结论，建议...
```

Orchestrator 是主持人，不是代发言人。

### 3.4 工作区（参考单聊）

群聊 `workspace_path` 规则与 V1 单聊保持一致，不做额外分支：

- 新建群聊进入空白页后，用户须先选择工作区（Composer 工作区选择器 / `POST /api/workspace/select`），与单聊相同。
- 未选定工作区时禁止发送首条消息（含初始化 `@` 消息）；前端提示与单聊一致。
- 首条有效消息创建或绑定 `conversations.workspace_path`；后续子 Agent task 与附件路径校验均使用该目录。
- 群聊内所有已入群 Agent **共用**同一会话工作区；V2 不为每个 `conversation_agent_id` 分配独立 workspace。
- 工作区可在会话生命周期内通过 `PATCH /api/conversations/:id` 更新，规则同单聊。

### 3.5 停止生成与用户接管

停止语义 **对齐 V1 单聊 adapter run**，但粒度改为 **按子 Agent（`conversation_agent_id`）**：

| 层级 | V2 行为 |
| --- | --- |
| 用户操作 | 正在流式回复的子 Agent 气泡/头像旁显示停止按钮；点击后只停止 **该 Agent 当前 running 的 adapter run** |
| 后端 | 对该 task 关联的 `AbortController` 调用 `abort()`；adapter 收到 `signal` 后结束 |
| 数据 | 对应 `agent_run` → `cancelled`；assistant 消息 → `cancelled`；`orchestrator_tasks` → `cancelled` |
| Orchestrator run | **不**因单个 Agent 被 stop 而整体作废；同轮其余 running / pending task 继续，已完成 task 保留 |
| 会话状态 | 当本轮所有 task 进入终态（`done` / `failed` / `cancelled`）后，`orchestrator_runs` 与 `conversations.status` 回到 `done` |

**SSE 广播**（与单聊一致，并补充 task 维度）：

```text
message_status  { messageId, status: "cancelled" }
run_status      { runId, status: "cancelled" }
task_status     { taskId, status: "cancelled" }
```

右栏对应 Agent 行与 task 行同步更新为已取消。

**用户 stop 后的手动接管**：

- 当前 `orchestrator_run` 进入部分完成态；Orchestrator **不**自动重规划剩余 pending task。
- 用户可在 Composer 中 `@某个已入群 alias` 并附带新指令，触发新一轮用户消息。
- Planner 看到用户显式 `@` 某 Agent 时，优先进入 `single_agent` 模式，只给被 @ 的 Agent 分派一条 task，并在 Orchestrator 消息中简短说明「按你的指定继续交给 xxx」。
- 未被 @ 的 Agent 在本轮不自动出场；用户也可不 @ 任何 Agent，由 Orchestrator 在 roster 内自行选择（与 §3.1 一致）。

V2 **不提供**「一键停止整轮 Orchestrator 下所有 Agent」的全局 stop；若需全部停下，用户对每个仍在 running 的 Agent 分别点停止，或等待其自然结束。

### 3.6 需求澄清与任务分配

用户发出需求后，Orchestrator **先判断信息是否足够**，再决定是否调度子 Agent：

```text
用户：@claude1 @claude2 帮我把登录页做了

Orchestrator：在开始前我需要确认几点：
1. 登录页是邮箱+密码还是 OAuth？
2. 是否需要对接现有 API，还是先做静态 UI？
3. 有无设计稿或参考页面？

用户：邮箱+密码，对接现有 /api/auth，先做 MVP

Orchestrator：收到。我会这样分工：
- claude1：梳理 API 与表单校验
- claude2：实现登录页组件
…
```

**澄清规则**：

| 情况 | Orchestrator 行为 |
| --- | --- |
| 需求模糊、缺关键约束（范围、验收标准、技术边界等） | 发 **澄清消息**（普通 Orchestrator 气泡），列出具体问题；**不**创建 task、**不**调用子 Agent |
| 用户已 @ 某 Agent 且指令足够明确 | 可跳过或只做 1 条极短确认，优先进入执行 |
| 用户未 @ 任何 Agent，或 @ 了但未说明谁做什么 | Orchestrator **负责**在 roster 内选 Agent、定协作模式、写 `assignment_reason` |
| 用户回复澄清问题 | 视为同一会话目标的续聊；重新评估是否足够，足够则进入 plan → dispatch |
| 用户明确说「直接做 / 不用问了」 | 视为信息足够，Orchestrator 按现有信息执行并在计划中注明假设 |

**V2 限制**：

- 同一用户目标下，Orchestrator **最多连续澄清 2 轮**（不含用户回答）；仍不足则带明确假设进入执行，并在计划消息中列出假设。
- 澄清阶段 **不**进入 `revise` 循环；只有已 dispatch 后的 review 才走 §5.1 的 revise 上限。

**与初始化的关系**：

- 首条 `@` 初始化消息若同时包含任务描述，Orchestrator 在 roster 写入后同样先走澄清判断；信息不足时只追问，不 dispatch。
- 初始化要求（至少 2 个有效 `@`）不变；澄清不改变 roster。

## 4. Orchestrator 定位

Orchestrator 是群聊协作的控制平面，不是一个可聊天 Agent，也不是 Claude Code / Codex / OpenCode 的某个实例。

它负责：

- 判断用户当前描述是否足以安全执行（范围、约束、验收、分工是否清晰）。
- 信息不足时向用户追问，直到认为足够或达到 V2 澄清轮次上限。
- 用户未指定 Agent 分工时，在 roster 内选择执行者与协作模式。
- 判断本轮请求是否需要多 Agent。
- 选择协作模式。
- 生成结构化计划。
- 校验计划是否合法、是否越权、是否过度分派。
- 调度子 Agent 执行任务。
- 维护任务状态。
- 收集子 Agent 输出。
- 做结构检查、一致性检查和验收检查。
- 必要时安排一次返工。
- 写入最终汇总消息。

它不负责：

- 直接写代码。
- 直接改文件。
- 直接执行 shell 命令。
- 代替子 Agent 输出任务结果。
- 把自己暴露为可选聊天对象。
- 代替用户做产品/业务终局决策（只能追问缺失信息并给出可执行假设，不能替用户定需求）。

## 5. Orchestrator 模块设计

新增目录：

```text
lib/orchestrator/
├── service.ts
├── context.ts
├── planner.ts
├── validator.ts
├── scheduler.ts
├── invoker.ts
├── evaluator.ts
├── aggregator.ts
├── runtime-inspection.ts
└── types.ts
```

### 5.1 OrchestratorService

总入口，负责串起完整状态机：

```text
user_message
  -> build_context
  -> plan                    // 输出 clarify | execute
  -> clarify?                // 信息不足：Orchestrator 追问，结束本轮，等待用户下一条消息
  -> validate                // 信息足够：校验计划
  -> dispatch
  -> collect
  -> evaluate
  -> revise?
  -> summarize
```

澄清与执行 **互斥**：`clarify` 阶段不创建 `orchestrator_tasks`、不调用 Invoker。

V2 限制最多两轮执行 revise：

```text
plan -> execute -> review/verify -> optional revise -> summary
```

同一用户目标下澄清最多 2 轮（见 §3.6）。

### 5.2 Planner

Planner 是 Orchestrator 内部模块，不是独立 Agent。它调用 Provider LLM，将用户意图转为 **澄清判断** 或 **结构化协作计划**。

Planner 输出两种 phase（JSON）：

```json
{
  "phase": "clarify",
  "analysis": "用户想实现登录页，但未说明鉴权方式与是否对接 API",
  "questions": ["登录方式？", "是否对接现有 API？", "有无设计参考？"],
  "missing_info": ["auth_method", "api_scope"]
}
```

```json
{
  "phase": "execute",
  "mode": "parallel_investigation",
  "analysis": "...",
  "collaboration_reason": "...",
  "tasks": [ "..."]
}
```

`phase=clarify` 时 Validator 只校验：问题非空、未越权指派 Agent、未偷偷创建 task。  
`phase=execute` 时走完整 Validator（§5.3）。

Planner 必须支持 `single_agent` 模式。提示词中写入硬规则：

```text
先判断信息是否足够再决定是否 dispatch。缺范围、验收标准、技术约束、或分工不清时，输出 phase=clarify 和具体问题，不要猜测后立刻派 Agent。
用户未 @ 任何 Agent，或未说明谁做什么时，由你在 roster 内分配；必须在 assignment_reason 中说明理由。
用户已 @ 某 Agent 且任务足够明确时，可 phase=execute；必要时最多 1 条简短确认，不要冗长盘问。
用户明确表示「直接做 / 不用问」时，phase=execute，在 analysis 中列出你的假设。
当前群聊已经由两个或以上 Agent 初始化；你只能从当前 roster 中选择执行者。
你不需要每一轮都调用多个 Agent。
如果用户请求简单、范围单一、或后续消息明确 @ 某个已入群 Agent，应选择 single_agent 模式。
只有在任务需要多视角分析、并行调查、实现+审查、方案比较、或明确要求多个 Agent 协作时，才选择多个 Agent。
选择 single_agent 时，必须给出简短原因，并只创建一个 task。
选择多 Agent 时，必须说明每个 Agent 的分工理由。
不要为了让群聊显得热闹而分派无必要任务。
```

### 5.3 Validator

纯代码校验，不相信 LLM 输出。Validator 不判断任务语义是否“真的必要”，只校验结构、权限和可枚举的产品策略。检查：

- assignee 是否属于当前群聊成员。
- task 依赖是否存在。
- 是否有循环依赖。
- `single_agent` 模式是否只包含一个 task。
- reviewer / verifier 是否申请了写权限。
- 写任务是否被多个 Agent 并行执行。
- 是否任务数量过多。
- 计划是否违反初始化后的固定 roster 约束。
- 多 Agent 分配是否缺少 `collaboration_reason` 和每个 task 的 `assignment_reason`。

### 5.4 Scheduler

执行轮次和依赖。任务状态：

```text
pending -> running -> done / failed / cancelled
```

无依赖任务可并行，但写操作保守串行。

V2 默认规则：

```text
read / analyze / summarize / review -> 可并行
edit / write / run_command -> 默认串行
```

### 5.5 Invoker

把 Orchestrator task 转成具体 adapter 调用：

```text
claude1 -> ClaudeCodeAdapter.run(...)
claude2 -> ClaudeCodeAdapter.run(...)
codex1  -> CodexAdapter.run(...)
```

调用时构造面向该子 Agent 的 task prompt，并要求它作为群聊成员直接回复。

### 5.6 Evaluator

Evaluator 不是自己写答案，而是根据事实判断是否进入下一步：

- task 是否完成。
- adapter 是否返回错误。
- reviewer 是否指出 blocking 问题。
- 验证命令是否通过。
- 用户目标是否仍有明显缺口。

V2 简化策略：

- 子任务失败：停止依赖任务，Orchestrator 说明失败点。
- reviewer 指出 blocking：允许一次 revise。
- 其他情况：进入 summary。

### 5.7 Stop（按 Agent 粒度）

复用 V1 `lib/conversations/runs.ts` 的 `AbortController` 模式，Orchestrator 在 `Invoker` 启动每个 task 时注册 `{ taskId, runId, conversationAgentId, controller }`。

- `POST /api/conversations/:id/stop` 请求体：`{ conversationAgentId: string }`（群聊必填；单聊仍可无 body，行为与 V1 一致）。
- 查找该 Agent 在当前 `orchestrator_run` 中 `status=running` 的 task 与 adapter run，执行 abort。
- 通过 `stream-bus` 推送 §3.5 所列 SSE 事件；Scheduler 将该 task 的依赖后继标为 `cancelled` 或 `skipped`（V2 默认 **cancelled**，不自动改派给其他 Agent）。
- stop 后 **不**触发 Evaluator 的 revise / summary；等用户下一条消息或同轮其余 task 全部结束后，再决定是否 summary。

### 5.8 Aggregator

汇总最终结果，但不替代子 Agent 的原始回复。最终消息包含：

- 参与 Agent。
- 分工过程。
- 每个任务结果。
- 验证结果。
- 剩余风险。
- 下一步建议。

## 6. 协作模式

V2 内置四种协作模式。

### 6.1 single_agent

适用：

- 简单问答。
- 单点解释。
- 初始化后用户明确 @ 一个已入群 Agent。
- 不需要交叉验证的明确任务。

输出一条任务，只分配给一个已入群 Agent。Orchestrator 需要写一条短消息解释为什么本轮不启用多 Agent。

### 6.2 parallel_investigation

适用：

- 读项目。
- 查架构。
- 多模块调查。
- 需求和代码现状对齐。

示例分工：

- `claude1` 看 UI。
- `claude2` 看 API / DB。
- `codex1` 看 adapter / runtime。

### 6.3 compare

适用：

- 架构方案比较。
- 产品取舍。
- 技术路线争议。

多个 Agent 独立给方案或反对意见，Orchestrator 汇总共同点、冲突点和建议取舍。

### 6.4 implement_review

适用：

- 代码实现。
- UI 接 API。
- 后端功能补齐。

V2 默认只允许一个主写 Agent。其他 Agent 做 review / verify。

### 6.5 pipeline

适用：

- 长链路任务。
- 需要设计、实现、验证、修复和汇总。

按阶段串行推进。

## 7. 上下文管理

### 7.1 事实源上下文

数据库是事实源，包括：

- conversation
- conversation_agents
- messages
- tasks
- task_runs
- artifacts
- workspace_path
- adapter health
- runtime inspection

### 7.2 Planner 上下文

Planner 不读取完整历史，只读取压缩上下文：

- 当前用户消息。
- 当前群聊成员 roster。
- 每个成员 alias、platform、能力、状态。
- 可探测模型信息。
- 最近 N 条关键消息。
- 会话摘要。
- 已 pin 的长期上下文。
- 最近任务结果摘要。
- 当前 workspace、附件、产物摘要。

### 7.3 子 Agent 执行上下文

每个子 Agent 只拿与任务相关的上下文：

- 用户原始请求。
- Orchestrator 分配的任务。
- 自己的 alias 和职责。
- 必要历史摘要。
- 上游任务结果。
- 相关附件 / artifact / workspace 路径。
- 输出要求：直接作为群聊成员回复。

不要把完整群聊历史全部塞给每个 Agent。

### 7.4 Evaluator / Aggregator 上下文

用于检查和汇总：

- 用户原始目标。
- Orchestrator 计划。
- 每个 task 的状态。
- 每个 Agent 的最终回复。
- 产物和验证结果。
- 错误原因。

### 7.5 摘要策略

V2 初版：

- 最近 10-20 条消息直接带入。
- 更早历史用 `conversation.summary`。
- 每个 task 完成后生成 `task_result_summary`。
- `pinned` 作为数据结构预留，UI 可后续补。

## 8. Agent Runtime 与模型探测

不要让用户在设置里手动填写内置 Agent 的模型或档位。模型信息由 adapter / Orchestrator 尽力获取，并放入 Orchestrator 上下文。

### 8.1 Runtime 上下文

```ts
type ConversationAgentRuntimeContext = {
  conversationAgentId: string;
  alias: string;
  platform: string;
  adapter: string;
  modelName?: string | null;
  modelFamily?: string | null;
  qualityTier?: "cheap" | "balanced" | "strong" | "unknown";
  contextWindow?: number | null;
  supportsToolUse?: boolean;
  supportsVision?: boolean;
  supportsFileEdit?: boolean;
  runtimeStatus: "available" | "unavailable" | "unknown";
  modelInfoSource: "env" | "config" | "cli_json_event" | "provider" | "unknown";
  confidence: "high" | "medium" | "low";
  lastUpdatedAt: number;
};
```

### 8.2 Adapter inspectRuntime

扩展 adapter 契约：

```ts
type AgentAdapter = {
  platform: AgentPlatform | string;
  healthcheck(): Promise<AdapterHealth>;
  inspectRuntime?(): Promise<AgentRuntimeInfo>;
  run(params: AdapterRunParams): AsyncIterable<AgentEvent>;
};
```

探测顺序：

1. AgentHub 显式传入的 `--model` 或 provider model。
2. 环境变量。
3. CLI 配置文件。
4. 运行时 JSON / verbose event。
5. unknown。

### 8.3 没有模型信息时

如果无法获取模型名，不要猜。

```json
{
  "modelName": null,
  "qualityTier": "unknown",
  "modelInfoSource": "unknown",
  "confidence": "low"
}
```

Planner 看到 unknown 时，只按能力、权限、历史成功率和可用状态分配，不得声称某 Agent 更便宜或更强。

### 8.4 调度使用模型信息的原则

模型信息只是优化项，不是必要项。

优先级：

```text
用户显式指定
> Agent 能力匹配
> 权限 / 工具能力
> 可用性 / 历史成功率
> 模型质量 / 成本信息
```

复杂任务优先选择 `strong` 或上下文更大的 Agent；简单任务可选择 `cheap` / `balanced`。如果模型信息 unknown，则降级为能力驱动调度。

## 9. 数据模型增量

在 V1 schema 基础上补充。

```text
providers
├── id
├── name
├── protocol
├── base_url
├── api_key_encrypted
├── default_model
├── enabled
├── created_at
└── updated_at

orchestrator_settings
├── id
├── planner_provider_id
└── updated_at

conversation_agents
├── id
├── conversation_id
├── agent_id
├── alias
├── display_name
├── role_hint
├── status
├── joined_at
└── runtime_context_json

orchestrator_runs
├── id
├── conversation_id
├── user_message_id
├── mode
├── goal
├── status
├── plan_json
├── evaluation_json
├── clarification_round
├── started_at
└── finished_at

orchestrator_tasks
├── id
├── orchestrator_run_id
├── conversation_id
├── assignee_conversation_agent_id
├── round_id
├── role
├── description
├── permission
├── depends_on_json
├── status
├── result_message_id
├── result_summary
├── error
├── started_at
└── finished_at
```

`orchestrator_runs.status` 至少包含：`planning` | `awaiting_user` | `running` | `done` | `failed` | `cancelled`。  
`phase=clarify` 结束时为 `awaiting_user`，用户下一条消息复用同一目标上下文重新 plan。

`messages` 需要能表达：

- `role = "orchestrator"` 或 `author_type = "orchestrator"`。
- `role = "assistant"` 且绑定 `author_conversation_agent_id`。
- 消息关联 `orchestrator_task_id`。

## 10. API 增量

### 10.1 Provider

```text
GET    /api/providers
POST   /api/providers
PATCH  /api/providers/:providerId
DELETE /api/providers/:providerId
POST   /api/providers/:providerId/test
```

### 10.2 Orchestrator 设置

```text
GET   /api/orchestrator/settings
PATCH /api/orchestrator/settings
```

### 10.3 群聊

V2 修改 V1 group 400 边界：

```text
POST /api/conversations { mode: "group" }
POST /api/messages      // group conversation 走 Orchestrator
GET  /api/conversations/:id/messages
GET  /api/conversations/:id/stream
POST /api/conversations/:id/stop   // body: { conversationAgentId } 群聊按 Agent 停止；单聊可无 body
```

**Stop 响应**（与 V1 一致扩展）：

```json
{ "ok": true, "runId": "...", "taskId": "..." }
```

无 running task 时：`{ "ok": true, "alreadyStopped": true }`。

### 10.4 Runtime inspection

```text
GET /api/agents/runtime
```

返回各 adapter health + runtime info，用于设置页展示和 Orchestrator roster 构造。

## 11. SSE 事件增量

新增事件：

```text
orchestrator_clarify
orchestrator_plan
task_created
task_status
task_result
agent_runtime_status
orchestrator_summary
```

子 Agent 的流式回复仍使用消息事件，但消息必须带 `author_conversation_agent_id`。

## 12. 前端改造

### 12.1 群聊消息流

- 去掉真实群聊路径上的 mock 数据。
- 支持 Orchestrator 气泡。
- Orchestrator **澄清追问**与**计划/汇总**均用普通消息气泡展示（澄清消息无 task、无子 Agent 流式）。
- 支持多 Agent assistant 气泡。
- 每个子 Agent 回复显示 alias、头像、平台、状态。
- 子 Agent 流式输出直接进入对应气泡。
- 子 Agent 处于 `running` 时，头像旁显示停止按钮；点击调用 `POST .../stop` 并传 `conversationAgentId`。
- **不在消息流内嵌任务进度卡片**；Orchestrator 计划与汇总以普通消息气泡展示，任务明细只在右栏。

### 12.2 Composer

- 新群聊初始化态要求用户 @ 两个或以上 Agent；少于两个有效 mention 时不发送给 Planner。
- 初始化后只允许 @ 已加入 alias。
- @ 未加入 Agent 时展示 V2 不支持中途邀请的提示。

### 12.3 右栏

群聊右栏是 **任务进度与状态的唯一主界面**（消息流不重复做 task 卡片）：

- 多 Agent 状态（含 running 时该行可显示停止，与消息流头像 stop 等价）。
- 当前 Orchestrator run。
- task 列表：assignee、状态、依赖；随 SSE `task_status` 实时更新。
- 产物按来源 Agent 聚合。

### 12.4 设置页

- Provider CRUD。
- Orchestrator planner provider 选择。
- Adapter health 和 runtime inspection 展示。
- 不提供内置 Agent 模型/档位手动填写入口。

## 13. 实施阶段

### Phase V2.0 文档与契约

- 更新 API 契约，补充 group / Orchestrator / Provider。
- 明确 schema 增量。
- 明确 SSE 事件。

验收：

- 文档能解释群聊中子 Agent 直接回复。
- 文档能解释 Orchestrator 不写入。
- 文档能解释 single-agent 调度。
- 文档能解释澄清阶段不 dispatch、用户未指定分工时由 Orchestrator 分配。

### Phase V2.1 Provider 与 runtime inspection

- 新增 Provider 表和 CRUD。
- 新增 Orchestrator settings。
- 扩展 adapter `inspectRuntime?()`。
- runtime info 放入 Orchestrator roster。

验收：

- 可保存 `openai_compatible` Provider。
- Orchestrator 能用 Provider 完成一次 planner 调用。
- CLI Agent 模型信息获取不到时显示 unknown。

### Phase V2.2 群聊后端

- 允许创建 group conversation。
- 群聊工作区选择与单聊对齐（未选工作区不可发消息）。
- 实现群聊初始化。
- 支持同基础 Agent 多实例。
- 消息支持 `author_conversation_agent_id`。
- 实现按 `conversationAgentId` 的 stop API 与 SSE。

验收：

- 未选工作区无法发送群聊首条消息。
- 第一条群聊消息 @ 多 Agent 后写入 roster。
- `claude1` / `claude2` 可区分。
- 初始化后 @ 新 Agent 被明确拒绝。
- stop 某 Agent 后其消息与 task 为 `cancelled`，同轮其他 Agent 不受影响。

### Phase V2.3 Orchestrator P0

- 实现 `service / planner / validator / scheduler / invoker / evaluator / aggregator`。
- Planner 支持 `phase=clarify | execute`；澄清轮次上限与 §3.6 一致。
- 支持 `single_agent`、`parallel_investigation`、`compare`、`implement_review`。
- 子 Agent 回复写入群聊消息流。

验收：

- 模糊需求时 Orchestrator 先追问，不立刻调用子 Agent。
- 用户补充信息后 Orchestrator 再出计划并 dispatch。
- 用户未指定 Agent 分工时，Orchestrator 自动分配并说明理由。
- 已初始化群聊中的简单任务只调用一个已入群 Agent，并解释原因。
- 复杂任务分派多个 Agent。
- 子 Agent 各自流式回复。
- Orchestrator 最后总结。

### Phase V2.4 前端真实联动

- 群聊消息流接真实 API / SSE。
- 右栏任务状态接真实 task。
- Composer 支持初始化、alias 校验与工作区选择（同单聊）。
- 子 Agent 头像 stop 与右栏 stop 均可取消当前 run。

验收：

- 群聊从初始化到多 Agent 回复完整可演示。
- 任务状态仅在右栏展示并与 SSE 同步；消息流无内嵌 task 卡片。
- stop 后用户 `@` 指定 Agent 可继续分配单任务。
- 刷新后群聊历史、任务状态、Agent 身份恢复。

### Phase V2.5 QA 与收口

- 跑 typecheck / build。
- 人工验证单聊不退化。
- 人工验证群聊主路径。
- AI review 只看 bug、边界、退化和缺失测试。
- 问题写入 `docs/state/TOFIX.md`。

## 14. V2 Demo 脚本

1. 新建群聊并选择工作区。
2. 输入 `@claude1 @claude2 帮我把登录页做了`（故意模糊）。
3. Orchestrator 发出澄清问题，不调用子 Agent。
4. 用户补充：邮箱+密码、对接现有 API、先做 MVP。
5. Orchestrator 发送计划并说明 claude1 / claude2 分工。
6. Claude 1 流式回复技术/API 分析。
7. Claude 2 流式回复 UI 实现思路或代码。
8. Orchestrator 汇总。
9. 再发一个简单明确问题，Orchestrator 只派一个 Agent 并解释原因。
10. 演示 stop 后 `@` 指定 Agent 续派。
11. 展示右栏多 Agent 状态、任务分派、产物来源。

## 15. 验收标准

- 群聊中子 Agent 直接回复，不由 Orchestrator 统一转述。
- Orchestrator 能解释为什么在已初始化群聊中只派一个 Agent 或为什么使用多个 Agent。
- 需求模糊时 Orchestrator 先澄清再 dispatch；用户未指定分工时由 Orchestrator 分配。
- 同基础 Agent 多实例可区分。
- Orchestrator 不写代码、不直接执行命令。
- Provider 支撑 Planner 调用。
- Runtime inspection 进入 Orchestrator 上下文，模型 unknown 时不硬猜。
- group conversation 刷新后历史和任务状态可恢复。
- 群聊工作区规则与单聊一致；未选工作区不可发消息。
- 任务进度仅在右栏展示，消息流无内嵌 task 卡片。
- 按 Agent stop 后 SSE 与单聊一致（`message_status` / `run_status` / `task_status`）；用户可 `@` Agent 手动续派任务。
- 单聊 V1 主链路不退化（含无 body 的 `POST .../stop`）。

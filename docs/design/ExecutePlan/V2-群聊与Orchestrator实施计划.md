# V2 群聊与 Orchestrator 实施计划

> **文档基线（2026-05-29）**：以当前仓库代码为准。V1 单聊 + 群聊静态 UI、**V1.5 交互桥接（Approval + Choice）** 已在代码中落地；V2 在此基础上接群聊真实链路与 Orchestrator，**不重做** V1.5 交互后端。

---

## 给后续 Agent 的推进规则

1. **按 Phase 顺序推进**：从「前置门禁」→ `V2.0` → … → `V2.5`；每个 Phase **验收通过后再进下一 Phase**，避免 Orchestrator、schema、群聊 UI、SSE 同时大改导致难定位。
2. **文件所有权**（见根目录 `AGENTS.md`）：`lib/orchestrator/` 仅 Orchestrator；`lib/db/` + `app/api/` 归 DB/API；`components/` + `app/` 归 UI；`lib/adapters/` 归适配器；**禁止**在 Invoker 里重写一套 adapter 循环，须扩展 `lib/conversations/runs.ts`。
3. **V1.5 后端不重做**：`lib/interactions/`、respond API、SSE `interaction_*` 直接复用；V2 只补群聊字段写入与 UI 挂载。
4. **原型优先于 mock**：群聊运行态 UI 以 `docs/design/prototypes/v2/` 为准；**删除** `lib/mock/group-conversation.ts` 中内嵌 `tasks` 与消息流 task-board（与附录 A.2、原型红色虚线一致）。
5. **单聊不退化**：每 Phase 结束跑单聊 smoke（发消息、SSE、stop 无 body、inline Approval/Choice、regenerate）。
6. **卡住时**：非主线问题写入 `docs/state/TOFIX.md`，不要大范围重构。

**推荐并行**：`V2.1`（Provider）与 `V2.2`（群聊 schema/roster API）可由不同 Agent 并行；**`V2.3` 必须等 V2.1 + V2.2 都验收**。

---

## 一、总体目标

V2 把 V1 群聊静态 UI（`lib/mock/group-conversation.ts`）接成真实链路：用户在一个群聊中 @ 多个 Agent 初始化 roster，Orchestrator 组织协作，子 Agent 在消息流中各自回复，Orchestrator 最后汇总。

- V2 **不追求**「每轮所有 Agent 都出场」。
- 群聊须先由 **两个或以上** Agent 实例初始化；之后 Orchestrator 可只派一个已入群 Agent，也可多 Agent 协作。
- **Orchestrator 不是可 @ 的 Agent**：创建群聊后由系统自动加入控制平面；Composer **不能** `@orchestrator`（与 `ConversationSetup`「Orchestrator 自动加入」一致）。

---

## 二、V2 原型对照（实现前必读）

| 原型文件 | 用途 | 主要落点 | 对应 Phase |
| --- | --- | --- | --- |
| `prototypes/v2/group-interaction-ui-recommendation.html` | 群聊运行态总览：气泡下 inline 交互、右栏两区块、**不要**工作区/产出/右栏审批按钮 | `MessageBubble.tsx`、`GroupContext`、`ContextPanel.tsx` | **V2.4** |
| `prototypes/v2/approval-ui.html` | Approval 单聊 Tab① / 群聊 Tab②：卡片在 Agent 气泡下，右栏仅状态 | `InteractionApprovalCard.tsx`（复用） | **V2.4**（组件 V1.5 已有） |
| `prototypes/v2/choice-ui.html` | Choice inline 单选 + 可选自定义；右栏仅 `awaiting_choice` | `InteractionChoiceCard.tsx`（复用） | **V2.4** |
| `prototypes/v1/group-chat-new.html`、`group-chat.html` | 群聊三栏布局、Orchestrator 气泡、多 Agent 头像 | `AppShell`、群聊路由 | V1 已 React 化；V2.4 接真数据 |

**群聊右栏铁律**（来自 `group-interaction-ui-recommendation.html` 表格与红色虚线）：

- **消息流**：Approval / Choice 的**操作**只在对应 Agent 气泡下 inline。
- **右栏 · 参与上下文**：各 alias + Orchestrator 状态文案（含 `awaiting_approval` / `awaiting_choice` 摘要），**只读**。
- **右栏 · 任务分派**：`orchestrator_tasks` 列表（assignee、状态），SSE `task_status` 更新，**只读**。
- **右栏不要**：工作区区块、产出文件、进度 todo、Approval/Choice 按钮列表（属 `SingleContext`，非 `GroupContext`）。

---

## 三、目录结构（V2 增量）

在 V1 骨架上新增/扩展：

```text
lib/
├── orchestrator/              # V2.3 新建（当前不存在）
│   ├── service.ts
│   ├── context.ts
│   ├── planner.ts
│   ├── validator.ts
│   ├── scheduler.ts
│   ├── invoker.ts
│   ├── evaluator.ts
│   ├── aggregator.ts
│   ├── runtime-inspection.ts
│   └── types.ts
├── conversations/
│   ├── runs.ts                  # 扩展：conversationAgentId、按 Agent stop
│   └── stream-bus.ts            # 扩展：task_*、orchestrator_* 事件
├── agents/
│   └── mention.ts               # 扩展：slug 初始化 vs alias 后续 @
├── interactions/                # V1.5 已有，V2 只写 conversationAgentId / orchestratorTaskId
└── db/schema.ts                 # V2.0 定稿 migration，V2.2 执行

app/api/
├── providers/                   # V2.1
├── orchestrator/settings/       # V2.1
├── conversations/[id]/stop/     # V2.2 群聊 body
└── agents/runtime/              # V2.1

components/
├── chat/                        # V2.4 群聊气泡、stop、inline 交互挂载
└── context/ContextPanel.tsx     # V2.4 GroupContext 真数据
```

---

## 四、阶段拆分（Agent 主入口）

> 本计划**不要一次性做完**。每 Phase 含：**目标 → 前置依赖 → 工作清单 → 原型/文件 → 验收**。详细领域规则见文末 **附录 A–J**（原 §3–§12）。

### Phase V2.0：文档、契约与 schema 设计

**目标**：评审能讲清 V1.5 复用点、破坏性 migration、群聊消息流**无 task 卡片**；不写 Orchestrator 业务代码。

**前置依赖**：§0 门禁（V1.5 单聊 E2E）已人工确认。

**工作**：

- 更新 `docs/design/API_CONTRACT.md`：**先补 V1.5 交互端点**，再写 group / Orchestrator / Provider / SSE 增量。
- 更新 `docs/design/TECH_DESIGN.md` §7.2–7.4（interaction、`agent_external_sessions`、adapter 现状）。
- 定稿附录 H.3 migration（`conversation_agents`：删 `(conversation_id, agent_id)` 唯一、加 `alias` 等）。
- 定稿附录 B.1 alias 规则与 `mention.ts` 扩展设计（slug 初始化 vs alias 后续 @）。
- 在 `REVIEW_CHECKLIST.md` 草拟 V2 段（可先占位）。

**涉及文件**：`docs/design/*`（无 `lib/orchestrator/` 实现）。

**验收**：

- [ ] 评审能说明：V1.5 哪些 API/SSE/表直接复用。
- [ ] migration 脚本步骤与回滚策略书面定稿。
- [ ] 文档明确：任务进度**只在右栏**，消息流禁止内嵌 task-board。

---

### Phase V2.1：Provider 与 runtime inspection

**目标**：Planner 有可配置的 `openai_compatible` Provider；设置页不再用 Provider mock；runtime 可探测（unknown 不硬猜模型）。

**前置依赖**：V2.0 契约中 Provider / `orchestrator_settings` 字段已定稿。

**工作**：

- 新增表 `providers`、`orchestrator_settings`（见附录 G）。
- 实现 `GET|POST|PATCH|DELETE /api/providers`、`POST .../test`。
- 实现 `GET|PATCH /api/orchestrator/settings`。
- 各 adapter 可选 `inspectRuntime?()`；`GET /api/agents/runtime`。
- 设置页：`lib/mock/providers.ts` → 真实 API（`SettingsModal`）。

**涉及文件**：`lib/db/schema.ts`、`app/api/providers/`、`app/api/orchestrator/`、`lib/adapters/*.ts`、`components/settings/`。

**验收**：

- [ ] 可保存并测试 `openai_compatible` Provider。
- [ ] Planner smoke：HTTP 调 LLM 成功一次（脚本或临时 route 均可）。
- [ ] `modelName` unknown 时 UI/Planner 行为符合附录 H（不按模型名瞎调度）。
- [ ] 单聊功能不退化。

---

### Phase V2.2：群聊后端基础（roster、schema、stop）

**目标**：群聊能建会话、首条消息初始化 roster（含同 slug 多实例）、校验 mention/工作区；按 Agent 粒度 stop；**尚未**要求完整 Orchestrator 调度闭环。

**前置依赖**：V2.0 migration 定稿；建议 V2.1 已完成（V2.3 强依赖 Provider，但本 Phase 可不调 Planner）。

**工作**：

- 执行附录 H.3 migration：`conversation_agents`、`messages`、`agent_runs` 扩展字段。
- 放开 `POST /api/conversations { mode: "group" }`；`GET /api/conversations` 含 group。
- 首条消息：≥2 个有效 Agent mention → 生成 alias（`slug`、`slug-2`…）+ 写入 roster；Orchestrator 系统消息占位可先 stub。
- `POST /api/messages`：群聊校验工作区、`@` 规则；中途 @ 未入群 slug → 400 + 明确文案。
- `POST /api/conversations/:id/stop`：群聊 body `{ conversationAgentId }`；扩展 `runs.ts` 索引；SSE `task_status` cancelled（schema 可先写 task 表占位或 mock 事件，与 V2.3 对齐）。
- **本 Phase 可不实现**完整 `OrchestratorService` 闭环；群聊 send 可返回 501/明确「调度未就绪」或仅落库用户消息 + roster，避免与 V2.3 重复造调度器。

**涉及文件**：`lib/db/`、`lib/agents/mention.ts`、`lib/conversations/`、`app/api/conversations/`、`app/api/messages/`。

**验收**：

- [ ] 未选工作区不可发首条/后续消息。
- [ ] `@claude-code @claude-code` → `claude-code` + `claude-code-2` 两行 roster。
- [ ] 少于 2 个有效 mention → 400。
- [ ] 初始化后 @ 新 slug →「请新建群聊」类错误。
- [ ] stop 只影响指定 `conversationAgentId` 的 run（可用 fake/stub run 测）。
- [ ] 单聊 `stop` 仍无 body，行为不变。

---

### Phase V2.3：Orchestrator P0（调度闭环）

**目标**：群聊 `POST /api/messages` 走 Orchestrator：澄清 → 规划 → 分派 → 子 Agent 流式 → 汇总；task 与 `awaiting_interaction` 联动；子 Agent 消息带身份字段。

**前置依赖**：**V2.1 + V2.2 均验收**。

**工作**：

- 新建 `lib/orchestrator/*`（`service` → `plan` → `validate` → `dispatch` → `collect` → `evaluate` → `summarize`）。
- **Invoker** 薄封装：扩展 `startAgentRun({ conversationAgentId, orchestratorTaskId, taskPrompt })` + 已有 `drainAgentRun()`。
- Planner：`phase=clarify|execute` JSON；`single_agent` 与多 Agent 模式；clarify 不创建 task、不调 Invoker。
- Validator / Scheduler：task 状态含 `awaiting_interaction`；与 `agent_runs`、V1.5 interaction 同步。
- 子 Agent assistant 消息：`authorConversationAgentId`；interaction 写入 `conversationAgentId`、`orchestratorTaskId`。
- Orchestrator 消息 `role=orchestrator`；新增表 `orchestrator_runs`、`orchestrator_tasks`。
- SSE：`task_created`、`task_status`、`task_result`、`orchestrator_summary`（澄清可用 orchestrator 消息 + `awaiting_user`，不必单独事件）。

**涉及文件**：`lib/orchestrator/`、`lib/conversations/runs.ts`、`lib/conversations/stream-bus.ts`、`app/api/messages/`。

**验收**：

- [ ] Demo 步骤 1–7（§七）主路径可跑：澄清 → 多 Agent 流式 → 汇总。
- [ ] `single_agent` follow-up 可只派一个 Agent。
- [ ] 子 Agent 触发 Approval 时 task `awaiting_interaction` → respond 后 resume **同一 run**。
- [ ] Hermes（`supportsApproval: none`）不被派为 implement_review 主写 Agent。
- [ ] Orchestrator **不**代述子 Agent 全文（子 Agent 独立气泡）。

---

### Phase V2.4：前端真实联动

**目标**：群聊页面接 API/SSE；UI 对齐 V2 原型；去掉 group mock 与 task-board；Composer alias 规则生效。

**前置依赖**：V2.3 后端闭环可联调。

**工作**：

- 群聊消息流：Orchestrator / 子 Agent / 用户气泡；`authorConversationAgentId` 展示 alias、头像、平台、状态。
- 子 Agent running：头像旁 stop → `POST .../stop` + `conversationAgentId`。
- 复用 `InteractionApprovalCard` / `InteractionChoiceCard`：按 `messageId` + `conversationAgentId` 挂到**对应气泡下**（对照 `approval-ui.html` 群聊 Tab、`group-interaction-ui-recommendation.html`）。
- `ContextPanel` → `GroupContext`：仅「参与上下文」+「任务分派」；**移除** mock `groupMessages[].tasks` 与 `MessageBubble` task-board。
- Composer：初始化 ≥2 slug mention；初始化后仅 @ 已入群 **alias**；`ConversationSetup` 文案改为 V2 能力。
- 工作区：与单聊相同 pill；未选禁用发送。
- 设置页 Provider/Orchestrator：若 V2.1 未做完 UI，本 Phase 补齐。

**涉及文件**：`components/chat/`、`components/context/`、`app/c/[conversationId]/`、`lib/mock/group-conversation.ts`（退役消息 mock）。

**验收**：

- [ ] §七 Demo 脚本 1–10 可在浏览器完成。
- [ ] 刷新后 pending interaction 可 respond；消息流无 task 卡片。
- [ ] Approval/Choice **均在气泡下**；右栏**无**审批按钮/选项列表。
- [ ] 右栏有任务分派列表且随 SSE 更新。
- [ ] 单聊不退化（§八清单）。

---

### Phase V2.5：QA 与收口

**目标**：可演示、可交接；文档与检查清单同步。

**前置依赖**：V2.4 验收通过。

**工作**：

- `npm run typecheck` / `npm run build`。
- 单聊全链路 + interaction 回归。
- 群聊主路径人工验证（§七）。
- `REVIEW_CHECKLIST.md` 增 V2 段；问题入 `docs/state/TOFIX.md`。

**验收**：

- [ ] §八总验收标准全部勾选。
- [ ] `roadmap.md` / 本文件顶部基线日期可更新为收口日。

---

## 五、V2 Demo 脚本（端到端）

1. 新建群聊并选择工作区。
2. `@claude-code @codex 帮我把登录页做了`（故意模糊）。
3. Orchestrator 澄清，不调用子 Agent。
4. 用户补充：邮箱+密码、对接 `/api/auth`、MVP。
5. Orchestrator 计划并分工。
6. Claude Code / Codex 各自流式回复。
7. Orchestrator 汇总。
8. 简单 follow-up → `single_agent` 只派一个 Agent。
9. stop 后 `@claude-code`（alias）续派。
10. 右栏：参与上下文 + 任务分派（对照 `group-interaction-ui-recommendation.html`）。

---

## 六、总验收标准

- 群聊子 Agent 直接回复，Orchestrator 不代述。
- Orchestrator 能解释 single vs 多 Agent 分工。
- 模糊需求先 clarify；未指定分工时 Orchestrator 在 roster 内分配。
- 同基础 Agent 多实例（alias `-2`）可区分。
- Orchestrator 不写代码、不跑 shell。
- Provider 支撑 Planner；Planner 与内置 CLI Agent 鉴权分离。
- Runtime unknown 时不硬猜模型。
- group 刷新后历史、task、身份可恢复。
- 工作区规则与单聊一致。
- **任务进度仅在右栏**；消息流无内嵌 task 卡片。
- 按 Agent stop：`message_status` / `run_status` / `task_status`；可 `@` 续派。
- **单聊不退化**；**V1.5 交互 API/SSE 群聊复用**，无 single-only hardcode。

---

## 七、实现映射（当前仓库）

| 模块 | 路径 | V2 动作 |
| --- | --- | --- |
| 交互 | `lib/interactions/` | 复用 |
| Run / SSE | `lib/conversations/runs.ts`, `stream-bus.ts` | 扩展 |
| Mention | `lib/agents/mention.ts` | 扩展 alias 模式 |
| 群聊 mock | `lib/mock/group-conversation.ts` | V2.4 退役消息 mock |
| Orchestrator | `lib/orchestrator/` | V2.3 新建 |
| Provider mock | `lib/mock/providers.ts` | V2.1 退役 |
| API 契约 | `docs/design/API_CONTRACT.md` | V2.0 同步 |
| 群聊 UI 原型 | `docs/design/prototypes/v2/*.html` | V2.4 对齐 |

---

## 0. 前置：V1.5 交互桥接（门禁）

完整规格见 `docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md`。启动 V2 编码前，按 `docs/design/REVIEW_CHECKLIST.md` §V1.5 勾选。

### 0.1 代码中已具备（V2 直接复用）


| 能力                                                                                         | 现状位置                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `agent_interactions` 表；可空 `conversation_agent_id`、`orchestrator_task_id`                   | `lib/db/schema.ts`                                                        |
| `agent_runs.status` 含 `awaiting_interaction`                                               | `lib/db/schema.ts`                                                        |
| `AgentEvent.interaction_required`；`AdapterRunParams.requestInteraction`                    | `lib/adapters/types.ts`                                                   |
| run 挂起 / 唤醒                                                                                | `lib/interactions/run-bridge.ts`、`lib/conversations/runs.ts`              |
| 交互 CRUD + respond（含不可恢复 waiter → 409）                                                      | `lib/interactions/service.ts`                                             |
| `GET /api/conversations/:id/interactions?status=pending`                                   | `app/api/conversations/[conversationId]/interactions/route.ts`            |
| `POST /api/interactions/:interactionId/respond`                                            | `app/api/interactions/[interactionId]/respond/route.ts`                   |
| SSE `interaction_requested` / `interaction_resolved`；`run_status` 含 `awaiting_interaction` | `lib/conversations/stream-bus.ts`                                         |
| 单聊 inline Approval / Choice 卡片                                                             | `components/chat/InteractionApprovalCard.tsx`、`InteractionChoiceCard.tsx` |
| Claude / Codex / OpenCode `capabilities.supportsApproval/Choice = native`                  | 各 adapter；Hermes 为 `none`                                                 |


### 0.2 V2 只新增（不重做 V1.5 后端）

- 群聊 **Approval / Choice UI**：与单聊相同，均在 **对应 Agent 气泡下 inline**（复用 `InteractionApprovalCard` / `InteractionChoiceCard`）；右栏 **不** 重复交互卡片，只显示 `awaiting_approval` / `awaiting_choice` 状态摘要（见 `prototypes/v2/group-interaction-ui-recommendation.html`）。
- Orchestrator task / sub-agent run 进入 `awaiting_interaction` 时 pause；用户 resolve 后 **同一 `agent_run` resume**（与单聊一致）。
- Invoker 调用 adapter 时写入 `conversationAgentId`、`orchestratorTaskId` 到 interaction 上下文；前端按 `conversationAgentId` / `messageId` 把卡片挂到正确 Agent 气泡。

### 0.3 启动 V2 前仍须人工确认

- 单聊 Approval / Choice E2E（至少一个真实 adapter；fake 不能作为唯一依据）。
- 刷新后 pending interaction 可 respond；不可恢复时 409 + 明确 error 态（见 `docs/state/TOFIX.md` 已修项）。
- 单聊发消息 / SSE / stop / regenerate / 产物 / 工作区不退化。
- `docs/design/API_CONTRACT.md` 补录 V1.5 交互端点（V2.0 文档阶段一并完成）。

---

> **说明**：§一–§七 为 Agent 主入口；以下 §0 起为**领域规格与附录**（实现时按需查阅，不必每次重读全文）。

## 附录 A. 产品边界

### A.1 V2 必做

- 固定成员群聊：首条有效消息初始化 roster。  
- 同基础 Agent 多实例：如两个 `@claude-code` → `claude-code` 与 `claude-code-2`（见附录 B.1 alias 规则）。
- 子 Agent 在消息流直接回复，显示 alias、头像、平台、状态、产物。
- Orchestrator：计划、分派、任务状态、review/revise（有限）、汇总。
- 需求模糊时 Orchestrator 先澄清；用户未指定分工时由 Orchestrator 在 roster 内分配。
- 已初始化群聊内可 **single_agent** 只派一个 Agent 并说明原因。
- Orchestrator 上下文含各成员 adapter 能力（`capabilities`）、health、可探测 runtime（V2.1 起）。
- Provider 支撑 Planner LLM，优先 `openai_compatible`（见 `docs/design/TECH_DESIGN.md` §3）。
- 群聊工作区与单聊一致；子 Agent 共用 `conversations.workspace_path`。
- 群聊右栏仅 **参与上下文 + 任务分派**（对齐 `GroupContext`；无工作区/产出 section）。
- 每个 running 子 Agent 可单独 stop；stop 后用户可 `@` 已入群 alias 手动续派。

### A.2 V2 暂不做

- 中途 @ 新 Agent 加入当前群聊。
- 动态重规划无限循环。
- Agent 之间直接互相调用。
- 多 Agent 同轮并发写同一代码库。
- 复杂失败降级、代码冲突自动解决。
- 自建 Agent、SkillRunner、`/agent-creator`、`/skill-creator`。
- 多 workspace 隔离。
- 消息流内嵌 ta      sk 卡片（**须移除** 当前 mock 中 `groupMessages[].tasks` 与 `MessageBubble` 的 task-board 展示）。

初始化后 @ 未入群 Agent/slug：返回 `V2 暂不支持中途邀请新 Agent，请新建群聊。`

---

## 附录 B. 群聊语义

### B.1 初始化与 @ mention

群聊创建时不预选 Agent。第一条有效用户消息须 @ **两个或以上 Agent 实例**（可以重复同一 slug，如 `@claude-code @claude-code @codex`）。少于两个有效 mention 时后端 400，不进入 Planner。

**与现有 mention 解析衔接**（`lib/agents/mention.ts`）：

1. **初始化阶段**：仍解析 **Agent slug**（`@claude-code`、`@codex` 等），复用 `parseAgentMentions`。
2. **alias 生成**（写入 `conversation_agents.alias`，供后续 @ 与 UI 展示）：
  - 按消息中出现顺序，每个 mention 占 roster 一行。
  - 某 slug **首次**出现 → alias = 规范化 slug（如 `claude-code`）。
  - 同 slug **再次出现** → alias = `{slug}-2`、`-3`…（如 `claude-code-2`）。
  - `display_name` 默认取自 `agents.name`，可在 UI 显示为「Claude Code (2)」。
3. **Orchestrator** 在首条消息处理完成后自动写入一条 system/orchestrator 身份消息（非用户 @）。
4. **初始化后**：Composer 只允许 @ **已入群 alias**（不是任意新 slug）。解析器须区分「slug 初始化」与「alias 后续 @」两种模式。

示例（与当前 Setup 文案一致）：

```text
@claude-code @codex 帮我分析 V2 Orchestrator 应该怎么设计
→ roster: claude-code, codex

@claude-code @claude-code 并行做 UI 和 API 审查
→ roster: claude-code, claude-code-2
```

初始化后任务分配 **必须** 指向 `conversation_agent_id`，不能只指向底层 `agent_id`。

后续消息可 @ 零个、一个或多个已入群 alias；Orchestrator 只在固定 roster 内选人，不能把未入群 Agent 加入会话。

### B.2 同类 Agent 多实例

同一 `agents.id` 可对应多行 `conversation_agents`（V2 须 **移除** 现有 `(conversation_id, agent_id)` 唯一索引，改为 `(conversation_id, alias)` 唯一）。

每实例独立：`conversation_agent_id`、alias、展示名、消息身份、task 状态、`agent_runs`（含 `conversation_agent_id`）。共享底层 platform 配置与同一会话 `workspace_path`。

### B.3 子 Agent 必须在消息流中回复

Orchestrator 不得吞掉子 Agent 结果后统一代述。示意：

```text
用户：@claude-code @codex 帮我讨论这个方案

Orchestrator：我会分两路：claude-code 看架构，codex 看实现边界

Claude Code：架构风险是…

Codex：从实现看…

Orchestrator：综合结论…
```

### B.4 工作区（与单聊一致）

- 未选 `workspace_path` 禁止发首条消息（含初始化 @）。
- `POST /api/workspace/select` / `PATCH /api/conversations/:id` 规则同 V1。
- 群聊内所有成员共用同一会话工作区。

### B.5 停止生成与用户接管

**现状（单聊，V1.5）**：`POST /api/conversations/:id/stop` 无 body；`stopConversationRun()` 找该会话最近一个 `running|pending|awaiting_interaction` 的 run 并 abort；会 `cancelPendingRunInteractions`。

**V2 群聊扩展**（单聊保持无 body 行为不变）：


| 层级               | V2 行为                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------- |
| 用户操作             | running 子 Agent 气泡/头像旁 stop；只停 **该 `conversation_agent_id` 当前 run**                           |
| 后端               | 对该 task 的 `AbortController.abort()`；`cancelPendingRunInteractions` 若处于 `awaiting_interaction` |
| 数据               | `agent_run` → `cancelled`；assistant 消息 → `cancelled`；`orchestrator_tasks` → `cancelled`       |
| Orchestrator run | 单个 Agent stop **不**作废整轮；其余 task 继续                                                            |
| 会话               | 本轮所有 task 终态后 `orchestrator_runs` 与 `conversations.status` → `done`                           |


**SSE**（在 V1.5 已有事件上扩展）：

```text
message_status  { messageId, status: "cancelled" }
run_status      { runId, status: "cancelled" }    // 已有
task_status     { taskId, status: "cancelled" }   // V2 新增
interaction_resolved ...                          // stop 时 pending 交互 cancelled
```

stop 后不自动 summary；用户可 `@` 已入群 alias 续派（Planner 优先 `single_agent`）。

V2 **不提供**「一键停整轮所有 Agent」；须分别 stop 或等待结束。

### B.6 需求澄清与任务分配

（规则不变：模糊需求先 clarify 气泡、不 dispatch；最多连续澄清 2 轮；用户说「直接做」则带假设执行。）

---

## 附录 C. Orchestrator 定位

Orchestrator 是群聊 **控制平面**，不是 Claude Code / Codex 实例，不可被用户 @。

负责：澄清、规划、校验、调度、任务状态、收集输出、有限 revise、汇总。  
不负责：写代码、改文件、跑 shell、代述子 Agent 结果、替用户做产品终局决策。

---

## 附录 D. Orchestrator 模块设计

新增目录（当前 **不存在**，V2.3 实现）：

```text
lib/orchestrator/
├── service.ts
├── context.ts
├── planner.ts
├── validator.ts
├── scheduler.ts
├── invoker.ts          # 薄封装，见 §5.5
├── evaluator.ts
├── aggregator.ts
├── runtime-inspection.ts
└── types.ts
```

### 5.1 OrchestratorService

```text
user_message
  -> build_context
  -> plan                    // clarify | execute
  -> clarify?                // 只发 Orchestrator 消息，结束本轮
  -> validate
  -> dispatch
  -> collect
  -> evaluate
  -> revise?                 // 最多 1 次
  -> summarize
```

`clarify` 阶段不创建 `orchestrator_tasks`、不调用 Invoker。

### 5.2 Planner

内部模块，经 Provider HTTP 调 LLM（**不走** Claude Agent SDK）。输出 `phase=clarify|execute` JSON（结构见原文 §5.2 示例）。须支持 `single_agent` 与多 Agent 模式；硬规则不变。

### 5.3 Validator

纯代码校验：assignee ∈ roster、依赖无环、single_agent 仅一 task、写任务不并行、roster 固定等。

### 5.4 Scheduler

任务状态（与 `agent_runs` 对齐，含交互态）：

```text
pending -> running -> awaiting_interaction -> running -> done / error / cancelled
```

- sub-agent run 进入 `awaiting_interaction` 时，对应 `orchestrator_tasks.status` 同步为 `awaiting_interaction`。
- 用户 respond 后 task 回到 `running`，直至 `done|error|cancelled`。
- 读/analyze/review 可并行；edit/write/run_command 默认串行。

### 5.5 Invoker（复用现有 Run 管线）

**不要**在 Invoker 内重写一套 adapter 循环。应 **扩展** `lib/conversations/runs.ts`：

```text
Orchestrator task
  -> startAgentRun({ conversationId, agent, workspacePath, conversationAgentId, orchestratorTaskId, taskPrompt })
  -> drainAgentRun()   // 已有：text_delta、artifact、interaction_required、abort
  -> 子 Agent assistant 消息写入 messages（带 authorConversationAgentId）
```

要点：

- 每个 task 一条 `agent_runs` 行，**新增** `conversation_agent_id`（见 §9）。
- `requestInteraction` 回调写入 `conversationAgentId`、`orchestratorTaskId`（V1.5 字段已预留）。
- 多轮 CLI 会话复用 `agent_external_sessions`（已有表）。
- assignee 的 `agent_id` + platform 决定 `getAdapter(platform).run(...)`。

### 5.6 Evaluator / 5.8 Aggregator

（策略不变：子 task 失败停依赖；blocking review 允许一次 revise；汇总不替代子 Agent 原文。）

### 5.7 Stop（按 Agent 粒度）

在现有 `activeRuns: Map<runId, AbortController>` 上增加 **按 conversationAgentId 索引**（或 taskId → runId）。群聊 `POST .../stop` body：`{ conversationAgentId: string }`。

### 5.8 Aggregator

（不变。）

---

## 附录 E. 协作模式

`single_agent` | `parallel_investigation` | `compare` | `implement_review` | `pipeline` — 语义不变。

**implement_review 注意**：assignee 须 `capabilities.supportsApproval !== "none"`；Hermes（`noInteractionCapabilities`）不宜作为主写 Agent。

---

## 附录 F. 上下文管理

### 7.1 事实源（当前 + V2 增量）


| 表                                                                               | 阶段             |
| ------------------------------------------------------------------------------- | -------------- |
| `conversations`, `messages`, `message_attachments`                              | V1             |
| `agents`, `conversation_agents`, `agent_runs`, `artifacts`                      | V1（V2 扩展字段/语义） |
| `agent_interactions`, `agent_external_sessions`                                 | V1.5           |
| `providers`, `orchestrator_settings`, `orchestrator_runs`, `orchestrator_tasks` | V2 新增          |


不使用单独的 `task_runs` 表；task 与 `agent_runs` 通过 `orchestrator_tasks.result_message_id` / run 外键关联即可。

### 7.2–7.5 Planner / 子 Agent / Evaluator 上下文、摘要策略

（不变；Planner roster 须含 `AdapterCapabilities` 与 runtime inspection 结果。）

---

## 附录 G. Agent Runtime 与模型探测

### 8.1 Runtime 上下文类型

（`ConversationAgentRuntimeContext` 结构不变，存入 `conversation_agents.runtime_context_json`。）

### 8.2 Adapter 契约（现状 + V2 增量）

**现状**（`lib/adapters/types.ts`，V2 Invoker 必须遵守）：

```ts
type AgentAdapter = {
  platform: AgentPlatform | string;
  capabilities: AdapterCapabilities;  // supportsApproval / supportsChoice
  healthcheck(): Promise<AdapterHealth>;
  run(params: AdapterRunParams): AsyncIterable<AgentEvent>;
};

type AdapterRunParams = {
  runId: string;
  conversationId: string;
  workspacePath: string;
  messages: AdapterMessage[];
  attachments: AdapterAttachment[];
  externalSessionId?: string;
  signal: AbortSignal;
  requestInteraction(...): Promise<InteractionDecision>;
  saveExternalSessionId(...): void;
};
```

**V2 新增**（可选方法）：

```ts
inspectRuntime?(): Promise<AgentRuntimeInfo>;
```

V2.1 实现；探测顺序与 unknown 处理不变。Planner 在 `modelName` unknown 时仅按能力与 availability 调度。

### 8.3–8.4

（不变。）

---

## 附录 H. 数据模型

### 9.1 现状摘要（V1 + V1.5，实施 V2 前已存在）

```text
conversation_agents          # V1 单聊锁定语义；须 V2 migration
├── id, conversation_id, agent_id, role, locked_at, created_at
└── UNIQUE (conversation_id, agent_id)   # ⚠ 阻止同 Agent 多实例

messages
├── role: user | assistant | system | tool
├── agent_id (nullable)
└── 无 author_conversation_agent_id / orchestrator_task_id

agent_runs
├── conversation_id, agent_id, status (含 awaiting_interaction)
└── 无 conversation_agent_id

agent_interactions           # V1.5
├── … conversation_agent_id, orchestrator_task_id (nullable)

agent_external_sessions      # V1 已有，Invoker 复用
```

### 9.2 V2 新增表

```text
providers                    # 见 TECH_DESIGN.md §3.5
├── id, name, protocol, base_url, api_key_encrypted, default_model, enabled, …

orchestrator_settings        # 即 TECH_DESIGN 中 OrchestratorConfig
├── id, planner_provider_id, updated_at

orchestrator_runs
├── id, conversation_id, user_message_id, mode, goal, status, plan_json,
│   evaluation_json, clarification_round, started_at, finished_at
└── status: planning | awaiting_user | running | done | error | cancelled

orchestrator_tasks
├── id, orchestrator_run_id, conversation_id, assignee_conversation_agent_id,
│   round_id, role, description, permission, depends_on_json, status,
│   result_message_id, result_summary, error, started_at, finished_at
└── status: pending | running | awaiting_interaction | done | error | cancelled
```

### 9.3 V2 扩展已有表

`**conversation_agents**`（群聊 roster；单聊仍可用 `role=primary` 一行）：

```text
+ alias              (NOT NULL；单聊可等于 slug)
+ display_name
+ role_hint          (nullable)
+ status             (active | idle | running | unavailable)
+ joined_at          (替代 locked_at 语义；单聊 migration 可 copied from locked_at)
+ runtime_context_json
- 删除 UNIQUE (conversation_id, agent_id)
+ UNIQUE (conversation_id, alias)
+ INDEX (conversation_id, agent_id)   # 非唯一，允许多实例
```

`**messages**`：

```text
+ role 枚举扩展 orchestrator
+ author_conversation_agent_id  (nullable FK)
+ orchestrator_task_id          (nullable)
```

`**agent_runs**`：

```text
+ conversation_agent_id  (nullable；群聊 sub-agent run 必填)
```

`**conversations.status**`：V2 可继续用 `running|done|empty`；`orchestrator_runs.awaiting_user` 表达澄清等待，避免重复枚举。

### 9.4 状态命名约定

与现有 schema 一致：库表用 `**error**`（非 `failed`）；API/SSE 对外可映射为 `error` 或文档说明等价关系。

---

## 附录 I. API

### 10.1 V1.5 已有（V2 群聊复用，不改契约）

```text
GET  /api/conversations/:id/interactions?status=pending
POST /api/interactions/:interactionId/respond
```

实现：`lib/interactions/service.ts`。群聊与单聊共用 respond；pending 列表用于刷新恢复，**交互 UI 渲染在消息流**（按 `messageId` / `conversationAgentId` 挂载），右栏不拉选项/审批按钮。

### 10.2 V2 新增 — Provider

```text
GET    /api/providers
POST   /api/providers
PATCH  /api/providers/:providerId
DELETE /api/providers/:providerId
POST   /api/providers/:providerId/test
```

设置页当前用 `lib/mock/providers.ts`；V2.1 换真实 CRUD。

### 10.3 V2 新增 — Orchestrator 设置

```text
GET   /api/orchestrator/settings
PATCH /api/orchestrator/settings
```

### 10.4 V2 修改 — 群聊与 stop

**现状**：`mode=group` 的 create / send / regenerate → **400**；`GET /api/conversations` 仅返回 `single`。

**V2**：

```text
POST /api/conversations              { mode: "group" }  # 放开
GET  /api/conversations              # 含 group 会话（或 query mode=）
POST /api/messages                   # group → OrchestratorService
GET  /api/conversations/:id/messages
GET  /api/conversations/:id/stream   # 含 V2 orchestrator + task 事件
POST /api/conversations/:id/stop
       # 单聊：无 body（现状）
       # 群聊：{ conversationAgentId: string }
```

Stop 响应扩展：`{ ok, runId?, taskId?, alreadyStopped? }`。

### 10.5 V2 新增 — Runtime inspection

```text
GET /api/agents/runtime
```

在 `GET /api/agents/health` 之上返回 runtime 探测结果（V2.1）。

---

## 附录 J. SSE 事件

### 11.1 V1 / V1.5 已有（群聊继续用）

```text
connected, ping
message_delta, message_replace, message_status
run_status          # 含 awaiting_interaction
interaction_requested
interaction_resolved
```

定义：`lib/conversations/stream-bus.ts`。群聊 sub-agent 流式仍走 `message_delta`；消息 API 须带 `authorConversationAgentId`。

### 11.2 V2 新增

```text
orchestrator_plan       # 或复用 orchestrator 普通 message + 右栏 task_created
task_created
task_status             # 含 awaiting_interaction
task_result
agent_runtime_status    # 可选，roster 刷新
orchestrator_summary
```

`orchestrator_clarify` 可不单独建事件——澄清内容即 `role=orchestrator` 消息 + `orchestrator_runs.status=awaiting_user`。

---

## 附录 K. 前端改造（规格摘要）

### 12.1 群聊消息流

- 真实群聊路径 **移除** `lib/mock/group-conversation.ts` 的 `groupMessages` 与内嵌 `tasks`（与附录 A.2 矛盾，V2.4 删除 `MessageBubble` 对 mock `tasks` 的 task-board 渲染）。
- Orchestrator / 子 Agent / 用户气泡；澄清与计划/汇总均为 **普通文本气泡**，无 task 卡片。
- 子 Agent running 时头像旁 stop → `POST .../stop` + `conversationAgentId`。
- 群聊 **Approval / Choice**：与单聊相同，挂在 **触发该 run 的 Agent 气泡下方** inline；多 Agent 时每个 pending 卡片跟各自气泡，不集中到右栏。

### 12.2 Composer

- 初始化：≥2 个有效 Agent mention（slug）；示例 `@claude-code @codex`（对齐 `ConversationSetup`）。
- 初始化后：仅 @ 已入群 **alias**。
- 未入群 @ → 提示「请新建群聊」。
- 工作区未选时禁用发送（同单聊）。

### 12.3 右栏

群聊右栏 **只看、不操作交互**；结构对齐 `ContextPanel.tsx` → `GroupContext()`（**不是** `SingleContext`）：

- **参与上下文**：各 Agent alias + Orchestrator 状态文案（如「等待批准」「运行中」「已分派 N 任务」）；含 `awaiting_approval` / `awaiting_choice` 摘要。
- **任务分派**：`orchestrator_tasks` 列表（assignee、状态、依赖）；随 SSE `task_status` 更新。

**群聊运行态右栏不要**（单聊 `SingleContext` 才有）：工作区区块、产出文件区块、进度 todo、Approval/Choice 按钮或选项列表。工作区在 Composer 选择；新建空群时 `NewConversationContext` 可展示「工作区 / 可用 Agent」引导。

### 12.4 设置页

当前 `SettingsModal` 中 Provider / Orchestrator 为 mock。V2.1 接真实 API；health 已有 `GET /api/agents/health`，runtime 接 §10.5。


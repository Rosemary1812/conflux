# Handoff

## 当前仓库

- 路径：`D:\coding\agent\AgentHub`
- 当前分支：`main`
- 当前阶段：**V2.4 前端真实联动已完成**
- V2 前置：V2.1 Provider + V2.2 群聊后端基础 + V2.3 Orchestrator P0 已验收

## 必读文件

- `AGENTS.md` — 文件所有权与协作规则
- `docs/design/ExecutePlan/V2-群聊与Orchestrator实施计划.md` — V2 完整计划与验收标准
- `docs/design/TECH_DESIGN.md` §3.2 — Provider / Planner 设计
- `roadmap.md` — 阶段总览

## 已完成

- **V2.4 前端真实联动**：群聊全面接入真实 API/SSE，退役所有 mock
  - 后端最小支撑：`toMessage()` 暴露 `authorConversationAgentId` + `tone=orchestrator`；新增 `GET /api/conversations/:id/roster`
  - `AppShell`：群聊也连 SSE；新增 `task_created`/`task_status`/`task_result`/`orchestrator_summary` 事件监听；`loadRoster()`；群聊发送支持；`stopAgent(conversationAgentId)`
  - `MessageStream`：移除 `groupMessages` mock 分支；统一真实消息；header 移除 preview badge
  - `MessageBubble`：`authorConversationAgentId` → roster 查 alias/头像/状态；orchestrator 特殊身份；running 时头像旁 stop 按钮；移除 task-board
  - `ContextPanel` → `GroupContext`：「参与上下文」遍历 roster + Orchestrator；「任务分派」遍历 `orchestratorTasks` 随 SSE 更新；移除所有 mock 硬编码
  - `Composer`：群聊不再 disabled；新群聊 placeholder ≥2 @；已有群聊客户端 @ alias 验证（未入群提示「请新建群聊」）
  - `ConversationSidebar`：移除 `groupConversations` mock；群聊 active 按 conversationId 匹配；修复群聊菜单（编辑/归档/删除）
  - 删除 `lib/mock/group-conversation.ts`
- **V2.4 现场修复**：群聊会话项不显示菜单（`conversation.mode === "single"` 遗留条件已移除）
- **构建/类型**：`npm run typecheck` ✅、`npm run build` ✅

## 未完成 / 待下一 Agent

- **V2.5 QA 与收口**（V2 最后一个阶段）
- **V2.4 待人工验证**（Demo 脚本 1–10 浏览器端到端）：
  1. 新建群聊并选择工作区
  2. `@claude-code @codex` 发模糊需求
  3. Orchestrator 澄清（不 dispatch）
  4. 用户补充
  5. Orchestrator 计划分工
  6. 子 Agent 各自流式回复
  7. Orchestrator 汇总
  8. follow-up `single_agent`
  9. stop 后 `@alias` 续派
  10. 右栏参与上下文 + 任务分派对照原型
- **刷新恢复验证**：pending interaction 刷新后可 respond；task/身份/历史可恢复
- **同基础 Agent 多实例 UI**：`@claude-code @claude-code` → `claude-code` + `claude-code-2` 在消息流和右栏是否正确区分
- **单聊回归**：发送、SSE、stop、regenerate、Approval/Choice 不退化
- **附件端到端**（TODO.md P2 待做项）：Claude Code 真实带附件对话验证

## 本轮修改文件

### 新建
- `lib/orchestrator/types.ts` — Orchestrator 内部类型
- `lib/orchestrator/context.ts` — 构建 conversation + roster + history 上下文
- `lib/orchestrator/planner.ts` — Provider HTTP 调用获取规划 JSON
- `lib/orchestrator/validator.ts` — Plan 校验
- `lib/orchestrator/scheduler.ts` — Task 状态机与 DB 操作
- `lib/orchestrator/invoker.ts` — 薄封装调用 `startAgentRun`
- `lib/orchestrator/evaluator.ts` — Task 结果评估
- `lib/orchestrator/aggregator.ts` — 多 Agent 输出汇总
- `lib/orchestrator/service.ts` — 主流程 `processGroupMessage`
- `app/api/conversations/[conversationId]/roster/route.ts` — roster API
- `lib/providers/service.ts` — Provider CRUD + Orchestrator settings
- `app/api/providers/` — Provider CRUD + test API
- `app/api/orchestrator/settings/` — Orchestrator settings API

### 修改
- `lib/db/schema.ts` — 新增 `orchestrator_runs`、`orchestrator_tasks`、`providers`、`orchestrator_settings`；扩展 `messages`、`conversation_agents`、`agent_runs`
- `lib/db/client.ts` — 新增表 CREATE TABLE + 索引 migration
- `lib/conversations/stream-bus.ts` — 新增 4 个 V2 SSE 事件类型
- `lib/conversations/runs.ts` — 扩展 `StartRunParams`、task callback、conversationAgentId/orchestratorTaskId 写入
- `lib/conversations/service.ts` — `sendGroupMessage` 调用 `processGroupMessage`；单聊也传 `conversationAgentId`；`toMessage()` 扩展
- `lib/conversations/types.ts` — `MockMessage` 增加 `authorConversationAgentId`；新增 `RosterItem`、`GroupTask`
- `components/shell/AppShell.tsx` — 群聊 SSE、task 事件、roster 加载、群聊发送、stopAgent
- `components/chat/MessageStream.tsx` — 移除 mock、统一真实消息
- `components/chat/MessageBubble.tsx` — 身份区分、stop、移除 task-board
- `components/chat/Composer.tsx` — 群聊可用、@ 验证
- `components/context/ContextPanel.tsx` — GroupContext 真实化
- `components/shell/ConversationSidebar.tsx` — 移除 mock、群聊菜单修复
- `components/settings/SettingsModal.tsx` — Provider/Orchestrator 设置页接真实 API
- `lib/agents/mention.ts` — 扩展 alias 模式（`parseAgentAliasMentions`、`parseAgentMentionsForRoster`）
- `lib/adapters/types.ts` — 扩展 `AgentEvent`、`AdapterRunParams`
- `app/api/conversations/[conversationId]/stop/route.ts` — 支持 `conversationAgentId` body

### 删除
- `lib/mock/group-conversation.ts`

## 验证结果

- `npm run typecheck`：✅ 通过
- `npm run build`：✅ 通过
- 未运行命令：无（已做）

## 风险与阻塞

1. **Planner Provider 必须配置**：若未设 `ORCHESTRATOR_BASE_URL`/`API_KEY`/`MODEL` 或未在设置页选 Provider，群聊发消息会直接抛 500（`No planner provider configured`）
2. **群聊 clarify 后等待用户**：`orchestrator_runs.status=awaiting_user` 时前端 composer 应允许继续输入，但当前 UI 可能无特殊提示（仅为普通 `role=orchestrator` 气泡）
3. **Demo 路径未人工跑通**：V2.4 代码层面已通，但浏览器端到端（§七 Demo 脚本 1–10）尚未验证
4. **单聊 regenerate 不支持群聊**：`regenerateMessage` 仍限制 `conversation.mode !== "single"` 时 400

## 下一个 Agent 应继续做什么

**明确进入 V2.5：QA 与收口**

范围：
1. 按 `docs/design/ExecutePlan/V2-群聊与Orchestrator实施计划.md` §七 Demo 脚本 1–10 在浏览器人工验证群聊主路径
2. 单聊全链路回归：发送、SSE、stop、regenerate、Approval/Choice、产物、工作区
3. 刷新恢复：pending interaction、task 列表、roster 身份
4. `REVIEW_CHECKLIST.md` 增 V2 段；问题入 `docs/state/TOFIX.md`
5. `roadmap.md` / 实施计划顶部基线日期更新为收口日

不要：
- 不要扩大范围到 V3 自建 Agent
- 不要重写 Orchestrator 后端（V2.3 已完成）
- 不要改 Provider / adapter / DB schema
- 不要恢复已删除的 mock 数据

## 可直接复制给下一个 Agent 的 Prompt

```text
你现在在 D:\coding\agent\AgentHub 仓库工作。

先阅读：
1. `AGENTS.md`（文件所有权与协作规则）
2. `docs/design/ExecutePlan/V2-群聊与Orchestrator实施计划.md`（重点看 §七 Demo 脚本、§八 总验收标准）
3. `docs/design/prototypes/v2/group-interaction-ui-recommendation.html`（群聊运行态原型）
4. `HANDOFF.md`（当前状态）

当前任务：实施 V2.5 QA 与收口。

前置状态：
- V2.4 前端真实联动已完成（群聊 SSE、task 事件、消息流、右栏 GroupContext、Composer 均已接真实数据）
- V2.3 Orchestrator 后端闭环已完成（调度、task SSE、子 Agent 流式已通）
- 构建和类型检查已通过

具体工作：
1. 浏览器人工验证群聊 Demo 脚本 1–10：
   - 新建群聊 → @2+ Agent → 发送 → Orchestrator 澄清/计划 → 子 Agent 流式 → 汇总 → stop → @alias 续派
   - 确认：气泡身份区分、右栏任务分派随 SSE 更新、stop 按钮可点、Composer @ 验证
2. 单聊全链路回归：
   - 新建单聊 → 发送 → 流式 → stop → regenerate → Approval/Choice → 产物
   - 确认单聊功能不退化
3. 刷新恢复验证：
   - 群聊刷新后 pending interaction 可 respond
   - 历史消息、roster、task 列表正确恢复
4. 同基础 Agent 多实例验证：
   - `@claude-code @claude-code` 初始化 → 确认 `claude-code` 与 `claude-code-2` 在消息流和右栏正确区分
5. 文档收口：
   - `REVIEW_CHECKLIST.md` 增 V2 段
   - 问题入 `docs/state/TOFIX.md`
   - 通过后更新 `roadmap.md` 基线日期

执行规则：
- 禁止重写 V2.3 Orchestrator 后端
- 禁止改 Provider / adapter / DB schema
- 单聊链路必须保持不退化
- 遇到非主线问题写入 `docs/state/TOFIX.md`

完成后汇报：
1. Demo 脚本哪些步骤通过、哪些失败
2. 单聊回归是否通过
3. 刷新恢复是否通过
4. 多实例是否正确区分
5. 新问题清单（如有）
```

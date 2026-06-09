# Handoff

## 当前仓库

- 路径：`D:\coding\agent\AgentHub`
- 当前分支：`main`
- 当前阶段：V3 自建 Agent、Skill 与基础收口
- 当前 phase：**V3.7 SDK Approval / Choice 桥接 C1 + C2 已实现并提交**
- 最新提交：`bbcaa28 docs(workflow): move memos and add demo assets`
- 当前工作区：仅 `docs/design/specs/v3-phase-3.7.md` 未提交

## 必读文件

- `AGENTS.md`
- `roadmap.md`（V3 段）
- `docs/design/ExecutePlan/V3-自建Agent与基础收口.md`（§七 V3.7）
- `docs/design/specs/v3-phase-3.7.md`（当前 C0 设计稿）
- `docs/design/specs/v3-phase-3.4.md`（自建 Agent SDK adapter 边界）
- `docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md`
- `lib/adapters/claude-code-sdk.ts`
- `lib/adapters/claude-code.ts`（参考实现，不要改）
- `lib/interactions/types.ts`
- `lib/interactions/service.ts`
- `lib/interactions/run-bridge.ts`
- `lib/conversations/runs.ts`

## 已完成

- V2.6 搜索会话收口。
- V3.0 数据模型：`agents` 扩展、`skills`、`agent_skills`。
- V3.1 斜杠命令骨架。
- V3.2 `/agent-creator` 引导创建自建 Agent。
- V3.3 `/skill-creator` 引导创建 Skill。
- V3.4 自建 Claude SDK adapter 已接入并能跑自建 Agent。
- V3.5 群聊 UI 接入自建 Agent。
- V3.6 自定义 Agent 设置页已实现并提交：
  - `b8c3934` C1 列表
  - `58ce1ea` C2 编辑 + PATCH
  - `b311047` C3 删除 + precheck + roster degrade
  - `6e7d99e` C4 regenerate profile
  - `d4c7f96` C5 avatar streaming + agent SSE bus
- repo hygiene 已提交：
  - `bbcaa28` 将 `docs/memo/*` 迁到 `docs/design/memo/*`，并新增演示图片资源。
- V3.7 C0 设计稿已新增：
  - `docs/design/specs/v3-phase-3.7.md`
- V3.7 C1 + C2 已实现并提交：
  - `5b4b906` C1：自建 SDK adapter Approval 桥接（`canUseTool` → approval）
  - `7f50202` C1 smoke：21 个 approval case 全过；TOFIX 记录 `npm run build` Windows 沙箱 EPERM
  - `<pending>` C2：自建 SDK adapter Choice 桥接（MCP `agenthub_interactions` + `request_choice`）

## V3.7 已确认结论

用户已大致认可以下 V3.7 设计结论，后续实现按这些边界推进：

1. **Choice 首版使用 MCP `request_choice`**
   - 不直接接 SDK 原生 `AskUserQuestion` 多问题结构。
   - 原因：现有 `InteractionChoiceCard` 是单问题单卡；MCP tool 可直接限制成 `prompt + 2-4 options + allowCustom`，不扩大 UI/API 契约。

2. **Approval 被拒后交还 SDK 自行继续**
   - 用户拒绝时返回 SDK：
     ```ts
     { behavior: "deny", message: "...", toolUseID }
     ```
   - 不由 Conflux 直接把 run 标 error。
   - 原因：拒绝工具不等于任务失败，模型仍可解释、换方案或继续只读处理。

3. **`executor` profile 继续不弹 Approval**
   - `executor` 语义是高危全放行，对应 `permissionMode: "bypassPermissions"` 与 `allowDangerouslySkipPermissions: true`。
   - 高危提示放在创建/设置页 profile 选择处，不在运行中反复弹审批。

4. **第一版不抽共享 helper**
   - V3.7 只改 `lib/adapters/claude-code-sdk.ts`。
   - 不抽到共享模块，也不碰内置 `lib/adapters/claude-code.ts`，避免影响稳定的内置 `@claude-code` 路径。

## 未完成

- V3.7 C3 群聊 / Orchestrator 回归尚未做：新建群聊 @ 自建 Agent，验证 task 进入 `awaiting_interaction` → 回应后回到 `running` → 最终 `done/error`；并验证 Planner 不再因 `supportsApproval=none` 拒绝分配写文件任务。
- V3.7 C4 文档与验收收口：`roadmap.md` V3 状态更新 + 如发现真实 SDK 行为问题写到 `TOFIX.md`。
- `git push` 未执行；仓库仍有本地提交未推远端。
- 工作区残留与 V3.7 无关的改动（`prototypes/v1` 迁移到 `docs/design/prototypes/v1/` 的 delete + `REVIEW_CHECKLIST.md` 路径修正 + 仓库根多出来的 `README.md`），未提交。

## 本轮修改文件

- `docs/design/specs/v3-phase-3.7.md`：新增 V3.7 C0 设计稿，覆盖 SDK `canUseTool`、MCP `request_choice`、run-bridge 挂起/唤醒、群聊 task 状态传播、验收标准和实现拆分。
- `HANDOFF.md`：更新为当前 V3.7 handoff，并写入用户已认可的 4 个设计结论；C1+C2 完成后再次刷新。
- `lib/adapters/claude-code-sdk.ts`：
  - C1：capabilities `supportsApproval: "native"`；`query()` options 注入 `canUseTool: createCustomAgentPermissionHandler(params)`；新增 handler + payload helpers（`actionForTool` / `commandFromInput` / `pathFromInput`，文件内复制以避免影响内置 `@claude-code`）；system prompt 改 V3.7 C1 提示。
  - C2：capabilities `supportsChoice: "native"`；`query()` options 加 `mcpServers: { agenthub_interactions: createCustomAgentChoiceServer(params) }`；新增 `createCustomAgentChoiceServer` + `handleCustomAgentChoice`；system prompt 改 V3.7 提示用 `request_choice` MCP tool。
- `scripts/smoke-v37-c1-approval.ts`：覆盖 C1（21 case：action 映射 / command&path fallback / allow vs deny 返回 / toolUseID 双向 round-trip）+ C2（10 case：option id fallback / allowCustom 默认 true / customText 优先 / 非 choice decision fallback）；31/31 OK。
- `docs/state/TOFIX.md`：记录 `npm run build` Windows 沙箱 `EPERM scandir 'C:\Users\wsmdm\Application Data'`（symlink → Roaming AppData，ACL 拒访）P2 环境问题，与 V3.7 代码无关。

## 验证结果

- `git diff --check`：通过
- `npm run typecheck`：通过
- `npx next dev` 编译 23603 modules：通过
- `npm run build`：失败，原因是 TOFIX 已记的 Windows 沙箱环境问题，与 V3.7 代码无关
- `npx tsx scripts/smoke-v37-c1-approval.ts`：31/31 OK（C1 21 + C2 10）

## 风险与阻塞

- V3.7 C1/C2 smoke 是 handler 级别（mock `params.requestInteraction`），不是端到端真 SDK query。`@anthropic-ai/claude-agent-sdk` 通过 minimax M3 跑通 Claude Code 工具调用 + tool_use 触发 canUseTool 的可行性需在 C3 群聊回归中验证；如果 M3 不支持 tool_use，需要切回真 Anthropic Provider。
- `lib/adapters/claude-code.ts` 已有可工作的 Approval/Choice 路径，不要为了抽象复用而改动它。
- `executor` profile 不弹 Approval 是产品语义选择；如果后续要收紧，应该改 profile 策略，而不是在 V3.7 实现里偷偷改变运行语义。
- 当前 `git status` 可能仍提示无法访问 `C:\Users\wsmdm/.config/git/ignore`，这是环境权限 warning，不代表仓库有变更。

## 下一个 Agent 应继续做什么

进入 **V3.7 C3 群聊 / Orchestrator 回归**：

- 用群聊会话 @ 自建 code-author Agent，触发 Approval / Choice。
- 验证 `agent_interactions.conversation_agent_id` / `orchestrator_task_id` 正确落库；右栏 task 状态显示"等待交互"；回应后恢复运行并最终 `done/error`。
- 验证 Orchestrator Planner 不再因为 `supportsApproval=none` 拒绝分配写文件任务。
- 注意端到端测试需要 minimax M3 跑通 SDK tool_use；如不支持，需切真 Anthropic Provider 或 fallback 到 C1/C2 handler smoke 作为最终验证。

C3 验证通过后再做 C4：`roadmap.md` V3 状态更新 + 真实 SDK 行为问题写入 `TOFIX.md`（如发现）。

## 禁止事项

- 不要改内置 `lib/adapters/claude-code.ts`。
- 不要抽共享 helper 影响内置 `@claude-code`。
- 不要新增 `agent_runs.status`。
- 不要修改 `POST /api/interactions/:id/respond` 契约。
- 不要让 V3.7 顺手改 Provider、Agent 设置页、Orchestrator Planner prompt 或 V3.6 UI。
- 不要把 `executor` profile 改成运行时弹 Approval，除非用户重新拍板。
- 不要 `git push`，除非用户明确要求。
- 不要把工作区残留的 `prototypes/v1` 迁移 delete / `REVIEW_CHECKLIST.md` 路径修正 / 仓库根 `README.md` 与 V3.7 一起提交；它们是别的流程。

## 可直接复制给下一个 Agent 的 Prompt

```text
你现在在 D:\coding\agent\AgentHub 仓库工作。

先阅读：
1. AGENTS.md
2. roadmap.md（V3 段）
3. docs/design/ExecutePlan/V3-自建Agent与基础收口.md（§七 V3.7）
4. docs/design/specs/v3-phase-3.7.md
5. docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md
6. lib/adapters/claude-code-sdk.ts
7. lib/adapters/claude-code.ts（只作参考，不要改）
8. lib/interactions/types.ts
9. lib/interactions/service.ts
10. lib/interactions/run-bridge.ts
11. lib/conversations/runs.ts

当前状态：
- V3.6 已完成并提交。
- V3.7 C0 设计稿已写到 docs/design/specs/v3-phase-3.7.md。
- 用户已确认 V3.7 四个结论：Choice 首版用 MCP request_choice；Approval 拒绝后交还 SDK 自行继续；executor 不弹 Approval；第一版不抽共享 helper、不影响内置 @claude-code。

当前任务：
1. 先提交 docs/design/specs/v3-phase-3.7.md 和 HANDOFF.md，commit message 用 docs(plan): V3.7 SDK interaction bridge draft。
2. 然后进入 V3.7 C1，只实现自建 SDK adapter 的 Approval 桥接。

执行规则：
- 只改 lib/adapters/claude-code-sdk.ts 及必要的类型导入。
- 不改 lib/adapters/claude-code.ts。
- 不新增 run status，不改 respond API。
- 用户批准时返回 SDK allow + updatedInput + toolUseID。
- 用户拒绝时返回 SDK deny + message + toolUseID，不直接把 run 标 error。
- C1 不接 Choice，Choice 留 C2。

完成后汇报：
1. 提交 hash。
2. 修改文件。
3. Approval smoke 结果。
4. npm run typecheck / npm run build / git diff --check 结果。
```

# Handoff

## 当前仓库

- 路径：`D:\coding\agent\AgentHub`
- 当前分支：`main`（领先 `origin/main` 13 个 commit，未 push）
- 当前阶段：V3 自建 Agent、Skill 与基础收口
- 当前 phase：V3.5 群聊 UI 接入已提交；下一阶段是 **V3.6 自定义 Agent 设置页**

## 必读文件

- `AGENTS.md`
- `roadmap.md`（V3 段 122–139 行定义 V3 总目标与验收）
- `docs/design/ExecutePlan/V3-自建Agent与基础收口.md`（V3 总计划；§七 含 V3.5/3.6/3.7 Phase 拆解）
- `docs/design/specs/v3-phase-3.4.md`（V3.4 C0 设计稿）
- `docs/design/specs/v3-phase-3.5.md`（V3.5 C0 设计稿，V3.6 模板可参考）
- `docs/state/TOFIX.md`（已知问题，V3.6 启动前扫一遍）
- `docs/design/prototypes/v3/`（V3.5 打字机角标原型 HTML）

## 已完成

- V2.6 搜索会话收口
- V3.0 数据模型（agents 扩展 7 列、skills、agent_skills 表）
- V3.1 斜杠命令骨架（registry + runner + Composer 面板）
- V3.2 /agent-creator 引导对话 + profile 抽取
- V3.3 /skill-creator 对话式生成
- V3.4 自建 Agent SDK 接入（commit `9f23def` "feat(agent): add custom Claude SDK adapter"）：
  - `lib/adapters/claude-code-sdk.ts` 新增：用 `@anthropic-ai/claude-agent-sdk` 的 `query()`，按 `toolProfile` 映射 `permissionMode/allowedTools/disallowedTools/allowDangerouslySkipPermissions`，固定 `settingSources=[]` / `cwd=workspace` / `maxTurns=50` / `includePartialMessages=true`，`env` 注入 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`
  - `lib/adapters/registry.ts` 新增 `getAdapterForAgent(agent)`：按 `isSystem` 分流，claude_code + isSystem=false 走 SDK adapter，isSystem=true 走旧 `claudeCodeAdapter`
  - `lib/adapters/types.ts` `AdapterRunParams` 增 `agent: AgentSummary`
  - `lib/agents/types.ts` `AgentSummary` 增 `isSystem / systemPrompt / permissionMode / toolProfile`
  - `lib/conversations/service.ts` `toAgentSummary`、`lib/orchestrator/context.ts` roster、`lib/orchestrator/invoker.ts` 子 Agent 调用同步补齐新字段
  - `lib/conversations/runs.ts` 改用 `getAdapterForAgent(agent)` 并把 `agent` 透传
  - `lib/providers/service.ts` 新增 `getAnthropicRuntimeProvider`：env `ORCHESTRATOR_*` (anthropic) 优先，其次 DB 中 enabled anthropic Provider
  - `docs/design/specs/v3-phase-3.4.md` 新增 V3.4 C0 设计稿
  - 验收：真实 `/agent-creator` 创建 `v34-real-smoke`（readonly profile），单聊两轮 smoke 全部 done + body=`OK`，第二轮复用 `agent_external_sessions.externalSessionId`，内置 `@claude-code` 不退化，typecheck/build/diff-check 全过
- **V3.5 群聊 UI 接入**（commits `53e0ab4` C0 设计稿 + `31ef7b4` C1-C3 实现）：
  - C1 types + API
    - `lib/agents/types.ts`：新增 `AgentAvatarKind` / `AvailableAgentSummary`（展示字段，不漏 systemPrompt）
    - `lib/agents/avatar-schema.ts`（新）：Zod `avatarKindSchema` / `capabilitiesSchema` + `parseCapabilitiesJson` 解析失败退化为 `null`
    - `lib/conversations/types.ts`：`RosterItem` 扩展 `isSystem / avatarKind / avatarValue / capabilities`
    - `lib/conversations/service.ts`：`listAgents({ conversationMode })` 接 `single` 过滤；新增 `listAvailableAgents`（直查 DB，绕开 `toAgentSummary` 防漏 systemPrompt）；`getConversationRoster` 扩 SELECT + Zod 解析 capabilities；`sendSingleMessage` mention 防御（`@<自建alias>` 拒绝并给专门提示）
    - `app/api/agents/route.ts`：接 `?conversationMode=single|group` query
  - C2 新组件
    - `components/agents/AgentVisualStyle.ts`（新）：`SYSTEM_AGENT_STYLE` / `CUSTOM_AGENT_STYLE` / `styleFor`
    - `components/agents/AgentAvatar.tsx`（新）：按 kind 分发 `system→AgentIcon` / `emoji→span` / `uploaded→img`（onError 隐藏）
  - C3 UI 差异化 + CSS
    - `components/chat/MessageBubble.tsx`：改用 `AgentAvatar`；自建 Agent 气泡加 `.bubble-live-dot`
    - `components/context/ContextPanel.tsx`：`GroupContext` 的 `RosterAgentState` 用 `AgentAvatar` + capability tag；`NewConversationContext` 拆"系统"/"自建"两段，单聊模式不显示自建段
    - `components/shell/AppShell.tsx`：新增 `availableAgents` state，按 `isGroup` 拉 `/api/agents?conversationMode=...` 传 `ContextPanel`
    - `app/globals.css`：`.bubble-with-badge` / `.bubble-live-dot` + 脉冲动画 / `.capability-tags` / `.capability-tag` / `.agent-avatar-emoji` / `.agent-avatar-image` / `.subsection-title` / `.available-agent-row`
  - C0 设计稿：`docs/design/specs/v3-phase-3.5.md`（8 节，398 行）
  - 原型 HTML：`docs/design/prototypes/v3/self-built-agent-typewriter.html`（381 行，可直接浏览器打开）
  - 验收（后端 smoke 通过）：`?conversationMode=group` 含自建 v34-real-smoke (emoji 🤖, capabilities 2) / `?conversationMode=single` 仅 6 system / 单聊 `@<自建alias>` 返回"自建 Agent 仅可用于群聊…" / 单聊 `@claude-code` 正常锁定 / 群聊 roster 返 4 新字段 / 重启 dev server 后 orchestrator → SDK run 调度通 / `npm run typecheck` / `build` / `git diff --check` 全过
  - **视觉验 ⏳ 待 user**：5 项肉眼检查（详见"V3.5 视觉验待办"段）

## 未完成

- **V3.6 自定义 Agent 设置页**（1.5d，🟡）—— **下一阶段**：
  - 自建 Agent 列表入口（侧栏 / 设置弹窗）
  - 编辑 systemPrompt / description / capabilities
  - 删除自建 Agent（DB 外键 + roster 清理）
  - 重新生成 profile（调 `/agent-creator` regen 流）
  - 重命名 alias（影响 roster 与历史消息的 alias 解析）
  - `avatarKind=uploaded` 真实接入（V3.5 已留 `AgentAvatar` 降级到 🤖 的兜底）
- V3.7 V1.5 Approval 卡片桥接到 SDK（1.5d，🔴 重预 plan）—— V3.6 完成后启动；需要 C0 + 与 V1.5 run-bridge 对齐方案 + 与用户对齐
- `git push` 把领先 origin 的 13 个 commit 推到远端（用户未要求前不推）

## 本轮（V3.5 提交）修改文件

- C0：`docs/design/specs/v3-phase-3.5.md`（commit `53e0ab4`）
- C0：`docs/design/prototypes/v3/self-built-agent-typewriter.html`（同上 commit）
- C1-C3（commit `31ef7b4`，11 files / +384 / -26）：
  - `lib/agents/types.ts`：新增 `AgentAvatarKind` / `AvailableAgentSummary`
  - `lib/agents/avatar-schema.ts`：新增 Zod
  - `lib/conversations/types.ts`：`RosterItem` 扩展 5 字段
  - `lib/conversations/service.ts`：`listAgents` 接 `conversationMode` / 新增 `listAvailableAgents` / `getConversationRoster` 扩 SELECT + Zod / `sendSingleMessage` mention 防御
  - `app/api/agents/route.ts`：接 query
  - `components/agents/AgentVisualStyle.ts`：新增
  - `components/agents/AgentAvatar.tsx`：新增
  - `components/chat/MessageBubble.tsx`：改用 `AgentAvatar` + `.bubble-live-dot`
  - `components/context/ContextPanel.tsx`：`RosterAgentState` + `NewConversationContext` 系统/自建分段
  - `components/shell/AppShell.tsx`：`availableAgents` state + effect + 传 `ContextPanel`
  - `app/globals.css`：8 新类

## 验证结果

- `npm run typecheck`：✅
- `npm run build`：✅
- `git diff --check`：✅（仅 CRLF 警告，无内容问题）
- V3.5 后端 smoke：✅（见"已完成"段验收清单 8 条）
- V3.5 视觉验：⏳ 待 user 浏览器肉眼验 5 项（见下）

### V3.5 视觉验待办（user 浏览器）

打开 `http://localhost:3000`（dev server 已重启，PID 不固定，进程组名 `bi8whkai7`）：

1. **新群聊右栏"可用 Agent"** — 应有"系统"段 + "自建"段，v34-real-smoke 显示 🤖 + displayName + `[smoke][reply-ok]` 两个 capability 圆角小药丸
2. **新单聊右栏"可用 Agent"** — 只能看到"系统"段，**无**"自建"段（空态不显示）
3. **群聊右栏"参与上下文"卡片** — 派发任务后：Claude Code 卡片是产品 logo（无 tag），v34-real-smoke 卡片是 🤖 + 2 个 capability tag
4. **群聊消息流自建 Agent 气泡** — 右上角**蓝色脉冲点**（无文字、无光标），常驻不只在打字中；等 SDK 第二轮回复也常驻
5. **单聊防自建 @ 的错误提示** — 新单聊框里 `@v34-real-smoke 看看` 回车 → 弹"自建 Agent 仅可用于群聊…"

未运行的命令：

- `git push`：未运行；按 AGENTS.md 规则未经用户明确要求不主动推远端
- V3.5 视觉验：待 user 浏览器肉眼验

## 风险与阻塞

- DB 留有 V3.4 + V3.5 验收用的自建 Agent `v34-real-smoke`（id `ccd68b3d-98c4-4049-946b-08db9585e5e5`）和 6 条 smoke conversation：
  - V3.4：`033fba45-...` 创建会话 / `5f63c66b-...` 两轮 smoke / `afdedff0-...` 内置 claude-code smoke
  - V3.5 我创建：`0c6b1473-...` 中文 mojibake 测试 / `3bc4be4f-...` planner 失败测试 / `222c5465-...` planner 失败测试 / `6df15953-...` 单聊 @claude-code smoke / `e8e80a49-...` V3.5 群聊 smoke（重启 dev server 后通了，Orchestrator 回复"Hi! 👋"）
  - V3.6 启动前可保留作为参考，也可清理（用户未指示）
- dev server 已重启在 `http://localhost:3000` 后台运行（background bash ID `bi8whkai7`）。如需重启，关掉该任务即可。
- V3.5 调试期遇到的"Orchestrator 计划阶段失败：fetch failed"教训：dev server 跑 14h+ 后 Node `fetch` 内部 `undici` keep-alive socket pool 状态陈旧，外部 curl / 单独 node fetch 都通，唯独 dev server 内部抛 fetch failed。**修复方式是杀掉 next-server 子进程（taskkill /F /PID <next-server-pid>，或 netstat -ano 看 3000 端口）让 npm run dev 重新 fork。** V3.6 启动时如果再遇到同类报错，优先重启 dev server。
- `lib/db/client.ts` 的 `migrate()` 块仍有"新装 DB 最小 DDL + 假设列已存在"与 ensure 函数职责重叠的遗留（见 `docs/state/TOFIX.md` 2026-06-06 条目），与 V3.5/3.6 无关。
- 自建 Agent 选 `executor` profile 在群聊下的二次确认：preview 卡上"⚠️ 高危"已经在 V3.2 设计稿里，但 V3.4 SDK adapter 不会真的拦截 `bypassPermissions`（V3.7 才接 Approval 桥接），目前 `executor` profile 在 V3.4/V3.5 已经是"无审批全放行"语义，与 V3.2 设计预期一致。V3.7 推进时再统一收口。
- V3.5 视觉未在 user 浏览器里肉眼验过：5 项 UI 检查清单见"V3.5 视觉验待办"段。如果 V3.5 视觉有偏差，V3.6 设置页"重新生成 profile / 改 alias"按钮会在错的视觉上叠加。建议 V3.6 启动前先肉眼验完 V3.5 视觉。

## 下一个 Agent 应继续做什么

明确下一步：**V3.6 自定义 Agent 设置页**（🟡 1.5d）。

按 V3 主计划 §七 的 C0 模板先写设计稿到 `docs/design/specs/v3-phase-3.6.md`，提交为 `docs(plan): V3.6 design draft`；设计稿通过后再进 C1+ 实现。

C0 设计稿必填项（V3 计划 §七 V3.6 范围 + V3.5 留下的延展点）：

1. **C0-1 类型 + Zod schema**：
   - `SelfBuiltAgentForm`：编辑现有 vs 创建草稿
   - `AgentListItem`：列表用（id / name / alias / platform / capabilities / lastRun / systemPrompt 摘要）
   - `DeleteAgentRequest`：软删 vs 硬删 + roster / message_history 处理策略
   - `RegenerateProfileRequest`：复用 `/agent-creator` regen 流的输入契约
2. **C0-2 状态机**：列表 / 编辑 / 重新生成 / 删除 4 个 view state（idle / loading / saving / error）
3. **C0-3 API 字段表**：
   - `GET /api/agents?managedBy=user`（只返自建）
   - `PATCH /api/agents/:id`（编辑 systemPrompt / description / capabilities / alias / avatarKind / avatarValue）
   - `DELETE /api/agents/:id`（DB 外键 + roster 清理；与 conversation / message_history 的处理策略）
   - `POST /api/agents/:id/regenerate`（调 `/agent-creator` regen 流）
4. **C0-4 UI 组件 + 原型 HTML**：
   - 入口位置：设置弹窗新 tab / 侧栏分组 / 独立路由
   - 列表 + 编辑表单 + 删除二次确认
   - capability tag 编辑器（沿用 V3.5 `.capability-tag` 视觉）
   - `avatarKind=uploaded` 真实接入（V3.5 已留降级到 🤖，V3.6 接 `/api/attachments/:id/preview`）

V3.6 验收：

- 设置页能列出所有自建 Agent（含 v34-real-smoke）
- 编辑 systemPrompt 后再走群聊 `@<alias>`，回复内容反映新 systemPrompt
- 删除自建 Agent 后 roster / conversation / message_history 的处理符合预期
- 重新生成 profile 后 `/api/agents/:id/regenerate` 返回新 profile
- alias 改名后旧 message 的 alias 显示正确（历史 alias 解析）
- `avatarKind=uploaded` 真实生效（图片预览）
- 内置 system Agent 不出现在设置页
- `npm run typecheck` / `build` / `git diff --check` 通过

## 禁止事项

- 不要进入 V3.7（🔴 Approval 桥接需 C0 + 与用户对齐，V3.6 完成后用户拍板）
- 不要回滚 V3.4 commit `9f23def` / V3.5 commit `31ef7b4` / V3.5 design `53e0ab4`
- 不要替换 `lib/adapters/claude-code-sdk.ts` / `lib/adapters/claude-code.ts`
- 不要扩展 SDK adapter 的 Approval / Choice 桥接（V3.7 scope）
- 不要把 `openai_compatible` Provider 接进 `getAnthropicRuntimeProvider` / SDK runtime
- 不要清理 DB 中 `v34-real-smoke` 与 6 条 smoke conversation 除非用户明确要求
- 不要 `git push` 除非用户明确要求
- 不要重写 V3.5 已落的 `RosterItem` / `AvailableAgentSummary` / `AgentVisualStyle` / `AgentAvatar`（V3.6 应复用，不重定义）

## 可直接复制给下一个 Agent 的 Prompt

```text
你现在在 D:\coding\agent\AgentHub 仓库工作。

先阅读：
1. AGENTS.md
2. roadmap.md（V3 段 122–139 行）
3. docs/design/ExecutePlan/V3-自建Agent与基础收口.md（V3 总计划；§七 V3.6/3.7 Phase 拆解）
4. docs/design/specs/v3-phase-3.5.md（V3.5 C0 设计稿，V3.6 模板）
5. docs/design/specs/v3-phase-3.4.md（V3.4 C0 设计稿）
6. docs/state/TOFIX.md（启动前扫一遍已知问题）

当前状态：
- V3.5 群聊 UI 接入已提交（commit 53e0ab4 C0 设计稿 + commit 31ef7b4 C1-C3 实现），工作区干净
- V3.5 视觉验 ⏳ 待 user 浏览器肉眼验 5 项（HANDOFF.md"V3.5 视觉验待办"段）
- dev server 已重启在 http://localhost:3000 后台运行（background bash ID bi8whkai7）
- DB 留有 V3.4 + V3.5 验收残留：自建 Agent v34-real-smoke (id ccd68b3d-98c4-4049-946b-08db9585e5e5) + 6 条 smoke conversation；不主动清理
- V3.5 教训：dev server 跑 14h+ 后 Node fetch 内部 undici pool 状态陈旧会抛 "fetch failed"，重启 dev server 解决

当前任务：
开始 V3.6 自定义 Agent 设置页（🟡 1.5d）。先写 C0 设计稿到 docs/design/specs/v3-phase-3.6.md 并独立提交为 docs(plan): V3.6 design draft；通过后再进 C1+ 实现。

C0 必填项（V3 计划 §七 V3.6 + V3.5 延展点）：
- C0-1 类型 + Zod schema：SelfBuiltAgentForm / AgentListItem / DeleteAgentRequest / RegenerateProfileRequest
- C0-2 状态机：列表/编辑/重新生成/删除 4 个 view state
- C0-3 API 字段表：GET /api/agents?managedBy=user / PATCH /api/agents/:id / DELETE /api/agents/:id / POST /api/agents/:id/regenerate
- C0-4 UI 组件 + 原型 HTML：入口位置（设置弹窗新 tab / 侧栏分组 / 独立路由）+ 列表 + 编辑表单 + 删除二次确认 + capability tag 编辑器 + avatarKind=uploaded 真实接入

V3.6 验收：
- 设置页能列出所有自建 Agent
- 编辑 systemPrompt 后群聊回复反映新 systemPrompt
- 删除自建 Agent 后 roster / conversation / message_history 处理符合预期
- 重新生成 profile 后 /api/agents/:id/regenerate 返回新 profile
- alias 改名后旧 message alias 显示正确
- avatarKind=uploaded 真实生效
- 内置 system Agent 不出现在设置页
- npm run typecheck / build / git diff --check 通过

执行规则：
- 不要进入 V3.7
- 不要回滚 V3.4 / V3.5 commits
- 不要替换 lib/adapters/claude-code-sdk.ts / lib/adapters/claude-code.ts
- 不要扩展 SDK adapter 的 Approval / Choice 桥接
- 不要把 openai_compatible Provider 接进 SDK runtime
- 不要重写 V3.5 已落的 RosterItem / AvailableAgentSummary / AgentVisualStyle / AgentAvatar
- 不要 git push
- 不要清理 DB 中 v34-real-smoke 与 6 条 smoke conversation 除非用户要求

完成后汇报：
1. C0 设计稿 commit hash
2. V3.6 真实自建 Agent 列表 + 编辑 + 删除截图/结果
3. typecheck/build/diff-check 结果
```

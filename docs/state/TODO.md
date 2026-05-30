# 待办池

本文件只记录主线之外的小目标、小优化和补充事项。主线阶段任务请写入根目录 `roadmap.md`。

## 待做

> **主线变更（2026-05-27）**：Approval 与选项交互已升格为 **V1.5 主线**（`roadmap.md` + `docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md`）。V2 启动前须完成 V1.5；群聊 Approval UI 在 V2.4 接入。

- 时间：2026-05-30
  优先级：P1
  所属范围：Orchestrator / 群聊交互
  问题/目标：当前群聊中所有用户消息都默认走 Orchestrator 统一规划（`processGroupMessage` → `planOrchestratorRound` → `executePlan`），用户无法直接 @ 某个 Agent 单独提问或下发任务。这与 IM 聊天的直觉不符——用户预期 @ 某个成员就是直接跟TA说话。
  解决方案：
  1. 修改 `lib/conversations/service.ts` 的 `sendGroupMessage`：在 roster 已存在的前提下，解析用户消息中的 @mention。若**只 @ 了一个 Agent**（且 alias 在当前 roster 中），绕过 `processGroupMessage`，直接以单聊模式调用 `startAgentRun` 触发该 Agent 回复，不创建 `orchestrator_run` 和 `orchestrator_tasks`。
  2. 若 @ 了多个 Agent、@ 了 Orchestrator、或没有 @，继续走现有的 Orchestrator 规划流程。
  3. `lib/agents/mention.ts` 视需要补充「提取单 mention」辅助函数。
  涉及修改文件：`lib/conversations/service.ts`（`sendGroupMessage` 增加分流逻辑）、`lib/agents/mention.ts`、`lib/orchestrator/service.ts`（保持现有流程不变，但上游不再把所有消息都丢进来）
  验收标准：群聊中 @ 单个 Agent 发送消息后，该 Agent 直接回复，不出现 Orchestrator 规划消息和 task 卡片；消息流中显示为普通 Agent 消息气泡；多 @ 或不 @ 时仍正常走 Orchestrator 规划；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P2
  所属范围：Orchestrator / 群聊交互
  问题/目标：当前群聊中所有用户消息都被视为任务请求（plan → execute），没有纯对话出口。用户无法与 Orchestrator 进行方案讨论、分析咨询、闲聊等非任务类交流。
  解决方案：
  1. 修改 `lib/orchestrator/planner.ts` 的 SYSTEM_PROMPT：增加 `phase: "chat"`。当用户消息明显是咨询/讨论而非可执行任务时，Planner 返回 `{"phase":"chat","response":"..."}`，不创建 task。
  2. 修改 `lib/orchestrator/service.ts` 的 `processGroupMessage`：增加 chat 分支处理。调用 Provider LLM（或复用 Planner）基于群聊上下文生成回复，以 `role: "orchestrator"` 消息入库并 SSE 推送，不创建 `orchestrator_run` 和 task。
  3. 或作为替代方案：前端/后端识别 `@Orchestrator` mention，直接触发 Orchestrator 回复而不走 Planner 任务拆解。
  涉及修改文件：`lib/orchestrator/planner.ts`（prompt 增加 chat phase）、`lib/orchestrator/service.ts`（新增 `handleChat` 分支）、`lib/agents/mention.ts`（识别 @Orchestrator）
  验收标准：群聊中发送非任务类消息（如"你怎么看这个方案""帮我们分析一下利弊"）时，Orchestrator 直接以对话形式回复，不创建 task、不调度 Agent；任务类消息仍正常走 plan → execute；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P1
  所属范围：Orchestrator
  问题/目标：当前 Orchestrator 在 Agent 任务完成后，通过关键词匹配的 Evaluator 自动判定任务失败并创建 revision 任务重跑。该机制评判粗糙、用户不可控，可能导致误杀和静默循环重跑，与「用户主导」的产品体验不符。
  解决方案：
  1. 删除 `lib/orchestrator/service.ts` 顶部模块级变量 `const revisionCount = new Map<string, number>();`。
  2. 删除 `lib/orchestrator/service.ts` 中 `handleTaskCompleted` 函数内从 `if (shouldRevise(evaluation))` 开始到该分支结束的全部代码块（约第 260-283 行），包括创建 revision task、插入 `orchestrator_tasks`、调用 `dispatchRunnableTasks` 的逻辑。保留 `evaluateTaskResult` 的调用（返回值先留着，后面改 Evaluator 时再用）。
  3. 删除 `lib/orchestrator/evaluator.ts` 中的 `shouldRevise` 和 `createRevisionTask` 两个导出函数，只保留 `evaluateTaskResult`。
  4. 删除 `lib/orchestrator/scheduler.ts` 中的 `createTasksFromPlan` 函数（该函数已废弃，且插入的 `assigneeConversationAgentId: ""` 会触发外键约束错误）。
  涉及修改文件：`lib/orchestrator/service.ts`、`lib/orchestrator/evaluator.ts`、`lib/orchestrator/scheduler.ts`
  验收标准：Agent 任务完成后不再自动重跑；Orchestrator 正常进入汇总阶段；下游依赖 task 的调度不受影响；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P2
  所属范围：Orchestrator
  问题/目标：`evaluateTaskResult` 使用关键词匹配（"error"、"failed"、"sorry" 等）判断 Agent 回复是否合格，误杀率和漏过率都很高。Agent 正常回复中出现 "error handling" 会被误判为失败，而委婉表达的无结果回复又会漏过。
  解决方案：
  1. 修改 `lib/orchestrator/evaluator.ts` 的 `evaluateTaskResult`：删除 `failureKeywords` 数组和关键词匹配逻辑。改为仅基于客观指标判断：
     - 若 `task.status === "error" || task.status === "cancelled"` → `ok: false`
     - 若 `messageContent.trim().length < 10` → `ok: false`（内容过短视为未产出）
     - 其余情况一律 → `ok: true`
     - `needsRevision` 固定返回 `false`（在引入用户确认机制前，不允许自动触发重跑）
  2. 修改 `lib/orchestrator/aggregator.ts` 的 `aggregateResults`：在汇总消息中，对 `failed` 任务增加显式说明（例如列出 "以下任务未成功完成：task-x · error 原因"），让用户在 Summary 里直接看到哪个 Agent 没搞定，而不是被 Orchestrator 偷偷重试。
  3. `lib/orchestrator/service.ts` 的 `handleTaskCompleted` 中，保留调用 `evaluateTaskResult` 的位置，但只把结果传给 aggregator 或写日志，不再用于自动创建新任务。
  涉及修改文件：`lib/orchestrator/evaluator.ts`、`lib/orchestrator/aggregator.ts`、`lib/orchestrator/service.ts`
  验收标准：Evaluator 不再基于关键词自动判定失败；Summary 中显式列出失败任务；`needsRevision` 永远返回 `false`；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P1
  所属范围：Orchestrator / 产品定位
  问题/目标：Orchestrator Planner 的 system prompt 被严重预设为 software/coding 场景（"software project orchestrator"、"AI coding agents"、规则 15 "Do NOT write code"），导致通用任务（写作、分析、策划等）也被当成软件需求拆解，与 AgentHub「通用多 Agent 协作平台」的产品定位不符。
  解决方案：将 Orchestrator Planner 的 system prompt 从「软件项目调度器」改为「通用多 Agent 任务调度器」。具体：1）身份定义去 coding 化（orchestrator → task orchestrator，coding agents → AI agents with diverse capabilities）；2）mode 解释通用化（single_agent/parallel/compare/implement_review/pipeline 均用领域无关语言描述）；3）规则语言中性化（"Do NOT write code" → "Do NOT execute tasks yourself"）；4）示例和任务描述不再隐含技术栈；5）JSON schema 和调度规则保持不变。
  涉及修改文件：`lib/orchestrator/planner.ts`（SYSTEM_PROMPT 全文重写）、`docs/design/TECH_DESIGN.md`（如 §3.2 涉及 Planner 角色描述则同步更新）
  验收标准：Planner 对非 coding 请求（如"写一份市场分析报告""策划一次旅行""分析某本书的论点"）返回的 plan 中 task description 不出现默认技术栈（React、API、代码审查等）；对 coding 请求仍能正常返回技术类 plan；`npm run typecheck`、`npm run build` 通过；至少各跑 1 个 coding 和 1 个非 coding 请求的 smoke 验证。

- 时间：2026-05-30
  优先级：P2
  所属范围：UI / 单聊
  问题/目标：单聊消息流中，Agent 消息气泡的发送者信息区域（头像右侧）会显示一个 `已激活` 的状态 tag（来自 `MessageBubble.tsx` 中 `statusLabel(rosterMember.status)` 的 `active` 分支）。该 tag 在每条 Agent 消息旁重复出现，视觉上显得繁琐冗余，用户不需要在每条消息上都看到这个状态标识。
  解决方案：移除单聊消息气泡中的状态 tag 展示。可选方案：① 直接删除 `senderRole` 的渲染逻辑；② 或仅在 `running` 状态时显示动态标签（如「运行中」+ 停止按钮），`active`/`idle` 等静态状态不显示。推荐方案①，保持消息头部简洁，状态信息保留在右栏上下文面板中。
  涉及修改文件：`components/chat/MessageBubble.tsx`（删除或简化 `senderRole` 渲染）
  验收标准：单聊中 Agent 消息气泡头部只显示名字和时间，不再显示 `已激活`/`待命` 等状态 tag；群聊消息气泡若也有类似逻辑同步处理；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-25 11:57
  优先级：P2
  所属范围：适配器 / QA
  问题/目标：对图片/附件上传到真实 Agent 的链路做端到端验收。
  解决方案：使用 Claude Code / Codex 至少各跑一次带图片或文件的真实对话，确认 adapter prompt 中包含附件本地路径，Agent 不再回答“没有看到附件”；记录不支持 native 多模态时的 UI/文案边界。
  涉及修改文件：`lib/adapters/claude-code.ts`、`lib/adapters/codex.ts`、`lib/adapters/types.ts`、`components/chat/Composer.tsx`、`components/chat/MessageBubble.tsx`
  验收标准：用户上传图片/文件并 @Agent 发送后，Agent 回复能基于附件路径进行处理；消息刷新后附件仍可查看/下载；不支持直接读图的 Agent 有明确限制说明。
  当前验证：本机 Claude Code CLI 可用（`claude --version` 为 2.1.119），Codex CLI 未在 PATH 中找到；Claude 附件路径 smoke 在 120 秒内未返回，尚不能判定真实端到端通过。

## 已做

- 时间：2026-05-30
  优先级：P1
  所属范围：Orchestrator / Provider
  问题/目标：Planner 目前只允许选择 `openai_compatible` Provider，需要同时支持 `anthropic` 协议。
  解决方案：放开 Orchestrator settings 的协议限制；在 Planner HTTP 客户端中根据 Provider protocol 自动切换 OpenAI Chat Completions 与 Anthropic Messages API 格式；统一 prompt 构造与响应提取。
  涉及修改文件：`lib/providers/service.ts`、`components/settings/SettingsModal.tsx`、`app/api/planner/smoke/route.ts`
  验收标准：设置页可选择 `anthropic` 协议 Provider 作为 Planner；Planner smoke 对 anthropic 端点返回有效 JSON plan。
  完成时间：2026-05-30
  验证结果：`lib/providers/service.ts` 已移除 protocol 限制；`components/settings/SettingsModal.tsx` 已放开过滤并更新文案；`app/api/planner/smoke/route.ts` 已支持 anthropic 协议；Kimi k2.6 anthropic 端点 smoke 返回有效 JSON plan；`npm run typecheck` 通过。

- 时间：2026-05-25 11:57
  优先级：P1
  所属范围：UI / API
  问题/目标：将右栏 Terminal 从一次性命令执行补齐为真实交互式终端。
  解决方案：引入 `xterm.js` 与后端 WebSocket / PTY 会话；右栏 Terminal 视图连接持久 shell，cwd 使用当前会话 `workspace_path`，支持基础输入输出和中断。
  涉及修改文件：`components/context/ContextPanel.tsx`、`app/api/terminal/execute/route.ts`、`package.json`、后续新增 terminal/ws 服务文件
  验收标准：右栏 Terminal 可持续执行多条命令；`pwd` / `ls` / `npm -v` 在会话工作区运行；切换会话后 cwd 与对应 `workspace_path` 一致。
  完成时间：2026-05-25 16:01
  验证结果：`npm run typecheck`、`npm run build` 通过；实现为 `@xterm/xterm` + `ws` + `node-pty`，cwd 使用会话 `workspace_path`。

- 时间：2026-05-25 11:57
  优先级：P1
  所属范围：适配器 / UI
  问题/目标：补齐真实产物链路，使 Agent 产物、消息产物卡片和右栏产出文件列表一致。
  解决方案：让 adapter 在检测到文件产出时发出 `artifact_created` 事件；后端写入 `artifacts` 表；消息流按真实 artifact 渲染 `ArtifactCard`，右栏产出文件列表读取同一数据源。
  涉及修改文件：`lib/adapters/*`、`lib/conversations/runs.ts`、`lib/conversations/service.ts`、`components/chat/MessageBubble.tsx`、`components/chat/ArtifactCard.tsx`、`components/context/ContextPanel.tsx`
  验收标准：Agent 生成文件后刷新页面仍能看到产物卡片和右栏产出文件；两处展示的文件名、路径和数量一致；用户上传附件不会被误识别为产物。
  完成时间：2026-05-25 12:39
  验证结果：`npm run typecheck`、`npm run build` 通过；后端保留 adapter 显式 `artifact_created`，并新增工作区运行前后文件快照兜底，排除 `data/attachments` 避免把用户附件误判为产物。

- 时间：2026-05-25 11:57
  优先级：P2
  所属范围：UI
  问题/目标：将当前基础 regex 代码高亮升级为稳定的 Markdown / Shiki 渲染链路。
  解决方案：接入成熟 Markdown 渲染与 Shiki 高亮，保留代码块复制按钮；覆盖常见语言、长代码滚动、流式输出完成后的渲染更新。
  涉及修改文件：`components/chat/MessageBubble.tsx`、`app/globals.css`、`package.json`
  验收标准：Agent 回复中的 Markdown 段落、列表、链接和代码块稳定渲染；代码块有语言标识、高亮和复制按钮；TypeScript、JSON、Shell 代码显示正确。
  完成时间：2026-05-25 12:39
  验证结果：`npm run typecheck`、`npm run build` 通过；消息渲染改为 `react-markdown` + `remark-gfm`，fenced code block 使用 Shiki 高亮并保留复制按钮。

- 时间：2026-05-22 22:40
  优先级：P1
  所属范围：API / UI
  问题/目标：补全会话重命名能力，支持左侧会话菜单编辑会话名称。
  解决方案：新增 `PATCH /api/conversations/[conversationId]` 的 `title` 更新逻辑；前端在 `ConversationSidebar` 的会话菜单中提供编辑入口，提交后刷新本地会话列表和当前会话标题。
  涉及修改文件：`lib/db/schema.ts`、`lib/conversations/service.ts`、`app/api/conversations/[conversationId]/route.ts`、`components/shell/AppShell.tsx`、`components/shell/ConversationSidebar.tsx`、`lib/conversations/types.ts`
  验收标准：用户可修改单聊会话标题；刷新页面后新标题仍保留；空标题或超长标题有明确处理。
  完成时间：2026-05-22 22:53
  验证结果：`npm run typecheck` 通过。

- 时间：2026-05-22 22:40
  优先级：P2
  所属范围：API / UI
  问题/目标：补全会话归档/取消归档能力，并支持左侧“已归档”区域展开/收起查看归档会话。
  解决方案：为 `conversations` 增加 `archived_at` 字段；`PATCH /api/conversations/[conversationId]` 支持 `archived` 布尔更新；默认会话列表过滤已归档会话，`ConversationSidebar` 的“已归档”区域展示数量并可展开归档列表，归档会话菜单提供取消归档。
  涉及修改文件：`lib/db/schema.ts`、`lib/conversations/service.ts`、`app/api/conversations/[conversationId]/route.ts`、`components/shell/AppShell.tsx`、`components/shell/ConversationSidebar.tsx`、`lib/conversations/types.ts`
  验收标准：归档后会话从主列表移入已归档区域；已归档区域可展开/收起；取消归档后会话回到主列表；刷新后状态保持一致。
  完成时间：2026-05-22 22:53
  验证结果：`npm run typecheck` 通过。

- 时间：2026-05-22 22:40
  优先级：P1
  所属范围：API / UI
  问题/目标：补全会话删除能力，删除会话时清理关联消息、锁定关系、运行记录和产物。
  解决方案：新增 `DELETE /api/conversations/[conversationId]`；后端依赖外键级联或显式事务清理 `messages`、`conversation_agents`、`agent_runs`、`artifacts`；前端左侧菜单提供删除入口并做二次确认，删除当前会话后回到空白新建页或选择下一条会话。
  涉及修改文件：`lib/db/schema.ts`、`lib/conversations/service.ts`、`app/api/conversations/[conversationId]/route.ts`、`components/shell/AppShell.tsx`、`components/shell/ConversationSidebar.tsx`
  验收标准：用户确认后可删除会话；会话从列表消失且详情/消息接口返回不存在；关联数据不残留；删除当前打开会话后 UI 不报错。
  完成时间：2026-05-22 22:53
  验证结果：`npm run typecheck` 通过。

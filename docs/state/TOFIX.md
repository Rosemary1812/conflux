# 待修复池

本文件记录已发现但不一定马上修复的 bug、回归、技术债和体验问题。主线阶段任务请写入根目录 `roadmap.md`。

## 待做

- 时间：2026-05-30
  优先级：P1
  所属范围：适配器 / OpenCode ACP
  问题/目标：单聊中 `@opencode hi` 等简单对话触发 `运行失败：OpenCode completed without returning assistant text.`。根因是 `lib/adapters/opencode.ts` 的 `extractText` 函数和 `eventFromSessionUpdate` 对 OpenCode ACP 返回的文本字段覆盖不全——OpenCode 把回复放在了 `extractText` 不认识的"抽屉"里（如 `delta`、`response`、`answer` 等字段名），导致 adapter 找不到文本而报错。此前 2026-05-29 的修复增加了部分兜底，但未覆盖所有可能的字段变体。
  解决方案：A) 扩展 `extractText` 的字段覆盖——增加 `delta`、`textDelta`、`response`、`assistantMessage`、`answer`、`body` 等常见变体；B) 扩展 `eventFromSessionUpdate` 的事件类型覆盖——增加 `agent_message`（完整消息）、`message`、`text` 等可能的事件名；C) 增加调试日志——当 `extractText` 返回空时，记录原始数据结构的 key 到 stderr，便于排查未来新变体。
  涉及修改文件：`lib/adapters/opencode.ts`（`extractText`、`eventFromSessionUpdate`）
  验收标准：`@opencode hi`、`@opencode 你好` 等简单对话能正常返回 assistant 文本且 message/run 状态为 `done`；不再出现 `OpenCode completed without returning assistant text.`；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-22 20:21
  优先级：待定
  所属范围：构建
  问题/目标：`npm audit` 报告 Next.js 依赖链中的 `postcss <8.5.10` 存在 moderate 级别安全告警。
  解决方案：等待 Next.js 发布包含安全依赖修复的兼容版本后升级，或评估可控的 package override；不要使用当前 `npm audit fix --force` 给出的破坏性降级方案。
  涉及修改文件：`package.json`、`package-lock.json`
  验收标准：`npm audit --audit-level=moderate` 不再报告该 `postcss` 告警，且 `npm run build`、`npm run typecheck` 通过。

## 已做

- 时间：2026-05-30
  优先级：P2
  所属范围：适配器 / Provider
  问题/目标：外部 Planner Provider（如 Kimi）偶发对正常开发类请求返回 `400 The request was rejected because it was considered high risk`，导致子 Agent run 直接失败。
  解决方案：评估是否需要更换 Provider、添加请求重试（换模型或简化 prompt）、或在 Orchestrator 中增加 task 失败后的自动重试/降级逻辑。
  涉及修改文件：`lib/orchestrator/invoker.ts`、`lib/orchestrator/service.ts`
  验收标准：正常开发类任务（写登录页、读目录等）的 task 失败率 < 10%；失败后 UI 有明确错误提示。
  完成时间：2026-06-01
  验证结果：已随 V2.5 计划一并修复；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P2
  所属范围：API / 群聊
  问题/目标：`regenerateMessage` 仍限制 `conversation.mode !== "single"` 时返回 400，群聊不支持重新生成。
  解决方案：扩展 regenerate 逻辑支持群聊——按 message 的 `authorConversationAgentId` 找到对应 Agent，重新触发 `startAgentRun` 或 `invokeAgentForTask`；或至少对 Orchestrator 消息提供重新生成功能。
  涉及修改文件：`lib/conversations/service.ts`、`app/api/messages/[messageId]/regenerate/route.ts`
  验收标准：群聊中可对子 Agent 的 assistant 消息点击重新生成；重新生成后旧消息被替换、新 run 启动。
  完成时间：2026-06-01
  验证结果：已随 V2.5 计划一并修复；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P2
  所属范围：Orchestrator / Planner
  问题/目标：Planner prompt 对模糊需求的判断偏保守，用户发送明确需求（如"直接做"）后仍可能返回 `phase=clarify`，导致连续 2 轮澄清。
  解决方案：微调 Planner system prompt 中 clarify 触发条件，增加对"直接做/开始/执行"等关键词的识别权重；或在 `processGroupMessage` 中增加 clarification_round 上限硬拦截（超过 2 轮强制 execute）。
  涉及修改文件：`lib/orchestrator/planner.ts`
  验收标准：连续 2 轮 clarify 后第 3 轮必定 execute；用户说"直接做"时 execute 概率 > 80%。
  完成时间：2026-06-01
  验证结果：已随 V2.5 计划一并修复；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P1
  所属范围：Orchestrator / 调度
  问题/目标：当上游 task 进入 `error` 状态时，下游依赖 task 永远停留在 `pending`，`orchestrator_runs` 无法进入终态，导致会话状态一直 `running`。
  解决方案：在 `handleTaskCompleted` 中检测依赖失败场景，将下游 task 自动标记为 `cancelled` 或 `error`（并附带 `dependency_failed` 原因），触发 `areAllTasksTerminal` 完成 Orchestrator run finalize。
  涉及修改文件：`lib/orchestrator/service.ts`
  验收标准：上游 task error 后，下游 task 在 1 秒内自动变为 cancelled/error；Orchestrator run 最终进入 `done` 并生成 summary（说明部分 task 失败）；会话状态回到 `done`。
  完成时间：2026-06-01
  验证结果：已随 V2.5 计划一并修复；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P1
  所属范围：Orchestrator / Planner
  问题/目标：Planner LLM 把 roster 中的 `platform` 字段（如 `claude_code`）和 `alias`（如 `claude-code`）混淆，返回的 `assignee_alias` 使用了下划线版本（`claude_code`）而非连字符版本（`claude-code`），导致 `validatePlan` 找不到匹配 alias，用户看到「计划校验失败」报错。
  解决方案：A) Prompt 层——在 `buildPlannerPrompt` 和 SYSTEM_PROMPT 中强调 alias 必须使用 roster 中列出的精确值，并将 platform 信息弱化/隐藏以避免混淆；B) 代码容错层——在 `normalizePlan` 中增加 alias fuzzy match：exact match 失败后尝试下划线↔连字符互换、忽略大小写等规则，在 roster 中找最接近的匹配。
  涉及修改文件：`lib/orchestrator/planner.ts`（SYSTEM_PROMPT + `buildPlannerPrompt` + `normalizePlan`）
  验收标准：`@claude @opencode` 初始化群聊后，Planner 返回的 task 中 `assignee_alias` 与 roster alias 精确匹配（或通过 fuzzy match 自动纠正）；不再出现「计划校验失败：unknown alias ...」报错。
  完成时间：2026-06-01
  验证结果：已随 V2.5 计划一并修复；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-30
  优先级：P1
  所属范围：UI / V2.4
  问题/目标：V2.4 退役群聊 mock 后，ConversationSidebar 仍保留 `conversation.mode === "single"` 条件屏蔽群聊的 ConversationMenu，导致真实群聊不支持编辑名称、归档、删除。
  解决方案：移除该条件，让所有真实 conversation（含 group）均显示菜单。
  涉及修改文件：`components/shell/ConversationSidebar.tsx`
  验收标准：群聊会话项显示「三个点」菜单；点击可编辑名称、归档、删除；操作后 UI 状态同步；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-30
  验证结果：已移除 `conversation.mode === "single"` 条件；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-29 01:05
  优先级：P1
  所属范围：适配器 / Claude Code
  问题/目标：经 AgentHub 接入的 Claude Code 在用户批准 Bash/Write 等需 `canUseTool` 审批的工具后，工具不执行并报 SDK 侧 Zod 校验错误（`updatedInput: expected record, received undefined`）；与命令内容、工作目录路径无关，凡走 Approval 且用户点「允许」的路径均可能失败。非 Windows 文件权限问题。
  解决方案：`lib/adapters/claude-code.ts` 的 `createPermissionHandler` 在用户批准时按 [Claude Agent SDK 文档](https://code.claude.com/docs/en/agent-sdk/user-input) 返回 `{ behavior: "allow", updatedInput: input }`（可保留 `toolUseID`）；`deny` 分支保持 `{ behavior: "deny", message }` 不变。
  涉及修改文件：`lib/adapters/claude-code.ts`
  验收标准：单聊中触发 Bash 审批（如 `rmdir`、先 `cd` 再删目录）用户批准后命令实际执行且无 ZodError；Write/Edit 审批通过后文件变更生效；拒绝时 run 合理结束且 Claude 收到 deny message；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-29 15:23
  验证结果：`createPermissionHandler` 的 allow 分支已返回 `updatedInput: input` 并保留 `toolUseID`；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-29 00:40
  优先级：P1
  所属范围：适配器 / OpenCode ACP
  问题/目标：与 OpenCode 对话时，用户发送「你好你好你好」等消息后，助手气泡无正常回复，仅显示 `运行失败：OpenCode completed without returning assistant text.`；界面上看到的「你好你好你好」实为**用户消息**（`messages.role=user`），不是 assistant 输出。`lib/adapters/opencode.ts` 在 `connection.prompt()` 已正常结束（非 cancelled/refusal）但未收到任何 `agent_message_chunk`（`content.type === "text"`）映射的 `text_delta` 时触发该错误（约 224–226 行）。本地复现：`data/agenthub.sqlite` 会话 `3a6fb8f6-5684-4392-956f-e98e66f1a9b7`，`agent_runs.error` 为上述文案，assistant `content` 为空；同会话 `agent_external_sessions` 为 `resumeSession=true` / `resumedSession=true`，且前序存在 `cancelled` 或同类 error run。
  解决方案：① 扩展 `eventFromSessionUpdate`，记录并映射 OpenCode 可能使用的其它 ACP `sessionUpdate` / content 形态（非 `agent_message_chunk`+`text`）；② 排查 `prompt` resolve 时立即 `queue.end()` 是否与迟到的 `sessionUpdate` 竞态，改为在确认无待处理 chunk 后再结束队列；③ `resumeSession`/`loadSession` 后若整轮无 chunk，回退 `newSession` 或从 prompt 结果中提取 assistant 文本作兜底；④ 增加可开关的 ACP 原始事件日志，便于对比「直接 `opencode acp` smoke 有 chunk、App 层无 chunk」的分叉。此前 TOFIX（2026-05-28）已做收尾 guard，本场景为同链路回归/未覆盖路径。
  涉及修改文件：`lib/adapters/opencode.ts`、`lib/conversations/runs.ts`（若需改进 error 展示区分用户/助手内容）
  验收标准：同一会话在「首条 `@opencode`」「普通 follow-up（如 `你好你好你好`）」及「取消上一轮后重试」三种路径下，前端均能显示非空 assistant 回复且 message/run 为 `done`；数据库 assistant `content` 非空；不再出现 `OpenCode completed without returning assistant text.`；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-29 15:23
  验证结果：`eventFromSessionUpdate` 已改为通过通用文本提取读取 `agent_message_chunk.content`；`connection.prompt()` resolve 后延迟关闭队列以接住迟到的 `session/update`；无 chunk 时会尝试从 prompt result 中提取文本兜底；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-28 16:42
  优先级：P1
  所属范围：交互桥接 / API
  问题/目标：Approval/Choice 的 resume 只依赖进程内 waiter，页面刷新、Next dev 热重载或服务重启后，用户点击批准/选择会把 `agent_runs` 改回 `running`，但实际 adapter run 已无法继续，单聊会卡在 running 或空回复。
  解决方案：将 interaction waiter 提升为进程级 `globalThis` 单例，并在 `POST /api/interactions/:id/respond` 检测无法恢复的 waiter；不可恢复时将 interaction 标记为 `expired`，assistant message / run 标记为 `error`，conversation 回到 `done`。
  涉及修改文件：`lib/interactions/run-bridge.ts`、`lib/interactions/service.ts`
  验收标准：触发 Approval/Choice 后刷新页面或重启 dev server，再点击回应时不会出现无限 running；若不能恢复同一 run，前端显示明确失败状态；正常未刷新路径仍可同一 run 继续；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-28 20:45
  验证结果：fake approval 正常回应后同一 run 继续并 `done`；重启 dev server 后回应旧 pending interaction 返回 409，message 为 `error`，interaction 为 `expired`；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-28 16:42
  优先级：P1
  所属范围：SSE / UI
  问题/目标：pending interaction 只在首次 HTTP 查询和实时 `interaction_requested` 事件中进入前端；SSE 重连只 replay agent message，不 replay pending interactions，若交互创建发生在 `loadPendingInteractions()` 与 EventSource 订阅之间，或网络重连期间，用户将看不到 Approval/Choice 卡片。
  解决方案：`/api/conversations/:id/stream` 在 connected replay 阶段订阅实时事件后补发当前 pending `interaction_requested`；前端继续按 interaction id 去重。
  涉及修改文件：`app/api/conversations/[conversationId]/stream/route.ts`
  验收标准：触发 Approval/Choice 后刷新页面、切换会话回来、断网重连或慢加载时，inline 卡片都能恢复显示且不重复；回应后卡片消失；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-28 20:45
  验证结果：fake choice pending 后请求 SSE stream，connected replay 中包含 `interaction_requested`；回应后 interaction 为 `answered`，assistant message 为 `done`；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-28 16:42
  优先级：P1
  所属范围：适配器 / 会话连续性
  问题/目标：Claude Code 和 OpenCode 每条用户消息都启动新的外部会话，只把最近消息拼成 prompt；没有持久化 Claude `sessionId`/`resume` 或 OpenCode ACP `sessionId`/`loadSession`，因此“持续会话”不是外部 Agent 的真实会话续接，工具上下文、内部状态和长会话能力会丢失。
  解决方案：新增 `agent_external_sessions` 按 conversation/agent/platform 持久化外部 session id；`AdapterRunParams` 增加 `externalSessionId` 与 `saveExternalSessionId()`；Claude Code 保存 SDK `session_id` 并用 `resume`；OpenCode 按 capability 优先 `resumeSession`、其次 `loadSession`，失败才新建 session。
  涉及修改文件：`lib/adapters/claude-code.ts`、`lib/adapters/opencode.ts`、`lib/adapters/types.ts`、`lib/conversations/runs.ts`、`lib/db/schema.ts`、`lib/db/client.ts`
  验收标准：同一单聊后续消息能复用同一个外部 Agent 会话；刷新页面不影响下一轮续接；无法续接的 adapter 在设置/healthcheck 中明确降级说明；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-28 20:45
  验证结果：OpenCode 同一会话第二轮回复 `OK2`，`agent_external_sessions` 保存同一个 `ses_...` 且 capabilities 为 `resumeSession=true`、`resumedSession=true`；Claude Code 同一会话第二轮回复 `OK2`，保存 Claude SDK UUID session；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-28 16:42
  优先级：P2
  所属范围：UI / 运行状态
  问题/目标：前端把除 `running` 之外的所有 `run_status` 都当作终态处理；`awaiting_interaction` 会触发重新拉取 conversations/messages，增加交互事件竞态，并可能在用户等待批准时造成消息流闪烁或状态误判。
  解决方案：前端将 `awaiting_interaction` 作为非终态处理，只在 `done`、`error`、`cancelled` 时刷新完整消息和会话列表。
  涉及修改文件：`components/shell/AppShell.tsx`
  验收标准：run 进入 awaiting interaction 时 composer 保持停止态且消息不闪烁；pending 卡片稳定显示；终态仍会刷新 artifacts/status；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-28 20:45
  验证结果：fake approval / choice 进入 pending 后不会因 `awaiting_interaction` 触发终态刷新；respond 后最终状态正常刷新；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-28 16:03
  优先级：P1
  所属范围：适配器 / 消息流
  问题/目标：Codex app-server 回复内容被重复追加两次；截图与 SQLite 最近消息均显示同一句 assistant 回复在单个消息 content 中重复拼接。
  解决方案：`lib/adapters/codex.ts` 改为 delta 优先，记录本 turn 已输出文本；`item/completed` 只在没有 delta 或只缺后缀时补全文，不再把完整 agent message 二次追加。
  涉及修改文件：`lib/adapters/codex.ts`
  验收标准：`@codex 你好` 这类短回复在数据库 `messages.content` 和前端气泡中只出现一次；仍能正常流式显示；Codex turn 完成后 run/message 状态为 `done`；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-28 20:45
  验证结果：`npm run typecheck`、`npm run build` 通过；真实 Codex app-server 普通回复 smoke 被当前账号 `Your workspace is out of credits. Add credits to continue.` 阻塞，未能在本机验证成功回复去重。

- 时间：2026-05-28 16:03
  优先级：P1
  所属范围：适配器 / OpenCode ACP
  问题/目标：OpenCode 在部分真实会话中不显示回复，数据库中存在 OpenCode assistant 消息 content 为空且 run 长时间停留 `running` 的记录；但直接 ACP smoke 可收到 `agent_message_chunk`，说明 OpenCode CLI 本身会产生回复，问题更可能在 AgentHub 的 OpenCode adapter/run 收尾链路或异常状态回写。
  解决方案：OpenCode adapter 不再把 stderr 当 assistant 正文；区分 prompt resolve/reject、child close/error 和 queue 关闭；进程提前关闭或 prompt 失败时写 `message_error`，完成但未收到 assistant 文本时也明确 error，避免空内容 running。
  涉及修改文件：`lib/adapters/opencode.ts`
  验收标准：`@opencode 你好` 和一个读取项目类任务都能在前端显示 assistant 回复；数据库对应 assistant message 非空且状态最终为 `done` 或明确 `error/cancelled`，不能无限 `running`；直接 ACP smoke 与 `/api/messages` app 层 smoke 均通过；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-05-28 20:45
  验证结果：`@opencode 只回复 OK，不要执行工具。` 返回 `OK` 且 message `done`；同会话第二轮返回 `OK2`；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-27 21:29
  优先级：待定
  所属范围：适配器
  问题/目标：Claude Code / Codex 真实 CLI 适配器仍是一次性进程模型，V1.5 Approval / Choice 目前只能通过 fake adapter 验证 pause/resume，尚未接 SDK `canUseTool` / AskUserQuestion。
  解决方案：Claude Code 改为 Claude Agent SDK，使用 `canUseTool` 映射 Approval，并通过 AgentHub MCP `request_choice` 映射 Choice；Codex 改为 `codex app-server` 长驻 JSON-RPC，映射 command/file/permissions approval 与 `request_user_input`/elicitation choice；OpenCode 改为 `opencode acp`，映射 ACP `session/request_permission` 与 elicitation；Hermes 保持 `noInteractionCapabilities`，因为当前 `hermes --oneshot` 路径没有可暂停控制通道。
  涉及修改文件：`lib/adapters/claude-code.ts`、`lib/adapters/codex.ts`、`lib/adapters/opencode.ts`、`lib/adapters/fallback.ts`、`lib/adapters/fake.ts`、`lib/adapters/hermes.ts`、`lib/adapters/types.ts`、`lib/adapters/json-rpc-process.ts`、`package.json`、`package-lock.json`
  验收标准：真实单聊 Agent 触发工具审批或选项提问时，前端收到 `interaction_requested`，用户 respond 后同一 `agent_run` 继续；拒绝审批会让 run 失败/结束。
  完成时间：2026-05-28 15:00
  验证结果：`npm run typecheck`、`npm run build` 通过；OpenCode ACP `initialize + session/new` smoke 通过；Codex app-server `initialize + thread/start` smoke 通过，并修正 `sessionStartSource` 为当前 CLI 接受的 `startup`。

- 时间：2026-05-25 23:03
  优先级：P1
  所属范围：API / 适配器
  问题/目标：附件功能采用上传并复制文件内容到 `data/attachments` 的模型，与本地 Agent 在本地工作区读文件的产品定位不匹配，还引入不必要的内存、磁盘和下载接口风险。
  解决方案：将附件改为路径引用模型；本地目录/文件选择器返回真实文件路径，消息只保存 `fileName`、`mimeType`、`size`、`path` 等元数据，Adapter prompt 传本地路径给 Agent；删除或停用上传 bytes、`arrayBuffer()`、`data/attachments` 写盘和附件下载接口，并增加路径存在、可读、默认限制在当前 workspace 内或显式确认外部路径的校验。
  涉及修改文件：`components/chat/Composer.tsx`、`components/shell/AppShell.tsx`、`app/api/messages/route.ts`、`app/api/attachments/[attachmentId]/route.ts`、`lib/conversations/service.ts`、`lib/adapters/types.ts`、`lib/db/schema.ts`、`lib/db/client.ts`
  验收标准：发送带附件消息时服务端不接收或复制文件内容；数据库只记录本地文件路径元数据；Agent 收到可访问的本地路径上下文；超出允许范围或不可读路径会被拒绝并给出明确错误；`npm run typecheck` 通过。
  完成时间：2026-05-26 00:05
  验证结果：附件发送改为 JSON 路径元数据；旧附件下载接口和直接上传 bytes 流程已移除；`npm run typecheck`、`git diff --check`、`git diff --cached --check` 通过，相关文件无新增 linter 错误。

- 时间：2026-05-25 23:03
  优先级：P1
  所属范围：API
  问题/目标：新增 Terminal API 和 WebSocket PTY 直接把浏览器请求/输入转发到本机 shell，缺少鉴权、一次性会话令牌、Origin 校验或显式本地开发开关。
  解决方案：移除未使用的 `/api/terminal/execute` 直接命令执行接口；Terminal WebSocket 通过服务端生成的短期签名 token 建立连接，校验 Origin/Host 与会话权限，并只在明确启用的本地模式开放。
  涉及修改文件：`app/api/terminal/execute/route.ts`、`app/api/terminal/session/route.ts`、`lib/terminal/websocket-server.ts`、`components/context/ContextPanel.tsx`
  验收标准：未携带有效短期 token 的 WebSocket 连接会被拒绝；跨 Origin 请求不能打开本机 shell；直接命令执行 API 不再暴露；本地 Terminal 功能在合法会话中仍可使用。
  完成时间：2026-05-26 00:05
  验证结果：直接命令执行接口已从暂存区移除；Terminal 会话改为短期 token + 本地 Origin 校验，并在生产环境要求 `AGENTHUB_ENABLE_TERMINAL=1`；`npm run typecheck`、`git diff --check`、`git diff --cached --check` 通过，相关文件无新增 linter 错误。

- 时间：2026-05-25 23:03
  优先级：P2
  所属范围：API / UI
  问题/目标：Agent 产物按绝对路径全局去重，后续 run 再次修改同一个文件时会跳过记录，导致最新回复的 `message.artifacts` 看不到本次产物。
  解决方案：将产物关联粒度改为 `messageId/runId + path`，或在同一路径再次变化时更新并关联到最新消息；UI 保持按当前消息和会话聚合显示。
  涉及修改文件：`lib/conversations/runs.ts`、`lib/conversations/service.ts`、`components/chat/ArtifactCard.tsx`、`components/context/ContextPanel.tsx`
  验收标准：同一文件在不同 Agent run 中被修改时，每次最新回复都能显示本次相关产物；会话右侧产物列表能看到最近更新记录；不会插入完全重复的同一 run 产物。
  完成时间：2026-05-26 00:05
  验证结果：工作区 diff 和 adapter 显式产物均按 `runId + path` 避免同一 run 重复，同时允许后续 run 重新关联同一路径产物；`npm run typecheck`、`git diff --check`、`git diff --cached --check` 通过，相关文件无新增 linter 错误。

- 时间：2026-05-25 23:03
  优先级：P3
  所属范围：文档 / QA
  问题/目标：`git diff --cached --check` 报告 `docs/design/ExecutePlan/V1-单聊完整版实施计划.md` 文件末尾存在新增空行。
  解决方案：清理文档末尾多余空行，保持 diff 空白检查通过。
  涉及修改文件：`docs/design/ExecutePlan/V1-单聊完整版实施计划.md`
  验收标准：`git diff --cached --check` 不再报告该文件的 EOF 空白问题。
  完成时间：2026-05-26 00:05
  验证结果：`git diff --cached --check` 通过。

- 时间：2026-05-25 21:05
  优先级：P1
  所属范围：UI
  问题/目标：新建对话首条消息发送请求有延迟，发送按钮在请求返回前仍可点击，可能导致用户重复发送同一条消息。
  解决方案：Composer 增加发送中互斥状态；提交后只禁用发送按钮并显示发送中，输入框、附件上传和工作区选择仍可继续使用。
  涉及修改文件：`components/chat/Composer.tsx`
  验收标准：发送请求未返回前不能再次提交；用户仍可继续输入下一条消息或添加附件；发送失败且用户未编辑新内容时恢复原草稿。
  完成时间：2026-05-25 21:10
  验证结果：`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-25 12:05
  优先级：P1
  所属范围：UI
  问题/目标：新建单聊会复用上一次选择的工作区，导致工作区看起来全局生效；未选择工作区时仍可直接发送首条消息。
  解决方案：新建单聊时清空草稿工作区；发送消息前校验当前会话或草稿必须已有工作区；未选择时提示用户先选择当前工作区。
  涉及修改文件：`components/shell/AppShell.tsx`
  验收标准：每次新建单聊都显示未选择工作区；未选工作区无法发送并显示明确提示；选定工作区后首条消息使用该目录创建会话。
  完成时间：2026-05-25 12:09
  验证结果：`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-25 12:05
  优先级：P1
  所属范围：UI / API
  问题/目标：点击中断后后端已无运行任务，但前端发送按钮仍保持红色停止态，导致无法再次发送消息。
  解决方案：停止请求返回成功或“无运行任务”时，前端都将当前会话恢复为 idle/done，并刷新会话与消息状态；后端重复 stop 的无运行任务响应保持可被前端幂等处理。
  涉及修改文件：`components/shell/AppShell.tsx`、`app/api/conversations/[conversationId]/stop/route.ts`
  验收标准：点击中断后发送按钮恢复为正常发送态；再次输入消息可以发送；重复点击中断不会让 UI 卡在 running。
  完成时间：2026-05-25 12:09
  验证结果：`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-25 11:23
  优先级：P1
  所属范围：UI / API
  问题/目标：新建空白单聊里「当前工作区」按钮不可点击，用户必须先 @Agent 发送首条消息生成会话后才能选择工作区，导致 Agent 首次运行目录无法提前确定。
  解决方案：为未落库的新单聊维护草稿工作区；工作区选择按钮在新建态也可打开目录选择器；首条消息创建会话时把草稿工作区一并传给后端持久化。
  涉及修改文件：`components/shell/AppShell.tsx`、`components/chat/MessageStream.tsx`、`components/context/ContextPanel.tsx`、`app/api/conversations/route.ts`、`lib/conversations/service.ts`
  验收标准：新建单聊未发送消息时可点击「当前工作区」选择文件夹；发送首条 `@Agent` 消息后，会话使用该目录作为 `workspace_path`；已有会话仍可修改工作区。
  完成时间：2026-05-25 11:26
  验证结果：`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-24 22:10
  优先级：P1
  所属范围：UI / API
  问题/目标：点击「新建聊天」会立即创建并保存空会话，连续点击会在左侧栏堆积多个未开始的「新建聊天」记录。
  解决方案：将「新建聊天」改为仅切换到本地空白单聊视图，直到用户首次发送消息时才创建真实会话；左侧列表过滤历史遗留的未锁定空会话。
  涉及修改文件：`components/shell/AppShell.tsx`、`lib/conversations/service.ts`
  验收标准：连续点击「新建聊天」不会新增左侧会话记录；发送首条消息后才出现真实会话；刷新后未发送的空白会话不会残留。
  完成时间：2026-05-24 22:20
  验证结果：`npm run build`、`npm run typecheck` 顺序执行通过。

- 时间：2026-05-24 22:10
  优先级：P1
  所属范围：UI
  问题/目标：左侧聊天栏会话过多时不稳定出现滚动条，列表向下叠加并被底部区域遮挡。
  解决方案：收紧左侧栏 flex 高度约束，固定头部、操作区、归档区和底部设置区，确保会话列表作为唯一主滚动区域。
  涉及修改文件：`app/globals.css`
  验收标准：大量会话时左侧「聊天」列表内部出现滚动条；底部「已归档」和「设置」区域始终可见且不遮挡列表项。
  完成时间：2026-05-24 22:20
  验证结果：`npm run build`、`npm run typecheck` 顺序执行通过。

- 时间：2026-05-24 10:00
  优先级：待定
  所属范围：UI
  问题/目标：左侧栏会话项「三个点」操作菜单展开后，点击页面其他区域不会自动收起，必须再次点击该按钮才能关闭。
  解决方案：为 `ConversationMenu` 增加 click-outside 监听——在菜单打开时注册 document 级 `mousedown` 事件，若点击目标不在菜单容器（含触发按钮与 popover）内，则将 `openMenuId` 置为 `null`；组件卸载或菜单关闭时移除监听。
  涉及修改文件：`components/shell/ConversationSidebar.tsx`
  验收标准：点击「三个点」展开菜单后，点击侧边栏其他区域、主聊天区或页面任意非菜单区域，菜单自动收起；点击菜单内按钮（编辑名称、归档、删除）行为不变；再次点击同一「三个点」仍可 toggle 开关。
  完成时间：2026-05-24 10:15
  验证结果：`ConversationMenu` 增加 `wrapRef` 与 `mousedown` 监听；`npm run typecheck` 通过。

- 时间：2026-05-23 14:30
  优先级：P2
  所属范围：UI
  问题/目标：消息列表可视区域占满整页高度，底部输入框（Composer）以绝对定位叠在消息区上方，导致对话框下方仍能看到消息内容。
  解决方案：调整 `chat-surface` 布局，使消息区高度 = 中间栏高度 − 顶栏 − Composer 占位（改为 flex 分栏或预留固定底部空间），消息滚动区域不得延伸进输入框区域。
  涉及修改文件：`app/globals.css`、`components/shell/AppShell.tsx`（若需结构调整）、`components/chat/Composer.tsx`
  验收标准：Composer 下方不再出现消息气泡/文本；滚到底时最后一条消息停在输入框上方；不同窗口高度下布局仍正确。
  完成时间：2026-05-23 15:00
  验证结果：`chat-surface` 改为 flex 分栏；Composer 取消 absolute/fixed 叠层；`.message-area` 移除 190px 底部 padding，消息滚动区不再延伸进输入框区域。

- 时间：2026-05-23 12:00
  优先级：P2
  所属范围：UI
  问题/目标：右侧栏与顶栏存在两个功能重复的收起/展开按钮；收起时仍保留约 38px 深色 `context-rail`，右侧竖条始终可见。
  解决方案：仅保留聊天顶栏（Terminal 旁）的右侧栏开关；移除 `ContextPanel` 内收起态 rail 与展开态顶栏的 toggle 按钮；收起时将第三列宽度设为 0 或完全隐藏，使布局呈 L 形（左栏 + 主聊天区），展开时再显示完整上下文面板。
  涉及修改文件：`components/context/ContextPanel.tsx`、`components/chat/MessageStream.tsx`、`components/shell/AppShell.tsx`、`app/globals.css`
  验收标准：全应用仅顶栏一处可切换右侧栏；收起后右侧深色区域完全不可见、不占布局宽度；展开后上下文面板正常显示且可拖拽调整宽度；`npm run typecheck` 通过。
  完成时间：2026-05-23 12:30
  验证结果：`npm run typecheck` 通过；收起时第三列宽度为 0 且不渲染 `ContextPanel`，仅顶栏按钮控制展开/收起。

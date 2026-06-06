# 待办池

本文件只记录主线之外的小目标、小优化和补充事项。主线阶段任务请写入根目录 `roadmap.md`。

## 待做

> **主线变更（2026-05-27）**：Approval 与选项交互已升格为 **V1.5 主线**（`roadmap.md` + `docs/design/ExecutePlan/V1.5-交互桥接-Approval与选项.md`）。V2 启动前须完成 V1.5；群聊 Approval UI 在 V2.4 接入。

- 时间：2026-06-05
  优先级：P1
  所属范围：UI / API / 性能
  问题/目标：单聊/群聊发送消息后，从点击到用户消息出现在界面、再到 Agent 开始流式回复之间存在明显空白期，感知上"反应慢"。根因是前端没有乐观更新（必须等 `POST /api/messages` 返回才渲染），且 assistant 消息缺少 loading 占位反馈。
  解决方案：
    1. **乐观更新用户消息**：`AppShell.sendMessage` 在 `fetch` 前先把用户消息 prepend 到本地 `messages`，并清空输入框；API 成功后替换为真实消息（含服务端生成的 id、time 等），失败则回滚。
    2. **临时 assistant 占位**：API 返回的 `payload.messages` 中若包含 `status=running` 的 assistant 消息，前端立即渲染该消息气泡（空内容），不等待 SSE 首条 delta。
    3. **发送按钮 loading**：`Composer` 在发送请求未返回前进入互斥 loading 状态，显示旋转动画并禁用发送按钮。
    4. **旋转 loading 动画**：assistant 占位气泡内显示旋转 loading（不显示"正在思考"等文案），直到收到第一条 `message_delta` 或 `message_status` 变为终态。
  涉及修改文件：`components/shell/AppShell.tsx`、`components/chat/Composer.tsx`、`components/chat/MessageBubble.tsx`、`app/globals.css`
  验收标准：点击发送后用户消息立即出现在消息流末尾；发送按钮显示旋转 loading 且不可重复提交；assistant 空气泡同步出现并带旋转动画；SSE 首条 delta 到达后无缝追加文本；发送失败时前端消息状态正确回滚或报错；`npm run typecheck`、`npm run build` 通过。

- 时间：2026-05-25 11:57
  优先级：P2
  所属范围：适配器 / QA
  问题/目标：对图片/附件上传到真实 Agent 的链路做端到端验收。
  解决方案：使用 Claude Code / Codex 至少各跑一次带图片或文件的真实对话，确认 adapter prompt 中包含附件本地路径，Agent 不再回答“没有看到附件”；记录不支持 native 多模态时的 UI/文案边界。
  涉及修改文件：`lib/adapters/claude-code.ts`、`lib/adapters/codex.ts`、`lib/adapters/types.ts`、`components/chat/Composer.tsx`、`components/chat/MessageBubble.tsx`
  验收标准：用户上传图片/文件并 @Agent 发送后，Agent 回复能基于附件路径进行处理；消息刷新后附件仍可查看/下载；不支持直接读图的 Agent 有明确限制说明。
  当前验证：本机 Claude Code CLI 可用（`claude --version` 为 2.1.119），Codex CLI 未在 PATH 中找到；Claude 附件路径 smoke 在 120 秒内未返回，尚不能判定真实端到端通过。

- 时间：2026-06-05
  优先级：P2
  所属范围：UI / 工作区选择
  问题/目标：当前 Windows 工作区选择器使用 `System.Windows.Forms.FolderBrowserDialog`，对话框老旧、启动慢、不支持粘贴路径，整体体验差。
  解决方案：换用现代 Windows 文件选择器（如 `IFileDialog` / `System.Windows.Forms.OpenFileDialog` 配合文件夹选择模式），启动更快、支持地址栏粘贴、体验更贴近资源管理器。
  涉及修改文件：`app/api/workspace/select/route.ts`
  验收标准：点击工作区按钮后对话框弹出明显更快；支持粘贴路径；选择后工作区路径正常回传。

- 时间：2026-06-05
  优先级：P2
  所属范围：API / 工作区选择
  问题/目标：当前工作区选择器后端通过新起 `powershell.exe` 进程调用对话框，PowerShell 冷启动耗时明显，导致用户点击后数秒才有反馈。
  解决方案：① 预启动并复用 PowerShell 进程避免冷启动；② 或换用 Node.js 原生 addon / `child_process` 直接调用 Windows API 减少中间层；③ 或评估前端 `<input webkitdirectory>` 方案是否可替代。
  涉及修改文件：`app/api/workspace/select/route.ts`、可能新增辅助模块
  验收标准：点击工作区按钮到对话框弹出延迟控制在 500ms 以内；`npm run typecheck`、`npm run build` 通过。

## 已做

- 时间：2026-06-05
  优先级：P2
  所属范围：UI / 单聊
  问题/目标：单聊消息流中，Agent 消息气泡的发送者信息区域会显示一个 `已激活` 的状态 tag，视觉上繁琐冗余。
  解决方案：直接删除 `senderRole` / `statusLabel` 的渲染逻辑，消息头部仅保留名字和时间，状态信息保留在右栏上下文面板。
  涉及修改文件：`components/chat/MessageBubble.tsx`
  验收标准：单聊/群聊中 Agent 消息气泡头部不再显示 `已激活`/`待命` 等状态 tag；`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-06-05
  验证结果：`npm run typecheck`、`npm run build` 通过；代码中已无状态 tag 渲染逻辑。

- 时间：2026-06-05
  优先级：P2
  所属范围：API / 性能 — 消息分页
  问题/目标：`listMessages` 无分页，一次性加载会话全部历史消息。群聊中多 Agent 并行回复，消息量增长快；长会话首次加载时返回数据量大、序列化慢、前端渲染慢。
  解决方案：
  - 后端新增 `listMessagesPaginated(conversationId, { limit, beforeId })`，用 `limit + 1` 技巧判断 `hasMore`，批量预加载附件/产物不变。
  - API `GET /api/conversations/:id/messages` 支持 `?limit=&beforeId=` 查询参数，返回 `{ messages, hasMore }`。
  - 前端 `AppShell` 新增 `hasMoreMessages` / `isLoadingMore` state；`loadMoreMessages` 传 `beforeId = messages[0].id` 加载更早消息并 prepend 到列表。
  - `MessageStream` 在 `.message-thread` 添加 `onScroll` 监听，滚动到顶部（scrollTop < 80）触发加载；加载后自动调整 scrollTop 保持视口位置。
  - SSE 实时推送正常追加到底部，与分页互不干扰。
  涉及修改文件：`lib/conversations/service.ts`、`app/api/conversations/[conversationId]/messages/route.ts`、`components/shell/AppShell.tsx`、`components/chat/MessageStream.tsx`、`app/globals.css`
  验收标准：`npm run typecheck`、`npm run build` 通过；长会话首次只加载 50 条；滚动到顶加载更多；新消息 SSE 正常追加。
  完成时间：2026-06-05
  验证结果：`npm run typecheck`、`npm run build` 通过。

- 时间：2026-06-05
  优先级：P1-P2
  所属范围：性能优化（数据库索引 + N+1 + 前端缓存 + SSE 精简）
  问题/目标：打开历史对话/群聊速度明显变慢，经调研发现数据库缺少索引、API 存在 N+1 查询、前端全量渲染、SSE 重复查询等多层性能瓶颈。
  解决方案：
  1. **数据库索引**：为 `messages`、`agent_interactions`、`agent_runs`、`orchestrator_runs`、`orchestrator_tasks`、`artifacts` 表添加 `conversation_id` 索引（`artifacts` 额外加 `message_id` 索引）。
  2. **N+1 修复**：`listMessages` 改为先查消息列表，再批量 `IN` 查询附件/产物后映射到各消息；`toConversationSummary` 移除 `artifacts` 查询，左侧列表不再为每个会话查产物；`ContextPanel` 右栏产物改为从 `messages` 聚合提取。
  3. **前端渲染缓存**：`MessageBubble` 用 `React.memo` + 自定义比较函数包裹，避免父组件刷新时重复渲染未变更消息。
  4. **SSE 精简**：移除 `/api/conversations/:id/stream` 启动时的全量 `message_replace` replay（前端已主动拉取），保留 `interaction_requested` replay 用于重连恢复 pending 交互。
  涉及修改文件：`lib/db/schema.ts`、`lib/conversations/service.ts`、`components/chat/MessageBubble.tsx`、`components/context/ContextPanel.tsx`、`app/api/conversations/[conversationId]/stream/route.ts`
  验收标准：`npm run typecheck`、`npm run build` 通过。
  完成时间：2026-06-05
  验证结果：`npm run typecheck`、`npm run build` 通过。

- 时间：2026-06-01
  优先级：P1-P2
  所属范围：Orchestrator / V2.5 修复与优化
  问题/目标：汇总并实施 V2.5 Orchestrator 修复与优化计划，覆盖调度、Planner、Evaluator、群聊交互范式、总结输出等模块。
  解决方案：分 4 个 Phase 实施：P1a（删除自动重跑、上游error下游cancelled、静默丢弃改报错、删废弃代码）、P1b（Planner去coding化、alias fuzzy match）、P1c（群聊@单Agent直接指派）、P2a（取消mode硬编码、roster status校验、clarify多轮多问、Evaluator保守化）、P2b（Agent上下文注入、总结流式输出、按mode模板化总结）、P3（Orchestrator纯对话chat phase、群聊regenerate、task卡片awaiting_interaction状态同步、Planner high risk重试）、P4（clarify关键词权重、permission弱化为可选）。
  涉及修改文件：`lib/orchestrator/*.ts`、`lib/conversations/service.ts`、`lib/interactions/service.ts`、`components/context/ContextPanel.tsx`
  验收标准：`npm run typecheck`、`npm run build` 通过；10项验收标准全部满足。
  完成时间：2026-06-01
  验证结果：`npm run typecheck`、`npm run build` 通过。

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

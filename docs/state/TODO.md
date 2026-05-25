# 待办池

本文件只记录主线之外的小目标、小优化和补充事项。主线阶段任务请写入根目录 `roadmap.md`。

## 待做

- 时间：2026-05-25 11:57
  优先级：P2
  所属范围：适配器 / QA
  问题/目标：对图片/附件上传到真实 Agent 的链路做端到端验收。
  解决方案：使用 Claude Code / Codex 至少各跑一次带图片或文件的真实对话，确认 adapter prompt 中包含附件本地路径，Agent 不再回答“没有看到附件”；记录不支持 native 多模态时的 UI/文案边界。
  涉及修改文件：`lib/adapters/claude-code.ts`、`lib/adapters/codex.ts`、`lib/adapters/types.ts`、`components/chat/Composer.tsx`、`components/chat/MessageBubble.tsx`
  验收标准：用户上传图片/文件并 @Agent 发送后，Agent 回复能基于附件路径进行处理；消息刷新后附件仍可查看/下载；不支持直接读图的 Agent 有明确限制说明。
  当前验证：本机 Claude Code CLI 可用（`claude --version` 为 2.1.119），Codex CLI 未在 PATH 中找到；Claude 附件路径 smoke 在 120 秒内未返回，尚不能判定真实端到端通过。

## 已做

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

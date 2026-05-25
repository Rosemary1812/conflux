# 待修复池

本文件记录已发现但不一定马上修复的 bug、回归、技术债和体验问题。主线阶段任务请写入根目录 `roadmap.md`。

## 待做

- 时间：2026-05-22 20:21
  优先级：待定
  所属范围：构建
  问题/目标：`npm audit` 报告 Next.js 依赖链中的 `postcss <8.5.10` 存在 moderate 级别安全告警。
  解决方案：等待 Next.js 发布包含安全依赖修复的兼容版本后升级，或评估可控的 package override；不要使用当前 `npm audit fix --force` 给出的破坏性降级方案。
  涉及修改文件：`package.json`、`package-lock.json`
  验收标准：`npm audit --audit-level=moderate` 不再报告该 `postcss` 告警，且 `npm run build`、`npm run typecheck` 通过。

## 已做

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

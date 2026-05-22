# 待办池

本文件只记录主线之外的小目标、小优化和补充事项。主线阶段任务请写入根目录 `roadmap.md`。

## 待做

暂无。

## 已做

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

# V1 UI 原型（结构修正版）

这批页面是 **纯 HTML 原型**，目标不是定最终视觉，而是先把信息架构、入口位置与页面成分改对。

## 预览方式

直接双击 `index.html`，或在目录里起静态服务：

```bash
cd d:\coding\agent\AgentHub\prototypes\v1
npx --yes serve . -p 5199
```

然后访问 `http://localhost:5199`。

## 页面说明

| 文件 | 说明 |
| --- | --- |
| `single-chat.html` | 单聊主页面：三栏、底部用户设置入口、上传型输入框、右栏可收起与拖拽 |
| `single-chat-new.html` | 新建单聊入口页：直接进入空白对话，首条消息只允许 `@` 一个 Agent，并在确认后锁定 |
| `group-chat-new.html` | 新建群聊入口页：直接进入空白对话，首条消息可 `@` 多个 Agent，`Orchestrator` 自动加入 |
| `group-chat.html` | 群聊静态预览：身份分层更清晰，Orchestrator 为独立消息类型 |
| `settings.html` | 设置弹层预览：不是独立设置页，而是从用户头像弹出的管理层 |
| `states.html` | 空状态、healthcheck 失败、连接中、发送失败 |

补充说明见 `HANDOFF.md`，供正式实施前端的 Agent 快速理解哪些交互已定、哪些视觉仍是参考。

## 本轮结构调整

- `AgentHub` logo 改为 `Conflux`
- 左栏增加「最近会话 / 已归档对话」结构
- 群聊与单聊在列表和消息区做更强区分
- 输入框改为支持图片 / 文件的复合输入条
- 设置改为用户区弹层入口
- 右栏支持收起与拖拽宽度
- “新建聊天 / 新建群聊” 改成直接进入空白对话页，不再先弹 Agent 选择层
- 单聊采用“首条消息 @ 一个 Agent 后锁定”的规则
- 群聊采用“首条消息 @ 多个 Agent，Orchestrator 自动加入”的规则
- 设置里移除：
  - 工作区目录 / 可执行路径等底层参数
  - “Orchestrator API” 这类技术词
  - 自建 Agent 的底层平台 / glob 暴露

## 与正式实现的对应

落地 Next.js 时，可拆成：

- `AppShell`
- `ConversationSidebar`
- `MessageStream`
- `Composer`
- `ContextPanel`
- `SettingsModal`
- `lib/mock/group-conversation.ts`

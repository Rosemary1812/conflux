# AgentHub 评审检查清单

本文件按阶段记录各版本验收项。完成后在对应项前打勾。

---

## V1 单聊完整版

> 基线：2026-05-26

- [x] 新建单聊 → 选择 Agent → 发送消息 → 流式回复
- [x] 刷新后历史消息保留
- [x] 至少 1 个外部 Agent 端到端可用（Claude Code）
- [x] 右栏状态、代码块、产物预览
- [x] 停止生成、重新生成
- [x] 工作区选择与会话锁定
- [x] 会话 CRUD（编辑名称、归档、删除）

## V1.5 交互桥接（Approval + Choice）

> 基线：2026-05-28

- [x] 单聊触发审批 → inline 批准/拒绝 → 同一 run 继续或失败
- [x] 单聊触发选项 → 点选或自定义 → 同一 run 继续
- [x] 刷新后 pending interaction 可 respond；不可恢复时 409 + error 态
- [x] SSE replay 包含 pending interactions
- [x] 外部会话续接（Claude Code session resume、OpenCode ACP loadSession）
- [x] 单聊主链路不退化

## V2 群聊、Orchestrator 与 Provider

> 基线：2026-05-30

### V2.0 文档与契约
- [x] API_CONTRACT.md 补录 V1.5 交互端点 + V2 增量
- [x] TECH_DESIGN.md §3.2 Provider / Planner 设计
- [x] migration 脚本定稿（conversation_agents alias 唯一、messages role 扩展）

### V2.1 Provider 与 Runtime Inspection
- [x] Provider CRUD API（GET/POST/PATCH/DELETE + test）
- [x] Orchestrator Settings API（GET/PATCH）
- [x] 设置页 Provider / Orchestrator 接真实 API
- [x] Planner 支持 anthropic + openai_compatible 协议
- [x] 单聊功能不退化

### V2.2 群聊后端基础
- [x] 群聊 schema migration（roster、alias、conversationAgentId）
- [x] 群聊创建与会话列表
- [x] 首条消息 ≥2 mention 初始化 roster
- [x] 同 slug 多实例 alias 生成（claude-code、claude-code-2）
- [x] stop 支持 conversationAgentId body
- [x] 单聊 stop 行为不变

### V2.3 Orchestrator P0
- [x] OrchestratorService 主流程（context → plan → validate → dispatch → collect → evaluate → summarize）
- [x] Planner HTTP 调用返回 JSON plan（clarify / execute）
- [x] Task 状态机与 DB 操作
- [x] Invoker 薄封装调用 startAgentRun
- [x] SSE 事件：task_created、task_status、task_result、orchestrator_summary
- [x] 子 Agent 消息带 authorConversationAgentId
- [x] 单聊功能不退化

### V2.4 前端真实联动
- [x] 群聊 SSE 连接与事件监听
- [x] MessageStream 移除 mock、统一真实消息
- [x] MessageBubble 身份区分（alias、头像、orchestrator 特殊身份）
- [x] ContextPanel GroupContext 真实化（参与上下文 + 任务分派）
- [x] Composer 群聊可用、@ alias 验证
- [x] ConversationSidebar 移除 mock、群聊菜单修复
- [x] 删除 lib/mock/group-conversation.ts
- [x] 构建和类型检查通过

### V2.5 QA 与收口（本轮）
- [x] 类型检查 `npm run typecheck` 通过
- [x] 构建 `npm run build` 通过
- [x] 单聊全链路回归：发送、流式、锁定、消息列表正常
- [x] 同基础 Agent 多实例 UI：roster 正确区分 alias（claude-code / claude-code-2）
- [ ] 群聊 Demo 脚本 1–10 完整端到端（受 Planner 行为 + 外部 API 可用性影响，主链路已通）
- [ ] 刷新恢复验证（pending interaction、task、roster）— 待人工确认
- [ ] 附件端到端（P2 遗留项）

### V2 已知问题 / 待优化（见 TOFIX.md）
- [ ] Planner 对模糊需求过度 clarify（偶发第 2 轮仍 clarify）
- [ ] 依赖 task 失败后下游 task 永久 pending，Orchestrator run 无法自动 finalize
- [ ] 外部 Provider 安全策略偶发拦截正常开发类请求（400 high risk）
- [ ] 群聊 regenerate 不支持（代码中仍限制 mode !== "single" 时 400）

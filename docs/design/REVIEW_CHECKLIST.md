# AgentHub V1 验收检查清单

> 依据 `roadmap.md` V1 验收标准、`docs/design/ExecutePlan/V1-单聊完整版实施计划.md` 第六节及 Phase 0–6 验收项、`AGENTS.md` 评审门编写。  
> 评审时逐项勾选；未通过项记录到 `docs/state/TOFIX.md`，不作为 V1 完成依据。

---

## 环境前提

- [ ] **本机 Node 开发服务可启动**  
  **如何验证**：项目根目录执行 `npm install`（首次）后运行 `npm run dev` 或文档约定的 `npx agenthub`；浏览器打开 `http://localhost:<port>`，三栏布局可见。

- [ ] **SQLite 与内置 Agent seed 就绪**  
  **如何验证**：首次启动后本地数据库文件已创建；会话/设置中可见 seed 的四类内置 Agent（Claude Code、Codex、Hermes、OpenCode）。

- [ ] **浏览器为 UI 壳，能力在本机 Node 进程**  
  **如何验证**：Agent adapter、SQLite、PTY Terminal（若已实现）均依赖本机 Node 服务；关闭服务后无法继续对话或打开 Terminal。

- [ ] **原型参考保留、正式实现独立**  
  **如何验证**：`prototypes/v1/` 仍存在作参考；正式页面由 React 组件实现，非直接嵌入 HTML 原型。

---

## 单聊必过

### 会话创建与 Agent 锁定

- [ ] **新建单聊进入空白页**  
  **如何验证**：点击「新建聊天」→ 选择单聊；消息区为空，无预填 Agent，Composer 可用。

- [ ] **首条消息缺少 `@Agent` 被拒绝**  
  **如何验证**：发送不含 `@Agent` 的首条消息（如「你好」）；UI 或 API 返回明确错误，不创建 run、不调用 adapter。

- [ ] **首条消息 `@` 多个 Agent 被拒绝**  
  **如何验证**：发送 `@claude-code @codex 一起帮我改代码`；返回明确错误，会话不锁定多个 Agent。

- [ ] **首条 `@` 一个有效 Agent 后锁定**  
  **如何验证**：发送 `@claude-code 你好`；会话详情显示当前 Agent 为 Claude Code，后续消息无需重复 `@` 即可继续。

- [ ] **锁定后不可切换 Agent**  
  **如何验证**：在已有消息的会话中发送 `@codex 换你来`；被拒绝并提示需新建聊天才能换 Agent。

### 消息、流式与持久化

- [ ] **发送消息触发 SSE 流式输出**  
  **如何验证**：发送 `@claude-code 用一句话介绍自己`；assistant 气泡逐字/逐段增长，非一次性整段出现。

- [ ] **流式回复落库，刷新后历史仍在**  
  **如何验证**：等待回复完成后刷新页面；会话列表、消息历史、锁定 Agent 与工作区路径（若已选）与刷新前一致。

- [ ] **发送按钮与停止按钮同一控件切换**  
  **如何验证**：Agent 运行中 Composer 发送按钮变为停止态；run 结束后恢复为发送态。

- [ ] **停止生成中断当前 run**  
  **如何验证**：发送较长 prompt，运行中点击停止；消息状态变为 cancelled/error，后端 run 被取消，可再次发送。

### 三栏布局与基础 IM

- [ ] **三栏布局完整**  
  **如何验证**：左侧会话列表、中间消息流、右侧上下文面板均可见；窗口缩放时布局不严重错位。

- [ ] **右栏可收起与拖拽调宽**  
  **如何验证**：点击收起后右栏隐藏且可再次展开；拖拽分隔条可改变右栏宽度。

- [ ] **设置从左下角 modal 打开**  
  **如何验证**：点击左下角设置按钮弹出 modal/sheet，展示各 Agent 连接状态；无独立 `/settings` 业务路由。

- [ ] **Composer 四个固定入口存在**  
  **如何验证**：底部输入区可见图片、附件、当前工作区、发送/停止四个入口。

### Adapter 与 healthcheck

- [ ] **Claude Code 端到端可用（必过）**  
  **如何验证**：healthcheck 通过前提下，单聊 `@claude-code` 发送 → 真实流式回复 → 落库 → 刷新后历史仍在。

- [ ] **Codex 端到端或准确失败（推荐）**  
  **如何验证**：本机 Codex CLI 就绪则 `@codex` 单聊跑通同样流程；未就绪时 healthcheck 与发送失败均展示准确原因，非假成功。

- [ ] **Hermes / OpenCode healthcheck 与边界正确**  
  **如何验证**：设置弹层显示状态；不可用时 UI 灰显或提示配置问题；可用环境下能完成真实 run 或给出明确 CLI 错误，不允许 mock 成功冒充。

- [ ] **停止生成能终止真实进程或取消运行**  
  **如何验证**：Claude Code（或任一真实 adapter）运行中点击停止；子进程退出或 run 标记 cancelled，非仅前端假停。

- [ ] **至少 2 个 Agent 可切换单聊对象（推荐）**  
  **如何验证**：分别新建两个单聊，各锁定不同可用 Agent；两者独立对话，互不影响同会话锁定关系。

- [ ] **设置弹层展示各 Agent 连接状态**  
  **如何验证**：打开设置，四类 Agent 均显示 healthcheck 结果（可用 / 不可用及原因）。

---

## Phase 5 体验（P0 / P1）

### P0（必过）

- [ ] **工作区选择与会话持久化**  
  **如何验证**：为单聊选择本机目录并发送消息；Agent 在该目录下运行；刷新后会话仍记住路径；切换工作区后新 run 使用新路径。

- [ ] **图片 / 附件上传、展示与恢复**  
  **如何验证**：通过 Composer 选择本地图片或文件随消息发送；消息流出现缩略图或附件卡片；刷新后 metadata 仍在，下载可用。

- [ ] **Markdown 与代码块渲染**  
  **如何验证**：让 Agent 回复含标题、列表与 fenced 代码块；消息流正确渲染 Markdown，代码块有语法高亮或复制能力至少一种可用。

- [ ] **重新生成**  
  **如何验证**：对 assistant 消息点击「重新生成」；触发新 run 且仍使用当前锁定 Agent；旧回复删除或标记 superseded；stop/cancel 行为与首次发送一致。

### P1（应过）

- [ ] **右栏上下文视图**  
  **如何验证**：默认右栏展示当前 Agent、run 状态（running/done/error/cancelled）；若有产物链路，产出文件列表与消息流产物卡片一致。

- [ ] **右栏 Terminal 视图可切换**  
  **如何验证**：点击顶栏 Terminal 按钮，右栏切换为 xterm.js 终端；再次点击回到上下文视图；终端区域撑满右栏且保留拖拽调宽。

- [ ] **Terminal PTY cwd 与会话工作区一致**  
  **如何验证**：在工作区为特定目录的会话打开 Terminal，执行 `pwd`（Unix）或 `cd`（Windows）；输出与选定工作区一致。

- [ ] **Terminal 常规命令可用**  
  **如何验证**：本机通过 CLI 启动服务后，Terminal 中执行 `ls`/`dir`、`npm -v` 等；输入输出双向正常，`Ctrl+C` 可中断前台命令。

- [ ] **产物卡片 `ArtifactCard`（若本 phase 已接链路）**  
  **如何验证**：Agent run 在工作区生成或显式上报文件后，消息流出现产物卡片（文件名、类型、预览/下载）；刷新后仍可恢复。

### 可延期（不阻塞 V1 结论）

- [ ] **引用回复** — 未实现则记入 TOFIX/TODO；已实现则验证选中消息引用后继续对话。  
- [ ] **产物路径正则提取、Terminal 多 tab、UI 微调** — 未做不算 V1 失败。

---

## 群聊静态必过

- [ ] **可从列表进入群聊静态页**  
  **如何验证**：新建对话选择「群聊」或从列表进入群聊；三栏布局与 PRD/原型一致（多 Agent 头像、分角色气泡、任务进度卡片、`@` 输入框样式可见）。

- [ ] **群聊使用模拟数据展示**  
  **如何验证**：消息流来自 `lib/mock/group-conversation.ts` 或等价 mock；可见 Orchestrator 角色与多 Agent 气泡，无需真实后端调度。

- [ ] **V1 仅 UI 标注清晰**  
  **如何验证**：群聊页存在「即将支持」「预览态」或发送禁用等提示；用户能区分「单聊已可用」与「群聊仅为界面预览」。

- [ ] **群聊 Composer 禁用或 mock-only**  
  **如何验证**：尝试在群聊发送消息；输入被禁用或仅本地 mock，不出现真实 SSE/run。

- [ ] **群聊发送不触发真实 Agent 链路**  
  **如何验证**：群聊内发送（若 UI 允许）不创建 `agent_run`、不调用 adapter registry、不调用 Orchestrator；Network 无真实单聊调度请求。

- [ ] **API 层 group conversation 不走路由到真实编排**  
  **如何验证**：审查或实测群聊消息接口返回禁用/4xx，或前端根本不发起该请求；`mode=group` 不触发 adapter/Orchestrator。

---

## 明确不验收（V2 / V3）

以下能力**不在 V1 阻塞范围**；误暴露入口应禁用并标注「即将支持」，评审时不按失败计：

- [ ] **群聊真实消息链路、Orchestrator、任务 DAG、并行调度、失败降级** — V2  
- [ ] **群聊 `@` 初始化成员、动态邀请、`ConversationAgent` 运行时** — V2  
- [ ] **设置页 Provider CRUD（anthropic / openai_compatible）** — V2  
- [ ] **`OrchestratorService`、Planner 与执行 Agent 分离** — V2  
- [ ] **`/agent-creator`、`/skill-creator`、`SkillRunner`、用户自建 Agent** — V3  
- [ ] **Diff 应用、部署发布、版本历史** — PRD P2 / V3 择项  
- [ ] **Electron 桌面壳、移动端、云端多用户协作、完整一键部署** — 路线图暂缓  
- [ ] **从浏览器拉起系统 Terminal 独立窗口；纯云端静态站下的 Terminal / Agent CLI** — V1 明确不做  

**如何验证**：答辩或自查时确认上述能力未作为 V1 必过项；若 UI 误暴露，应禁用或标注。

---

## 工程门（typecheck / build）

- [ ] **TypeScript 类型检查通过**  
  **如何验证**：执行 `npm run typecheck`，退出码 0，无类型错误。

- [ ] **生产构建通过**  
  **如何验证**：执行 `npm run build`，Next.js 构建成功，无阻塞性错误。

- [ ] **Phase 0 基座验收**  
  **如何验证**：本地 dev 可启动；首页或会话页见三栏空壳；上述 typecheck/build 通过。

- [ ] **设计文档齐备**  
  **如何验证**：`docs/design/` 下存在 `TECH_DESIGN.md`（架构、数据模型、Adapter 契约）与 `API_CONTRACT.md`（HTTP + SSE 事件），与当前实现大致一致。

- [ ] **路线图与实施计划一致**  
  **如何验证**：`roadmap.md` V1 范围与 `ExecutePlan/V1-单聊完整版实施计划.md` 无未说明的重大偏差；Phase 0–6 完成状态与代码匹配。

---

## 评审门（TOFIX）

按 `AGENTS.md` 评审门执行：

- [ ] **功能验收**  
  **如何验证**：本文「环境前提」「单聊必过」「Phase 5 P0」「群聊静态必过」全部勾选；未完成项已写入 `docs/state/TOFIX.md` 并标注优先级。

- [ ] **类型 / 构建 / lint**  
  **如何验证**：「工程门」通过；若项目有 lint 命令则一并执行，失败项入 TOFIX。

- [ ] **AI 评审（bug / 边界 / 退化）**  
  **如何验证**：对变更 diff 做针对性 review，仅记录 bug、边界条件、体验退化、缺失测试；不做无关重构。发现写入 TOFIX。

- [ ] **人工决策**  
  **如何验证**：评审结论为「立即修复」或「记入 TOFIX」；无 P0 问题悬而未决却标记 V1 完成。

- [ ] **TOFIX 条目格式合规**  
  **如何验证**：新增 TOFIX 含时间、优先级、所属范围、问题/目标、解决方案、涉及文件、验收标准；修复后从「待做」移至「已做」。

---

## 附录：5 分钟 Demo 脚本（答辩用）

1. 启动 `npm run dev`（或 `npx agenthub`）→ 展示三栏 IM 布局。  
2. 打开设置 → 展示四类 Agent healthcheck 状态。  
3. 新建单聊 → 选择工作区 → 发送 `@claude-code …` → 展示 SSE 流式与 Agent 锁定。  
4. （可选）运行中点击停止 → 展示 cancelled。  
5. 展示 Markdown 代码块渲染；对 assistant 消息点「重新生成」。  
6. 刷新页面 → 会话、消息、工作区、锁定 Agent 仍在。  
7. （P1）顶栏 Terminal → 右栏执行 `pwd`/`cd` 验证 cwd。  
8. 进入群聊静态页 → 展示 mock 多 Agent 与任务卡片 → 说明 V1 仅 UI、发送不触发真实编排。

---

## 附录：验收结论模板

| 项目 | 结论 |
| --- | --- |
| 评审日期 | |
| 评审人 | |
| 单聊必过 | ☐ 通过 ☐ 有条件通过 |
| Phase 5 P0 | ☐ 通过 ☐ 部分延期 |
| Phase 5 P1 | ☐ 通过 ☐ 部分延期 |
| Adapter | ☐ Claude Code 必过 ☐ 第二 Agent |
| 群聊静态 | ☐ 通过 |
| 工程门 | ☐ 通过 |
| 阻塞 TOFIX 数 | |
| 备注 | |

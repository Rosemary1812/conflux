# AgentHub 路线图

## 路线图原则

- **V1 一次性把单聊做完整**：前后端、Agent 接入、对话与流式、基础 IM 体验（右栏、产物、消息操作）同属本阶段，不再拆成「先能聊再补 UI」。
- **群聊在本阶段只做 UI**：三栏、群聊消息流、`@` 输入、任务卡片等可用静态/模拟数据展示，**不接** Orchestrator、真实多 Agent 调度与群聊 API。
- API 与数据模型以单聊为准；群聊相关表字段可预留，但 V1 后端只实现 `mode=single` 路径。

## V1：单聊完整版 + 群聊静态 UI

**目标**：单聊端到端可用、体验完整；群聊界面可演示产品形态，但发送消息不触发真实编排。

### 单聊（必须跑通）

**后端**

- Next.js Route Handlers：会话 / 消息 CRUD；SSE 推送 Agent 流式事件。
- SQLite（Drizzle）：`Conversation`（V1 创建与调度仅 `single`）、`Message`、`Agent`。
- `lib/adapters/` 统一契约；接通 **至少 1 个** 真实外部 Agent，推荐 **2 个**（如 Claude Code、Codex）。
- 流程：新建单聊 → 选择 Agent → 发送消息 → 适配器 `run()` → SSE → 落库 → 前端渲染。
- 适配器 `healthcheck`；CLI 未就绪时在 UI 给出提示。

**前端（单聊全功能）**

- 三栏布局：会话列表、消息流、右侧上下文面板。
- 流式输出、停止生成；重新生成、引用回复。
- 消息类型：Markdown 文本、代码块高亮、图片/附件、基础产物卡片（代码/文件预览）。
- 右栏：当前 Agent 状态、简单进度/Todo、本会话产出文件列表。

### 群聊 UI（仅静态，不接后端能力）

- 新建对话可选「群聊」；群聊会话用**模拟数据**展示（多 Agent 头像、分角色气泡、任务进度卡片、`@` 输入框样式等）。
- 群聊内发送、Orchestrator 分派、`Task` 调度、多适配器并行：**不做**；可标注「即将支持」或禁用发送。
- 目的：答辩/Demo 能展示完整 IM 信息架构，开发与联调集中在单聊。

### 明确不做（V2 及以后）

- 群聊真实消息链路、`@` 初始化成员、动态邀请、`ConversationAgent` 运行时。
- `OrchestratorService`、任务 DAG、并行调度、失败降级。
- `/agent-creator`、`SkillRunner`、用户自建 Agent。
- Diff 应用、部署发布、版本历史（按 PRD P2）。

### 验收标准

**单聊（必过）**

- 本机：新建单聊 → 选 Agent → 发消息 → 流式回复 → 刷新后历史仍在。
- 至少 1 个外部 Agent 端到端可用；推荐 2 个可切换单聊对象。
- 右栏状态、代码块/产物预览、重新生成或停止生成至少各验证 1 次。
- API 契约与 V1 数据模型记录在 `docs/design/`。

**群聊 UI（必过）**

- 可从列表进入群聊静态页，布局与 PRD 一致（多 Agent 气泡、任务卡片等可见）。
- 用户能区分「单聊已可用」与「群聊仅为界面预览」。

**记录**

- 主线进度以本文件为准；零散问题记入 `docs/state/`。

## V2：群聊、Orchestrator 与 Provider

**目标**：把 V1 已做好的群聊 UI 接上真实多 Agent 协作；落地统一 **Provider** 配置，供编排调度 Agent 接 API。

**范围**：

- 群聊模式：`@` 初始化、动态邀请、`ConversationAgent` 多实例。
- 自研 `OrchestratorService`：规划 → 任务 DAG → 并行/串行调度 → 汇总。
- **设置页 Provider（V2）**：支持多种协议（至少 `anthropic`、`openai_compatible`）；Base URL + API Key + 默认模型；CRUD 与启用/停用。
- **OrchestratorPlanner / 调度 Agent**：自研 HTTP 客户端（**不**走 Claude Agent SDK），绑定 `openai_compatible` 等 Provider 完成规划 LLM 调用（见 `docs/design/TECH_DESIGN.md` §3.2）。
- 消息流任务进度卡片与右侧任务分派区与真实 `Task` 状态联动。
- 失败降级、代码冲突处理（按 PRD 优先级）。

**验收标准**：

- 群聊内一次用户请求可拆分给多个 Agent，结果在消息流中连贯展示。
- **Provider**：可新增并保存至少两种协议各一条（如 Anthropic 兼容 + OpenAI 兼容）；编排服务能使用已配置的 OpenAI 兼容 Provider 完成一次规划调用。
- **Orchestrator**：能说明 Planner 与执行 Agent 适配器分离、Planner 使用的 Provider 与内置 `@claude-code` 本机鉴权分离。
- 答辩能说明编排流程与当前限制。

## V3：自建 Agent、Skill 与增强产物

**目标**：用户自建 Agent、斜杠 Skill，以及更丰富的产物与部署能力。

**范围**：

- `/agent-creator`、`/skill-creator` 与 `SkillRunner`。
- 自建 Agent：System Prompt + `permission_mode` + 底层 `platform`；`claude_code` 执行见 `docs/design/TECH_DESIGN.md`（复用 V2 Provider，绑定须 `anthropic`）。
- `ClaudeCodeAdapter` 自建路径：`@anthropic-ai/claude-agent-sdk` + per-run `env`；不做本地协议代理。
- Diff 视图、版本历史、部署状态卡片等（按 PRD P2 择项）。

**验收标准**：

- 对话式创建一个自建 Agent（`/agent-creator`），并用于单聊或群聊 `@`。
- 至少一个内置 Skill（`agent-creator`）完整跑通创建流程。
- **自建 + Claude Code**：在 V2 已存在的 Provider 列表中，**仅能选择** `protocol = anthropic` 的项；若选 OpenAI 兼容 Provider 则拦截并提示；绑定后单聊端到端跑通（`permission_mode` 至少验证 `readonly` 与 `editable` 各一次）。
- **内置 `@claude-code`**：单聊仍走本机 Claude Code 默认能力，行为不因自建 Agent 的 Provider 绑定而被覆盖。
- 与 PRD §3.6.5、`TECH_DESIGN.md` 一致。

## 暂缓事项

- 纯假数据演示作为独立阶段（V1 单聊必须真实前后端；群聊仅 UI 静态）。
- Electron 桌面壳。
- 移动端客户端。
- 云端部署与多用户协作。
- 完整版本历史与一键部署。

# 自建 Agent 技术选型（Claude Agent SDK / CLI / Provider 契约）

- 时间：2026-05-23 16:00
- 类型：技术选型 / 产品取舍 / 架构讨论
- 相关范围：适配器 / API / 文档 / V3
- 状态：已决策
- 相关文件：`roadmap.md`、`docs/design/prd初版.md`（§3.6）、`docs/design/ExecutePlan/V1-单聊完整版实施计划.md`、`components/settings/SettingsModal.tsx`、`lib/db/schema.ts`

## 背景

在 V1 单聊与适配器尚未完全落地时，提前讨论 V3「自建 Agent」的执行技术路线：是否自研 agentic 框架、是否采用 Claude Agent SDK、与内置 `@claude-code` 的关系、以及设置页 Provider（含国内第三方 API）如何接入。讨论中曾混淆「SDK 作为执行引擎」与「SDK 作为 IM 里的 Agent」，后续已澄清分层。

## 核心问题

- 内置 Claude Code（`@claude-code`）与「用户自建 Agent」在产品和运行时上如何区分？
- 执行层用 CLI 直调还是 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）？
- 第三方 / 用户配置的 API 如何接入，是否需要本地代理？
- Provider 协议是否应限制为 Anthropic 兼容格式？

## 讨论要点

- **产品分层**：`@claude-code` 是内置 Agent 产品（本机 Claude Code 默认人格与权限，不覆盖 System Prompt）；自建 Agent 是另一套持久化实体（用户 System Prompt + `permission_mode` + 底层平台），由 `/agent-creator` 等流程创建。
- **SDK 定位**：Claude Agent SDK 不是 Conflux 里的第三个 Agent，而是 **在 Node 里调用 Claude Code 运行时的宿主集成方式**；底层仍 spawn `claude` 子进程，与 CLI 同源。
- **CLI 能力**：`claude -p` 已支持 `--system-prompt`、`--permission-mode`、`--allowedTools` / `--disallowedTools`（权限规则语法）及 `stream-json`；自建 Agent 用 CLI **功能上可行**，但 Conflux 侧「每次生成临时 settings + 解析 stdout」维护成本高、协议升级敏感。
- **工具权限颗粒度**：规则格式为 `Tool` 或 `Tool(specifier)`（如 `Edit(/components/**)`、`Bash(npm run *)`）；`--tools` 控制模型可见工具集，`--allowedTools` 偏预批准，`deny` 可禁用整类工具。权限由运行时强制执行，不能仅靠 Prompt。
- **第三方 API**：官方 SDK 支持 Anthropic API Key，以及 Bedrock / Vertex / Azure 等；社区常用 `ANTHROPIC_BASE_URL` + Key 指向 **Anthropic 协议兼容网关**（如 OpenRouter）。子进程 **不能** 注入任意自定义 HTTP Header。
- **本地代理**：仅当 Provider 为 **非 Anthropic 协议**（如纯 OpenAI `/v1/chat/completions`）或需要协议转换 / 多协议混跑时才需要；若产品限定 Anthropic 兼容端点，**不必** 做本地代理。
- **与 Cursor SDK（`@cursor/sdk`）无关**：后者用于在 Cursor 外跑 Cursor Agent，不纳入 Conflux 自建 Agent 方案。

## 方案对比

| 方案 | 优点 | 缺点 | 适用条件 |
| --- | --- | --- | --- |
| 自研完整 agentic 框架（自写 tool loop） | 完全可控、可统一多平台协议 | 工作量大、重复 Claude Code 已有能力 | 不采用 |
| V1/V3 全部 CLI 直调 | 与终端一致、无额外 npm 依赖 | 临时 settings、stream-json 解析脆弱；动态权限（如按 DB glob）难做 | 仅作备选 |
| Claude Code 系统一用 Agent SDK | 结构化事件、options 内 Prompt/权限/env、AbortSignal、`canUseTool`；第三方端点经 `options.env` 按会话注入 | 绑定 Claude Code 技术栈；需处理 native binary / 版本；非 Anthropic 兼容 Provider 仍不可用 | **自建 Agent（platform=claude_code）及推荐的内置适配器实现方式** |
| 本地代理统一转发多厂商 API | 可接 OpenAI 兼容等任意后端 | 运维与协议维护成本高；与「国内厂商已提供 Anthropic 风格 API」不符 | **不采用**（除非未来单独开放非 Anthropic Provider） |

本次没有形成「自建 Agent 跨平台统一用同一 SDK」的方案——Codex / Hermes / OpenClaw 自建实例仍走各自 `*Adapter`，与 Claude Agent SDK 无关。

## 当前结论

1. **内置 `@claude-code`**：代表本机 Claude Code 产品；尽量不覆盖 System Prompt，权限跟用户本机 Claude Code；API 来源 **不强制** 走设置页 Provider（与本机登录/OAuth 一致）。
2. **自建 Agent（V3，`platform = claude_code`）**：执行层优先 **Claude Agent SDK**（`query()` + `options`），不用「自研 agentic 框架」；Conflux 自研薄层负责落库、SSE、`/agent-creator`、权限模式映射。
3. **Provider（V2 设置页）**：支持 **多种协议**（Anthropic 兼容、OpenAI 兼容等）；Orchestrator 调度 Agent 用自研 HTTP + 通常 `openai_compatible` Provider。
4. **自建 Agent（V3，`claude_code`）**：只能 **绑定** `protocol = anthropic` 的 Provider；在绑定步骤拦截 OpenAI 类 Provider（**不是**禁止在设置页保存 OpenAI Provider）。
5. **不做本地代理**作为默认路径；Anthropic Provider 经 SDK `options.env` 直连。
6. **Orchestrator 规划 LLM** 与 Claude Code 执行层分离（Planner 不走 Claude Agent SDK）。

**修订（2026-05-23）**：初稿误将「设置页 Provider 仅 Anthropic」写入 V3；已更正为「设置页多协议、V2 落地；仅自建 `claude_code` 绑定限 Anthropic」，见 `TECH_DESIGN.md` §3、`roadmap.md` V2/V3。

## 决策理由

- Claude Agent SDK 与 CLI 共享同一运行时；选型差异在 **集成稳定性**（事件、权限、取消、按会话 env），而非「只有 SDK 才能接第三方 API」。
- 限制 Provider 为 Anthropic 格式与 Claude Code 子进程能力一致，避免协议转换与本地代理的长期维护成本；国内环境可通过厂商 Anthropic 兼容端点满足，产品边界清晰。
- 区分内置 Agent 与自建 Agent 的 API 来源，避免「单聊 Claude Code」被设置页 Provider 覆盖，符合 IM 产品语义。

## 后续动作

- [x] 将 Provider「仅 Anthropic 兼容」及内置/自建 API 来源分离写入 `docs/design/` → `TECH_DESIGN.md`、PRD §3.6.5
- [x] V3 验收标准补充 → `roadmap.md` V3 验收标准（后修订：Provider 验收移至 V2）
- [x] Provider 多协议 + V2 提前 → `TECH_DESIGN.md` §3、`roadmap.md`、`prd` §6.5
- [x] V1 `ClaudeCodeAdapter` 倾向 Agent SDK → `TECH_DESIGN.md`、`ExecutePlan` 适配器小节
- [x] OpenRouter 等网关 env 约定 → `TECH_DESIGN.md` §3.2
- [ ] `restricted-editable` 落地时优先评估 SDK `canUseTool` 与 `Edit(path)` 规则二选一（待 V3 细设）

## 不纳入范围

- Codex / Hermes / OpenClaw 自建 Agent 的具体适配实现细节（仅确认不走 Claude Agent SDK）
- Electron、云端多租户、完整 Provider 管理 UI 实现
- 用 Claude Agent SDK 的 programmatic `agents`（subagent）替代 DB 持久化自建 Agent
- 将内置 `@claude-code` 与自建 Agent 强制共用同一 Provider 配置

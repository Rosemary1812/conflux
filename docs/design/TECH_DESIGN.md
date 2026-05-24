# 技术设计（适配器 / 自建 Agent / Provider）

本文档记录 **已决策** 的持久技术约定。产品需求见 `prd初版.md`；讨论过程见 `docs/memo/2026-05-23-1600-custom-agent-tech-choice.md`。

**阶段**：**Provider** 基础设施在 **V2** 落地（Orchestrator 调度 Agent 接 API）；**V3** 自建 Agent 复用同一 Provider 表，但对 `claude_code` 绑定增加协议约束。

## 1. 内置 Agent 与自建 Agent

| 维度 | 内置 Agent（如 `@claude-code`） | 用户自建 Agent（V3） |
| --- | --- | --- |
| 定义 | 平台预置，`is_builtin = true` | `/agent-creator` 持久化，`is_builtin = false` |
| System Prompt | **不覆盖** Claude Code 等产品默认 | 用户定义的 `system_prompt` |
| 权限 | 跟随本机 Agent 运行时默认 / 用户本机配置 | `permission_mode` + 平台映射 |
| API / 鉴权 | 继承本机 CLI 登录态（OAuth / 官方 config） | `platform = claude_code` 时绑定 **Provider**，且该 Provider 须为 **Anthropic 兼容**（见 §3.3）；其他平台走各自适配器 |
| 执行实现 | V1 当前通过本机 CLI 适配器调用；`ClaudeCodeAdapter` 后续可切到 Agent SDK | 按 `platform` 选适配器；`claude_code` 用 Agent SDK，profile=`custom` |

**原则**：内置 Agent 不是「SDK 这个框架」；SDK 仅是 Conflux 在 Node 里调用 Claude Code 运行时的方式。IM 里用户对话的对象始终是 Agent 产品/自建人格，不是 SDK 本身。

## 2. Claude Code 执行：Claude Agent SDK

- 包：`@anthropic-ai/claude-agent-sdk`（TypeScript）；底层 spawn 与 `claude` CLI 同源。
- **V1**：`ClaudeCodeAdapter` 建议直接基于 SDK，减少 `stream-json` 自解析与临时 settings 文件。
- **V3 自建**（`platform = claude_code`）：`query({ prompt, options })`，其中：
  - `options.systemPrompt` ← Agent.`system_prompt`
  - `options.permissionMode` / `allowedTools` / `disallowedTools` / `canUseTool` ← `permission_mode` 映射（见 §4）
  - `options.env` ← Provider 注入（见 §3）
- **不采用**：自研完整 agentic tool loop；**不采用**本地协议代理作为默认路径。
- **不采用**：用 SDK programmatic `agents`（subagent）替代 DB 中的自建 Agent 记录。

### 2.1 `ClaudeCodeAdapter` 两种 profile

```typescript
type ClaudeCodeRunProfile = "builtin" | "custom";

// builtin: 不传 systemPrompt 覆盖；env 不注入用户 Provider
// custom:  传入 agent.system_prompt；env 来自 agent.provider_id
```

## 3. Provider（设置页，V2 基础设施）

Provider 是 Conflux **统一的模型 API 配置**（Base URL + Key + 协议 + 默认模型），在设置页管理，供多个消费者引用。**不等于**「全局只能 Anthropic」。

### 3.1 设置页：支持多种协议

| `protocol` | 说明 | 典型消费者 |
| --- | --- | --- |
| `anthropic` | Anthropic Messages API 兼容（含 OpenRouter Anthropic Skin、国内厂商 Anthropic 端点） | 自建 Agent（`platform = claude_code`）经 Claude Agent SDK `env` 注入 |
| `openai_compatible` | OpenAI Chat Completions 兼容（`/v1/chat/completions` 等） | **OrchestratorPlanner**、调度用自研 Agent（HTTP 客户端，不走 Claude Agent SDK） |
| （扩展） | 实现期可增加，如厂商专用枚举 | 按消费者文档约定 |

| 字段 | 说明 |
| --- | --- |
| `name` | 显示名 |
| `protocol` | 上表枚举 |
| `base_url` | API 根 URL |
| `api_key` | 密钥（存储策略见实现阶段） |
| `default_model` | 默认模型 |
| `enabled` | 是否可用 |

**保存 Provider 时**：按 `protocol` 校验 `base_url` 形态（合法 URL；可警告明显与协议不符的路径）。**允许** 同时存在 Anthropic 与 OpenAI 兼容多条配置。

### 3.2 消费者与阶段

| 消费者 | 阶段 | 调用方式 |
| --- | --- | --- |
| `OrchestratorPlanner`（编排/调度 Agent） | **V2** | 自研 HTTP 客户端 + 用户选的 `openai_compatible` Provider（或平台默认 Provider）；**不**走 Claude Agent SDK |
| 自建 Agent `platform = claude_code` | **V3** | Claude Agent SDK + **仅可绑定 `protocol = anthropic` 的 Provider** |
| 内置 `@claude-code` | V1+ | 默认本机 CLI/OAuth；**不强制**绑定 Provider |

V2 前 PRD 中的 `ORCHESTRATOR_LLM_*` 环境变量，V2 起优先收敛为 **设置页 Provider + 编排服务引用**（可保留 env 作为开发默认）。

### 3.3 自建 Agent 的协议约束（非 Provider 全局约束）

仅当用户自建 Agent 且 **`platform = claude_code`**：

- 创建/编辑时 **只能选择** `protocol = anthropic` 的 Provider。
- 若用户选了 OpenAI 兼容 Provider，**禁止绑定**，UI 提示：*「Claude Code 自建 Agent 须使用 Anthropic 兼容 API；请在设置中添加 Anthropic 风格 Provider，或改用其他底层平台。」*
- **不做** 本地协议代理把 OpenAI Provider 转成 Anthropic 给 Claude Code 用。

其他 `platform`（codex 等）的 Provider 策略在 V3 按各适配器单独约定；V3 前可不绑定 Provider。

### 3.4 运行时 env 映射（`claude_code` 自建 + Anthropic Provider）

每次 `run` 通过 SDK `options.env` 注入（示例，按网关文档调整）：

| env | 来源 |
| --- | --- |
| `ANTHROPIC_BASE_URL` | `provider.base_url` |
| `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` | `provider.api_key`（OpenRouter 等可能要求 `ANTHROPIC_API_KEY=""` 且用 `AUTH_TOKEN`） |
| `ANTHROPIC_MODEL` | Agent.`model_name` ?? `provider.default_model` |

### 3.5 数据模型（补充）

```
Provider
├── id
├── name
├── protocol          (anthropic | openai_compatible | …)
├── base_url
├── api_key_encrypted (实现期定)
├── default_model
└── enabled

OrchestratorConfig（或 settings，V2）
├── planner_provider_id   (FK → Provider，通常 openai_compatible)

Agent（V3 补充）
├── provider_id           (nullable；builtin 为空；自建 claude_code 必填且 FK 须 anthropic)
```

## 4. 权限模式 → SDK 映射（`claude_code`）

权限由 Claude Code **运行时强制执行**，不能仅靠 System Prompt。

| `permission_mode` | SDK 倾向（实现期可微调） |
| --- | --- |
| `readonly` | `permissionMode: "plan"` 或 deny `Edit`/`Write`，allow `Read`/`Grep`/`Glob` 等 |
| `editable` | `permissionMode: "acceptEdits"` + 受控 `Bash` allowlist（PRD：build/test/lint） |
| `restricted-editable` | `Edit(path)` 规则 + 或 `canUseTool` 按 `editable_scopes` 动态校验（优先 SDK） |

细粒度 `tools[]`、MCP、任意 shell：P1/P2，见 PRD §3.6.3。

## 5. 其他平台自建 Agent

| `platform` | 执行方式 |
| --- | --- |
| `codex` | `CodexAdapter`（本机 CLI/API），**不用** Claude Agent SDK |
| `hermes` | `HermesAdapter` |
| `opencode` | `OpenCodeAdapter`（V1 使用 `opencode run --format json --dir <workspace> <prompt>`；CLI 未加入 PATH 时可用 `AGENTHUB_OPENCODE_COMMAND` 指定路径） |

## 6. 参考

- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Permissions（CLI/SDK 规则语法）](https://code.claude.com/docs/en/permissions)
- 项目 memo：`docs/memo/2026-05-23-1600-custom-agent-tech-choice.md`

# Claude Agent SDK 工具集机制调研

- 时间：2026-06-07
- 类型：技术调研 / 设计输入
- 关联：V3 自建 Agent（`platform=claude_code`）、`docs/design/ExecutePlan/V3-自建Agent与基础收口.md`
- 状态：已完成

## 背景

V3 计划让自建 Agent 走 `@anthropic-ai/claude-agent-sdk`（`@anthropic-ai/claude-agent-sdk`，原名 `claude-code-sdk`）。产品设计约束是：**用户不直接选择具体工具**，由 LLM 抽取需求后自动选定"工具 profile"。本文档梳理 SDK 提供的工具/权限机制，作为 V3 设计的输入。

## TL;DR

1. **SDK 的工具/权限控制粒度足够做 profile 抽象**：内置 10 个工具（`Read`/`Write`/`Edit`/`Bash`/`Glob`/`Grep`/`WebSearch`/`WebFetch`/`AskUserQuestion`/`Agent`），通过 `allowedTools` / `disallowedTools` / `permissionMode` 三个 option 组合，可清晰表达"只读 / 写不改 / 全开"等档位
2. **`permissionMode: 'plan'`** 是天然的 "readonly" 档 —— 限制 Claude 只用只读工具（不能编辑源文件）；无需手动列 `allowedTools`
3. **`permissionMode: 'acceptEdits'`** 是天然的 "code-author" 档 —— 自动批准 `Edit`/`Write` 和 `mkdir`/`rm` 等文件系统操作
4. **`permissionMode: 'bypassPermissions'`** 等同 "executor" 档但**慎用** —— 完全放行，需 `allowDangerouslySkipPermissions: true` 显式开启
5. **per-run 注入三件套**都用标准 option：`env` 注入 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`，`model` 注入模型名，`systemPrompt` 注入 system prompt
6. **`canUseTool` 回调**可接管"工具被拒绝时的人工审批"流程；与 Conflux 现有的 Approval/Choice 交互（V1.5）天然契合

## Tool inventory（内置工具）

| 工具 | 用途 | 默认 |
|------|------|------|
| `Read` | 读文件（支持行范围、多种格式含 PDF/图片） | ✓ |
| `Write` | 写文件（创建/覆盖） | ✓ |
| `Edit` | 字符串级精确编辑 | ✓ |
| `Bash` | 跑 shell 命令 | ✓ |
| `Glob` | glob 模式匹配文件 | ✓ |
| `Grep` | 正则搜文件内容 | ✓ |
| `WebSearch` | 搜网 | ✓ |
| `WebFetch` | 抓并解析网页 | ✓ |
| `Monitor` | watch 后台脚本输出 | ✓ |
| `AskUserQuestion` | 主动向用户提问（多选 1–4） | 默认可用 |
| `Agent` | 调起子 Agent（subagent） | 默认可用 |

> 来源：[Agent SDK overview → Built-in tools](https://code.claude.com/docs/en/agent-sdk/overview#built-in-tools)、[TypeScript reference → ToolConfig](https://code.claude.com/docs/en/agent-sdk/typescript)

`Read/Write/Edit` 路径限制在 `cwd` 与 `additionalDirectories` 内；越界仍可写但会触发权限检查。

## 关键 Option（与 V3 相关的部分）

完整 `Options` 类型见 [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript#options-type-complete)。下表只列 V3 用得到的：

| Option | 类型 | 用途 | V3 必用 |
|--------|------|------|---------|
| `systemPrompt` | `string \| { type: 'preset', preset: 'claude_code', append?: string }` | 注入 system prompt | ✓ |
| `model` | `string` | 模型名 | ✓ |
| `allowedTools` | `string[]` | 预批准工具列表（支持 scoped rules） | ✓ |
| `disallowedTools` | `string[]` | 拒绝工具（bare 工具名 / scoped rules） | ✓ |
| `permissionMode` | `PermissionMode`（见下表） | 权限模式 | ✓ |
| `allowDangerouslySkipPermissions` | `boolean` | 显式开启 `bypassPermissions`（安全） | ✓（executor profile） |
| `env` | `Record<string, string \| undefined>` | 环境变量 | ✓（注入 `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`） |
| `cwd` | `string` | 工作目录 | ✓ |
| `canUseTool` | `CanUseTool` | 工具被拒/未批准时人工回调 | ✓（接 V1.5 交互） |
| `mcpServers` | `Record<string, McpServerConfig>` | MCP 服务器 | V3 暂不用 |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>` | 生命周期钩子 | V3 暂不用 |
| `maxTurns` | `number` | 最大 agentic 轮数 | ✓（默认给 50） |
| `maxBudgetUsd` | `number` | USD 成本上限 | V3 暂不用 |
| `settingSources` | `SettingSource[]`（`'user' \| 'project' \| 'local'`） | 加载哪些文件系统设置 | 设为 `[]`（**重要**：避免加载本机 `~/.claude/` 污染） |
| `tools` | `string[] \| { type: 'preset', preset: 'claude_code' }` | 模型可见工具集（比 allowedTools 严格，bare 名） | 与 `allowedTools` 配合 |

> **⚠️ 关键安全项**：`settingSources: []` 必须显式设置，否则 SDK 会从 `cwd/.claude/` 与 `~/.claude/` 加载本机 Claude Code 的设置（Skills、Memory、Hooks、Permissions），与"自建 Agent 的 system_prompt"冲突。

## 权限评估顺序

来源：[permissions 页](https://code.claude.com/docs/en/agent-sdk/permissions#how-permissions-are-evaluated)

1. **Hooks** —— 可显式 `deny`
2. **Deny rules**（`disallowedTools` 与 settings.json）—— 匹配则拒
3. **Permission mode** —— `bypassPermissions` 全批准；`acceptEdits` 批准文件操作；其他 fall through
4. **Allow rules**（`allowedTools` 与 settings.json）—— 匹配则批准
5. **canUseTool callback** —— 兜底；`dontAsk` 模式跳过此步

`allowed_tools` **不约束** `bypassPermissions`（文档原文警告）。要"全开但禁止特定工具"，用 `disallowedTools` 而非只列 `allowedTools`。

## Permission modes

来源：[permissions 页 → Available modes](https://code.claude.com/docs/en/agent-sdk/permissions#available-modes)

| Mode | 行为 | V3 建议 profile |
|------|------|----------------|
| `default` | 无自动批准；未匹配触发 `canUseTool` | 不直接用 |
| `dontAsk` | 未预批准直接拒；不调 `canUseTool` | `readonly` 强化版（hard lockdown） |
| `acceptEdits` | 自动批准 `Edit`/`Write` + `mkdir`/`rm`/`mv` 等 fs 操作 | `code-author` |
| `bypassPermissions` | 全部自动批准；需 `allowDangerouslySkipPermissions: true` 显式开 | `executor`（谨慎） |
| `plan` | 只读工具，Claude 探索但不编辑源文件 | **`readonly`** |
| `auto`（TS only） | 模型分类器决定批准/拒绝 | 不在 V3 用 |

> **⚠️ 继承警告**：当父级用 `bypassPermissions` / `acceptEdits` / `auto`，**所有 subagent 自动继承**且不可覆盖。V3 不主动用 subagent，可忽略。

## 工具限制语法

来源：[permissions 页 → Allow and deny rules](https://code.claude.com/docs/en/agent-sdk/permissions#allow-and-deny-rules)

| 写法 | 效果 |
|------|------|
| `allowedTools: ["Read", "Grep"]` | `Read` 和 `Grep` 自动批准；其他工具仍可见，未匹配走 permission mode |
| `disallowedTools: ["Bash"]` | `Bash` 从模型视野中**移除**（Claude 看不到这个工具） |
| `disallowedTools: ["Bash(rm *)"]` | `Bash` 仍可见；匹配 `rm *` 的调用在所有 mode 下都被拒（含 `bypassPermissions`） |

**结论**：

- `allowedTools` 表达"自动批准"语义，不是"模型可见"
- `disallowedTools` 配合 scoped rules（`Tool(specifier)`）可实现"工具可见但具体行为被拒"
- bare 名的 `disallowedTools` 比 `allowedTools` 更"硬"

**V3 建议**：profile 内用 `permissionMode` 表达主语义，必要时用 `allowedTools` 收紧"自动批准的子集"，用 `disallowedTools` 显式 ban 高危调用（如 `Bash(rm -rf /)`）。

## canUseTool 回调（接 V1.5 交互）

来源：[user-input 页](https://code.claude.com/docs/en/agent-sdk/user-input)

TypeScript 签名：

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;

type PermissionResult =
  | { behavior: "allow"; updatedInput?: ...; updatedPermissions?: ...; toolUseID?: string; }
  | { behavior: "deny"; message: string; interrupt?: boolean; toolUseID?: string; };
```

触发场景：

1. Claude 想用未预批准的工具
2. Claude 调 `AskUserQuestion` 主动提问

**V3 接入方案**：

- 自建 Agent run 启动时注册 `canUseTool`，把"工具被拒 / 提问"事件转成 V1.5 已有的 `agent_interactions` 行
- Conflux 现有 Approval 卡片 + Choice 卡片直接复用（无需新增 UI 组件）
- `permissionMode: 'plan'` 下 Claude 可能用 `AskUserQuestion` 多 —— 这正好与"review 场景"匹配

## Per-run 注入：env / model / systemPrompt

来源：[TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: userMessage,
  options: {
    // 1. 注入 API 凭据（per-conversation Provider）
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: provider.apiKeyDecrypted,
      ANTHROPIC_BASE_URL: provider.baseUrl
    },
    // 2. 注入模型
    model: provider.defaultModel,
    // 3. 注入 system prompt（自建 Agent 的 system_prompt 字段）
    systemPrompt: agent.systemPrompt || {
      type: 'preset',
      preset: 'claude_code'  // 不传 system_prompt 时用 Claude Code 默认人格
    },
    // 4. 工具/权限（profile 映射）
    permissionMode: 'plan',  // readonly profile
    allowedTools: ['Read', 'Glob', 'Grep'],
    // 5. 安全：避免加载本机 .claude
    settingSources: [],
    // 6. 接 V1.5 交互
    canUseTool: async (toolName, input, opts) => { /* ... */ },
    cwd: conversation.workspacePath
  }
})) {
  // 7. 消费消息流
  if (message.type === 'assistant') {
    // 提取 text 块 → SSE message_delta
  } else if (message.type === 'result') {
    // 最终结果
  }
}
```

## Streaming 事件（最相关的几个）

来源：[TypeScript reference → Message Types](https://code.claude.com/docs/en/agent-sdk/typescript#message-types-sdkmessage-union)

完整 union 很多，V3 只需关注这几个：

| type | subtype | 关键字段 | 用途 |
|------|---------|----------|------|
| `assistant` | — | `message: BetaMessage`, `parent_tool_use_id` | Claude 输出的文本块，转 `message_delta` |
| `user` | — | `message: MessageParam`, `tool_use_result` | 工具结果回灌（一般不需要我们处理） |
| `system` | `init` | `session_id` 等 | 启动事件（记录日志/会话） |
| `result` | `success` | `result: string`, `num_turns`, `total_cost_usd` | 最终结果；落到 `messages.content` |
| `result` | `error_max_turns` / `error_during_execution` / `error_max_budget_usd` | `errors: string[]` | 错误，标 `agent_runs.status='error'` |
| `tool_use` | —（在 `assistant.message.content[]` 里） | `name`, `input` | 工具调用（不直接 emit，由 `assistant` 携带） |
| `tool_result` | —（在 `user.message.content[]` 里） | `content` | 工具结果（同上） |

完整 union 还包括 `SDKPartialAssistantMessage`（流式分片，启用 `includePartialMessages: true` 时出现）、`SDKAuthStatusMessage`、`SDKRrateLimitEvent` 等。V3 首版不开 `includePartialMessages`，按 turn 聚合后用 `text` 块生成 SSE 增量；后续如需更细粒度流式再开。

## SDK 自带 vs 自建需要的"profile"对照

SDK **不直接提供** "readonly / code-author / executor" 这种命名档位；它只提供上面那些原子 option。**V3 需要在 Conflux 侧自己定义 profile**，再写映射表。

### 推荐 profile → SDK option 映射

| V3 profile | permissionMode | allowedTools | disallowedTools | 备注 |
|------------|----------------|--------------|------------------|------|
| `readonly` | `'plan'` | `['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'AskUserQuestion']` | `['Write', 'Edit', 'Bash']` | `plan` mode 自带只读约束；显式 `disallowedTools` 双保险 |
| `code-author` | `'acceptEdits'` | `['Read', 'Glob', 'Grep', 'Edit', 'Write', 'AskUserQuestion']` | `['Bash(rm -rf *)', 'Bash(sudo *)']` | 文件编辑自动批准；显式 ban 高危命令 |
| `executor` | `'bypassPermissions'` | （全开） | `['Bash(rm -rf /)', 'Bash(sudo *)']` | 需 `allowDangerouslySkipPermissions: true`；谨慎 |
| `custom` | 用户在设置页选 | 用户选 | 用户选 | V3 暂不开放，留 V3.4 |

> **executor profile 的安全提示**：自建 Agent 默认不能开 `executor`（太危险）。建议首次创建时 LLM 选到 `executor` 给个"⚠️ 高危"二次确认；或在 UI 显式标注。

### 关键边界

- `permissionMode: 'plan'` 已经实现"只读 + 可问问题 + 不编辑源文件"，与 `readonly` 几乎完全对齐
- `permissionMode: 'acceptEdits'` 对应 `code-author`；但要注意 `acceptEdits` 也自动批准 `mkdir`/`rm`/`mv`（**仅在 cwd 内**），需要 `additionalDirectories` 控制
- `bypassPermissions` 与 `allowedTools` 是"OR"关系（`bypassPermissions` 全批准，allowedTools 仅为预批准语义），所以 V3 不能只靠 `allowedTools` 表达"只读"，必须用 `plan` 或 `dontAsk`

## Open questions

| # | 问题 | 建议 |
|---|------|------|
| O1 | 自建 Agent run 是否要开 `includePartialMessages: true` 做"逐 token"流式？ | V3 暂不开，按 `assistant` 消息聚合后 SSE 增量；效果与 V1.5 内置 Agent 类似。V3.4 可优化 |
| O2 | `AskUserQuestion` 与 Conflux 现有 Choice 卡片怎么映射？ | SDK 给的是 `{question, options, multiSelect}` 结构，正好对应 V1.5 的 Choice 交互；V3 把 SDK `AskUserQuestion` 事件转 Choice 卡片，`answers` 回写 SDK |
| O3 | `canUseTool` 收到"工具被拒"事件时，要不要 Conflux 侧也弹 Approval 卡片？ | 建议弹，但仅在 `permissionMode: 'default'` 时弹；其他 mode 下由 SDK 自身处理。V3 暂只接 `default` + `plan` 两个 mode |
| O4 | 自建 Agent 删除后，正在运行的 run 怎么处理？ | 启动时把 `agent_id` 缓存进 `agent_runs`；删除时 `UPDATE agent_runs SET status='error', error='agent_deleted'` 并 abort 进程 |
| O5 | `ANTHROPIC_BASE_URL` 与设置页 Provider `base_url` 的格式差异？ | 多数 Anthropic 兼容端点直接可用；个别厂商需要加 `/v1` 后缀。V3 文档化"绑定 Provider 时 base_url 不要带 /v1"提示 |

## 关键设计建议（V3 用）

1. **profile 与 SDK option 解耦**：profile 名是 Conflux 概念（`readonly` / `code-author` / `executor`），映射表在 `lib/skills/agent-creator/profiles.ts`，未来 SDK 升级只改映射表
2. **`settingSources: []` 必设**：避免自建 Agent 加载到本机 `~/.claude/CLAUDE.md` 等污染
3. **`canUseTool` 接到 V1.5 交互层**：复用现有 Approval/Choice 卡片；不另起炉灶
4. **`permissionMode: 'plan'` 用作 readonly profile**：比手写 `allowedTools` 更稳
5. **`executor` profile 必须 `allowDangerouslySkipPermissions: true` + 二次确认**

## 相关文档链接

- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)
- [TypeScript changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)

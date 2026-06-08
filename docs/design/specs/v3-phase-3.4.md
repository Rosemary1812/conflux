# V3.4 自建 Agent SDK 接入 C0 设计稿

> 范围：本设计稿覆盖自建 Agent 运行时接入 Claude Agent SDK 的最小闭环：新增专用 adapter、启动参数映射、Provider 校验、事件映射、run 层分流。  
> 明确不覆盖：SDK Approval / Choice 桥接的完整挂起唤醒（V3.7）、群聊 UI 运行态改造（V3.5）、自定义 Agent 设置页（V3.6）、Diff / 版本历史。

## 1. 阶段目标与边界

V3.4 的目标是让 `agents.is_system = 0` 且 `platform = 'claude_code'` 的自建 Agent 可以在单聊中真正启动 SDK run，并使用创建时保存的 system prompt、model、tool profile 与 Provider。

V1 / V1.5 内置 `Claude Code` Agent 继续走现有 `lib/adapters/claude-code.ts`，行为不变。V3.4 不替换内置 Agent adapter。

本阶段只要求跑通：

- `readonly` profile + 单轮 LLM 回复。
- `code-author` / `executor` 参数映射正确，运行时由 SDK 执行权限模式。
- 自建 Agent run 使用 `settingSources: []`、`cwd = conversation.workspace_path`、`maxTurns = 50`、`includePartialMessages = true`。
- `anthropic` Provider 可作为自建 Agent 的 SDK env 来源。

## 2. 类型设计

```ts
export type SDKToolProfile = "readonly" | "code-author" | "executor";

export type ClaudeCodeSDKAgentConfig = {
  agentId: string;
  name: string;
  isSystem: false;
  systemPrompt: string;
  model?: string;
  providerId?: string;
  permissionMode: SDKToolProfile;
  toolProfile: SDKToolProfile;
};

export type ClaudeCodeSDKRunOptions = {
  prompt: string;
  systemPrompt: string;
  model?: string;
  workspacePath: string;
  externalSessionId?: string;
  maxTurns: 50;
  includePartialMessages: true;
  settingSources: [];
  env: NodeJS.ProcessEnv;
  permissionMode: "plan" | "acceptEdits" | "bypassPermissions";
  allowedTools: string[];
  disallowedTools: string[];
  allowDangerouslySkipPermissions: boolean;
};
```

现有 `AgentSummary` 需要扩展运行字段：

```ts
export type AgentSummary = {
  id: string;
  slug: string;
  name: string;
  platform: AgentPlatform;
  description: string;
  isSystem: boolean;
  systemPrompt: string;
  permissionMode: "readonly" | "code-author" | "executor";
  toolProfile: "readonly" | "code-author" | "executor" | null;
};
```

## 3. 启动参数表

| SDK option | 来源 | 规则 |
| --- | --- | --- |
| `prompt` | `AdapterRunParams.messages` + `attachments` | 复用现有 `buildPrompt` 语义；resume 时只发最近一条用户消息 |
| `systemPrompt` | `agents.system_prompt` | 追加 AgentHub 运行约束；为空时使用自建 Agent 默认说明 |
| `model` | Provider `default_model` | V3.4 使用 Orchestrator settings 的 planner provider 作为临时 Provider 来源；V3.6 再做 per-agent provider |
| `env.ANTHROPIC_API_KEY` | Provider `api_key_encrypted` | 当前项目未加密，按现有 Provider service 语义读取 |
| `env.ANTHROPIC_BASE_URL` | Provider `base_url` | 若用户填到 `/v1`，V3.4 先原样传入；自动 strip 留到后续兜底 |
| `settingSources` | 固定 | `[]`，避免读取本机 Claude settings 污染自建 Agent |
| `cwd` | `conversation.workspace_path` | 必须是当前会话工作区 |
| `maxTurns` | 固定 | `50` |
| `includePartialMessages` | 固定 | `true`，用于自建 Agent 打字机效果 |
| `permissionMode` | `toolProfile -> getProfileMeta()` | `readonly -> plan`，`code-author -> acceptEdits`，`executor -> bypassPermissions` |
| `allowedTools` | `getProfileMeta(toolProfile)` | 直接透传 |
| `disallowedTools` | `getProfileMeta(toolProfile)` | 直接透传 |
| `allowDangerouslySkipPermissions` | `getProfileMeta(toolProfile)` | `executor` 必须为 `true` |
| `tools` | 固定 | `{ type: "preset", preset: "claude_code" }` |
| `resume` | `agent_external_sessions.external_session_id` | 与现有外部 session 续接一致 |

## 4. Provider 校验

V3.4 C1 先用一个保守策略：自建 Agent SDK run 必须能解析到 enabled `anthropic` Provider。解析顺序：

1. 环境变量 `ORCHESTRATOR_*` 中 protocol 为 `anthropic`。
2. `orchestrator_settings.planner_provider_id` 指向 enabled `anthropic` Provider。
3. 否则 run 直接 `message_error`，提示用户在设置页配置 Anthropic Provider。

不允许 `openai_compatible` Provider 进入 SDK run；Planner 仍可继续使用 openai-compatible，不受影响。

## 5. 与 V1.5 Adapter Interface 对齐

现有接口是：

```ts
type AgentAdapter = {
  platform: AgentPlatform | string;
  capabilities: AdapterCapabilities;
  healthcheck(): Promise<AdapterHealth>;
  inspectRuntime?(): Promise<AgentRuntimeInfo>;
  run(params: AdapterRunParams): AsyncIterable<AgentEvent>;
};
```

V3.4 新增 `claudeCodeSDKAdapter`，仍实现同一接口，不改 `runs.ts` 的事件消费方式。

| SDK message | AgentEvent | 规则 |
| --- | --- | --- |
| `assistant` | `text_delta` | 提取 `message.content` 文本；作为完整段落 delta 推出 |
| `stream_event` / `content_block_delta` | `text_delta` | 提取 text delta；用于打字机效果 |
| `result` success | `message_done` | run 正常结束 |
| `result` error | `message_error` | 显示 SDK error |
| abort | `message_cancelled` | `AbortController` 与 `params.signal` 对齐 |
| session id | `saveExternalSessionId` | 与现有 Claude adapter 一样保存 SDK session |

V3.4 暂不注册 `canUseTool` / MCP Choice server；V3.7 统一接 V1.5 Approval / Choice 桥接。`supportsApproval` / `supportsChoice` 在 V3.4 仍可标为 `none` 或保守标识，避免 UI 误以为完整交互已可用。

## 6. Run 层分流

`lib/conversations/runs.ts` 当前按 `agent.platform` 直接 `getAdapter(platform)`。V3.4 改为：

```ts
const adapter = getAdapterForAgent(agent);
```

规则：

- `agent.platform !== 'claude_code'`：保持原逻辑。
- `agent.platform === 'claude_code' && agent.isSystem === true`：走现有 `claudeCodeAdapter`。
- `agent.platform === 'claude_code' && agent.isSystem === false`：走新增 `claudeCodeSDKAdapter`。

这要求 `AgentSummary` 携带 `isSystem` / `systemPrompt` / `toolProfile` 等字段。

## 7. 文件落点

| 工作 | 文件 |
| --- | --- |
| 扩展 `AgentSummary` | `lib/agents/types.ts`、`lib/conversations/service.ts` |
| 新增 SDK adapter | `lib/adapters/claude-code-sdk.ts` |
| adapter 分流 | `lib/adapters/registry.ts`、`lib/conversations/runs.ts` |
| Provider 解析复用 | `lib/providers/service.ts` |
| profile 映射复用 | `lib/skills/agent-creator/profiles.ts` |

## 8. 验收标准

- 自建 Agent 单聊可启动 SDK run 并返回 assistant 文本。
- 内置 Claude Code 单聊仍走原 adapter，不退化。
- `readonly` profile 使用 `permissionMode='plan'`，不会写文件。
- `code-author` / `executor` 的 SDK option 映射正确；`executor` 带 `allowDangerouslySkipPermissions=true`。
- run 使用 `settingSources: []`、`cwd=workspace_path`、`maxTurns=50`、`includePartialMessages=true`。
- 缺少 `anthropic` Provider 时返回明确错误，不静默使用本机 Claude 配置。
- `npm run typecheck`、`npm run build` 通过。

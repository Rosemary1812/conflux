# V3.7 SDK Approval / Choice 桥接 C0 设计稿

> 范围：本设计稿覆盖自建 Agent SDK adapter（`lib/adapters/claude-code-sdk.ts`）接入 V1.5 `agent_interactions` / inline Approval / Choice 的挂起唤醒方案。
> 明确不覆盖：改造内置 `@claude-code` adapter、重写 V1.5 交互 UI、引入新的 Orchestrator 交互模型、扩大 Provider 协议范围。

## 1. 阶段目标与边界

V3.4 已让 `is_system=0 && platform='claude_code'` 的自建 Agent 通过 `@anthropic-ai/claude-agent-sdk` 跑通；V3.5 / V3.6 已把自建 Agent 接入群聊 UI 与设置页。当前缺口是：自建 Agent SDK path 仍标记为 `supportsApproval: "none"` / `supportsChoice: "none"`，Planner 会避免把写文件类任务分给它，SDK 运行中也不会把工具确认或提问桥接成 AgentHub 的交互卡片。

V3.7 的目标：

- 自建 SDK adapter 注册 SDK `canUseTool`，把工具权限请求转成 V1.5 `approval` interaction。
- 自建 SDK adapter 提供 AgentHub Choice 通道，把运行中问题转成 V1.5 `choice` interaction。
- 用户在 inline 卡片回应后，同一 SDK run 继续，继续使用同一个 `run_id` / assistant message / SDK session。
- 群聊下保留 `conversation_agent_id` / `orchestrator_task_id`，右栏 task 状态进入 `awaiting_interaction` 后可恢复为 `running`。
- adapter capabilities 改为 `supportsApproval: "native"` / `supportsChoice: "native"`，让 Orchestrator Planner 可把需要审批的任务分配给自建 Agent。

明确边界：

- 不新增 `agent_runs.status`。继续复用已有 `awaiting_interaction`，避免引入 `awaiting_canuse` 第二套状态。
- 不修改 `POST /api/interactions/:id/respond` 契约；继续走 `resolveInteraction()` + `run-bridge`。
- 不把 `executor` profile 接 Approval：`bypassPermissions` 本来就是全放行语义，只保留 `disallowedTools` 的硬拒绝。
- 不改内置 `lib/adapters/claude-code.ts`。它已经有 `canUseTool` + MCP `request_choice` 的参考实现，V3.7 只把同类能力补到自建 SDK adapter。
- 不在 C0 之后直接实现。V3.7 是重预 plan，C0 设计稿需先与用户对齐后再进 C1。

## 2. 现状对齐

### 2.1 已有桥接能力

| 模块 | 现状 | V3.7 复用方式 |
| --- | --- | --- |
| `lib/interactions/types.ts` | 已有 `approval` / `choice` / `InteractionDecision` / `conversationAgentId` / `orchestratorTaskId` | 不新增类型，只补 SDK payload 映射辅助类型 |
| `lib/interactions/service.ts:createInteraction` | 写 `agent_interactions`，run 置 `awaiting_interaction`，task 置 `awaiting_interaction`，发 SSE | 自建 SDK adapter 通过 `params.requestInteraction()` 进入该路径 |
| `lib/interactions/run-bridge.ts` | `waitForInteractionResponse()` 挂 Promise，`resumeInteraction()` 唤醒 | SDK `canUseTool` / Choice tool await 该 Promise |
| `app/api/interactions/[interactionId]/respond/route.ts` | 对普通 Agent interaction 调 `resolveInteraction()` | 不改 API；只保证自建 SDK interaction 的 `agentId` 不是 creator 占位 |
| `lib/conversations/runs.ts` | `AdapterRunParams.requestInteraction()` 自动补 `conversationAgentId` / `orchestratorTaskId` | 自建 SDK adapter 不直接写 DB，只调用这个函数 |
| `lib/adapters/claude-code.ts` | 内置 Claude Code adapter 已有 `canUseTool` + MCP `request_choice` 参考实现 | 复制思路，不共享代码到避免牵动内置路径 |

### 2.2 当前自建 SDK adapter 缺口

`lib/adapters/claude-code-sdk.ts` 当前：

- capabilities 是 `none / none`。
- `query({ options })` 未传 `canUseTool`。
- 未提供 MCP server / SDK tool 给模型主动提问。
- system prompt 还写着“V3.4 does not yet provide AgentHub inline Approval or Choice bridging...”。
- `readonly` profile 用 `permissionMode='plan'`，`code-author` 用 `acceptEdits`，`executor` 用 `bypassPermissions`。

V3.7 应只围绕这些缺口改，不改 Provider、session resume、文本流式和 artifact 逻辑。

## 3. 类型设计（C0-1）

### 3.1 SDK 回调上下文

引用 SDK 真实类型，不复制完整 union：

```ts
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
```

本地新增轻量辅助类型（只在 adapter 内部使用）：

```ts
type SdkPermissionRequest = {
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  decisionReason?: string;
  blockedPath?: string;
  toolUseID: string;
};

type SdkChoiceAnswer = {
  selectedOptionIds: string[];
  customText?: string;
};
```

### 3.2 Approval payload 映射

继续使用 V1.5 `ApprovalPayload`，新增 adapter 内部 helper：

```ts
function approvalPayloadFromSdkTool(request: SdkPermissionRequest): ApprovalPayload {
  return {
    action: actionForTool(request.toolName),
    summary: request.title ?? request.displayName ?? `自建 Agent 请求使用 ${request.toolName}`,
    command: commandFromInput(request.input),
    path: pathFromInput(request.input, request.blockedPath),
    risk: request.description ?? request.decisionReason ?? "该操作需要用户确认后才能继续。"
  };
}
```

映射规则：

| SDK tool | `ApprovalPayload.action` | 重点字段 |
| --- | --- | --- |
| `Bash` / shell 类 | `run_command` | `command` 从 `input.command/cmd/script` 提取 |
| `Write` / `Edit` / `MultiEdit` / patch 类 | `write_file` | `path` 从 `file_path/path/notebook_path/blockedPath` 提取 |
| `WebFetch` / `WebSearch` | `network` | `summary` / `risk` 用 SDK title / description |
| 其他工具 | `tool_use` | 只展示 summary + risk |

### 3.3 PermissionResult 映射

用户批准：

```ts
{
  behavior: "allow",
  updatedInput: input,
  toolUseID: options.toolUseID
}
```

用户拒绝：

```ts
{
  behavior: "deny",
  message: "用户在 AgentHub 中拒绝了该操作。",
  toolUseID: options.toolUseID
}
```

必须保留 `updatedInput: input`，否则 SDK 侧会出现 `updatedInput` 校验问题；这个经验来自 V1.5 已修复的 Claude Code adapter。

### 3.4 Choice payload 映射

V3.7 首版不直接依赖 SDK 内建 `AskUserQuestion` 的自动 UI 桥，而是沿用内置 `claude-code.ts` 的 MCP server 方案：

```ts
tool("request_choice", "...", {
  prompt: z.string().min(1),
  options: z.array(z.object({
    id: z.string().min(1).optional(),
    label: z.string().min(1),
    description: z.string().optional()
  })).min(2).max(4),
  allowCustom: z.boolean().optional()
}, async (args) => {
  const decision = await params.requestInteraction({
    kind: "choice",
    messageId: "",
    payload: {
      prompt: args.prompt,
      options: args.options.map((option, index) => ({
        id: option.id ?? `option_${index + 1}`,
        label: option.label,
        description: option.description
      })),
      allowCustom: args.allowCustom ?? true
    }
  });
  return choiceToolResult(decision);
});
```

原因：

- 现有 V1.5 Choice 卡已经按 `ChoicePayload` 工作。
- SDK `AskUserQuestion` 类型支持 1-4 个问题，但当前 AgentHub `InteractionChoiceCard` 是单问题单卡。MCP `request_choice` 可以直接限制成单问题，避免 UI 契约扩张。
- 内置 `claude-code.ts` 已验证该方式可与 `query()` 共存。

后续若要原生接 SDK `AskUserQuestion`，另开小 phase 扩展 `ChoicePayload` 多问题结构。

## 4. 状态机（C0-2）

继续复用已有 run 状态：

```text
running
  ├─ SDK canUseTool / request_choice 触发
  ↓
awaiting_interaction
  ├─ 用户批准 / 选择
  ↓
running
  ├─ SDK 继续输出
  ↓
done / error / cancelled
```

群聊 task 状态同步：

```text
orchestrator_task.running
  ├─ createInteraction(orchestratorTaskId)
  ↓
orchestrator_task.awaiting_interaction
  ├─ resolveInteraction()
  ↓
orchestrator_task.running
  ├─ markRunDone / markRunErrored / markRunCancelled
  ↓
orchestrator_task.done / error / cancelled
```

异常路径：

| 场景 | 处理 |
| --- | --- |
| 用户拒绝 Approval | SDK 收到 `deny`，模型可继续解释或最终 error；adapter 不主动终止 run |
| 用户刷新页面但服务未重启 | SSE replay pending interaction；respond 后 `resumeInteraction()` 唤醒 |
| Next dev 热重载 / 服务重启 | waiter 丢失；`resolveInteraction()` 现有逻辑把 interaction 标 `expired`，run/message 标 error |
| 用户 stop run | abort signal 触发，`run-bridge` waiter reject，pending interaction 标 cancelled |
| SDK 抛错 | `message_error`，`cancelPendingRunInteractions(runId)` 收口 |

## 5. API 字段表（C0-3）

V3.7 不新增 API。

| Endpoint | 用途 | 是否改动 |
| --- | --- | --- |
| `GET /api/conversations/:id/interactions?status=pending` | 刷新恢复 pending 卡片 | 不改 |
| `POST /api/interactions/:id/respond` | 用户批准 / 拒绝 / 选择 | 不改 |
| `GET /api/conversations/:id/stream` | replay pending interaction + 实时 SSE | 不改 |

对 `POST /api/interactions/:id/respond` 的要求：

- 自建 SDK interaction 的 `agent_id` 必须是真实自建 Agent id。
- 不得使用 `__agent_creator__` / `__skill_creator__` 占位，否则 route 会进入 creator 专属分支。
- `decision.kind` 必须与 interaction kind 一致，继续由 `validateDecision()` 和 `resolveInteraction()` 兜底。

SSE 事件沿用：

```text
interaction_requested
interaction_resolved
run_status
task_status
message_delta
message_status
```

## 6. UI 组件（C0-4）

V3.7 不新增 UI 组件。

| UI | 现状 | V3.7 使用 |
| --- | --- | --- |
| `InteractionApprovalCard` | 单聊 / 群聊 inline 卡片已可渲染 approval | 直接复用 |
| `InteractionChoiceCard` | 单选 + 自定义输入 | 直接复用 |
| `MessageBubble` | 根据 message interactions 渲染 inline 卡片 | 直接复用 |
| `ContextPanel` task 状态 | 已显示 `awaiting_interaction` 为“等待交互” | 直接复用 |

可选文案微调（C1 时如需要）：

- Approval summary 中将“Claude Code”改为自建 Agent displayName：`自建 Agent <name> 请求使用 Bash`。
- risk 中展示 SDK `options.description` / `decisionReason`，不要把 JSON input 原样塞到 UI。

## 7. 依赖模块接口对齐方案（C0-5）

### 7.1 Adapter 启动参数

`lib/adapters/claude-code-sdk.ts` 的 `query()` options 增加：

```ts
canUseTool: createCustomAgentPermissionHandler(params),
mcpServers: {
  agenthub_interactions: createCustomAgentChoiceServer(params)
},
toolConfig: {
  askUserQuestion: { previewFormat: "markdown" }
}
```

system prompt 追加：

```text
When you need the user to choose between options, call the MCP tool
`request_choice` from the `agenthub_interactions` server instead of asking in plain text.
```

capabilities 改为：

```ts
capabilities: {
  supportsApproval: "native",
  supportsChoice: "native"
}
```

### 7.2 挂起 / 唤醒调用序列

```text
1. startAgentRun() 创建 agent_runs + assistant message，drainAgentRun() 开始消费 adapter.run()
2. claudeCodeSdkAdapter.run() 调 query({ canUseTool, mcpServers })
3. SDK 需要工具确认时调用 canUseTool(toolName, input, options)
4. canUseTool 调 params.requestInteraction({ kind: "approval", payload })
5. runs.ts requestRunInteraction() 调 createInteraction()
6. createInteraction() 写 agent_interactions，run/task 置 awaiting_interaction，SSE 推 interaction_requested
7. canUseTool await waitForInteractionResponse()
8. 用户点击卡片，POST /api/interactions/:id/respond
9. resolveInteraction() 写 response，run/task 置 running，SSE 推 interaction_resolved
10. resumeInteraction() resolve Promise
11. canUseTool 把 decision 映射成 PermissionResult 返回给 SDK
12. SDK 继续同一 run，adapter 继续 yield text_delta/message_done
```

Choice 路径同上，只是第 3 步由 MCP `request_choice` tool 触发，第 11 步返回 tool result text 给模型。

### 7.3 伪代码

```ts
function createCustomAgentPermissionHandler(params: AdapterRunParams): CanUseTool {
  return async (toolName, input, options) => {
    const decision = await params.requestInteraction({
      kind: "approval",
      messageId: "",
      payload: approvalPayloadFromSdkTool({
        toolName,
        input,
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        decisionReason: options.decisionReason,
        blockedPath: options.blockedPath,
        toolUseID: options.toolUseID
      })
    });

    if (decision.kind === "approval" && decision.approved) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID
      };
    }

    return {
      behavior: "deny",
      message: "用户在 AgentHub 中拒绝了该操作。",
      toolUseID: options.toolUseID
    };
  };
}

function createCustomAgentChoiceServer(params: AdapterRunParams) {
  return createSdkMcpServer({
    name: "agenthub_interactions",
    version: "0.1.0",
    instructions: "Use request_choice when the run needs a user decision.",
    alwaysLoad: true,
    tools: [
      tool("request_choice", "...", requestChoiceSchema, async (args) => {
        const decision = await params.requestInteraction({
          kind: "choice",
          messageId: "",
          payload: {
            prompt: args.prompt,
            options: normalizeChoiceOptions(args.options),
            allowCustom: args.allowCustom ?? true
          }
        });

        if (decision.kind !== "choice") {
          return { content: [{ type: "text", text: "No choice was provided." }] };
        }

        return {
          content: [{
            type: "text",
            text: decision.customText || decision.selectedOptionIds.join(", ") || "No choice was selected."
          }]
        };
      }, { alwaysLoad: true })
    ]
  });
}
```

### 7.4 与 `run-bridge` 的衔接点

V3.7 不改 `run-bridge` 的数据结构。关键约束是：

- adapter 必须 `await params.requestInteraction(...)`，不能只 `yield interaction_required` 后继续。
- `params.requestInteraction()` 已由 `runs.ts` 自动补 `conversationId/runId/messageId/agentId/conversationAgentId/orchestratorTaskId`。
- `messageId: ""` 是允许的，`requestRunInteraction()` 会回填当前 assistant message id。
- SDK callback 内不要 catch 并吞掉 `AbortError`；stop run 时要让 query abort。

## 8. 文件落点

| 工作 | 文件 | 备注 |
| --- | --- | --- |
| capabilities 改 native | `lib/adapters/claude-code-sdk.ts` | approval / choice 均 native |
| SDK permission handler | `lib/adapters/claude-code-sdk.ts` | 新增 `createCustomAgentPermissionHandler` |
| Choice MCP server | `lib/adapters/claude-code-sdk.ts` | 复用内置 adapter 模式 |
| payload helper | `lib/adapters/claude-code-sdk.ts` | `actionForTool` / `commandFromInput` / `pathFromInput` |
| system prompt 更新 | `lib/adapters/claude-code-sdk.ts` | 删除 V3.4 “尚未提供桥接”文案 |
| Planner 能力恢复 | 无独立文件 | `orchestrator/context.ts` 会从 adapter capabilities 自动读到 native |
| 测试 / smoke | 后续 C1 决定 | 最少要有 fake 或真实 SDK smoke |

## 9. 分阶段实现建议

### C1：Approval 桥接

- `claude-code-sdk.ts` 增加 `canUseTool`。
- capabilities 的 `supportsApproval` 改 `native`，`supportsChoice` 仍先保持 `none`。
- 跑 readonly/code-author 自建 Agent 的写文件触发审批 smoke。

### C2：Choice 桥接

- 增加 `agenthub_interactions` MCP server + `request_choice` tool。
- system prompt 指导模型使用工具提问。
- capabilities 的 `supportsChoice` 改 `native`。

### C3：群聊 / Orchestrator 回归

- 新建群聊 @ 自建 Agent，触发审批或选择。
- 验证 task 进入 `awaiting_interaction`，回应后回到 `running` 并最终 `done/error`。
- 验证 Planner 不再因为 `supportsApproval=none` 拒绝分配写文件任务。

### C4：文档与验收收口

- 更新 `HANDOFF.md` / `roadmap.md` V3 状态。
- 如发现无法稳定复现的真实 SDK 行为，写入 `docs/state/TOFIX.md`，不要用 mock 伪装通过。

## 10. 验收标准

Approval：

- 自建 `readonly` 或 `code-author` Agent 尝试 `Write/Edit/Bash` 时，消息流出现 Approval 卡片。
- 用户批准后，同一 `run_id` 继续，SDK 收到 `{ behavior: "allow", updatedInput: input, toolUseID }`。
- 用户拒绝后，SDK 收到 `{ behavior: "deny", message, toolUseID }`，run 合理结束或继续解释，不无限 running。
- 刷新页面后 pending Approval 可恢复；服务重启后回应旧 pending 走现有 expired 逻辑。

Choice：

- 自建 Agent 需要用户决策时调用 `request_choice`，消息流出现 Choice 卡片。
- 用户选择 option 或填写 customText 后，同一 `run_id` 继续，模型收到选择文本。
- Choice 不走 `/agent-creator` / `/skill-creator` 专属分支。

群聊：

- 群聊子 Agent 触发 Approval / Choice 时，`agent_interactions.conversation_agent_id` 和 `orchestrator_task_id` 正确落库。
- 右栏 task 状态显示“等待交互”；回应后恢复运行并最终终态。
- Orchestrator 不代批、不代选。

回归：

- 内置 `@claude-code` 行为不变。
- 自建 Agent `executor` profile 不弹 Approval（除非 SDK 硬拒或 disallowedTools），符合 V3.2/V3.4 的高危语义。
- `npm run typecheck` / `npm run build` / `git diff --check` 通过。

## 11. 对齐问题

C1 前需确认：

1. Choice 首版是否坚持 MCP `request_choice`，暂不接 SDK 原生 `AskUserQuestion` 多问题结构。
2. Approval 被拒绝后是否让 SDK 自行继续，还是 Conflux 直接把 run 标 error。本文建议前者。
3. `executor` profile 是否继续保持不弹 Approval。本文建议保持，因为创建/设置页已用高危语义提示。
4. V3.7 是否只验自建 SDK adapter，不把新 helper 抽到内置 `claude-code.ts` 共享。本文建议不抽，避免影响稳定路径。

# V3.5 群聊 UI 接入 C0 设计稿

> 范围：本设计稿覆盖自建 Agent 在群聊场景的 UI 接入：roster 字段扩展、右栏 `GroupContext` 卡片差异化、消息流 `MessageBubble` 蓝色脉冲点角标、新建群聊的可用 Agent 提示分段，以及"单聊不接入自建 Agent"的过滤位置。
> 明确不覆盖：SDK 运行参数（V3.4 已落库）、Approval/Choice 桥接（V3.7）、自定义 Agent 设置页（V3.6）、`/agent-creator` / `/skill-creator` 流程改动。

## 1. 阶段目标与边界

V3.5 的目标是让 V3.2 创建、V3.4 已可运行的自建 Agent，能在群聊里被正常加入 roster、被 @ 派发任务，并且在右栏与消息流中显示与系统 Agent 有明确视觉区分的形态。单聊侧不接入自建 Agent（继续走系统 Agent 的锁定流程）。

V3.5 不调整 `lib/adapters/*`、`lib/conversations/runs.ts`、Orchestrator planner 逻辑。所有运行链路在 V3.4 已收口，群聊 `@<自建alias>` 路径只验证、不重写。

本阶段验收范围：

- 群聊 `RosterItem` 增加 `avatarKind / avatarValue / capabilities / isSystem / displayName`（`displayName` 字段早已存在，本阶段保持语义）。
- `GET /api/conversations/:id/roster` 返回新字段；`GET /api/agents` 支持 `conversationMode=single|group` 过滤；`POST /api/messages` 在单聊路径拒绝自建 Agent mention。
- `NewConversationContext` 的"可用 Agent"区块分"系统" / "自建"两段；自建段空态显示引导文案。
- `GroupContext` 卡片：自建 Agent 用 `emoji / uploaded` 头像 + capability tag；系统 Agent 维持 `AgentIcon` + 无 tag。
- `MessageBubble` 气泡右上角：自建 Agent 加蓝色脉冲点角标（无文字）；系统 Agent 不变。
- 静态原型：`docs/design/prototypes/v3/self-built-agent-typewriter.html` 演示气泡角标 + 右栏卡片差异。

## 2. 类型设计（C0-1）

### 2.1 `RosterItem` 扩展

`lib/conversations/types.ts:54-60`：

```ts
export type RosterItem = {
  id: string;
  alias: string;
  displayName: string;
  status: "active" | "idle" | "running" | "unavailable";
  slug: string;
  // V3.5 新增
  isSystem: boolean;
  avatarKind: "system" | "emoji" | "uploaded";
  avatarValue: string;
  capabilities: string[] | null;
};
```

字段语义：

| 字段 | 取值 | 来源 |
| --- | --- | --- |
| `isSystem` | `true` / `false` | `agents.is_system`，决定走 `AgentIcon` 还是自建头像组件 |
| `avatarKind` | `system` / `emoji` / `uploaded` | `agents.avatar_kind`；系统 Agent 强制 `system` |
| `avatarValue` | slug（system）/ emoji 字符（emoji）/ `message_attachments.id`（uploaded） | `agents.avatar_value`；系统 Agent 强制为 `slug` |
| `capabilities` | `string[]` 或 `null` | `agents.capabilities`（JSON 数组）；系统 Agent 为 `null` |
| `displayName` | 字符串 | 同实例多份时仍按 V2.6 加 ` N` 后缀（service 层逻辑不变） |

> 兼容：旧字段不改动；新字段在序列化时全部必填，避免前端做 `??` 判断。

### 2.2 `AvailableAgentSummary`（"可用 Agent"列表）

`lib/agents/types.ts` 新增（供 `NewConversationContext` 使用）：

```ts
export type AvailableAgentSummary = {
  id: string;
  slug: string;
  name: string;
  platform: AgentPlatform;
  description: string;
  isSystem: boolean;
  avatarKind: "system" | "emoji" | "uploaded";
  avatarValue: string;
  capabilities: string[] | null;
};
```

> 与现有 `AgentSummary`（V3.4 加了 `systemPrompt / permissionMode / toolProfile` 三个运行时字段）刻意区分：`AvailableAgentSummary` 只暴露**展示用**字段，不向前端泄露 `systemPrompt`。

### 2.3 `AgentVisualStyle`（视觉常量）

`components/agents/AgentVisualStyle.ts`（新增）：

```ts
export type AgentVisualStyle = {
  /** 头像背景，自建 Agent emoji 用 panel；uploaded 不透明 */
  avatarBg: "panel" | "transparent";
  /** 角标：自建 Agent 用 'live'（蓝色脉冲点），系统 Agent 不显示 */
  bubbleBadge: "live" | "none";
  /** capability tag 是否在群聊右栏卡片显示（消息流恒不显示） */
  showCapabilityInRoster: boolean;
};

export const SYSTEM_AGENT_STYLE: AgentVisualStyle = {
  avatarBg: "panel",
  bubbleBadge: "none",
  showCapabilityInRoster: false
};

export const CUSTOM_AGENT_STYLE: AgentVisualStyle = {
  avatarBg: "panel",
  bubbleBadge: "live",
  showCapabilityInRoster: true
};

export function styleFor(item: { isSystem: boolean }): AgentVisualStyle {
  return item.isSystem ? SYSTEM_AGENT_STYLE : CUSTOM_AGENT_STYLE;
}
```

> 之所以独立成模块：让 `GroupContext` / `MessageBubble` / `NewConversationContext` 三处共用同一份常量，未来视觉对齐时只改一处。

### 2.4 Zod 校验

新增 `lib/agents/avatar-schema.ts`：

```ts
import { z } from "zod";

export const avatarKindSchema = z.enum(["system", "emoji", "uploaded"]);

export const capabilitiesSchema = z
  .array(z.string().min(1).max(24))
  .max(8)
  .nullable();
```

`getConversationRoster` 返回前用该 schema 解析 `agents.capabilities` JSON（解析失败 → 退化为 `null`，写 stderr 日志），避免脏数据让前端崩。

## 3. 状态机（C0-2）

**N/A — V3.5 是纯展示层 + API 透出层改造**。无前端状态机扩展，无后端 run 状态变更。

需要说明的两点：

- 群聊 `@<自建alias>` 触发 orchestrator → SDK run 的链路在 V3.4 已经收口。V3.5 只在 UI 渲染端读 roster + capabilities，不改 orchestrator planner / dispatcher。
- 单聊"自建 Agent 不能 @"的拒绝是同步校验（service.ts），不引入异步等待状态。

## 4. API 字段表（C0-3）

### 4.1 `GET /api/conversations/:id/roster`

请求：路径参数 `conversationId`，无 query。

响应：

```ts
{
  roster: Array<{
    id: string;
    alias: string;
    displayName: string;
    status: "active" | "idle" | "running" | "unavailable";
    slug: string;
    // V3.5 新增
    isSystem: boolean;
    avatarKind: "system" | "emoji" | "uploaded";
    avatarValue: string;
    capabilities: string[] | null;
  }>;
}
```

实现位置：`lib/conversations/service.ts:getConversationRoster`（924–961）。SELECT 增加 `agents.isSystem / avatarKind / avatarValue / capabilities`，map 时按上文 Zod 解析 capabilities。系统 Agent 兜底：`avatarKind` 为空时填 `'system'`，`avatarValue` 为空时填 `slug`。

### 4.2 `GET /api/agents?conversationMode=single|group`

请求：可选 query `conversationMode`。

| 取值 | 行为 |
| --- | --- |
| 未传 | 返回所有 enabled Agent（与现状一致，保留旧消费方兼容） |
| `single` | 只返回 `is_system=1` 的 enabled Agent |
| `group` | 返回所有 enabled Agent（含 `is_system=0`） |

响应：`{ agents: AvailableAgentSummary[] }`。

实现位置：`app/api/agents/route.ts` + `lib/conversations/service.ts:listAgents`（46–54）。`listAgents` 增加可选参数 `{ conversationMode?: 'single' | 'group' }`，按 `agents.isSystem` 过滤；新建 `toAvailableAgentSummary(agent)` 函数返回展示字段（不含 `systemPrompt`）。

### 4.3 单聊 mention 防御：`POST /api/messages`

请求：与现状一致（`{ content, attachments? }`）。

变更：`lib/conversations/service.ts:sendSingleMessage`（418–512）在调用 `parseAgentMentions(trimmed, allAgents)` 之前，把 `allAgents` 过滤为 `isSystem=true`。

| 输入 | 行为 |
| --- | --- |
| `@<系统alias>` + 单聊首条 | 走原 `validateSingleChatMention`，正常锁定 |
| `@<自建alias>` + 单聊首条 | `parseAgentMentions` 返回 `未知 Agent：@xxx`（因为已被过滤掉）— 给用户的提示语在 `parseAgentMentions` 层改为"自建 Agent 仅可用于群聊，请新建群聊后 @{alias}" |
| `@<自建alias>` + 单聊后续（已锁定系统 Agent） | 同上拒绝；与"切换 Agent"的拒绝合并，错误信息保持单一来源 |

实现细节：在 `sendSingleMessage` 顶部新增

```ts
const systemAgents = listAgents().filter((a) => a.isSystem);
const parsed = parseAgentMentions(trimmed, systemAgents);
```

并在 `parseAgentMentions` 错误返回时区分"过滤掉的自建 Agent" vs "纯未知 Agent" — 前者用专门文案。**最小改动**方案：在 `sendSingleMessage` 失败兜底里检测 `parsed.error` 包含的 slug 是否对应 `is_system=false` 的 Agent，是则用更友好文案。

> 兼容：`POST /api/conversations` 本身**不带 agent 选择参数**（单聊 agent 是在首条消息 @ 时锁定的）。所以 V3 计划 §三 C9 的"`POST /api/conversations`（单聊模式）的可选 Agent 列表过滤 `is_system=1`"实际落在两处：(a) `GET /api/agents?conversationMode=single` 的 API 过滤；(b) `sendSingleMessage` 内的 mention 防御。计划文档表述是同一个意思的两面。

### 4.4 `POST /api/messages`（群聊路径）

无字段变更。`sendGroupMessage` 的 `parseAgentMentionsForRoster` 已用 `listAgents()` 全表，自建 Agent 通过 `slugFor(agent)` 直接被 @ 识别（V3.4 验证过 `slugFor` 对 `is_system=0` 的 Agent 同样可用，依赖 `agents.slug` 列）。

### 4.5 SSE 事件

无新增事件。`run_status` / `message_replace` / `message_delta` / `interaction_requested` 在 V1.5 / V2.4 已就绪；自建 Agent 走 SDK adapter 的 `text_delta`（V3.4）只是改了 adapter 实现，事件名称不变。

## 5. UI 组件 props（C0-4）

### 5.1 `RosterItem` 消费方一览

| 组件 / 函数 | 文件 | V3.5 改动 |
| --- | --- | --- |
| `ContextPanel` → `GroupContext` | `components/context/ContextPanel.tsx:306-349` | 卡片按 `isSystem` 分流；自建 Agent 渲染 `AgentAvatar`（新组件）+ capability tag |
| `MessageBubble` | `components/chat/MessageBubble.tsx:23-101` | 取 `rosterMember.isSystem` 决定头像走 `AgentIcon` 还是 `AgentAvatar`；非系统 Agent 在 `.message-bubble` 上加 `bubble-badge--live` 类 |
| `AppShell` SSE 处理 | `components/shell/AppShell.tsx` | 无改动（roster fetch 已经现成，自动带新字段） |

### 5.2 新组件：`AgentAvatar`

`components/agents/AgentAvatar.tsx`（新）：

```ts
type AgentAvatarProps = {
  kind: "system" | "emoji" | "uploaded";
  value: string;
  slug?: string; // kind === 'system' 时回退到 AgentIcon
  size?: number;
};
```

行为：

- `kind === 'system'` → `<AgentIcon agent={slug ?? value} size={size} />`
- `kind === 'emoji'` → `<span className="agent-avatar-emoji" style={{ fontSize: size * 0.7 }}>{value}</span>`
- `kind === 'uploaded'` → `<img src={`/api/attachments/${value}/preview`} alt="" className="agent-avatar-image" />`（V3.5 不验证 endpoint 真实可用，uploaded 由 V3.2 A8 收口；如未就绪降级到 emoji "🤖"）

> 命名 `AgentAvatar` 与现有 `AgentIcon` 区分：`AgentIcon` 仅供系统 Agent（写死 4 个 logo），`AgentAvatar` 是按 kind 分发的统一入口。`MessageBubble` / `GroupContext` 全部改用 `AgentAvatar`，内部再决定走哪条路径。

### 5.3 `MessageBubble` 改动

新 props：

```ts
type MessageBubbleProps = {
  message: MockMessage;
  roster?: RosterItem[]; // 已存在
  onRegenerate?: (messageId: string) => Promise<void>;
  onRespondInteraction?: (interactionId: string, decision: InteractionDecision) => Promise<void>;
  onStopAgent?: (conversationAgentId: string) => Promise<void>;
};
```

无新 prop。`MessageBubble` 自行从 `rosterMember.isSystem` 推导：

```tsx
const isCustomAgent = tone === "agent" && rosterMember && !rosterMember.isSystem;

<div className={`message-bubble${isCustomAgent ? " bubble-with-badge" : ""}`}>
  {isCustomAgent ? <span className="bubble-live-dot" aria-label="自建 Agent 输出" /> : null}
  <RichText text={message.body} />
  ...
</div>
```

> capability tag 在 `MessageBubble` 内**恒不渲染**（G4 决策），无开关。

### 5.4 `GroupContext` 改动

`AgentState` 子组件签名改为：

```ts
function AgentState({
  member,
  detail
}: {
  member: RosterItem;
  detail: string;
}) {
  // ...
  return (
    <div className="agent-state-row">
      <span className="context-agent-icon">
        <AgentAvatar
          kind={member.avatarKind}
          value={member.avatarValue}
          slug={member.slug}
          size={22}
        />
      </span>
      <div>
        <strong>{member.displayName}</strong>
        <p>{detail}</p>
        {!member.isSystem && member.capabilities?.length ? (
          <div className="capability-tags">
            {member.capabilities.map((tag) => (
              <span className="capability-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

> Orchestrator 行（`<AgentState detail="调度中" name="Orchestrator" slug="orchestrator" />`）不通过 roster 渲染，单独传 `member={{ isSystem: true, avatarKind: 'system', avatarValue: 'orchestrator', ... }}` 或保留旧 props 签名向后兼容。最小改动方案：保留 `name + slug` 旧签名作为重载（"orchestrator 是系统的固定项，不走 roster"）。

### 5.5 `NewConversationContext` 改动

群聊视图下，"可用 Agent"区块拆为两段：

```
─ 系统 Agent ─
[icon] Claude Code         @claude-code
[icon] Codex               @codex
[icon] Hermes              @hermes
[icon] OpenCode            @opencode

─ 自建 Agent ─
[emoji] 文档审查者          @doc-reviewer
       [代码审查][文档撰写]
[emoji] PRD 总结器         @prd-summarizer
       [PRD][文档摘要]
```

空态文案（无自建 Agent 时）：

> 还没有自建 Agent。去单聊里调 `/agent-creator` 创建一个。

数据获取：`AppShell` 拉 `GET /api/agents?conversationMode=group` 返回包含 `isSystem` 的列表，前端按 `isSystem` 分组。当前 `NewConversationContext` 用的是硬编码 4 个系统 Agent（`ContextPanel.tsx:111-116`），V3.5 改为从 props 接收 `availableAgents: AvailableAgentSummary[]`。

> 单聊视图（`view === 'new-single'`）按 `conversationMode=single` 拉取，只展示系统 Agent，不展示自建段（这就是 G6 / C9 在 UI 侧的体现）。

### 5.6 `ConversationSetup` 改动

`components/chat/ConversationSetup.tsx`：示例 `mention-row` 区域在群聊视图下追加一行 `@<custom-agent>` 占位（用 dimmed style，配文案"已创建自建 Agent 也可在此 @"），不强行硬编码 alias。本改动属 P1，做与不做不阻塞 V3.5 验收。

### 5.7 CSS 新增类（`app/globals.css`）

```css
/* 自建 Agent 气泡角标（蓝色脉冲点，无文字） */
.message-bubble.bubble-with-badge {
  position: relative;
}
.bubble-live-dot {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--blue);
  animation: bubble-live-pulse 1.6s ease-in-out infinite;
}
@keyframes bubble-live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.85); }
}

/* capability tag（右栏） */
.capability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.capability-tag {
  border: 1px solid var(--border-light);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 10px;
  color: var(--text-2);
  background: var(--bg-input);
}

/* 自建 Agent emoji 头像 */
.agent-avatar-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.agent-avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

## 6. 原型 HTML 范围

`docs/design/prototypes/v3/self-built-agent-typewriter.html`（静态单文件，无构建）。

包含视图：

1. **左半区：群聊消息流片段**
   - 用户气泡（自己发的 `@claude-code @doc-reviewer ...`）
   - 系统 Agent `Claude Code` 气泡（无角标）
   - 自建 Agent `Doc Reviewer` 气泡（右上角蓝色脉冲点角标，无文字、无光标）
   - 同一自建 Agent 第二轮气泡，角标仍常驻
2. **右半区：群聊右栏"参与上下文"卡片**
   - 系统 Agent 卡片：`AgentIcon` + 名称 + `@alias · 运行中`
   - 自建 Agent 卡片：emoji 头像 + displayName + `@alias · 待命` + 两个 capability tag
   - Orchestrator 卡片（保持现状）
3. 顶部说明条：左右两栏的差异点用 1-2 句话标注

技术约束：

- 内联 CSS，复用 `:root` 中颜色变量（`--primary / --blue / --bg-panel / --bg-subtle / --text-1 / --text-2 / --text-3 / --border-light / --shadow-sm` 等）
- 不引用 `@lobehub/icons`（原型用 SVG `<use href>` 或 emoji 占位）
- 文件长度控制在 400 行内，可直接用浏览器打开预览

## 7. 文件落点

| 工作 | 文件 |
| --- | --- |
| 扩展 `RosterItem` | `lib/conversations/types.ts:54-60` |
| 新增 `AvailableAgentSummary` | `lib/agents/types.ts` |
| 新增 `AgentVisualStyle` / `styleFor` | `components/agents/AgentVisualStyle.ts`（新） |
| 新增 `AgentAvatar` 组件 | `components/agents/AgentAvatar.tsx`（新） |
| `getConversationRoster` 扩展 SELECT + Zod | `lib/conversations/service.ts:924-961` + `lib/agents/avatar-schema.ts`（新） |
| `listAgents` 增加 `conversationMode` 过滤 | `lib/conversations/service.ts:46-54` |
| `GET /api/agents` 接 `conversationMode` query | `app/api/agents/route.ts` |
| 单聊 mention 防御 | `lib/conversations/service.ts:sendSingleMessage` |
| `GroupContext` 按 `isSystem` 分流视觉 | `components/context/ContextPanel.tsx:306-349` |
| `MessageBubble` 蓝色脉冲点角标 | `components/chat/MessageBubble.tsx:44-101` |
| `NewConversationContext` 系统 / 自建分段 | `components/context/ContextPanel.tsx:86-120` |
| `ConversationSetup` 文案补充（P1） | `components/chat/ConversationSetup.tsx:38-54` |
| CSS 新类 | `app/globals.css` |
| 原型 HTML | `docs/design/prototypes/v3/self-built-agent-typewriter.html`（新） |

## 8. 验收标准

- 群聊"选择 Agent"（实际入口：`NewConversationContext` "可用 Agent"区块 + Composer @ 补全）能看到自建 Agent，displayName 与创建时一致。
- 群聊中 `@<自建alias>` 走 orchestrator → SDK run → 自建 Agent 基于 system_prompt 回复（链路在 V3.4 已通，本阶段验证 UI 不退化即可）。
- 群聊右栏"参与上下文"中自建 Agent 显示 emoji 头像 + displayName + capability tag；系统 Agent 保持 `AgentIcon` 视觉。
- 群聊消息流气泡**不显示** capability tag；自建 Agent 气泡右上角常驻蓝色脉冲点角标（无文字、无光标）。
- 单聊首条 `@<自建alias>` 被拒绝并提示"自建 Agent 仅可用于群聊，请新建群聊后 @{alias}"。
- 单聊 `NewConversationContext` "可用 Agent"区块不展示自建段。
- 内置 `@claude-code` 群聊行为与 V2.5 一致（roster 视觉、消息流、@ 派发均不变）。
- `npm run typecheck` / `npm run build` / `git diff --check` 通过。
- 原型 HTML 在浏览器中可直接打开预览，左右两栏视觉与设计稿一致。

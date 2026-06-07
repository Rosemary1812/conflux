import type { AgentCreatorEvent, AgentCreatorState, AgentDraft, PlannerLLMResponse } from "@/lib/skills/agent-creator/types";
import { agentDraftFieldSchema, type AgentDraftField } from "@/lib/skills/agent-creator/types";

export type ConversationTurn = { role: "user" | "assistant"; text: string };

export type AgentCreatorSession = {
  conversationId: string;
  userMessageId: string;
  state: AgentCreatorState;
  draft: Partial<AgentDraft>;
  history: ConversationTurn[];
  currentInteractionId: string | null;
  /** 上一条 Choice 提示文本（用于日志） */
  lastSummary: string;
  /** 标记是 executor profile 二次确认 */
  requireDangerConfirm: boolean;
  createdAt: number;
  updatedAt: number;
};

const REQUIRED_FIELDS: AgentDraftField[] = [
  "name",
  "alias",
  "display_name",
  "description",
  "system_prompt",
  "permission_mode",
  "capabilities",
  "tool_profile"
];

// 在 dev 模式下，Next.js 的 HMR 会重新评估本模块，导致普通 `new Map()` 被替换。
// 通过挂到 globalThis，让 Map 跨 HMR 保留。
type GlobalWithStore = typeof globalThis & { __agentCreatorSessionStore?: Map<string, AgentCreatorSession> };
const sessionStore: Map<string, AgentCreatorSession> =
  ((globalThis as GlobalWithStore).__agentCreatorSessionStore ??= new Map<string, AgentCreatorSession>());

function sessionKey(conversationId: string) {
  return conversationId;
}

export function getSession(conversationId: string) {
  return sessionStore.get(sessionKey(conversationId)) ?? null;
}

export function listSessions() {
  return [...sessionStore.values()];
}

export function createSession(input: {
  conversationId: string;
  userMessageId: string;
}): AgentCreatorSession {
  const now = Date.now();
  const session: AgentCreatorSession = {
    conversationId: input.conversationId,
    userMessageId: input.userMessageId,
    state: "collecting",
    draft: {},
    history: [],
    currentInteractionId: null,
    lastSummary: "",
    requireDangerConfirm: false,
    createdAt: now,
    updatedAt: now
  };
  sessionStore.set(sessionKey(input.conversationId), session);
  return session;
}

export function clearSession(conversationId: string) {
  sessionStore.delete(sessionKey(conversationId));
}

export function applyLLMResponse(
  session: AgentCreatorSession,
  response: PlannerLLMResponse
): AgentCreatorSession {
  const mergedDraft: Partial<AgentDraft> = {
    ...session.draft,
    ...(response.draft ?? {})
  };
  if (!mergedDraft.avatar) {
    mergedDraft.avatar = { kind: "emoji", value: "🤖" };
  }

  const warnings = response.warnings ?? [];
  const updated: AgentCreatorSession = {
    ...session,
    draft: mergedDraft,
    history: [
      ...session.history,
      { role: "assistant", text: response.summary }
    ],
    lastSummary: response.summary,
    requireDangerConfirm: mergedDraft.tool_profile === "executor",
    updatedAt: Date.now()
  };

  if (response.info_sufficient) {
    const missing = computeMissingFields(mergedDraft);
    if (missing.length === 0) {
      updated.state = "confirm_build";
    } else {
      // info_sufficient=true 但缺关键字段 → 退回 collecting 让 LLM 补
      updated.state = "collecting";
      updated.history = [
        ...updated.history,
        {
          role: "assistant",
          text: `⚠️ 内部一致性：声称信息充足但仍缺 ${missing.join(", ")}，回退继续收集。`
        }
      ];
    }
  } else {
    updated.state = "collecting";
  }

  if (warnings.length > 0) {
    updated.history = [
      ...updated.history,
      { role: "assistant", text: `warnings: ${warnings.join("; ")}` }
    ];
  }

  return updated;
}

export function applyUserInput(
  session: AgentCreatorSession,
  text: string
): AgentCreatorSession {
  if (session.state === "done" || session.state === "cancelled") {
    return session;
  }

  if (text.trim().toLowerCase() === "/cancel") {
    return cancelSession(session);
  }

  const updated: AgentCreatorSession = {
    ...session,
    history: [...session.history, { role: "user", text }],
    currentInteractionId: null,
    updatedAt: Date.now()
  };

  if (updated.state === "confirm_build" || updated.state === "preview") {
    // 用户在确认/预览阶段补了新输入 → 回到 collecting 重新规划
    updated.state = "collecting";
  } else if (updated.state === "saving") {
    // saving 阶段忽略额外输入
  }

  return updated;
}

export function applyChoiceResponded(
  session: AgentCreatorSession,
  decision: { interactionId: string; selectedOptionIds: string[]; customText?: string }
): AgentCreatorSession {
  if (session.state === "done" || session.state === "cancelled") {
    return session;
  }

  if (session.currentInteractionId && session.currentInteractionId !== decision.interactionId) {
    // 过期 interaction
    return session;
  }

  const optionIds = decision.selectedOptionIds ?? [];
  const custom = decision.customText?.trim();

  if (session.state === "confirm_build") {
    if (optionIds.includes("start")) {
      return { ...session, currentInteractionId: null, state: "preview", updatedAt: Date.now() };
    }
    if (optionIds.includes("cancel")) {
      return cancelSession(session);
    }
    // continue 或其它 → collecting，附加用户自由输入
    return {
      ...session,
      currentInteractionId: null,
      state: "collecting",
      history: [
        ...session.history,
        { role: "user", text: custom ?? "再聊聊" }
      ],
      updatedAt: Date.now()
    };
  }

  // collecting 阶段：把选项 / 自定义文本作为用户输入
  const userText = custom
    ? custom
    : optionIds.length > 0
      ? optionIds.join(", ")
      : "(空)";

  return {
    ...session,
    currentInteractionId: null,
    state: "collecting",
    history: [...session.history, { role: "user", text: userText }],
    updatedAt: Date.now()
  };
}

export function applyConfirmed(session: AgentCreatorSession): AgentCreatorSession {
  if (session.state !== "preview") {
    return session;
  }
  return { ...session, state: "saving", updatedAt: Date.now() };
}

export function applySaved(session: AgentCreatorSession): AgentCreatorSession {
  return { ...session, state: "done", updatedAt: Date.now() };
}

export function applyRegenerate(
  session: AgentCreatorSession,
  instruction?: string
): AgentCreatorSession {
  return {
    ...session,
    state: "collecting",
    history: [
      ...session.history,
      { role: "user", text: instruction?.trim() || "请重新生成 profile" }
    ],
    currentInteractionId: null,
    updatedAt: Date.now()
  };
}

export function cancelSession(session: AgentCreatorSession): AgentCreatorSession {
  return {
    ...session,
    state: "cancelled",
    currentInteractionId: null,
    updatedAt: Date.now()
  };
}

export function setCurrentInteraction(
  session: AgentCreatorSession,
  interactionId: string | null
): AgentCreatorSession {
  return { ...session, currentInteractionId: interactionId, updatedAt: Date.now() };
}

export function persistSession(session: AgentCreatorSession) {
  sessionStore.set(sessionKey(session.conversationId), { ...session, updatedAt: Date.now() });
}

export function computeMissingFields(draft: Partial<AgentDraft>): AgentDraftField[] {
  const missing: AgentDraftField[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!hasField(draft, field)) {
      missing.push(field);
    }
  }
  if (!draft.avatar) {
    missing.push("avatar");
  }
  return missing;
}

function hasField(draft: Partial<AgentDraft>, field: AgentDraftField): boolean {
  const value = (draft as Record<string, unknown>)[field];
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function applyEvent(
  session: AgentCreatorSession,
  event: AgentCreatorEvent
): AgentCreatorSession {
  switch (event.type) {
    case "USER_INPUT":
      return applyUserInput(session, event.text);
    case "CHOICE_RESPONDED":
      return applyChoiceResponded(session, {
        interactionId: event.interactionId,
        selectedOptionIds: event.selectedOptionIds,
        customText: event.customText
      });
    case "LLM_RESPONSE":
      return applyLLMResponse(session, event.response);
    case "USER_CONFIRMED":
      return applyConfirmed(session);
    case "USER_CANCELLED":
      return cancelSession(session);
    case "USER_REGENERATE_PROFILE":
      return applyRegenerate(session, event.instruction);
  }
}

export function transitionAllowed(state: AgentCreatorState, eventType: AgentCreatorEvent["type"]): boolean {
  if (state === "done" || state === "cancelled") {
    return false;
  }

  const allowed: Record<AgentCreatorState, AgentCreatorEvent["type"][]> = {
    idle: ["USER_INPUT", "USER_CANCELLED"],
    collecting: ["LLM_RESPONSE", "CHOICE_RESPONDED", "USER_INPUT", "USER_CANCELLED"],
    confirm_build: ["CHOICE_RESPONDED", "USER_CANCELLED", "USER_INPUT"],
    preview: ["USER_CONFIRMED", "USER_REGENERATE_PROFILE", "USER_CANCELLED"],
    saving: ["USER_CONFIRMED", "USER_CANCELLED"],
    done: [],
    cancelled: []
  };

  return allowed[state]?.includes(eventType) ?? false;
}

export { agentDraftFieldSchema };

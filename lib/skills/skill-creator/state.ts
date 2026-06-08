import type { SkillCreatorEvent, SkillCreatorLLMResponse, SkillCreatorState, SkillDraft } from "@/lib/skills/skill-creator/types";
import { type SkillDraftField } from "@/lib/skills/skill-creator/types";

export type ConversationTurn = { role: "user" | "assistant"; text: string };

export type SkillCreatorSession = {
  conversationId: string;
  userMessageId: string;
  state: SkillCreatorState;
  draft: Partial<SkillDraft>;
  history: ConversationTurn[];
  currentInteractionId: string | null;
  lastSummary: string;
  createdAt: number;
  updatedAt: number;
};

const REQUIRED_FIELDS: SkillDraftField[] = ["name", "slug", "description", "body"];

type GlobalWithStore = typeof globalThis & { __skillCreatorSessionStore?: Map<string, SkillCreatorSession> };
const sessionStore: Map<string, SkillCreatorSession> =
  ((globalThis as GlobalWithStore).__skillCreatorSessionStore ??= new Map<string, SkillCreatorSession>());

function sessionKey(conversationId: string) {
  return conversationId;
}

export function getSession(conversationId: string) {
  return sessionStore.get(sessionKey(conversationId)) ?? null;
}

export function createSession(input: { conversationId: string; userMessageId: string }): SkillCreatorSession {
  const now = Date.now();
  const session: SkillCreatorSession = {
    conversationId: input.conversationId,
    userMessageId: input.userMessageId,
    state: "collecting",
    draft: {},
    history: [],
    currentInteractionId: null,
    lastSummary: "",
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
  session: SkillCreatorSession,
  response: SkillCreatorLLMResponse
): SkillCreatorSession {
  const mergedDraft: Partial<SkillDraft> = {
    ...session.draft,
    ...(response.draft ?? {})
  };
  const warnings = response.warnings ?? [];
  const updated: SkillCreatorSession = {
    ...session,
    draft: mergedDraft,
    history: [...session.history, { role: "assistant", text: response.summary }],
    lastSummary: response.summary,
    updatedAt: Date.now()
  };

  if (response.info_sufficient && computeMissingFields(mergedDraft).length === 0) {
    updated.state = "confirm_build";
  } else {
    updated.state = "collecting";
  }

  if (warnings.length > 0) {
    updated.history = [...updated.history, { role: "assistant", text: `warnings: ${warnings.join("; ")}` }];
  }

  return updated;
}

export function applyUserInput(session: SkillCreatorSession, text: string): SkillCreatorSession {
  if (session.state === "done" || session.state === "cancelled") {
    return session;
  }
  if (text.trim().toLowerCase() === "/cancel") {
    return cancelSession(session);
  }

  const updated: SkillCreatorSession = {
    ...session,
    history: [...session.history, { role: "user", text }],
    currentInteractionId: null,
    updatedAt: Date.now()
  };

  if (updated.state === "confirm_build" || updated.state === "preview") {
    updated.state = "collecting";
  }

  return updated;
}

export function applyChoiceResponded(
  session: SkillCreatorSession,
  decision: { interactionId: string; selectedOptionIds: string[]; customText?: string }
): SkillCreatorSession {
  if (session.state === "done" || session.state === "cancelled") {
    return session;
  }
  if (session.currentInteractionId && session.currentInteractionId !== decision.interactionId) {
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
    return {
      ...session,
      currentInteractionId: null,
      state: "collecting",
      history: [...session.history, { role: "user", text: custom ?? "再聊聊" }],
      updatedAt: Date.now()
    };
  }

  const userText = custom ? custom : optionIds.length > 0 ? optionIds.join(", ") : "(空)";
  return {
    ...session,
    currentInteractionId: null,
    state: "collecting",
    history: [...session.history, { role: "user", text: userText }],
    updatedAt: Date.now()
  };
}

export function applyRegenerate(session: SkillCreatorSession, instruction?: string): SkillCreatorSession {
  return {
    ...session,
    state: "collecting",
    history: [...session.history, { role: "user", text: instruction?.trim() || "请重新生成 Skill 草稿" }],
    currentInteractionId: null,
    updatedAt: Date.now()
  };
}

export function cancelSession(session: SkillCreatorSession): SkillCreatorSession {
  return {
    ...session,
    state: "cancelled",
    currentInteractionId: null,
    updatedAt: Date.now()
  };
}

export function setCurrentInteraction(session: SkillCreatorSession, interactionId: string | null): SkillCreatorSession {
  return { ...session, currentInteractionId: interactionId, updatedAt: Date.now() };
}

export function persistSession(session: SkillCreatorSession) {
  sessionStore.set(sessionKey(session.conversationId), { ...session, updatedAt: Date.now() });
}

export function computeMissingFields(draft: Partial<SkillDraft>): SkillDraftField[] {
  const missing: SkillDraftField[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!hasField(draft, field)) {
      missing.push(field);
    }
  }
  return missing;
}

function hasField(draft: Partial<SkillDraft>, field: SkillDraftField) {
  const value = (draft as Record<string, unknown>)[field];
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function applyEvent(session: SkillCreatorSession, event: SkillCreatorEvent): SkillCreatorSession {
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
    case "USER_CANCELLED":
      return cancelSession(session);
    case "USER_REGENERATE":
      return applyRegenerate(session, event.instruction);
  }
}

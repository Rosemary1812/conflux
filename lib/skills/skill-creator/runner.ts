import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agentInteractions, agentRuns, conversations, messages, providers, skills } from "@/lib/db/schema";
import { SKILL_CREATOR_SYSTEM_AGENT_ID } from "@/lib/db/seed";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import { getEnvPlannerProvider, getOrchestratorSettings } from "@/lib/providers/service";
import { buildSkillCreatorPrompt, buildSkillCreatorSystemPrompt, confirmBuildChoice } from "@/lib/skills/skill-creator/prompts";
import {
  applyChoiceResponded,
  applyEvent,
  applyLLMResponse,
  applyRegenerate,
  applyUserInput,
  clearSession,
  computeMissingFields,
  createSession,
  getSession,
  persistSession,
  setCurrentInteraction
} from "@/lib/skills/skill-creator/state";
import type { SkillCreatorSession } from "@/lib/skills/skill-creator/state";
import {
  skillCreatorExtractionResultSchema,
  skillDraftSchema,
  type ChoicePayload,
  type SkillCreatorExtractionResult,
  type SkillCreatorLLMResponse,
  type SkillDraft,
  type SkillDraftField
} from "@/lib/skills/skill-creator/types";

type RunInput = {
  conversationId: string;
  userMessageId: string;
  text: string;
};

export type RunSkillCreatorResult =
  | { kind: "ignored"; reason: string }
  | { kind: "info_sufficient_choice"; session: SkillCreatorSession; interactionId: string }
  | { kind: "collecting_choice"; session: SkillCreatorSession; interactionId: string }
  | { kind: "preview"; session: SkillCreatorSession }
  | { kind: "saved"; session: SkillCreatorSession; skillId: string }
  | { kind: "cancelled"; session: SkillCreatorSession }
  | { kind: "error"; session: SkillCreatorSession; error: string };

export async function runSkillCreator({ conversationId, userMessageId, text }: RunInput): Promise<RunSkillCreatorResult> {
  const conversation = getDb().select().from(conversations).where(eq(conversations.id, conversationId)).get();
  if (!conversation) {
    return { kind: "ignored", reason: "conversation not found" };
  }
  if (conversation.mode !== "single") {
    return { kind: "ignored", reason: "/skill-creator 仅在单聊中可用" };
  }

  if (text.trim().toLowerCase() === "/cancel") {
    const existing = getSession(conversationId);
    if (existing) {
      const cancelled = applyEvent(existing, { type: "USER_CANCELLED", reason: "user typed /cancel" });
      persistSession(cancelled);
      expirePendingInteraction(cancelled, "cancelled");
      publishSessionUpdate(cancelled);
      return { kind: "cancelled", session: cancelled };
    }
    return { kind: "ignored", reason: "no active skill-creator session" };
  }

  let session = getSession(conversationId);
  if (!session) {
    session = applyUserInput(createSession({ conversationId, userMessageId }), text);
  } else {
    session = applyUserInput(session, text);
  }

  persistSession(session);
  publishSessionUpdate(session);
  return runPlannerRound(session);
}

export async function continueSkillCreatorAfterChoice({
  conversationId,
  interactionId,
  decision
}: {
  conversationId: string;
  interactionId: string;
  decision: { selectedOptionIds: string[]; customText?: string };
}): Promise<RunSkillCreatorResult> {
  const session = getSession(conversationId);
  if (!session) {
    return { kind: "ignored", reason: "no active skill-creator session" };
  }
  if (session.currentInteractionId !== interactionId) {
    return { kind: "ignored", reason: "interaction is not the current skill-creator prompt" };
  }

  const updated = applyChoiceResponded(session, {
    interactionId,
    selectedOptionIds: decision.selectedOptionIds,
    customText: decision.customText
  });
  persistSession(updated);

  if (updated.state === "preview") {
    publishSessionUpdate(updated);
    return { kind: "preview", session: updated };
  }
  if (updated.state === "cancelled") {
    publishSessionUpdate(updated);
    return { kind: "cancelled", session: updated };
  }

  return runPlannerRound(updated);
}

export async function confirmSkillCreatorSave(conversationId: string): Promise<RunSkillCreatorResult> {
  const session = getSession(conversationId);
  if (!session) {
    return { kind: "ignored", reason: "no active skill-creator session" };
  }
  if (session.state !== "preview") {
    return { kind: "ignored", reason: `cannot save from state=${session.state}` };
  }

  const missing = computeMissingFields(session.draft);
  if (missing.length > 0) {
    return { kind: "error", session, error: `字段不完整：${missing.join(", ")}` };
  }

  const parsed = skillDraftSchema.safeParse(session.draft);
  if (!parsed.success) {
    return { kind: "error", session, error: `草稿校验失败：${parsed.error.message}` };
  }

  const draft = parsed.data;
  const collision = getDb().select({ id: skills.id }).from(skills).where(eq(skills.slug, draft.slug)).get();
  if (collision) {
    return { kind: "error", session, error: `slug "${draft.slug}" 已被占用，请换一个` };
  }

  const saving: SkillCreatorSession = { ...session, state: "saving" };
  persistSession(saving);
  publishSessionUpdate(saving);

  const now = Date.now();
  const skillId = crypto.randomUUID();
  getDb()
    .insert(skills)
    .values({
      id: skillId,
      slug: draft.slug,
      name: draft.name,
      description: draft.description,
      body: draft.body,
      kind: "user",
      version: 1,
      sourceAttachmentId: null,
      createdAt: now,
      updatedAt: now
    })
    .run();

  appendSessionAssistantMessage(saving, `已创建 Skill \`/${draft.slug}\`（${draft.name}）。现在可以在输入框的 / 命令面板中使用。`);
  const done: SkillCreatorSession = { ...saving, state: "done" };
  persistSession(done);
  publishSessionUpdate(done);
  return { kind: "saved", session: done, skillId };
}

export async function regenerateSkillCreator(conversationId: string, instruction?: string): Promise<RunSkillCreatorResult> {
  const session = getSession(conversationId);
  if (!session) {
    return { kind: "ignored", reason: "no active skill-creator session" };
  }
  const updated = applyRegenerate(session, instruction);
  persistSession(updated);
  return runPlannerRound(updated);
}

export function cancelSkillCreator(conversationId: string): SkillCreatorSession | null {
  const session = getSession(conversationId);
  if (!session) return null;
  const cancelled = applyEvent(session, { type: "USER_CANCELLED", reason: "user cancelled" });
  persistSession(cancelled);
  expirePendingInteraction(cancelled, "cancelled");
  publishSessionUpdate(cancelled);
  return cancelled;
}

export function discardSkillCreatorSession(conversationId: string) {
  clearSession(conversationId);
}

export function isSkillCreatorInteraction(agentId: string) {
  return agentId === SKILL_CREATOR_SYSTEM_AGENT_ID;
}

async function runPlannerRound(session: SkillCreatorSession): Promise<RunSkillCreatorResult> {
  try {
    const response = await callPlanner(session);
    const next = applyLLMResponse(session, response);
    persistSession(next);

    if (next.state === "confirm_build") {
      const interactionId = writeChoiceInteraction(next, confirmBuildChoice(), "Skill 草稿已经足够，可以生成预览。");
      const withId = setCurrentInteraction(next, interactionId);
      persistSession(withId);
      return { kind: "info_sufficient_choice", session: withId, interactionId };
    }

    if (next.state === "collecting" && response.next_question) {
      const interactionId = writeChoiceInteraction(next, response.next_question, response.summary);
      const withId = setCurrentInteraction(next, interactionId);
      persistSession(withId);
      return { kind: "collecting_choice", session: withId, interactionId };
    }

    return { kind: "error", session: next, error: "Skill Creator 未返回下一步问题。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Skill Creator Planner 调用失败。";
    console.error("[skill-creator] planner error", { conversationId: session.conversationId, error: message });
    const interactionId = writeChoiceInteraction(
      session,
      plannerRecoveryChoice(),
      `Skill Creator 暂时没能稳定生成草稿。你可以重试、补充更短的描述，或取消。错误：${message}`
    );
    const withId = setCurrentInteraction(session, interactionId);
    persistSession(withId);
    return { kind: "collecting_choice", session: withId, interactionId };
  }
}

function writeChoiceInteraction(session: SkillCreatorSession, payload: ChoicePayload, summary: string) {
  const now = Date.now();
  const interactionId = crypto.randomUUID();
  const runId = ensureSyntheticRun(session, now);

  getDb()
    .insert(agentInteractions)
    .values({
      id: interactionId,
      kind: "choice",
      status: "pending",
      conversationId: session.conversationId,
      runId,
      messageId: session.userMessageId,
      agentId: SKILL_CREATOR_SYSTEM_AGENT_ID,
      conversationAgentId: null,
      orchestratorTaskId: null,
      payloadJson: JSON.stringify(payload),
      responseJson: null,
      createdAt: now,
      resolvedAt: null
    })
    .run();

  getDb().update(agentRuns).set({ status: "awaiting_interaction", updatedAt: now }).where(eq(agentRuns.id, runId)).run();
  appendSessionAssistantMessage(session, summary || payload.prompt);

  publishConversationEvent(session.conversationId, {
    type: "interaction_requested",
    interaction: {
      id: interactionId,
      kind: "choice",
      status: "pending",
      conversationId: session.conversationId,
      runId,
      messageId: session.userMessageId,
      agentId: SKILL_CREATOR_SYSTEM_AGENT_ID,
      conversationAgentId: null,
      orchestratorTaskId: null,
      payload,
      response: null,
      createdAt: now,
      resolvedAt: null
    }
  });
  publishConversationEvent(session.conversationId, { type: "run_status", runId, status: "awaiting_interaction" });
  publishSessionUpdate(session);
  return interactionId;
}

function ensureSyntheticRun(session: SkillCreatorSession, now: number) {
  const runId = crypto.randomUUID();
  getDb()
    .insert(agentRuns)
    .values({
      id: runId,
      conversationId: session.conversationId,
      agentId: SKILL_CREATOR_SYSTEM_AGENT_ID,
      conversationAgentId: null,
      status: "awaiting_interaction",
      startedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .run();
  return runId;
}

function appendSessionAssistantMessage(session: SkillCreatorSession, content: string) {
  const now = Date.now();
  const messageId = crypto.randomUUID();
  getDb()
    .insert(messages)
    .values({
      id: messageId,
      conversationId: session.conversationId,
      role: "assistant",
      authorName: "Conflux Skill Creator",
      agentId: SKILL_CREATOR_SYSTEM_AGENT_ID,
      authorConversationAgentId: null,
      orchestratorTaskId: null,
      content,
      status: "done",
      createdAt: now
    })
    .run();
  getDb().update(conversations).set({ updatedAt: now }).where(eq(conversations.id, session.conversationId)).run();
  publishConversationEvent(session.conversationId, { type: "message_replace", messageId, content, status: "done" });
}

function expirePendingInteraction(session: SkillCreatorSession, status: "cancelled" | "expired") {
  if (!session.currentInteractionId) return;
  const now = Date.now();
  getDb().update(agentInteractions).set({ status, resolvedAt: now }).where(eq(agentInteractions.id, session.currentInteractionId)).run();
  publishConversationEvent(session.conversationId, {
    type: "interaction_resolved",
    interactionId: session.currentInteractionId,
    status
  });
}

function publishSessionUpdate(session: SkillCreatorSession) {
  publishConversationEvent(session.conversationId, {
    type: "skill_creator_session",
    conversationId: session.conversationId,
    state: session.state,
    draft: session.draft,
    lastSummary: session.lastSummary
  });
}

const PLANNER_TOOL_NAME = "update_skill_draft";

const plannerToolInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "给用户看的简短进展摘要，最多 800 字。" },
    draft_patch: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        slug: { type: "string" },
        description: { type: "string" },
        body: { type: "string" }
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", items: { type: "string" } }
  },
  required: ["summary", "draft_patch"]
} as const;

function anthropicPlannerToolDefinition() {
  return {
    name: PLANNER_TOOL_NAME,
    description: "生成或更新 Conflux slash-command Skill 草稿字段。",
    input_schema: plannerToolInputSchema
  };
}

function openAIPlannerToolDefinition() {
  return {
    name: PLANNER_TOOL_NAME,
    description: "生成或更新 Conflux slash-command Skill 草稿字段。",
    parameters: plannerToolInputSchema
  };
}

async function callPlanner(session: SkillCreatorSession): Promise<SkillCreatorLLMResponse> {
  const provider = resolvePlannerProvider();
  if (!provider) {
    throw new Error("未配置 Planner Provider；请在 Orchestrator Settings 或环境变量中配置。");
  }

  const apiKey = Buffer.from(provider.apiKeyEncrypted, "base64").toString("utf8");
  const userInput = session.history.length ? session.history[session.history.length - 1].text : "(空)";
  const prompt = buildSkillCreatorPrompt({
    partialDraft: session.draft,
    history: session.history,
    userInput,
    missingFields: computeMissingFields(session.draft)
  });
  const systemPrompt = buildSkillCreatorSystemPrompt();
  const extraction = provider.protocol === "anthropic"
    ? await callAnthropicPlanner(provider.baseUrl, apiKey, provider.defaultModel, systemPrompt, prompt)
    : await callOpenAIPlanner(provider.baseUrl, apiKey, provider.defaultModel, systemPrompt, prompt);
  return buildPlannerResponseFromExtraction(session, extraction);
}

function buildPlannerResponseFromExtraction(
  session: SkillCreatorSession,
  extraction: SkillCreatorExtractionResult
): SkillCreatorLLMResponse {
  const mergedDraft: Partial<SkillDraft> = { ...session.draft, ...(extraction.draft_patch ?? {}) };
  const missing = computeMissingFields(mergedDraft);
  const nextQuestion = missing.length > 0 ? buildQuestionForMissingField(missing[0], mergedDraft) : undefined;
  return {
    intent: "skill_creator",
    info_sufficient: missing.length === 0,
    confidence: extraction.confidence,
    summary: extraction.summary ?? defaultPlannerSummary(missing),
    draft: mergedDraft,
    next_question: nextQuestion,
    missing_fields: missing,
    warnings: extraction.warnings
  };
}

function defaultPlannerSummary(missing: SkillDraftField[]) {
  return missing.length === 0
    ? "Skill 草稿已经足够，可以生成预览。"
    : `我已记录当前信息，还需要补充：${missing.join(", ")}。`;
}

function buildQuestionForMissingField(field: SkillDraftField, draft: Partial<SkillDraft>): ChoicePayload {
  switch (field) {
    case "name":
      return {
        prompt: "这个 Skill 叫什么？",
        options: [
          { id: "name_prd", label: "PRD 总结助手", description: "整理产品文档和需求" },
          { id: "name_meeting", label: "会议行动项助手", description: "把会议记录整理成行动项" },
          { id: "name_review", label: "代码审查笔记助手", description: "把审查记录整理成结构化建议" }
        ],
        allowCustom: true
      };
    case "slug":
      return {
        prompt: `命令名用哪个？${draft.name ? `我可以根据「${draft.name}」生成一个短 slug。` : ""}`,
        options: [
          { id: "slug_prd-summarizer", label: "prd-summarizer" },
          { id: "slug_meeting-actions", label: "meeting-actions" },
          { id: "slug_review-notes", label: "review-notes" }
        ],
        allowCustom: true
      };
    case "description":
      return {
        prompt: "用一句话描述这个 Skill 的用途。",
        options: [
          { id: "desc_prd", label: "整理 PRD 摘要", description: "把产品文档整理为背景、目标、范围、风险和问题" },
          { id: "desc_meeting", label: "提取会议行动项", description: "从会议记录中提取负责人、事项和截止时间" },
          { id: "desc_review", label: "整理审查建议", description: "把代码审查内容整理为风险点和修复方向" }
        ],
        allowCustom: true
      };
    case "body":
      return {
        prompt: "这个 Skill 应该如何工作？描述输入、处理步骤、输出格式和边界即可。",
        options: [
          { id: "body_generate", label: "按我的描述生成", description: "让 LLM 生成一版完整 Skill 指令" },
          { id: "body_structured", label: "结构化输出", description: "要求输出固定章节和待确认问题" },
          { id: "body_concise", label: "简洁实用", description: "保持短指令，适合反复调用" }
        ],
        allowCustom: true
      };
  }
}

function plannerRecoveryChoice(): ChoicePayload {
  return {
    prompt: "我没能稳定生成 Skill 草稿。你想怎么继续？",
    options: [
      { id: "retry_short", label: "我重说一遍", description: "用更短的描述重新说明需求" },
      { id: "manual_fields", label: "手动补字段", description: "直接写 name / slug / description / body" },
      { id: "cancel", label: "取消", description: "放弃本次创建" }
    ],
    allowCustom: true,
    multiSelect: false
  };
}

function parsePlannerExtraction(input: unknown): SkillCreatorExtractionResult {
  const normalized = stripNulls(input);
  const result = skillCreatorExtractionResultSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(`Skill Creator 字段抽取结果校验失败：${result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  return result.data;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null) out[key] = stripNulls(v);
    }
    return out;
  }
  return value;
}

function resolvePlannerProvider() {
  const settings = getOrchestratorSettings();
  const envProvider = getEnvPlannerProvider();
  if (envProvider) return envProvider;
  if (settings.plannerProviderId) {
    return getDb().select().from(providers).where(eq(providers.id, settings.plannerProviderId)).get();
  }
  return null;
}

async function callAnthropicPlanner(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string
): Promise<SkillCreatorExtractionResult> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      tools: [anthropicPlannerToolDefinition()],
      tool_choice: { type: "tool", name: PLANNER_TOOL_NAME },
      messages: [{ role: "user", content: prompt }]
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Planner API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === PLANNER_TOOL_NAME);
  if (!toolUse) {
    console.error("[skill-creator] Planner returned no tool_use", { data });
    throw new Error("Planner 未返回结构化 tool 调用。");
  }
  return parsePlannerExtraction(toolUse.input);
}

async function callOpenAIPlanner(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string
): Promise<SkillCreatorExtractionResult> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ],
      tools: [{ type: "function", function: openAIPlannerToolDefinition() }],
      tool_choice: { type: "function", function: { name: PLANNER_TOOL_NAME } }
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Planner API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
  const toolCall = data.choices?.[0]?.message?.tool_calls?.find((call) => call.function?.name === PLANNER_TOOL_NAME);
  if (!toolCall?.function?.arguments) {
    console.error("[skill-creator] Planner returned no tool_call", { data });
    throw new Error("Planner 未返回结构化 tool 调用。");
  }

  try {
    return parsePlannerExtraction(JSON.parse(toolCall.function.arguments));
  } catch (error) {
    throw new Error(`Planner tool 参数解析失败：${(error as Error).message}`);
  }
}

export { skillDraftSchema, type SkillDraft };

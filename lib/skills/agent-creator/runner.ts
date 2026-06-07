import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agentInteractions, agentRuns, agents, conversations, messages, providers } from "@/lib/db/schema";
import { getEnvPlannerProvider, getOrchestratorSettings } from "@/lib/providers/service";
import { AGENT_CREATOR_SYSTEM_AGENT_ID } from "@/lib/db/seed";
import { publishConversationEvent } from "@/lib/conversations/stream-bus";
import { buildPlannerPrompt, buildPlannerSystemPrompt, confirmBuildChoice } from "@/lib/skills/agent-creator/prompts";
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
} from "@/lib/skills/agent-creator/state";
import type { AgentCreatorSession } from "@/lib/skills/agent-creator/state";
import {
  agentDraftSchema,
  plannerExtractionResultSchema,
  type AgentDraft,
  type AgentDraftField,
  type PlannerExtractionResult,
  type PlannerLLMResponse
} from "@/lib/skills/agent-creator/types";

type RunInput = {
  conversationId: string;
  userMessageId: string;
  text: string;
};

export type RunAgentCreatorResult =
  | { kind: "ignored"; reason: string }
  | { kind: "started"; session: AgentCreatorSession }
  | { kind: "info_sufficient_choice"; session: AgentCreatorSession; interactionId: string }
  | { kind: "collecting_choice"; session: AgentCreatorSession; interactionId: string }
  | { kind: "preview"; session: AgentCreatorSession }
  | { kind: "saved"; session: AgentCreatorSession; agentId: string }
  | { kind: "cancelled"; session: AgentCreatorSession }
  | { kind: "error"; session: AgentCreatorSession; error: string };

export async function runAgentCreator({
  conversationId,
  userMessageId,
  text
}: RunInput): Promise<RunAgentCreatorResult> {
  const conversation = getDb()
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();

  if (!conversation) {
    return { kind: "ignored", reason: "conversation not found" };
  }

  if (conversation.mode !== "single") {
    return { kind: "ignored", reason: "/agent-creator 仅在单聊中可用" };
  }

  if (text.trim().toLowerCase() === "/cancel") {
    const existing = getSession(conversationId);
    if (existing) {
      const cancelled = applyEvent(existing, { type: "USER_CANCELLED", reason: "user typed /cancel" });
      persistSession(cancelled);
      expirePendingInteraction(cancelled, "cancelled");
      return { kind: "cancelled", session: cancelled };
    }
    return { kind: "ignored", reason: "no active agent-creator session" };
  }

  let session = getSession(conversationId);

  if (!session) {
    session = createSession({ conversationId, userMessageId });
  } else {
    session = applyUserInput(session, text);
  }

  persistSession(session);
  console.info("[agent-creator] runAgentCreator start", { conversationId, state: session.state });

  // 把 user input 也写进 messages（仅在 collecting/confirm_build 阶段；preview/saving 不重复写）
  appendSessionUserMessage(session, userMessageId, text);

  publishSessionUpdate(session);

  return runPlannerRound(session);
}

export async function continueAgentCreatorAfterChoice({
  conversationId,
  interactionId,
  decision
}: {
  conversationId: string;
  interactionId: string;
  decision: { selectedOptionIds: string[]; customText?: string };
}): Promise<RunAgentCreatorResult> {
  const session = getSession(conversationId);
  console.info("[agent-creator] continue", {
    conversationId,
    interactionId,
    hasSession: Boolean(session),
    currentInteractionId: session?.currentInteractionId ?? null,
    state: session?.state ?? null
  });
  if (!session) {
    return { kind: "ignored", reason: "no active agent-creator session" };
  }

  if (session.currentInteractionId !== interactionId) {
    return { kind: "ignored", reason: "interaction is not the current agent-creator prompt" };
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

export async function confirmAgentCreatorSave(conversationId: string): Promise<RunAgentCreatorResult> {
  const session = getSession(conversationId);
  if (!session) {
    return { kind: "ignored", reason: "no active agent-creator session" };
  }

  if (session.state !== "preview") {
    return { kind: "ignored", reason: `cannot save from state=${session.state}` };
  }

  const missing = computeMissingFields(session.draft);
  if (missing.length > 0) {
    return { kind: "error", session, error: `字段不完整：${missing.join(", ")}` };
  }

  const parsed = agentDraftSchema.safeParse(session.draft);
  if (!parsed.success) {
    return { kind: "error", session, error: `草稿校验失败：${parsed.error.message}` };
  }

  const draft = parsed.data;
  const collision = getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.slug, draft.alias))
    .get();

  if (collision) {
    return { kind: "error", session, error: `alias "${draft.alias}" 已被占用，请换一个` };
  }

  // 进入 saving 状态，避免重复点击
  const saving: AgentCreatorSession = { ...session, state: "saving" };
  persistSession(saving);

  const now = Date.now();
  const newAgentId = crypto.randomUUID();
  getDb()
    .insert(agents)
    .values({
      id: newAgentId,
      slug: draft.alias,
      name: draft.name,
      platform: "claude_code",
      description: draft.description,
      enabled: true,
      isSystem: false,
      systemPrompt: draft.system_prompt,
      capabilities: JSON.stringify(draft.capabilities),
      avatarKind: "emoji",
      avatarValue: "🤖",
      permissionMode: draft.permission_mode,
      toolProfile: draft.tool_profile,
      createdAt: now,
      updatedAt: now
    })
    .run();

  appendSessionAssistantMessage(
    saving,
    `已创建自建 Agent \`${draft.alias}\`（${draft.display_name}）。\n后续可在 V3.4 / V3.5 把它加入群聊并基于 Claude Agent SDK 跑任务。`
  );

  const done: AgentCreatorSession = { ...saving, state: "done" };
  persistSession(done);
  publishSessionUpdate(done);
  // 保留 session 以便前端查询最近状态；几分钟后自动清理可后续扩展

  return { kind: "saved", session: done, agentId: newAgentId };
}

export async function regenerateAgentCreatorProfile(
  conversationId: string,
  instruction?: string
): Promise<RunAgentCreatorResult> {
  const session = getSession(conversationId);
  if (!session) {
    return { kind: "ignored", reason: "no active agent-creator session" };
  }
  const updated = applyRegenerate(session, instruction);
  persistSession(updated);
  return runPlannerRound(updated);
}

export function cancelAgentCreator(conversationId: string): AgentCreatorSession | null {
  const session = getSession(conversationId);
  if (!session) return null;
  const cancelled = applyEvent(session, { type: "USER_CANCELLED", reason: "user cancelled" });
  persistSession(cancelled);
  expirePendingInteraction(cancelled, "cancelled");
  publishSessionUpdate(cancelled);
  return cancelled;
}

export function discardAgentCreatorSession(conversationId: string) {
  clearSession(conversationId);
}

export function isAgentCreatorInteraction(agentId: string) {
  return agentId === AGENT_CREATOR_SYSTEM_AGENT_ID;
}

// === 内部辅助 ===

async function runPlannerRound(session: AgentCreatorSession): Promise<RunAgentCreatorResult> {
  try {
    const response = await callPlanner(session);
    const next = applyLLMResponse(session, response);
    persistSession(next);
    console.info("[agent-creator] planner responded", { conversationId: session.conversationId, state: next.state });

    if (next.state === "confirm_build") {
      const choice = confirmBuildChoice();
      const interactionId = writeChoiceInteraction(next, choice, "开始创建 / 再聊聊 / 取消");
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

    // 极端情况：collecting 但没 next_question
    return { kind: "error", session: next, error: "Planner 未返回 next_question 且未声明信息充足。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planner 调用失败。";
    console.error("[agent-creator] planner error", { conversationId: session.conversationId, error: message, stack: error instanceof Error ? error.stack : undefined });
    const fallback = plannerRecoveryChoice();
    const interactionId = writeChoiceInteraction(
      session,
      fallback,
      `Planner 暂时没能稳定抽取这次回复。你可以重试、改成更短的描述，或直接手动补充缺失字段。错误：${message}`
    );
    const withId = setCurrentInteraction(session, interactionId);
    persistSession(withId);
    return { kind: "collecting_choice", session: withId, interactionId };
  }
}

function writeChoiceInteraction(
  session: AgentCreatorSession,
  payload: { prompt: string; options: Array<{ id: string; label: string; description?: string }>; allowCustom?: boolean; multiSelect?: boolean },
  summary: string
) {
  const now = Date.now();
  const interactionId = crypto.randomUUID();
  const runId = ensureSyntheticRun(session, now);
  const messageId = ensurePreviewAnchorMessage(session, now);

  getDb()
    .insert(agentInteractions)
    .values({
      id: interactionId,
      kind: "choice",
      status: "pending",
      conversationId: session.conversationId,
      runId,
      messageId,
      agentId: AGENT_CREATOR_SYSTEM_AGENT_ID,
      conversationAgentId: null,
      orchestratorTaskId: null,
      payloadJson: JSON.stringify(payload),
      responseJson: null,
      createdAt: now,
      resolvedAt: null
    })
    .run();

  getDb()
    .update(agentRuns)
    .set({ status: "awaiting_interaction", updatedAt: now })
    .where(eq(agentRuns.id, runId))
    .run();

  appendSessionAssistantMessage(session, summary || payload.prompt);

  const interaction = {
    id: interactionId,
    kind: "choice" as const,
    status: "pending" as const,
    conversationId: session.conversationId,
    runId,
    messageId,
    agentId: AGENT_CREATOR_SYSTEM_AGENT_ID,
    conversationAgentId: null,
    orchestratorTaskId: null,
    payload,
    response: null,
    createdAt: now,
    resolvedAt: null
  };

  publishConversationEvent(session.conversationId, {
    type: "interaction_requested",
    interaction
  });
  publishConversationEvent(session.conversationId, {
    type: "run_status",
    runId,
    status: "awaiting_interaction"
  });
  publishSessionUpdate(session);

  return interactionId;
}

function ensureSyntheticRun(session: AgentCreatorSession, now: number) {
  // 简化：每次 Choice 用一个独立的合成 run，与一次"问题"对应。
  // 后续 confirm_build 也可以复用同一 run。
  const runId = crypto.randomUUID();
  getDb()
    .insert(agentRuns)
    .values({
      id: runId,
      conversationId: session.conversationId,
      agentId: AGENT_CREATOR_SYSTEM_AGENT_ID,
      conversationAgentId: null,
      status: "awaiting_interaction",
      startedAt: now,
      createdAt: now,
      updatedAt: now
    })
    .run();
  return runId;
}

function ensurePreviewAnchorMessage(session: AgentCreatorSession, now: number) {
  // 找到一个绑定到本次 user message 的"宿主" message（assistant 提示）。
  // 首版复用 userMessageId；后续可以让 assistant prompt 单独成一条 message。
  return session.userMessageId;
}

function appendSessionUserMessage(session: AgentCreatorSession, messageId: string, text: string) {
  // 占位：当前 Phase 不需要再写 user message（已由 messages API 写入）。
  // 保留 hook 以便后续如需"在预览卡里再嵌一段说明"时使用。
  void session;
  void messageId;
  void text;
}

function appendSessionAssistantMessage(session: AgentCreatorSession, content: string) {
  const now = Date.now();
  const messageId = crypto.randomUUID();
  getDb()
    .insert(messages)
    .values({
      id: messageId,
      conversationId: session.conversationId,
      role: "assistant",
      authorName: "Conflux Agent Creator",
      agentId: AGENT_CREATOR_SYSTEM_AGENT_ID,
      authorConversationAgentId: null,
      orchestratorTaskId: null,
      content,
      status: "done",
      createdAt: now
    })
    .run();

  getDb()
    .update(conversations)
    .set({ updatedAt: now })
    .where(eq(conversations.id, session.conversationId))
    .run();

  publishConversationEvent(session.conversationId, {
    type: "message_replace",
    messageId,
    content,
    status: "done"
  });
}

function expirePendingInteraction(session: AgentCreatorSession, status: "cancelled" | "expired") {
  if (!session.currentInteractionId) return;
  const now = Date.now();
  getDb()
    .update(agentInteractions)
    .set({ status, resolvedAt: now })
    .where(eq(agentInteractions.id, session.currentInteractionId))
    .run();
  publishConversationEvent(session.conversationId, {
    type: "interaction_resolved",
    interactionId: session.currentInteractionId,
    status
  });
}

function publishSessionUpdate(session: AgentCreatorSession) {
  // 在 idle 状态不发布（前端无需渲染）
  if (session.state === "idle") return;
  publishConversationEvent(session.conversationId, {
    type: "agent_creator_session",
    conversationId: session.conversationId,
    state: session.state,
    draft: session.draft,
    lastSummary: session.lastSummary
  });
}

const PLANNER_TOOL_NAME = "update_agent_draft";

const plannerToolInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "给用户看的简短进展摘要，最多 800 字。"
    },
    draft_patch: {
      type: "object",
      additionalProperties: false,
      description: "本轮能确定或修正的 AgentDraft 字段；拿不准的字段不要返回。",
      properties: {
        name: { type: "string" },
        alias: { type: "string" },
        display_name: { type: "string" },
        description: { type: "string" },
        system_prompt: { type: "string" },
        permission_mode: { type: "string", enum: ["readonly", "editable"] },
        capabilities: {
          type: "array",
          items: { type: "string" },
          maxItems: 8
        },
        tool_profile: { type: "string", enum: ["readonly", "code-author", "executor"] },
        provider_hint: {
          type: "object",
          additionalProperties: false,
          properties: {
            protocol: { type: "string", enum: ["anthropic"] },
            base_url_note: { type: "string" }
          }
        }
      }
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    warnings: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["summary", "draft_patch"]
} as const;

function anthropicPlannerToolDefinition() {
  return {
    name: PLANNER_TOOL_NAME,
    description: "抽取或更新 Conflux 自建 Agent 配置草稿字段。",
    input_schema: plannerToolInputSchema
  };
}

function openAIPlannerToolDefinition() {
  return {
    name: PLANNER_TOOL_NAME,
    description: "抽取或更新 Conflux 自建 Agent 配置草稿字段。",
    parameters: plannerToolInputSchema
  };
}

async function callPlanner(session: AgentCreatorSession): Promise<PlannerLLMResponse> {
  const provider = resolvePlannerProvider();
  if (!provider) {
    throw new Error("未配置 Planner Provider；请在 Orchestrator Settings 或环境变量中配置。");
  }

  const apiKey = Buffer.from(provider.apiKeyEncrypted, "base64").toString("utf8");
  const userInput = session.history.length
    ? session.history[session.history.length - 1].text
    : "(空)";

  const prompt = buildPlannerPrompt({
    partialDraft: session.draft,
    history: session.history,
    userInput,
    missingFields: computeMissingFields(session.draft)
  });
  const systemPrompt = buildPlannerSystemPrompt();

  const extraction = provider.protocol === "anthropic"
    ? await callAnthropicPlanner(provider.baseUrl, apiKey, provider.defaultModel, systemPrompt, prompt)
    : await callOpenAIPlanner(provider.baseUrl, apiKey, provider.defaultModel, systemPrompt, prompt);

  return buildPlannerResponseFromExtraction(session, extraction);
}

function buildPlannerResponseFromExtraction(
  session: AgentCreatorSession,
  extraction: PlannerExtractionResult
): PlannerLLMResponse {
  const mergedDraft: Partial<AgentDraft> = {
    ...session.draft,
    ...(extraction.draft_patch ?? {})
  };
  if (!mergedDraft.avatar) {
    mergedDraft.avatar = { kind: "emoji", value: "🤖" };
  }

  const missing = computeMissingFields(mergedDraft);
  const nextQuestion = missing.length > 0
    ? buildQuestionForMissingField(missing[0], mergedDraft)
    : undefined;

  return {
    intent: "agent_creator",
    info_sufficient: missing.length === 0,
    confidence: extraction.confidence,
    summary: extraction.summary ?? defaultPlannerSummary(missing),
    draft: mergedDraft,
    next_question: nextQuestion,
    missing_fields: missing,
    warnings: extraction.warnings
  };
}

function defaultPlannerSummary(missing: AgentDraftField[]) {
  if (missing.length === 0) {
    return "信息已经足够，可以生成 Agent 配置预览。";
  }
  return `我已记录当前信息，还需要补充：${missing.join(", ")}。`;
}

function buildQuestionForMissingField(
  field: AgentDraftField,
  draft: Partial<AgentDraft>
): { prompt: string; options: Array<{ id: string; label: string; description?: string }>; allowCustom?: boolean; multiSelect?: boolean } {
  switch (field) {
    case "name":
    case "display_name":
    case "alias":
      return {
        prompt: "这个 Agent 对外显示叫什么？也可以顺便给一个命令别名 alias。",
        options: [
          { id: "naming_code_review", label: "代码审查助手", description: "alias 可用 code-reviewer" },
          { id: "naming_doc_helper", label: "文档助手", description: "alias 可用 doc-helper" },
          { id: "naming_test_helper", label: "测试助手", description: "alias 可用 test-helper" }
        ],
        allowCustom: true
      };
    case "description":
      return {
        prompt: "用一句话描述这个 Agent 的职责范围。",
        options: [
          { id: "desc_review", label: "审查代码风险", description: "识别 PR / diff 里的 bug、回归风险和代码异味" },
          { id: "desc_author", label: "协助改代码", description: "根据需求修改代码、补测试和文档" },
          { id: "desc_docs", label: "整理项目知识", description: "阅读代码和文档，回答架构与实现问题" }
        ],
        allowCustom: true
      };
    case "system_prompt":
      return {
        prompt: "这个 Agent 应该遵循什么工作规则？可以直接粘贴完整 system prompt。",
        options: [
          { id: "prompt_readonly_review", label: "只读代码审查", description: "只分析风险和建议，不修改文件" },
          { id: "prompt_code_author", label: "代码修改助手", description: "可读写代码，改动后说明验证方式" },
          { id: "prompt_docs_helper", label: "文档问答助手", description: "基于项目内容回答问题并引用文件路径" }
        ],
        allowCustom: true
      };
    case "permission_mode":
    case "tool_profile":
      return {
        prompt: "这个 Agent 需要什么权限档位？",
        options: [
          { id: "profile_readonly", label: "只读", description: "读取、搜索、审查和答疑，不修改文件" },
          { id: "profile_code_author", label: "可改代码", description: "可以编辑文件、生成代码和文档" },
          { id: "profile_executor", label: "可执行命令", description: "可以跑测试、构建或脚本，后续会二次确认" }
        ],
        allowCustom: true
      };
    case "capabilities":
      return {
        prompt: "这个 Agent 的能力标签包含哪些？",
        options: [
          { id: "cap_review_core", label: "审查四项", description: "潜在 bug / 代码异味 / 回归风险 / 修复建议" },
          { id: "cap_author_core", label: "开发四项", description: "代码修改 / 测试补充 / 文档更新 / 验证说明" },
          { id: "cap_research_core", label: "研究三项", description: "代码检索 / 架构解释 / 方案比较" }
        ],
        allowCustom: true
      };
    case "avatar":
      return {
        prompt: "使用默认头像继续吗？",
        options: [
          { id: "avatar_default", label: "使用默认头像", description: "V3.2 暂时统一使用机器人头像" }
        ],
        allowCustom: false
      };
  }
}

function plannerRecoveryChoice() {
  return {
    prompt: "我没能稳定解析刚才的回复。你想怎么继续？",
    options: [
      { id: "retry_short", label: "我重说一遍", description: "用更短的描述重新补充关键信息" },
      { id: "manual_fields", label: "手动补字段", description: "直接写 name / alias / system_prompt / capabilities" },
      { id: "cancel", label: "取消", description: "放弃本次创建" }
    ],
    allowCustom: true,
    multiSelect: false
  };
}

function parsePlannerExtraction(input: unknown): PlannerExtractionResult {
  const normalized = stripNulls(input);
  const result = plannerExtractionResultSchema.safeParse(normalized);
  if (!result.success) {
    const issues = JSON.stringify(result.error.issues, null, 2);
    console.error("[agent-creator] Planner extraction schema mismatch", { input, issues });
    throw new Error(`Planner 字段抽取结果校验失败：${result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  return result.data;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;
      out[key] = stripNulls(v);
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
    return getDb()
      .select()
      .from(providers)
      .where(eq(providers.id, settings.plannerProviderId))
      .get();
  }
  return null;
}

async function callAnthropicPlanner(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string
): Promise<PlannerExtractionResult> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
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

  const data = (await response.json()) as {
    content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
  };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === PLANNER_TOOL_NAME);
  if (!toolUse) {
    console.error("[agent-creator] Planner returned no tool_use", { data });
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
): Promise<PlannerExtractionResult> {
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
      tools: [
        {
          type: "function",
          function: openAIPlannerToolDefinition()
        }
      ],
      tool_choice: {
        type: "function",
        function: { name: PLANNER_TOOL_NAME }
      }
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Planner API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  const toolCall = data.choices?.[0]?.message?.tool_calls?.find((call) => call.function?.name === PLANNER_TOOL_NAME);
  if (!toolCall?.function?.arguments) {
    console.error("[agent-creator] Planner returned no tool_call", { data });
    throw new Error("Planner 未返回结构化 tool 调用。");
  }

  try {
    return parsePlannerExtraction(JSON.parse(toolCall.function.arguments));
  } catch (error) {
    throw new Error(`Planner tool 参数解析失败：${(error as Error).message}`);
  }
}

export { agentDraftSchema, type AgentDraft };

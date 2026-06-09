import { z } from "zod";
import type { AgentSummary } from "@/lib/agents/types";
import {
  callAnthropicPlanner,
  callOpenAIPlanner,
  resolvePlannerProvider
} from "@/lib/agents/planner";
import { buildPlannerPrompt, buildPlannerSystemPrompt } from "@/lib/skills/agent-creator/prompts";
import { computeMissingFields } from "@/lib/skills/agent-creator/state";
import {
  agentDraftPartialSchema,
  type AgentDraftPartial
} from "@/lib/skills/agent-creator/types";

export const regenerateRequestSchema = z.object({
  instruction: z.string().max(500).optional()
});

export type RegenerateProfileRequest = z.infer<typeof regenerateRequestSchema>;

export type RegenerateProfileResponse = {
  draft: AgentDraftPartial;
  summary: string;
  warnings: string[];
};

export class RegenerateProfileError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function agentSummaryToPartialDraft(agent: AgentSummary): AgentDraftPartial {
  const draft: AgentDraftPartial = {};
  draft.name = agent.name;
  draft.alias = agent.slug;
  draft.display_name = agent.name;
  draft.description = agent.description;
  draft.system_prompt = agent.systemPrompt;
  draft.permission_mode = agent.permissionMode;
  draft.tool_profile = (agent.toolProfile ?? "readonly") as AgentDraftPartial["tool_profile"];
  if (agent.capabilities && agent.capabilities.length > 0) {
    draft.capabilities = agent.capabilities;
  }
  if (agent.avatarKind === "emoji" && agent.avatarValue) {
    draft.avatar = { kind: "emoji", value: "🤖" };
  }
  return draft;
}

export async function regenerateAgentProfile(
  agent: AgentSummary,
  request: RegenerateProfileRequest
): Promise<RegenerateProfileResponse> {
  const provider = resolvePlannerProvider();
  if (!provider) {
    throw new RegenerateProfileError(
      "未配置 Planner Provider；请在 Orchestrator Settings 或环境变量中配置。",
      503
    );
  }

  const apiKey = Buffer.from(provider.apiKeyEncrypted, "base64").toString("utf8");
  const partialDraft = agentSummaryToPartialDraft(agent);
  const prompt = buildPlannerPrompt({
    partialDraft,
    history: [],
    userInput: request.instruction?.trim() || "请基于当前字段重新生成 profile。",
    missingFields: computeMissingFields(partialDraft)
  });
  const systemPrompt = buildPlannerSystemPrompt();

  const extraction = provider.protocol === "anthropic"
    ? await callAnthropicPlanner(provider.baseUrl, apiKey, provider.defaultModel, systemPrompt, prompt)
    : await callOpenAIPlanner(provider.baseUrl, apiKey, provider.defaultModel, systemPrompt, prompt);

  const draftPatch = agentDraftPartialSchema.safeParse(extraction.draft_patch ?? {});
  if (!draftPatch.success) {
    throw new RegenerateProfileError(
      `Planner 抽取结果不符合 AgentDraft：${draftPatch.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      502
    );
  }

  return {
    draft: draftPatch.data,
    summary: extraction.summary ?? "已根据当前字段重新生成 profile。",
    warnings: extraction.warnings ?? []
  };
}

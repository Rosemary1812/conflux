import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { providers } from "@/lib/db/schema";
import { getEnvPlannerProvider, getOrchestratorSettings } from "@/lib/providers/service";
import { plannerExtractionResultSchema, type PlannerExtractionResult } from "@/lib/skills/agent-creator/types";

export const PLANNER_TOOL_NAME = "update_agent_draft";

export const plannerToolInputSchema = {
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

export function anthropicPlannerToolDefinition() {
  return {
    name: PLANNER_TOOL_NAME,
    description: "抽取或更新 Conflux 自建 Agent 配置草稿字段。",
    input_schema: plannerToolInputSchema
  };
}

export function openAIPlannerToolDefinition() {
  return {
    name: PLANNER_TOOL_NAME,
    description: "抽取或更新 Conflux 自建 Agent 配置草稿字段。",
    parameters: plannerToolInputSchema
  };
}

export function parsePlannerExtraction(input: unknown): PlannerExtractionResult {
  const normalized = stripNulls(input);
  const result = plannerExtractionResultSchema.safeParse(normalized);
  if (!result.success) {
    const issues = JSON.stringify(result.error.issues, null, 2);
    console.error("[agents/planner] Planner extraction schema mismatch", { input, issues });
    throw new Error(
      `Planner 字段抽取结果校验失败：${result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`
    );
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

export type ResolvedPlannerProvider = {
  baseUrl: string;
  apiKeyEncrypted: string;
  defaultModel: string;
  protocol: "anthropic" | "openai_compatible";
};

export function resolvePlannerProvider(): ResolvedPlannerProvider | null {
  const settings = getOrchestratorSettings();
  const envProvider = getEnvPlannerProvider();
  if (envProvider) return envProvider as ResolvedPlannerProvider;
  if (settings.plannerProviderId) {
    const row = getDb()
      .select()
      .from(providers)
      .where(eq(providers.id, settings.plannerProviderId))
      .get();
    if (row) {
      return {
        baseUrl: row.baseUrl,
        apiKeyEncrypted: row.apiKeyEncrypted,
        defaultModel: row.defaultModel,
        protocol: row.protocol as ResolvedPlannerProvider["protocol"]
      };
    }
  }
  return null;
}

export async function callAnthropicPlanner(
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
    console.error("[agents/planner] Planner returned no tool_use", { data });
    throw new Error("Planner 未返回结构化 tool 调用。");
  }
  return parsePlannerExtraction(toolUse.input);
}

export async function callOpenAIPlanner(
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
  const toolCall = data.choices?.[0]?.message?.tool_calls?.find(
    (call) => call.function?.name === PLANNER_TOOL_NAME
  );
  if (!toolCall?.function?.arguments) {
    console.error("[agents/planner] Planner returned no tool_call", { data });
    throw new Error("Planner 未返回结构化 tool 调用。");
  }

  try {
    return parsePlannerExtraction(JSON.parse(toolCall.function.arguments));
  } catch (error) {
    throw new Error(`Planner tool 参数解析失败：${(error as Error).message}`);
  }
}

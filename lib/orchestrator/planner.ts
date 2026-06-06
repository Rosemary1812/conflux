import { getOrchestratorSettings, getEnvPlannerProvider } from "@/lib/providers/service";
import type { OrchestratorContext, OrchestratorPlan, PlannerTask } from "./types";

const SYSTEM_PROMPT = `You are a planning assistant. Your job is to analyze user requests and produce a structured execution plan for a team of agents.

You must respond with a JSON object matching this schema:
{
  "phase": "clarify" | "execute" | "chat",
  "mode": "single_agent" | "parallel_investigation" | "compare" | "implement_review" | "pipeline",
  "goal": "string",
  "tasks": [
    {
      "id": "string",
      "assignee_alias": "string",
      "role": "string",
      "description": "string",
      "permission": "readonly" | "editable" | "restricted-editable" | undefined, // optional, defaults to readonly
      "depends_on": ["task_id"]
    }
  ],
  "clarification_questions": ["string"] | undefined
}

Rules:
1. phase="clarify" ONLY when the user request is ambiguous, missing critical info, or too vague to act on. Ask questions only when genuinely ambiguous. If the user says "直接做/开始/执行/go ahead" or similar, do NOT clarify; use phase="execute" with reasonable assumptions.
1.5. phase="chat" when the user is making small talk, asking general questions, greeting, or discussing the plan itself rather than requesting execution.
2. phase="execute" when the request is clear enough to dispatch.
3. mode="single_agent" for simple follow-ups or when only one agent is needed.
4. mode="parallel_investigation" when multiple agents can investigate different angles simultaneously.
5. mode="compare" when you want two agents to produce alternatives for comparison.
6. mode="implement_review" when one agent produces a deliverable and another reviews it. The implement agent MUST support approval interactions.
7. mode="pipeline" for sequential stages with dependencies.
8. Assign tasks ONLY to agents listed in the roster. Use their exact alias. Do NOT construct aliases by yourself.
9. Do NOT assign write/edit tasks to agents with supportsApproval="none".
10. Keep task descriptions concrete and actionable.
11. Tasks with depends_on must reference valid task ids within the same plan.
12. For single_agent mode, create exactly 1 task.
13. For implement_review, create exactly 2 tasks: implement (editable) and review (readonly), with review depending on implement.
14. For compare, create 2 parallel tasks with the same goal but different angles.
15. You are the orchestrator. Do NOT execute tasks yourself. Only plan and delegate.`;

function buildPlannerPrompt(context: OrchestratorContext, content: string): string {
  const rosterText = context.roster
    .map(
      (r) => `  - ${r.alias} (${r.displayName})
    capabilities: approval=${r.capabilities.supportsApproval}, choice=${r.capabilities.supportsChoice}
    status: ${r.status}`
    )
    .join("\n");

  const historyText = context.history
    .slice(-20)
    .map((h) => `  [${h.role}] ${h.alias ? `@${h.alias} ` : ""}${h.authorName || ""}: ${h.content.slice(0, 400)}`)
    .join("\n");

  return `## Roster
${rosterText}

## Conversation History (last ${Math.min(context.history.length, 20)} messages)
${historyText}

## New User Message
${content}

## Instruction
Analyze the user message in the context of the conversation history and roster. Produce your JSON plan.`;
}

export async function planOrchestratorRound(
  context: OrchestratorContext,
  content: string
): Promise<OrchestratorPlan> {
  const settings = getOrchestratorSettings();
  const envProvider = getEnvPlannerProvider();
  const db = (await import("@/lib/db/client")).getDb();
  const { providers } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  let provider = envProvider;
  if (settings.plannerProviderId && !provider) {
    const dbProvider = db.select().from(providers).where(eq(providers.id, settings.plannerProviderId)).get();
    if (dbProvider) {
      provider = dbProvider;
    }
  }

  if (!provider) {
    throw new Error("No planner provider configured. Set one in Orchestrator Settings or via ORCHESTRATOR_BASE_URL / ORCHESTRATOR_API_KEY / ORCHESTRATOR_MODEL env vars.");
  }

  const apiKey = Buffer.from(provider.apiKeyEncrypted, "base64").toString("utf8");
  const prompt = buildPlannerPrompt(context, content);

  let responseText: string;

  if (provider.protocol === "anthropic") {
    responseText = await callAnthropicPlanner(provider.baseUrl, apiKey, provider.defaultModel, prompt);
  } else {
    responseText = await callOpenAIPlanner(provider.baseUrl, apiKey, provider.defaultModel, prompt);
  }

  const parsed = extractJson(responseText);
  if (!parsed) {
    throw new Error(`Planner returned invalid JSON: ${responseText.slice(0, 500)}`);
  }

  return normalizePlan(parsed, context.roster.map((r) => r.alias));
}

async function callAnthropicPlanner(baseUrl: string, apiKey: string, model: string, prompt: string, customSystem?: string): Promise<string> {
  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    system: customSystem || SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }]
  });

  let response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body,
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (text.toLowerCase().includes("high risk") || response.status === 400) {
      console.warn(`[orchestrator] Planner API error ${response.status}, retrying once...`);
      response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body,
        signal: AbortSignal.timeout(60000)
      });
    }
    if (!response.ok) {
      const retryText = await response.text().catch(() => "");
      throw new Error(`Planner API error ${response.status}: ${retryText.slice(0, 300)}`);
    }
  }

  const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text || "";
  return text;
}

async function callOpenAIPlanner(baseUrl: string, apiKey: string, model: string, prompt: string, customSystem?: string): Promise<string> {
  const body = JSON.stringify({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: customSystem || SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ]
  });

  let response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body,
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (text.toLowerCase().includes("high risk") || response.status === 400) {
      console.warn(`[orchestrator] Planner API error ${response.status}, retrying once...`);
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body,
        signal: AbortSignal.timeout(60000)
      });
    }
    if (!response.ok) {
      const retryText = await response.text().catch(() => "");
      throw new Error(`Planner API error ${response.status}: ${retryText.slice(0, 300)}`);
    }
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || "";
}

function extractJson(text: string): unknown {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = codeBlock ? codeBlock[1] : text;
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function normalizePlan(raw: unknown, rosterAliases?: string[]): OrchestratorPlan {
  const obj = raw as Record<string, unknown>;
  const phase = ["clarify", "execute", "chat"].includes(String(obj.phase))
    ? (String(obj.phase) as OrchestratorPlan["phase"])
    : "execute";
  const mode = ["single_agent", "parallel_investigation", "compare", "implement_review", "pipeline"].includes(
    String(obj.mode)
  )
    ? (String(obj.mode) as OrchestratorPlan["mode"])
    : "single_agent";

  const tasks: PlannerTask[] = Array.isArray(obj.tasks)
    ? obj.tasks
        .map((t: unknown) => {
          const task = t as Record<string, unknown>;
          let assigneeAlias = String(task.assignee_alias || task.assigneeAlias || "");

          // B2: fuzzy match alias against roster
          if (rosterAliases && assigneeAlias) {
            const exact = rosterAliases.find((a) => a.toLowerCase() === assigneeAlias.toLowerCase());
            if (exact) {
              assigneeAlias = exact;
            } else {
              const candidates = new Set([
                assigneeAlias,
                assigneeAlias.toLowerCase(),
                assigneeAlias.replace(/_/g, "-"),
                assigneeAlias.replace(/-/g, "_"),
                assigneeAlias.toLowerCase().replace(/_/g, "-"),
                assigneeAlias.toLowerCase().replace(/-/g, "_")
              ]);
              const fuzzy = rosterAliases.find((a) => candidates.has(a) || candidates.has(a.toLowerCase()));
              if (fuzzy) {
                console.warn(
                  `[orchestrator] Fuzzy matched alias "${String(task.assignee_alias || task.assigneeAlias || "")}" to roster alias "${fuzzy}"`
                );
                assigneeAlias = fuzzy;
              }
            }
          }

          return {
            id: String(task.id || crypto.randomUUID()),
            assigneeAlias,
            role: String(task.role || "analyze"),
            description: String(task.description || ""),
            permission: ["readonly", "editable", "restricted-editable"].includes(String(task.permission))
              ? (String(task.permission) as PlannerTask["permission"])
              : "readonly",
            dependsOn: Array.isArray(task.depends_on) ? task.depends_on.map(String) : undefined
          };
        })
        .filter((t) => t.assigneeAlias && t.description)
    : [];

  return {
    phase,
    mode,
    goal: String(obj.goal || ""),
    tasks,
    clarificationQuestions: Array.isArray(obj.clarification_questions)
      ? obj.clarification_questions.map(String)
      : obj.clarification_question
        ? [String(obj.clarification_question)]
        : undefined
  };
}

const CHAT_SYSTEM_PROMPT = `You are a helpful planning assistant participating in a group chat. You can answer questions, discuss plans, and provide guidance. You do NOT execute tasks yourself. Keep responses concise and helpful.`;

export async function generateOrchestratorChat(context: OrchestratorContext, content: string): Promise<string> {
  const settings = getOrchestratorSettings();
  const envProvider = getEnvPlannerProvider();
  const db = (await import("@/lib/db/client")).getDb();
  const { providers } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  let provider = envProvider;
  if (settings.plannerProviderId && !provider) {
    const dbProvider = db.select().from(providers).where(eq(providers.id, settings.plannerProviderId)).get();
    if (dbProvider) {
      provider = dbProvider;
    }
  }

  if (!provider) {
    throw new Error("No planner provider configured.");
  }

  const apiKey = Buffer.from(provider.apiKeyEncrypted, "base64").toString("utf8");

  const rosterText = context.roster.map((r) => `  - ${r.alias} (${r.displayName})`).join("\n");

  const historyText = context.history
    .slice(-20)
    .map((h) => `  [${h.role}] ${h.alias ? `@${h.alias} ` : ""}${h.authorName || ""}: ${h.content.slice(0, 400)}`)
    .join("\n");

  const prompt = `## Roster\n${rosterText}\n\n## Conversation History (last ${Math.min(context.history.length, 20)} messages)\n${historyText}\n\n## New User Message\n${content}\n\nPlease provide a concise and helpful response.`;

  if (provider.protocol === "anthropic") {
    return callAnthropicPlanner(provider.baseUrl, apiKey, provider.defaultModel, prompt, CHAT_SYSTEM_PROMPT);
  }
  return callOpenAIPlanner(provider.baseUrl, apiKey, provider.defaultModel, prompt, CHAT_SYSTEM_PROMPT);
}

import { NextResponse } from "next/server";
import { getEnvPlannerProvider } from "@/lib/providers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const provider = getEnvPlannerProvider();

  if (!provider) {
    return NextResponse.json(
      {
        error:
          "未找到 Planner Provider。请在环境变量中设置 ORCHESTRATOR_BASE_URL、ORCHESTRATOR_API_KEY、ORCHESTRATOR_MODEL，或在设置页配置并选择 Provider。"
      },
      { status: 400 }
    );
  }

  const apiKey = Buffer.from(provider.apiKeyEncrypted, "base64").toString("utf8");

  const systemPrompt = `You are a planning assistant. Given a user request, break it into 1–3 sub-tasks and return ONLY a JSON object in this exact shape (no markdown, no extra text):
{"phase":"execute","mode":"parallel_investigation","tasks":[{"id":"task_1","assignee":"claude-code","description":"..."},{"id":"task_2","assignee":"codex","description":"..."}]}`;

  const userPrompt = "Implement a login page with email + password, connect to /api/auth, keep it MVP.";

  try {
    let response: Response;

    if (provider.protocol === "anthropic") {
      response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: provider.defaultModel,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          max_tokens: 512
        }),
        signal: AbortSignal.timeout(30000)
      }).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }) as Response);
    } else {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: provider.defaultModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0,
          max_tokens: 512
        }),
        signal: AbortSignal.timeout(30000)
      }).catch((error) => ({ ok: false, status: 0, text: async () => String(error) }) as Response);
    }

    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 480);
      const status = response.status > 0 ? `HTTP ${response.status}` : "请求失败";
      return NextResponse.json({ ok: false, message: text ? `${status}: ${text}` : status }, { status: 502 });
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    let content = "";

    if (provider.protocol === "anthropic") {
      const blocks = payload.content as Array<{ type: string; text?: string }> | undefined;
      content = blocks?.find((b) => b.type === "text")?.text ?? "";
    } else {
      const choices = payload.choices as Array<{ message?: { content?: string } }> | undefined;
      content = choices?.[0]?.message?.content ?? "";
    }

    const trimmed = content.trim();
    let parsed: unknown = null;

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      protocol: provider.protocol,
      model: provider.defaultModel,
      raw: trimmed,
      parsed
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "请求处理失败。" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { regenerateRequestSchema } from "@/lib/agents/edit-schema";
import { RegenerateProfileError, regenerateAgentProfile } from "@/lib/agents/regenerate";
import { getSelfBuiltAgentById, SelfBuiltAgentError } from "@/lib/conversations/service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = regenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")
      },
      { status: 400 }
    );
  }

  let agent;
  try {
    agent = getSelfBuiltAgentById(id);
  } catch (error) {
    if (error instanceof SelfBuiltAgentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载 Agent 失败" },
      { status: 500 }
    );
  }

  try {
    const result = await regenerateAgentProfile(agent, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RegenerateProfileError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新生成 profile 失败" },
      { status: 500 }
    );
  }
}

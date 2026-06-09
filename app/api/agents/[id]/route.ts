import { NextRequest, NextResponse } from "next/server";
import { agentUpdateSchema } from "@/lib/agents/edit-schema";
import {
  deleteSelfBuiltAgent,
  getSelfBuiltAgentById,
  SelfBuiltAgentError,
  updateSelfBuiltAgent
} from "@/lib/conversations/service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const agent = getSelfBuiltAgentById(id);
    return NextResponse.json({ agent });
  } catch (error) {
    if (error instanceof SelfBuiltAgentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "加载 Agent 失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const parsed = agentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") },
      { status: 400 }
    );
  }

  try {
    const agent = updateSelfBuiltAgent(id, parsed.data);
    return NextResponse.json({ agent });
  } catch (error) {
    if (error instanceof SelfBuiltAgentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新 Agent 失败" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = deleteSelfBuiltAgent(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SelfBuiltAgentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除 Agent 失败" },
      { status: 500 }
    );
  }
}


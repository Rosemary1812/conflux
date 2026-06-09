import { NextResponse } from "next/server";
import {
  precheckDeleteSelfBuiltAgent,
  SelfBuiltAgentError
} from "@/lib/conversations/service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const precheck = precheckDeleteSelfBuiltAgent(id);
    return NextResponse.json({ precheck });
  } catch (error) {
    if (error instanceof SelfBuiltAgentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "预检删除失败" },
      { status: 500 }
    );
  }
}

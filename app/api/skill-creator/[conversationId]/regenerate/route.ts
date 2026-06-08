import { NextResponse } from "next/server";
import { regenerateSkillCreator } from "@/lib/skills/skill-creator/runner";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { instruction?: string };
    const result = await regenerateSkillCreator(conversationId, body.instruction);
    if (result.kind === "ignored") {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }
    if (result.kind === "error") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重新生成失败。" },
      { status: 500 }
    );
  }
}

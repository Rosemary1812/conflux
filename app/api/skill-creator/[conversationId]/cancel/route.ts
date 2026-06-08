import { NextResponse } from "next/server";
import { cancelSkillCreator } from "@/lib/skills/skill-creator/runner";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const session = cancelSkillCreator(conversationId);
    if (!session) {
      return NextResponse.json({ cancelled: false, reason: "no active session" }, { status: 404 });
    }
    return NextResponse.json({ cancelled: true, state: session.state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "取消失败。" },
      { status: 500 }
    );
  }
}

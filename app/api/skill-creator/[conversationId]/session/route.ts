import { NextResponse } from "next/server";
import { getSession } from "@/lib/skills/skill-creator/state";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const session = getSession(conversationId);
    if (!session) {
      return NextResponse.json({ session: null });
    }
    return NextResponse.json({
      session: {
        conversationId: session.conversationId,
        state: session.state,
        draft: session.draft,
        lastSummary: session.lastSummary,
        currentInteractionId: session.currentInteractionId
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "查询失败。" },
      { status: 500 }
    );
  }
}

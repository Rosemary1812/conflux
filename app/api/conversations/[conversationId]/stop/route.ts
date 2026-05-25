import { NextResponse } from "next/server";
import { stopConversationRun } from "@/lib/conversations/runs";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const runId = stopConversationRun(conversationId);

  if (!runId) {
    return NextResponse.json({ ok: true, alreadyStopped: true });
  }

  return NextResponse.json({ ok: true, runId });
}

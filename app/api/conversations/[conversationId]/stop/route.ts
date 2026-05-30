import { NextResponse } from "next/server";
import { stopConversationRun } from "@/lib/conversations/runs";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    conversationAgentId?: string;
  };

  const result = stopConversationRun(conversationId, body.conversationAgentId);

  if (!result) {
    return NextResponse.json({ ok: true, alreadyStopped: true });
  }

  return NextResponse.json({ ok: true, runId: result.runId, taskId: result.taskId });
}

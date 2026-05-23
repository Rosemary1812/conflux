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
    return NextResponse.json({ error: "当前会话没有正在运行的任务。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, runId });
}

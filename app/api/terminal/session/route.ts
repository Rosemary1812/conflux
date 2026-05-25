import { NextResponse } from "next/server";
import { createTerminalSession } from "@/lib/terminal/websocket-server";
import { ApiError, getConversation } from "@/lib/conversations/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      conversationId?: string;
    };

    if (!body.conversationId) {
      throw new ApiError("缺少 conversationId。", 400);
    }

    getConversation(body.conversationId);

    return NextResponse.json(await createTerminalSession(body.conversationId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Terminal 会话创建失败。" },
    { status: 500 }
  );
}

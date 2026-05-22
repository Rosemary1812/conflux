import { NextResponse } from "next/server";
import { ApiError, sendMessage } from "@/lib/conversations/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { conversationId?: string; content?: string };

    if (!body.conversationId) {
      throw new ApiError("缺少 conversationId。", 400);
    }

    return NextResponse.json(sendMessage(body.conversationId, body.content ?? ""), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "请求处理失败。" }, { status: 500 });
}

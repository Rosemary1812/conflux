import { NextResponse } from "next/server";
import { ApiError, createConversation, listConversations } from "@/lib/conversations/service";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ conversations: listConversations() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { mode?: "single" | "group" };
    return NextResponse.json({ conversation: createConversation(body.mode ?? "single") }, { status: 201 });
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

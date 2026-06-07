import { NextResponse } from "next/server";
import { ApiError, createConversation, listConversations } from "@/lib/conversations/service";

export const runtime = "nodejs";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json({ conversations: listConversations({ q: searchParams.get("q") ?? undefined }) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: "single" | "group";
      workspacePath?: string;
    };
    return NextResponse.json({ conversation: createConversation(body) }, { status: 201 });
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

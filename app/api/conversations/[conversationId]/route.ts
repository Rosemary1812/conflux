import { NextResponse } from "next/server";
import { ApiError, deleteConversation, getConversation, updateConversation } from "@/lib/conversations/service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    return NextResponse.json({ conversation: getConversation(conversationId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      archived?: boolean;
      workspacePath?: string;
    };

    return NextResponse.json({ conversation: updateConversation(conversationId, body) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    deleteConversation(conversationId);
    return NextResponse.json({ ok: true });
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

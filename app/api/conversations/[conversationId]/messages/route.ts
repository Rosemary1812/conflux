import { NextResponse } from "next/server";
import { ApiError, listMessagesPaginated } from "@/lib/conversations/service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit")) || undefined;
    const beforeId = searchParams.get("beforeId") || undefined;

    const result = listMessagesPaginated(conversationId, { limit, beforeId });
    return NextResponse.json(result);
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

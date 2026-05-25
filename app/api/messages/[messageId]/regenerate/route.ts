import { NextResponse } from "next/server";
import { ApiError, regenerateMessage } from "@/lib/conversations/service";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ messageId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  try {
    const { messageId } = await context.params;
    return NextResponse.json(regenerateMessage(messageId), { status: 201 });
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

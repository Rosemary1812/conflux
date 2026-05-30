import { NextResponse } from "next/server";
import { deleteProvider, ProviderApiError, updateProvider } from "@/lib/providers/service";
import type { ProviderInput } from "@/lib/providers/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ providerId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { providerId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as ProviderInput;
    return NextResponse.json({ provider: updateProvider(providerId, body) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  try {
    const { providerId } = await context.params;
    deleteProvider(providerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown) {
  if (error instanceof ProviderApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: "请求处理失败。" }, { status: 500 });
}

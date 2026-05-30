import { NextResponse } from "next/server";
import { ProviderApiError, testProvider } from "@/lib/providers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ providerId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  try {
    const { providerId } = await context.params;
    const result = await testProvider(providerId);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
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

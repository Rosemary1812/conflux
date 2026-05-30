import { NextResponse } from "next/server";
import { createProvider, listProviders, ProviderApiError } from "@/lib/providers/service";
import type { ProviderInput } from "@/lib/providers/types";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ providers: listProviders() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ProviderInput;
    return NextResponse.json({ provider: createProvider(body) }, { status: 201 });
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

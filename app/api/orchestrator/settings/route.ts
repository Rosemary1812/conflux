import { NextResponse } from "next/server";
import {
  getOrchestratorSettings,
  ProviderApiError,
  updateOrchestratorSettings
} from "@/lib/providers/service";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ settings: getOrchestratorSettings() });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      plannerProviderId?: string | null;
    };
    return NextResponse.json({ settings: updateOrchestratorSettings(body) });
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

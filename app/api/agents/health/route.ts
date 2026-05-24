import { NextResponse } from "next/server";
import { listAdapters } from "@/lib/adapters/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const results = await Promise.all(
    listAdapters().map(async (adapter) => ({
      platform: adapter.platform,
      ...(await adapter.healthcheck())
    }))
  );

  return NextResponse.json({ health: results });
}

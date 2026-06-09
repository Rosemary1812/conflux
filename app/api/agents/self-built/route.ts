import { NextResponse } from "next/server";
import { listSelfBuiltAgents } from "@/lib/conversations/service";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ agents: listSelfBuiltAgents() });
}

import { NextResponse } from "next/server";
import { listAgents } from "@/lib/conversations/service";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ agents: listAgents() });
}

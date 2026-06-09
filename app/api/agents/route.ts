import { NextRequest, NextResponse } from "next/server";
import { listAvailableAgents } from "@/lib/conversations/service";
import type { ConversationMode } from "@/lib/conversations/types";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const rawMode = request.nextUrl.searchParams.get("conversationMode");
  const conversationMode: ConversationMode | undefined =
    rawMode === "single" || rawMode === "group" ? rawMode : undefined;
  return NextResponse.json({ agents: listAvailableAgents({ conversationMode }) });
}

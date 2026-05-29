import { NextResponse } from "next/server";
import { listConversationInteractions } from "@/lib/interactions/service";
import type { InteractionStatus } from "@/lib/interactions/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  return NextResponse.json({
    interactions: listConversationInteractions(
      conversationId,
      isInteractionStatus(status) ? status : undefined
    )
  });
}

function isInteractionStatus(value: string | null): value is InteractionStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "answered" ||
    value === "expired" ||
    value === "cancelled"
  );
}

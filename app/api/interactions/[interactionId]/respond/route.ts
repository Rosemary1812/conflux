import { NextResponse } from "next/server";
import { InteractionError, resolveInteraction } from "@/lib/interactions/service";
import type { InteractionDecision } from "@/lib/interactions/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ interactionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { interactionId } = await context.params;
    const body = (await request.json()) as InteractionDecision;

    validateDecision(body);

    return NextResponse.json({ interaction: resolveInteraction(interactionId, body) });
  } catch (error) {
    if (error instanceof InteractionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "处理交互回应失败。" }, { status: 500 });
  }
}

function validateDecision(value: InteractionDecision) {
  if (!value || typeof value !== "object") {
    throw new Error("回应不能为空。");
  }

  if (value.kind === "approval" && typeof value.approved === "boolean") {
    return;
  }

  if (value.kind === "choice" && Array.isArray(value.selectedOptionIds)) {
    return;
  }

  throw new Error("回应格式不正确。");
}

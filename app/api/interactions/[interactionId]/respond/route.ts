import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agentInteractions } from "@/lib/db/schema";
import { InteractionError, resolveInteraction } from "@/lib/interactions/service";
import { continueAgentCreatorAfterChoice, isAgentCreatorInteraction } from "@/lib/skills/agent-creator/runner";
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

    const row = getDb()
      .select()
      .from(agentInteractions)
      .where(eq(agentInteractions.id, interactionId))
      .get();

    if (!row) {
      return NextResponse.json({ error: "交互请求不存在。" }, { status: 404 });
    }

    if (isAgentCreatorInteraction(row.agentId)) {
      // /agent-creator 内部 Choice 卡：走专属 runner，避免污染 V1.5 run-bridge 流程
      if (body.kind !== "choice") {
        return NextResponse.json({ error: "Agent Creator 仅支持 choice 回应。" }, { status: 400 });
      }

      const result = await continueAgentCreatorAfterChoice({
        conversationId: row.conversationId,
        interactionId,
        decision: {
          selectedOptionIds: body.selectedOptionIds,
          customText: body.customText
        }
      });

      if (result.kind === "ignored") {
        return NextResponse.json({ error: result.reason }, { status: 409 });
      }
      if (result.kind === "error") {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }

      // 标 interaction 为 answered，模拟 V1.5 resolveInteraction 的副作用
      const now = Date.now();
      getDb()
        .update(agentInteractions)
        .set({
          status: "answered",
          responseJson: JSON.stringify(body),
          resolvedAt: now
        })
        .where(eq(agentInteractions.id, interactionId))
        .run();

      return NextResponse.json({
        interaction: {
          id: interactionId,
          status: "answered",
          response: body
        },
        result
      });
    }

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

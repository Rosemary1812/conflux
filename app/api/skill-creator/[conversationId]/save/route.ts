import { NextResponse } from "next/server";
import { confirmSkillCreatorSave } from "@/lib/skills/skill-creator/runner";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const result = await confirmSkillCreatorSave(conversationId);
    if (result.kind === "ignored" || result.kind === "error") {
      const status = result.kind === "error" ? 400 : 404;
      return NextResponse.json(
        { error: result.kind === "error" ? result.error : result.reason },
        { status }
      );
    }
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存失败。" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getSkills } from "@/lib/skills/registry";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ skills: getSkills() });
}

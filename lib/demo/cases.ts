import { caseGroup } from "@/lib/demo/fixtures/case-group";
import { caseSingle } from "@/lib/demo/fixtures/case-single";
import { caseSlash } from "@/lib/demo/fixtures/case-slash";
import type { DemoCase, DemoCaseId } from "@/lib/demo/types";

export type { DemoCaseId };

export const DEMO_CASES: Record<DemoCaseId, DemoCase> = {
  single: caseSingle,
  slash: caseSlash,
  group: caseGroup
};

export const DEMO_CASE_ORDER: DemoCaseId[] = ["single", "slash", "group"];

export const DEMO_CASE_LABELS: Record<DemoCaseId, string> = {
  single: "单聊",
  slash: "斜杠创建",
  group: "群聊协同"
};

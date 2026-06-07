export type SkillKind = "built-in" | "user";

export type SkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: SkillKind;
  version: number;
};

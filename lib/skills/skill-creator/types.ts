import { z } from "zod";

export const skillCreatorStateSchema = z.enum([
  "collecting",
  "confirm_build",
  "preview",
  "saving",
  "done",
  "cancelled"
]);
export type SkillCreatorState = z.infer<typeof skillCreatorStateSchema>;

export const skillSlugSchema = z
  .string()
  .min(2)
  .max(31)
  .regex(/^[a-z][a-z0-9-]{1,30}$/, "slug 只能包含小写字母、数字与短横线，且必须以字母开头");

export const skillDraftSchema = z.object({
  name: z.string().min(1).max(64),
  slug: skillSlugSchema,
  description: z.string().min(1).max(240),
  body: z.string().min(20).max(12000)
});
export type SkillDraft = z.infer<typeof skillDraftSchema>;

export const skillDraftPartialSchema = skillDraftSchema.partial();
export type SkillDraftPartial = z.infer<typeof skillDraftPartialSchema>;

export const skillDraftFieldSchema = z.enum(["name", "slug", "description", "body"]);
export type SkillDraftField = z.infer<typeof skillDraftFieldSchema>;

export const choiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional()
});

export const choicePayloadSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(choiceOptionSchema).min(1).max(8),
  allowCustom: z.boolean().optional(),
  multiSelect: z.boolean().optional()
});
export type ChoicePayload = z.infer<typeof choicePayloadSchema>;

export const skillCreatorExtractionResultSchema = z.object({
  summary: z.string().min(1).max(800).optional(),
  draft_patch: skillDraftPartialSchema.optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  warnings: z.array(z.string()).default([])
});
export type SkillCreatorExtractionResult = z.infer<typeof skillCreatorExtractionResultSchema>;

export const skillCreatorLLMResponseSchema = z.object({
  intent: z.literal("skill_creator").default("skill_creator"),
  info_sufficient: z.boolean(),
  confidence: z.number().min(0).max(1).default(0.5),
  summary: z.string().min(1).max(800),
  draft: skillDraftPartialSchema.optional(),
  next_question: choicePayloadSchema.optional(),
  missing_fields: z.array(skillDraftFieldSchema).default([]),
  warnings: z.array(z.string()).default([])
});
export type SkillCreatorLLMResponse = z.infer<typeof skillCreatorLLMResponseSchema>;

export const skillCreatorEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("USER_INPUT"),
    text: z.string().min(1),
    messageId: z.string()
  }),
  z.object({
    type: z.literal("CHOICE_RESPONDED"),
    interactionId: z.string(),
    selectedOptionIds: z.array(z.string()).default([]),
    customText: z.string().optional()
  }),
  z.object({
    type: z.literal("LLM_RESPONSE"),
    response: skillCreatorLLMResponseSchema
  }),
  z.object({ type: z.literal("USER_CANCELLED"), reason: z.string().optional() }),
  z.object({ type: z.literal("USER_REGENERATE"), instruction: z.string().optional() })
]);
export type SkillCreatorEvent = z.infer<typeof skillCreatorEventSchema>;

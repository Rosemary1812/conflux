import { z } from "zod";

export const agentCreatorStateSchema = z.enum([
  "idle",
  "collecting",
  "confirm_build",
  "preview",
  "saving",
  "done",
  "cancelled"
]);

export type AgentCreatorState = z.infer<typeof agentCreatorStateSchema>;

export const toolProfileSchema = z.enum(["readonly", "code-author", "executor"]);
export type ToolProfile = z.infer<typeof toolProfileSchema>;

export const permissionModeSchema = z.enum(["readonly", "editable"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const avatarSchema = z.object({
  kind: z.literal("emoji"),
  value: z.literal("🤖")
});
export type AgentAvatar = z.infer<typeof avatarSchema>;

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

export const agentDraftSchema = z.object({
  name: z.string().min(1).max(48),
  alias: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/, "alias 只能包含小写字母、数字与短横线"),
  display_name: z.string().min(1).max(48),
  description: z.string().min(1).max(240),
  system_prompt: z.string().min(1).max(8000),
  permission_mode: permissionModeSchema,
  capabilities: z.array(z.string().min(1).max(24)).max(8),
  tool_profile: toolProfileSchema,
  avatar: avatarSchema.default({ kind: "emoji", value: "🤖" }),
  provider_hint: z
    .object({
      protocol: z.literal("anthropic").optional(),
      base_url_note: z.string().optional()
    })
    .optional()
});
export type AgentDraft = z.infer<typeof agentDraftSchema>;

export const agentDraftPartialSchema = agentDraftSchema.partial();
export type AgentDraftPartial = z.infer<typeof agentDraftPartialSchema>;

export const agentDraftFieldSchema = z.enum([
  "name",
  "alias",
  "display_name",
  "description",
  "system_prompt",
  "permission_mode",
  "capabilities",
  "tool_profile",
  "avatar"
]);
export type AgentDraftField = z.infer<typeof agentDraftFieldSchema>;

export const plannerLLMResponseSchema = z.object({
  intent: z.literal("agent_creator").default("agent_creator"),
  info_sufficient: z.boolean(),
  confidence: z.number().min(0).max(1).default(0.5),
  summary: z.string().min(1).max(800),
  draft: agentDraftPartialSchema.optional(),
  next_question: choicePayloadSchema.optional(),
  missing_fields: z.array(agentDraftFieldSchema).default([]),
  warnings: z.array(z.string()).default([])
});
export type PlannerLLMResponse = z.infer<typeof plannerLLMResponseSchema>;

export const plannerExtractionResultSchema = z.object({
  summary: z.string().min(1).max(800).optional(),
  draft_patch: agentDraftPartialSchema.optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  warnings: z.array(z.string()).default([])
});
export type PlannerExtractionResult = z.infer<typeof plannerExtractionResultSchema>;

export const agentCreatorEventSchema = z.discriminatedUnion("type", [
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
    response: plannerLLMResponseSchema
  }),
  z.object({
    type: z.literal("USER_CONFIRMED")
  }),
  z.object({
    type: z.literal("USER_CANCELLED"),
    reason: z.string().optional()
  }),
  z.object({
    type: z.literal("USER_REGENERATE_PROFILE"),
    instruction: z.string().optional()
  })
]);
export type AgentCreatorEvent = z.infer<typeof agentCreatorEventSchema>;

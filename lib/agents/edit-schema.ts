import { z } from "zod";
import { avatarKindSchema, capabilitiesSchema } from "@/lib/agents/avatar-schema";
import { permissionModeSchema, toolProfileSchema } from "@/lib/skills/agent-creator/types";

const aliasSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, "alias 只能包含小写字母、数字与短横线，且以字母开头");

const nameSchema = z.string().min(1).max(48);
const descriptionSchema = z.string().min(1).max(240);
const systemPromptSchema = z.string().min(1).max(8000);

const absolutePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) => /^([a-zA-Z]:\\|\/)[^\x00]+$/.test(value),
    "上传头像必须传绝对路径。"
  );

export const agentUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    alias: aliasSchema.optional(),
    description: descriptionSchema.optional(),
    systemPrompt: systemPromptSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
    toolProfile: toolProfileSchema.optional(),
    capabilities: capabilitiesSchema.optional(),
    avatarKind: avatarKindSchema.optional(),
    avatarValue: z.string().min(1).max(1024).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "至少要改一个字段。")
  .refine(
    (value) => {
      if (!value.avatarKind || !value.avatarValue) return true;
      if (value.avatarKind === "system") {
        return false;
      }
      if (value.avatarKind === "emoji") {
        return value.avatarValue.length <= 8;
      }
      if (value.avatarKind === "uploaded") {
        return absolutePathSchema.safeParse(value.avatarValue).success;
      }
      return true;
    },
    "avatar 与 avatarKind 不匹配。"
  );

export type AgentUpdateRequest = z.infer<typeof agentUpdateSchema>;

export const regenerateRequestSchema = z.object({
  instruction: z.string().max(500).optional()
});

export type RegenerateProfileRequest = z.infer<typeof regenerateRequestSchema>;

import { z } from "zod";

export const avatarKindSchema = z.enum(["system", "emoji", "uploaded"]);

export const capabilitiesSchema = z
  .array(z.string().min(1).max(24))
  .max(8)
  .nullable();

export function parseCapabilitiesJson(raw: string | null | undefined, logLabel: string): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = capabilitiesSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[avatar-schema] invalid capabilities for ${logLabel}: ${result.error.message}`);
      return null;
    }
    return result.data;
  } catch (err) {
    console.warn(`[avatar-schema] capabilities JSON parse failed for ${logLabel}: ${(err as Error).message}`);
    return null;
  }
}

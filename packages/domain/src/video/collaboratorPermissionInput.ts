import { z } from "zod";
import { normalizeXId, isCanonicalXId } from "../xid/format.ts";
import { MAX_COLLABORATOR_PERMISSION_BATCH } from "./atomicLimits.ts";

/** Shared CURRENT/Hono collaborator permission request validation. */
const optionalXIdSchema = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => normalizeXId(value ?? ""))
  .refine((value) => !value || isCanonicalXId(value), {
    message: "X ID は英数字とアンダースコア20文字以内で入力してください。",
  });

const permissionXIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .transform((value) => normalizeXId(value))
  .refine((value) => isCanonicalXId(value), {
    message: "X ID は英数字とアンダースコア20文字以内で入力してください。",
  });

export const upsertSchema = z.object({
  video_id: z.string().trim().min(1).max(64),
  x_user_id: optionalXIdSchema,
  user_id: z.string().trim().max(128).optional().nullable(),
  display_name: z.string().trim().min(1).max(80),
  can_edit: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "1" || value === "true" || value === undefined),
  notify: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((value) => value === "1"),
});

const permissionIntentSchema = z.object({
  x_user_id: permissionXIdSchema,
  display_name: z.string().trim().min(1).max(80),
  intent: z.union([z.literal("on"), z.literal("off")]),
});

export const permissionBatchSchema = z.object({
  video_id: z.string().trim().min(1).max(64),
  edit_privilege_mode: z.enum(["normal", "admin", "event"]).optional(),
  notify: z.boolean().optional().default(true),
  intents: z
    .array(permissionIntentSchema)
    .min(1)
    .max(MAX_COLLABORATOR_PERMISSION_BATCH),
});


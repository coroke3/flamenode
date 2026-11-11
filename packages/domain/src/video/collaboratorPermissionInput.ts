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

export type CollaboratorPermissionIntent = {
  x_user_id: string;
  display_name: string;
  intent: "on" | "off";
};

/**
 * Post-alias-resolution intent selection shared by CURRENT and Hono.
 * Any aliases that resolve to the same canonical X ID must be rejected,
 * rather than silently selecting the first authorization mutation.
 */
export function prepareCollaboratorPermissionIntents(
  canonicalIntents: readonly CollaboratorPermissionIntent[],
):
  | { ok: true; intents: Map<string, { displayName: string; intent: "on" | "off" }> }
  | { ok: false; message: string } {
  const intents = new Map<string, { displayName: string; intent: "on" | "off" }>();
  const duplicateXids = new Set<string>();
  for (const item of canonicalIntents) {
    const xid = normalizeXId(item.x_user_id);
    if (!xid || !isCanonicalXId(xid)) {
      return { ok: false, message: "有効な X ID を指定してください。" };
    }
    if (intents.has(xid)) {
      duplicateXids.add(xid);
      continue;
    }
    intents.set(xid, {
      displayName: item.display_name.trim() || `@${xid}`,
      intent: item.intent,
    });
  }
  if (duplicateXids.size > 0) {
    return {
      ok: false,
      message: `同じ X ID の権限指定が重複しています: ${Array.from(duplicateXids)
        .map((xid) => `@${xid}`)
        .join("、")}`,
    };
  }
  return { ok: true, intents };
}

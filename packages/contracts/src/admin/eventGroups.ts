import { z } from "zod";

/**
 * MIG-0653 U03: SA-026/027 CURRENT event-group form contract.
 * Mirror src/lib/actions/event-group-admin.ts groupSchema. The schema only
 * validates data; it does NOT authorize a write, bypass visibility fences,
 * calculate queue rows or substitute for atomic audit mutations.
 *
 * CURRENT permits an optional id on create, a nullable base_updated_at (the
 * update action checks its presence against the fetched row), and trims the
 * string fields. Unknown properties are dropped by z.object like CURRENT.
 */
export const EventGroupMutationBodySchema = z.object({
  id: z.string().trim().optional(),
  base_updated_at: z.coerce.number().int().nonnegative().optional().nullable(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(64).regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "スラッグは小文字英数字とハイフンのみ",
  ),
  description: z.string().trim().max(2000).optional().nullable(),
  group_type: z.enum(["series", "genre", "related", "collection", "other"]).default("series"),
  icon_url: z.string().trim().max(500).optional().nullable(),
  img_url: z.string().trim().max(500).optional().nullable(),
  accent_color: z.string().trim().max(32).regex(
    /^$|^#[0-9a-fA-F]{3,8}$/,
    "アクセント色は #RRGGBB 形式",
  ).optional().nullable(),
  visibility_status: z.enum(["public", "private", "archived"]).default("public"),
  sort_order: z.coerce.number().int().min(-9999).max(9999).default(0).optional(),
});
export type EventGroupMutationBody = z.infer<typeof EventGroupMutationBodySchema>;

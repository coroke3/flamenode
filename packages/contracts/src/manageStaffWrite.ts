import { z } from "zod";

/**
 * MIG-0654 U01 — wire contract for CURRENT SA-031..034.
 * The URL owns eventId (and staffId for PUT/DELETE); these bodies preserve
 * CURRENT form field names. Do not use this DTO alone for authorization:
 * the Hono route must apply the domain X-ID parser, permission-key policy,
 * site-admin-only preset rule, and server-core atomic owner protection.
 *
 * Preset names mirror @flamenode/domain/auth/permissions/presets. The domain
 * package depends on contracts, so keep the comparison in a parity test
 * rather than creating a reverse package dependency.
 */
export const EventStaffPresetSchema = z.enum([
  "owner",
  "manager",
  "slot_manager",
  "content_editor",
  "reviewer",
  "xid_reviewer",
  "public_staff",
  "custom",
]);

const requiredReason = z.string().trim().min(1).max(500);
const optionalConfirmation = z.string().trim().optional().nullable();

/** POST .../staff and PUT .../staff/:staffId (CURRENT SA-031). */
export const EventStaffUpsertBodySchema = z.object({
  staff_id: z.string().trim().optional().nullable(),
  display_name: z.string().trim().min(1).max(80),
  // CURRENT accepts @handle and X/Twitter profile URLs. Normalize in the
  // route with @flamenode/domain/xid; a simple regex here would reject them.
  x_user_id: z.string().trim().min(1),
  permission_preset: EventStaffPresetSchema.default("public_staff"),
  permission_keys: z.string().trim().optional().nullable(),
  is_public: z.coerce.number().int().min(0).max(1).default(0),
  public_role_label: z.string().trim().max(40).optional().nullable(),
  reason: requiredReason,
  confirm_text: optionalConfirmation,
});
export type EventStaffUpsertBody = z.infer<typeof EventStaffUpsertBodySchema>;

/** POST .../staff/csv (CURRENT SA-032): max 100 rows, one atomic batch. */
export const EventStaffCsvRowSchema = z.object({
  lineNumber: z.number().int().positive(),
  display_name: z.string().trim().min(1).max(80),
  x_user_id: z.string().trim().min(1).max(64),
  permission_preset: EventStaffPresetSchema,
  permission_keys: z.array(z.string().trim().min(1).max(100)).max(64),
  is_public_staff: z.enum(["0", "1"]),
  public_role_label: z.string().trim().max(40),
});
export const EventStaffCsvBodySchema = z.object({
  reason: requiredReason,
  rows: z.array(EventStaffCsvRowSchema).min(1).max(100),
});
export type EventStaffCsvBody = z.infer<typeof EventStaffCsvBodySchema>;

/** DELETE .../staff/:staffId (CURRENT SA-033). */
export const EventStaffDeleteBodySchema = z.object({
  reason: requiredReason,
  confirm_text: optionalConfirmation,
});
export type EventStaffDeleteBody = z.infer<typeof EventStaffDeleteBodySchema>;

/** POST .../owner-transfer (CURRENT SA-034). */
export const EventOwnerTransferBodySchema = z.object({
  from_staff_id: z.string().trim().min(1),
  to_staff_id: z.string().trim().min(1),
  reason: requiredReason,
  confirm_text: z.string().trim().min(1),
  self_confirm_text: optionalConfirmation,
});
export type EventOwnerTransferBody = z.infer<typeof EventOwnerTransferBodySchema>;

/** CURRENT StaffActionResult: successful writes indicate pending public projection. */
export const EventStaffWriteResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    pendingPublicReflection: z.boolean().optional(),
    message: z.string().optional(),
  }),
  z.object({
    ok: z.literal(false),
    message: z.string(),
  }),
]);
export type EventStaffWriteResult = z.infer<typeof EventStaffWriteResultSchema>;

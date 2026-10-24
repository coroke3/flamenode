import { z } from "zod";

/**
 * Input and self-protection rules of the admin user commands SA-077..080
 * (moved from src/lib/actions/user-admin.ts). `actorUserId` is the acting
 * Auth User. The action keeps the admin guard, the target lookup, the
 * full-row CAS + strict audit, the notification cancellation DML and
 * revalidation.
 */

type Rejected = { ok: false; message: string };
type Entries = Record<string, unknown>;

function firstIssue(error: z.ZodError): Rejected {
  return { ok: false, message: error.issues[0]?.message ?? "入力エラー" };
}

const roleSchema = z.object({
  user_id: z.string().trim().min(1),
  role: z.enum(["user", "moderator", "admin"]),
});

/** SA-077: an admin cannot drop their own admin role. */
export function parseSetUserRoleInput(
  entries: Entries,
  actorUserId: string,
): { ok: true; user_id: string; role: "user" | "moderator" | "admin" } | Rejected {
  const parsed = roleSchema.safeParse(entries);
  if (!parsed.success) return firstIssue(parsed.error);
  const { user_id, role } = parsed.data;
  if (user_id === actorUserId && role !== "admin") {
    return { ok: false, message: "自分自身の管理者権限は解除できません。" };
  }
  return { ok: true, user_id, role };
}

const banSchema = z.object({
  user_id: z.string().trim().min(1),
  is_banned: z.coerce.number().int().min(0).max(1),
  reason: z.string().trim().max(500).optional().nullable(),
});

/** SA-078: no self-ban, a ban needs a reason, an unban without one is recorded as "BAN解除". */
export function parseSetUserBannedInput(
  entries: Entries,
  actorUserId: string,
): { ok: true; user_id: string; is_banned: number; auditReason: string | null } | Rejected {
  const parsed = banSchema.safeParse(entries);
  if (!parsed.success) return firstIssue(parsed.error);
  const { user_id, is_banned, reason } = parsed.data;
  if (user_id === actorUserId && is_banned === 1) {
    return { ok: false, message: "自分自身をBANにはできません。" };
  }
  if (is_banned === 1 && !reason) {
    return { ok: false, message: "BANには理由が必要です。" };
  }
  return { ok: true, user_id, is_banned, auditReason: reason || (is_banned === 0 ? "BAN解除" : null) };
}

const notifSchema = z.object({
  user_id: z.string().trim().min(1),
  is_notification_enabled: z.coerce.number().int().min(0).max(1),
});

/** SA-079 input. */
export function parseSetUserNotificationsInput(
  entries: Entries,
): { ok: true; user_id: string; is_notification_enabled: number } | Rejected {
  const parsed = notifSchema.safeParse(entries);
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true, ...parsed.data };
}

/** SA-079 audit reason: turning notifications off cancels the pending deliveries. */
export function userNotificationsAuditReason(disabling: boolean, pendingCount: number): string {
  return disabling
    ? `通知をOFFにし、未送信のpending通知${pendingCount}件をキャンセル`
    : "通知をONに変更";
}

const eventCreateSchema = z.object({
  user_id: z.string().trim().min(1),
  can_create_events: z.coerce.number().int().min(0).max(1),
});

/** SA-080 input. */
export function parseSetUserCanCreateEventsInput(
  entries: Entries,
): { ok: true; user_id: string; can_create_events: number } | Rejected {
  const parsed = eventCreateSchema.safeParse(entries);
  if (!parsed.success) return firstIssue(parsed.error);
  return { ok: true, ...parsed.data };
}

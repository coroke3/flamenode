import type { ServerCoreDb } from "../db.ts";
import { normalizeXId } from "@flamenode/domain/xid";
import { getApprovedLinkedXUserIds } from "../auth/approvedX.ts";
import { resolveCanonicalXUserResolutions } from "../xid/requestIdentity.ts";

export type PermissionSubjectResult =
  | { ok: true; xUserId: string }
  | { ok: false; message: string };

/**
 * SA-082 / SA-083 identity-selection contract, shared by CURRENT and future Hono.
 * This is NOT video.permissions authorization. Callers must check actor access
 * before invoking it, and must re-check mutation CAS inside the same D1 batch.
 */
export async function resolvePermissionSubjectXUserId(
  db: ServerCoreDb,
  xUserId: string | null,
  authUserId: string | null,
): Promise<PermissionSubjectResult> {
  if (xUserId) {
    // A supplied identity is a write target, not a new pending X account:
    // unknown/rejected/ambiguous aliases MUST fail closed.
    const normalized = normalizeXId(xUserId);
    const canonical = normalized
      ? (await resolveCanonicalXUserResolutions(db, [normalized])).get(normalized)?.value ?? null
      : null;
    if (!canonical) {
      return { ok: false, message: "指定した X ID を一意な正本として解決できません。" };
    }
    if (authUserId) {
      const approvedLinks = await getApprovedLinkedXUserIds(db, authUserId);
      if (!approvedLinks.includes(canonical)) {
        return { ok: false, message: "指定した認証ユーザーはその承認済み X ID に紐づいていません。" };
      }
    }
    return { ok: true, xUserId: canonical };
  }

  if (!authUserId) return { ok: false, message: "共同編集者の X ID が必要です。" };
  const linked = await getApprovedLinkedXUserIds(db, authUserId);
  if (linked.length === 0) {
    return { ok: false, message: "指定した認証ユーザーに承認済み X ID がありません。" };
  }
  if (linked.length > 1) {
    return { ok: false, message: "複数の X ID が紐づいているため、共同編集者の X ID を明示してください。" };
  }
  return { ok: true, xUserId: linked[0]! };
}

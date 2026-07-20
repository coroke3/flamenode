import "server-only";

import type { DB } from "@/lib/db/client";
import { normalizeXId } from "@/lib/utils/xid";
import { getLinkedXUsersForAuthUser } from "./xIdentity";

/**
 * users.active_x_user_id を x_user_account_links 上の承認済み X 名義だけに制限する。
 * 所有者の自動付与や DB 更新は行わない。
 */
export async function resolveActiveXUserId(
  db: DB,
  authUserId: string,
  currentActiveXUserId: string | null,
): Promise<string | null> {
  const normalizedCurrent = normalizeXId(currentActiveXUserId) || null;
  const linkedRows = await getLinkedXUsersForAuthUser(db, authUserId, {
    approvedOnly: true,
  });
  if (linkedRows.length === 0) return null;

  const linkedIds = new Set(linkedRows.map((row) => row.x_user_id));
  if (normalizedCurrent && linkedIds.has(normalizedCurrent)) {
    return normalizedCurrent;
  }

  return linkedIds.size === 1 ? linkedRows[0]?.x_user_id ?? null : null;
}

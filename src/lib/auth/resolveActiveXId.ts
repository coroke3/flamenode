import "server-only";

import type { DB } from "@/lib/db/client";
import { normalizeXId } from "@/lib/utils/xid";
import { getApprovedLinkedXUserIds } from "./approvedX";

export type ActiveXApprovedLinkedRow = {
  x_user_id: string;
  approval_status: string | null;
};

/**
 * users.active_x_user_id を x_user_account_links 上の承認済み X 名義だけに制限する。
 * 所有者の自動付与や DB 更新は行わない。
 */
export async function resolveActiveXUserId(
  db: DB,
  authUserId: string,
  currentActiveXUserId: string | null,
  approvedLinkedRows?: readonly ActiveXApprovedLinkedRow[],
): Promise<string | null> {
  const normalizedCurrent = normalizeXId(currentActiveXUserId) || null;
  // 呼び出し元から行を受け取る場合も、認可の正本である approval_status を
  // この境界で再確認する。比較キーは legacy の大文字/空白を許容して正規化し、
  // 戻り値は D1 の正本 ID 表記を維持する。同一名義の重複は1件に畳む。
  const linkedIds = new Map<string, string>();
  const linkedRawIds = approvedLinkedRows
    ? approvedLinkedRows
        .filter((row) => row.approval_status === "approved")
        .map((row) => row.x_user_id)
    : await getApprovedLinkedXUserIds(db, authUserId);
  const linkedValues = linkedRawIds
    .map((xUserId) => ({ raw: xUserId, normalized: normalizeXId(xUserId) }))
    .filter(
      (xUserId): xUserId is { raw: string; normalized: string } =>
        Boolean(xUserId.normalized),
    );
  for (const { raw, normalized } of linkedValues) {
    if (!linkedIds.has(normalized)) linkedIds.set(normalized, raw);
  }
  if (linkedIds.size === 0) return null;

  if (normalizedCurrent && linkedIds.has(normalizedCurrent)) {
    return linkedIds.get(normalizedCurrent) ?? null;
  }

  return linkedIds.size === 1 ? Array.from(linkedIds.values())[0] ?? null : null;
}

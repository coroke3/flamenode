import "server-only";

import { eq } from "drizzle-orm";
import { xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { normalizeXId } from "@/lib/utils/xid";
import { xIdApprovalRank } from "@/lib/xid/entries";

type LinkedXRow = {
  id: string;
  approval_status: string | null;
};

/**
 * users.active_x_user_id を連携済み・承認済み X ID の範囲で解決する。
 * 所有者の自動付与や DB 更新は行わない。明示的な連携・選択フローだけが
 * linked_user_id / active_x_user_id を変更できる。
 */
export async function resolveActiveXUserId(
  db: DB,
  userId: string,
  currentActive: string | null,
): Promise<string | null> {
  const normalizedCurrent = normalizeXId(currentActive) || null;
  const linkedRows = await db
    .select({
      id: xUsers.id,
      approval_status: xUsers.approval_status,
    })
    .from(xUsers)
    .where(eq(xUsers.linked_user_id, userId));

  if (linkedRows.length === 0) return null;

  const byId = new Map<string, LinkedXRow>();
  for (const row of linkedRows) {
    const id = normalizeXId(row.id);
    if (!id) continue;
    const existing = byId.get(id);
    if (
      !existing ||
      xIdApprovalRank(row.approval_status) <
        xIdApprovalRank(existing.approval_status)
    ) {
      byId.set(id, { id, approval_status: row.approval_status });
    }
  }

  if (
    normalizedCurrent &&
    byId.get(normalizedCurrent)?.approval_status === "approved"
  ) {
    return normalizedCurrent;
  }

  let approvedId: string | null = null;
  for (const row of byId.values()) {
    if (row.approval_status !== "approved") continue;
    if (approvedId) return null;
    approvedId = row.id;
  }
  return approvedId;
}

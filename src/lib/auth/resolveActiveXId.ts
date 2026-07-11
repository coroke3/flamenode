import "server-only";

import { eq, sql } from "drizzle-orm";
import { xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { normalizeXId } from "@/lib/utils/xid";

type LinkedXRow = {
  id: string;
  approval_status: string | null;
};

function approvalRank(status: string | null | undefined): number {
  if (status === "approved") return 0;
  if (status === "rejected") return 2;
  return 1;
}

function pickAutoActiveXId(rows: readonly LinkedXRow[]): string | null {
  const approved = rows.filter((row) => row.approval_status === "approved");
  if (approved.length === 1) {
    return normalizeXId(approved[0]!.id);
  }
  return null;
}

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

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

  if (normalizedCurrent) {
    const currentRow = (
      await db
        .select({
          id: xUsers.id,
          approval_status: xUsers.approval_status,
          linked_user_id: xUsers.linked_user_id,
        })
        .from(xUsers)
        .where(xUserIdMatches(normalizedCurrent))
        .limit(1)
    )[0];
    if (
      currentRow &&
      currentRow.approval_status === "approved" &&
      currentRow.linked_user_id === userId
    ) {
      return normalizeXId(currentRow.id);
    }
  }

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
      approvalRank(row.approval_status) < approvalRank(existing.approval_status)
    ) {
      byId.set(id, { id, approval_status: row.approval_status });
    }
  }

  if (normalizedCurrent) {
    const current = byId.get(normalizedCurrent);
    if (current && current.approval_status === "approved") {
      return normalizedCurrent;
    }
  }

  const autoPick = pickAutoActiveXId(Array.from(byId.values()));
  if (!autoPick) return null;

  return autoPick;
}

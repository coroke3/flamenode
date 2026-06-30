import "server-only";

import { eq, sql } from "drizzle-orm";
import { users, xUsers } from "@/lib/db/schema";
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
  const usable = rows.filter((row) => row.approval_status !== "rejected");
  if (usable.length === 0) return null;

  const approved = usable.filter((row) => row.approval_status === "approved");
  if (usable.length === 1) {
    return normalizeXId(usable[0]!.id);
  }
  if (approved.length === 1) {
    return normalizeXId(approved[0]!.id);
  }
  return null;
}

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

/**
 * users.active_x_user_id を、連携済み X ID から自動補完する。
 * 複数候補で一意に決まらない場合は DB を更新せず null を返す。
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
          linked_discord_user_id: xUsers.linked_discord_user_id,
        })
        .from(xUsers)
        .where(xUserIdMatches(normalizedCurrent))
        .limit(1)
    )[0];
    if (
      currentRow &&
      currentRow.approval_status !== "rejected" &&
      (!currentRow.linked_discord_user_id ||
        currentRow.linked_discord_user_id === userId)
    ) {
      if (!currentRow.linked_discord_user_id) {
        await db
          .update(xUsers)
          .set({ linked_discord_user_id: userId })
          .where(xUserIdMatches(normalizedCurrent));
      }
      return normalizeXId(currentRow.id);
    }
  }

  const linkedRows = await db
    .select({
      id: xUsers.id,
      approval_status: xUsers.approval_status,
    })
    .from(xUsers)
    .where(eq(xUsers.linked_discord_user_id, userId));

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
    if (current && current.approval_status !== "rejected") {
      return normalizedCurrent;
    }
  }

  const autoPick = pickAutoActiveXId(Array.from(byId.values()));
  if (!autoPick) return null;

  if (autoPick !== normalizedCurrent) {
    await db
      .update(users)
      .set({ active_x_user_id: autoPick })
      .where(eq(users.id, userId));
  }

  return autoPick;
}

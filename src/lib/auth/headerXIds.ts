import "server-only";

import { and, eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { xAccountLinkRequests, xUsers } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import type { HeaderXIdEntry } from "./headerUser";

function normalizeApprovalStatus(
  status: string | null | undefined,
): HeaderXIdEntry["approval_status"] {
  return status === "approved" || status === "rejected" ? status : "pending";
}

function approvalRank(status: HeaderXIdEntry["approval_status"]): number {
  return status === "approved" ? 0 : status === "pending" ? 1 : 2;
}

function fallbackName(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

/**
 * ヘッダー用: 内部user_idに明示連携済みの X ID と承認待ち申請だけを返す。
 * read pathでは未連携行を自動claimしない。
 */
export async function fetchHeaderXIdEntries(
  db: DB,
  userId: string,
  activeXId: string | null,
): Promise<HeaderXIdEntry[]> {
  const linkedRows = await db
    .select({
      x_user_id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      approval_status: xUsers.approval_status,
      linked_user_id: xUsers.linked_user_id,
    })
    .from(xUsers)
    .where(eq(xUsers.linked_user_id, userId));

  const byNormalizedXId = new Map<string, HeaderXIdEntry>();

  for (const row of linkedRows) {
    const normalizedId = normalizeXId(row.x_user_id);
    if (!normalizedId) continue;

    const approvalStatus = normalizeApprovalStatus(row.approval_status);
    const entry: HeaderXIdEntry = {
      x_user_id: normalizedId,
      x_name: fallbackName(row.x_name, `@${normalizedId}`),
      icon_url: row.icon_url,
      approval_status: approvalStatus,
      is_active: false,
    };
    const existing = byNormalizedXId.get(normalizedId);
    if (
      !existing ||
      approvalRank(entry.approval_status) < approvalRank(existing.approval_status)
    ) {
      byNormalizedXId.set(normalizedId, entry);
    }
  }

  const pendingRequests = await db
    .select({
      requested_x_id: xAccountLinkRequests.requested_x_id,
    })
    .from(xAccountLinkRequests)
    .where(
      and(
        eq(xAccountLinkRequests.user_id, userId),
        eq(xAccountLinkRequests.status, "pending"),
      )!,
    );

  for (const request of pendingRequests) {
    const normalizedId = normalizeXId(request.requested_x_id);
    if (!normalizedId || byNormalizedXId.has(normalizedId)) continue;
    byNormalizedXId.set(normalizedId, {
      x_user_id: normalizedId,
      x_name: `@${normalizedId}`,
      icon_url: null,
      approval_status: "pending",
      is_active: false,
    });
  }

  const entries = Array.from(byNormalizedXId.values());
  const withIconFallback = await resolveMissingIcons(
    db,
    entries.map((entry) => ({
      creator_x_user_id: entry.x_user_id,
      icon_url: entry.icon_url,
    })),
  );

  return entries.map((entry, index) => ({
    ...entry,
    icon_url: withIconFallback[index]?.icon_url ?? entry.icon_url,
  }));
}

export function applyActiveXIdToEntries(
  entries: readonly HeaderXIdEntry[],
  activeXId: string | null,
): HeaderXIdEntry[] {
  const normalizedActive = normalizeXId(activeXId) || null;
  return entries.map((entry) => ({
    ...entry,
    is_active:
      entry.approval_status !== "rejected" &&
      entry.x_user_id === normalizedActive,
  }));
}

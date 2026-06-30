import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { xAccountLinkRequests, xUsers } from "@/lib/db/schema";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { normalizeXId } from "@/lib/utils/xid";
import type { HeaderXIdEntry } from "./headerUser";

function xUserIdMatches(xUserId: string) {
  return sql`lower(${xUsers.id}) = ${normalizeXId(xUserId)}`;
}

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

function ownsXUserRow(
  row: { linked_discord_user_id: string | null },
  userId: string,
): boolean {
  return !row.linked_discord_user_id || row.linked_discord_user_id === userId;
}

/**
 * ヘッダー用: Discord に紐づく X ID、active 行、承認待ち申請をまとめて返す。
 * linked_discord_user_id 欠損時は active 行から自動修復する。
 */
export async function fetchHeaderXIdEntries(
  db: DB,
  userId: string,
  activeXId: string | null,
): Promise<HeaderXIdEntry[]> {
  const rowConditions = [eq(xUsers.linked_discord_user_id, userId)];
  if (activeXId) {
    rowConditions.push(xUserIdMatches(activeXId));
  }

  const linkedRows = await db
    .select({
      x_user_id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      approval_status: xUsers.approval_status,
      linked_discord_user_id: xUsers.linked_discord_user_id,
    })
    .from(xUsers)
    .where(rowConditions.length === 1 ? rowConditions[0] : or(...rowConditions)!);

  const byNormalizedXId = new Map<string, HeaderXIdEntry>();

  for (const row of linkedRows) {
    if (!ownsXUserRow(row, userId)) continue;

    const normalizedId = normalizeXId(row.x_user_id);
    if (!normalizedId) continue;

    if (!row.linked_discord_user_id) {
      await db
        .update(xUsers)
        .set({ linked_discord_user_id: userId })
        .where(xUserIdMatches(normalizedId));
    }

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
        eq(xAccountLinkRequests.discord_user_id, userId),
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

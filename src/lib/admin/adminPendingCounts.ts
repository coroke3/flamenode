import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  events as eventsTable,
  notificationOutbox as notificationOutboxTable,
  slots as slotsTable,
  videoModerationCases as videoModerationCasesTable,
  videoYoutubeMetadata as videoYoutubeMetadataTable,
  videos as videosTable,
  xIdentityRequests as xIdentityRequestsTable,
} from "@/lib/db/schema";
import { readAdminSystemSettings } from "@/lib/admin/adminSystemSettings";
import { resolveOperationMode } from "@/lib/operationMode/resolve";
import type { OperationMode } from "@/lib/operationMode/types";
import { acceptingEntriesWhere } from "@/lib/utils/eventStatus";

export type AdminPendingCounts = {
  pendingVideos: number;
  reservedOpenSlots: number;
  xLinkRequests: number;
  xMergeRequests: number;
  xMergeReverts: number;
  notificationFailed: number;
  notificationStuck: number;
  youtubeFailed: number;
  moderationOpen: number;
  moderationOverdue: number;
};

export const EMPTY_ADMIN_PENDING_COUNTS: AdminPendingCounts = {
  pendingVideos: 0,
  reservedOpenSlots: 0,
  xLinkRequests: 0,
  xMergeRequests: 0,
  xMergeReverts: 0,
  notificationFailed: 0,
  notificationStuck: 0,
  youtubeFailed: 0,
  moderationOpen: 0,
  moderationOverdue: 0,
};

export type AdminTopSnapshot = {
  counts: AdminPendingCounts;
  mode: OperationMode;
  isMaintenance: number;
};

export async function fetchAdminTopSnapshot(
  db: DB,
  now = Math.floor(Date.now() / 1000),
): Promise<AdminTopSnapshot> {
  const processingCutoff = now - 15 * 60;

  const [
    pendingVideos,
    reservedOpenSlots,
    xIdentityCounts,
    notificationCounts,
    youtubeFailed,
    moderationCounts,
    sys,
  ] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .where(eq(videosTable.visibility_status, "pending")),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(slotsTable)
      .innerJoin(eventsTable, eq(eventsTable.id, slotsTable.event_id))
      .where(
        and(
          eq(slotsTable.status, "reserved"),
          acceptingEntriesWhere(now),
        )!,
      ),
    db
      .select({
        xLinkRequests: sql<number>`SUM(CASE
          WHEN ${xIdentityRequestsTable.status} = 'pending'
            AND ${xIdentityRequestsTable.request_type} IN ('new_link','existing_link','alias')
          THEN 1 ELSE 0 END)`,
        xMergeRequests: sql<number>`SUM(CASE
          WHEN ${xIdentityRequestsTable.status} = 'pending'
            AND ${xIdentityRequestsTable.request_type} = 'merge'
          THEN 1 ELSE 0 END)`,
        xMergeReverts: sql<number>`SUM(CASE
          WHEN ${xIdentityRequestsTable.status} = 'pending'
            AND ${xIdentityRequestsTable.request_type} = 'revert_merge'
          THEN 1 ELSE 0 END)`,
      })
      .from(xIdentityRequestsTable)
      .where(
        and(
          eq(xIdentityRequestsTable.status, "pending"),
          inArray(xIdentityRequestsTable.request_type, [
            "new_link",
            "existing_link",
            "alias",
            "merge",
            "revert_merge",
          ]),
        )!,
      ),
    db
      .select({
        notificationFailed: sql<number>`SUM(CASE
          WHEN ${notificationOutboxTable.status} = 'failed' THEN 1 ELSE 0 END)`,
        notificationStuck: sql<number>`SUM(CASE
          WHEN ${notificationOutboxTable.status} = 'processing'
            AND ${notificationOutboxTable.processing_started_at} < ${processingCutoff}
          THEN 1 ELSE 0 END)`,
      })
      .from(notificationOutboxTable)
      .where(
        inArray(notificationOutboxTable.status, ["failed", "processing"]),
      ),
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoYoutubeMetadataTable)
      .where(eq(videoYoutubeMetadataTable.sync_status, "failed")),
    db
      .select({
        moderationOpen: sql<number>`SUM(CASE
          WHEN ${videoModerationCasesTable.status} = 'open' THEN 1 ELSE 0 END)`,
        moderationOverdue: sql<number>`SUM(CASE
          WHEN ${videoModerationCasesTable.status} = 'open'
            AND ${videoModerationCasesTable.due_at} < ${now}
          THEN 1 ELSE 0 END)`,
      })
      .from(videoModerationCasesTable)
      .where(eq(videoModerationCasesTable.status, "open")),
    readAdminSystemSettings(db),
  ]);

  const mode = resolveOperationMode(sys);
  return {
    counts: {
      pendingVideos: Number(pendingVideos[0]?.c ?? 0),
      reservedOpenSlots: Number(reservedOpenSlots[0]?.c ?? 0),
      xLinkRequests: Number(xIdentityCounts[0]?.xLinkRequests ?? 0),
      xMergeRequests: Number(xIdentityCounts[0]?.xMergeRequests ?? 0),
      xMergeReverts: Number(xIdentityCounts[0]?.xMergeReverts ?? 0),
      notificationFailed: Number(notificationCounts[0]?.notificationFailed ?? 0),
      notificationStuck: Number(notificationCounts[0]?.notificationStuck ?? 0),
      youtubeFailed: Number(youtubeFailed[0]?.c ?? 0),
      moderationOpen: Number(moderationCounts[0]?.moderationOpen ?? 0),
      moderationOverdue: Number(moderationCounts[0]?.moderationOverdue ?? 0),
    },
    mode,
    isMaintenance: mode === "maintenance" ? 1 : 0,
  };
}

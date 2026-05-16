import "server-only";

import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  events as eventsTable,
  slots as slotsTable,
  systemSettings,
  videoEvents as videoEventsTable,
  videos as videosTable,
} from "@/lib/db/schema";

export type HealthCheckResult = {
  id: string;
  label: string;
  status: "ok" | "warn";
  count: number;
  samples: string[];
  note?: string;
};

type AnyDb = LibSQLDatabase<any>;

/** system_settings が global 1 行であるか */
async function checkSystemSettingsSingleRow(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(systemSettings);
  const count = Number(rows[0]?.c ?? 0);
  return {
    id: "system_settings_single_row",
    label: "system_settings グローバル 1 行性",
    status: count === 1 ? "ok" : "warn",
    count,
    samples: [],
  };
}

/** videos.primary_event_id が video_events に対応行を持つか */
async function checkPrimaryEventSync(db: AnyDb): Promise<HealthCheckResult> {
  // primary_event_id が設定されているが video_events に存在しない
  const missingRows = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .leftJoin(
      videoEventsTable,
      and(
        eq(videoEventsTable.video_id, videosTable.id),
        eq(videoEventsTable.event_id, videosTable.primary_event_id!),
      ),
    )
    .where(
      and(
        isNotNull(videosTable.primary_event_id),
        isNull(videoEventsTable.video_id),
      ),
    )
    .limit(10);

  const count = missingRows.length;
  return {
    id: "primary_event_sync",
    label: "primary_event_id / video_events 同期",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: missingRows.slice(0, 5).map((r) => r.id),
  };
}

/** video_events の event_id が events に存在するか */
async function checkOrphanEventRef(db: AnyDb): Promise<HealthCheckResult> {
  const rows = await db
    .select({ video_id: videoEventsTable.video_id })
    .from(videoEventsTable)
    .leftJoin(eventsTable, eq(eventsTable.id, videoEventsTable.event_id))
    .where(isNull(eventsTable.id))
    .limit(10);
  const count = rows.length;
  return {
    id: "orphan_event_ref",
    label: "video_events.event_id 参照整合性",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => r.video_id),
  };
}

/** video_events の video_id が videos に存在するか */
async function checkOrphanVideoRef(db: AnyDb): Promise<HealthCheckResult> {
  const rows = await db
    .select({ video_id: videoEventsTable.video_id })
    .from(videoEventsTable)
    .leftJoin(videosTable, eq(videosTable.id, videoEventsTable.video_id))
    .where(isNull(videosTable.id))
    .limit(10);
  const count = rows.length;
  return {
    id: "orphan_video_ref",
    label: "video_events.video_id 参照整合性",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => r.video_id),
  };
}

/** available slot に video_id がある */
async function checkAvailableSlotWithVideo(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const rows = await db
    .select({ id: slotsTable.id })
    .from(slotsTable)
    .where(
      and(eq(slotsTable.status, "available"), isNotNull(slotsTable.video_id)),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "available_slot_with_video",
    label: "available スロットに video_id あり",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => r.id),
  };
}

/** submitted slot に video_id がない */
async function checkSubmittedSlotWithoutVideo(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const rows = await db
    .select({ id: slotsTable.id })
    .from(slotsTable)
    .where(
      and(eq(slotsTable.status, "submitted"), isNull(slotsTable.video_id)),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "submitted_slot_without_video",
    label: "submitted スロットに video_id なし",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => r.id),
  };
}

/** reservation_group_id 内に別ユーザー混在 */
async function checkReservationGroupUserMix(
  db: AnyDb,
): Promise<HealthCheckResult> {
  // 同一 reservation_group_id に x_user_id が複数いるグループ
  const rows = await db
    .select({ reservation_group_id: slotsTable.reservation_group_id })
    .from(slotsTable)
    .where(isNotNull(slotsTable.reservation_group_id))
    .groupBy(slotsTable.reservation_group_id)
    .having(sql`COUNT(DISTINCT ${slotsTable.x_user_id}) > 1`)
    .limit(10);
  const count = rows.length;
  return {
    id: "reservation_group_user_mix",
    label: "reservation_group_id 内に別ユーザー混在",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows
      .slice(0, 5)
      .map((r) => r.reservation_group_id ?? "(null)"),
  };
}

/** public 動画に youtube_video_id がない */
async function checkPublicVideoWithoutYoutubeId(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const rows = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(
      and(
        eq(videosTable.status, "public"),
        or(
          isNull(videosTable.youtube_video_id),
          eq(videosTable.youtube_video_id, ""),
        ),
      ),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "public_video_without_youtube_id",
    label: "public 動画に youtube_video_id なし",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => r.id),
  };
}

/** voided 動画が非削除・非非表示 */
async function checkVoidedVideoVisible(db: AnyDb): Promise<HealthCheckResult> {
  const rows = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(
      and(
        eq(videosTable.status, "voided"),
        eq(videosTable.is_deleted, 0),
        eq(videosTable.is_manual_hidden, 0),
      ),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "voided_video_visible",
    label: "voided 動画が is_deleted=0 かつ is_manual_hidden=0",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => r.id),
    note:
      "voided でも is_deleted/is_manual_hidden が立っていない行。表示制御を確認してください。",
  };
}

export async function runHealthChecks(db: AnyDb): Promise<HealthCheckResult[]> {
  // Opus判断候補: like_count 実数差分チェック (集計負荷・閾値設定要)
  // Opus判断候補: deprecated 項目への新規データ検出 (何を deprecated 扱いするか仕様確定要)
  // Opus判断候補: slot 時間重複チェック (連続枠の複雑な判断が必要)
  return Promise.all([
    checkSystemSettingsSingleRow(db),
    checkPrimaryEventSync(db),
    checkOrphanEventRef(db),
    checkOrphanVideoRef(db),
    checkAvailableSlotWithVideo(db),
    checkSubmittedSlotWithoutVideo(db),
    checkReservationGroupUserMix(db),
    checkPublicVideoWithoutYoutubeId(db),
    checkVoidedVideoVisible(db),
  ]);
}

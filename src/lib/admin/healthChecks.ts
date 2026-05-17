import "server-only";

import { and, eq, gte, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  events as eventsTable,
  slots as slotsTable,
  systemSettings,
  videoChapters as videoChaptersTable,
  videoComments as videoCommentsTable,
  videoEvents as videoEventsTable,
  videoInteractions as videoInteractionsTable,
  videos as videosTable,
} from "@/lib/db/schema";

export type HealthCheckResult = {
  id: string;
  label: string;
  status: "ok" | "warn" | "info";
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

/** slot 時間重複チェック (同一 event 内で slot_kind=time かつ start_time/end_time が重複) */
async function checkSlotTimeOverlap(db: AnyDb): Promise<HealthCheckResult> {
  // slot_kind=time かつ start_time/end_time が両方 non-null のスロットを取得
  const rows = await db
    .select({
      id: slotsTable.id,
      event_id: slotsTable.event_id,
      start_time: slotsTable.start_time,
      end_time: slotsTable.end_time,
      reservation_group_id: slotsTable.reservation_group_id,
    })
    .from(slotsTable)
    .where(
      and(
        eq(slotsTable.slot_kind, "time"),
        isNotNull(slotsTable.start_time),
        isNotNull(slotsTable.end_time),
      ),
    );

  // event_id ごとにグループ化
  const byEvent = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.event_id;
    let list = byEvent.get(key);
    if (!list) {
      list = [];
      byEvent.set(key, list);
    }
    list.push(row);
  }

  const overlapSamples: string[] = [];
  let overlapCount = 0;

  for (const [, slotList] of byEvent) {
    // start_time 昇順ソート (区間スイープラインで全ペア検出)
    slotList.sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));

    for (let i = 0; i < slotList.length; i++) {
      const cur = slotList[i];
      const curEnd = cur.end_time ?? 0;
      // cur.end_time より start_time が小さい後続スロットすべてと比較する。
      // 隣接比較だけだと「長い枠が後続の複数枠を覆う」ケースを取りこぼすので、
      // start_time が cur.end_time 以上になるまでループを進める。
      for (let j = i + 1; j < slotList.length; j++) {
        const next = slotList[j];
        const nextStart = next.start_time ?? 0;
        if (nextStart >= curEnd) break;

        // reservation_group_id が同じペアは連続枠として除外
        if (
          cur.reservation_group_id != null &&
          cur.reservation_group_id === next.reservation_group_id
        ) {
          continue;
        }

        overlapCount++;
        if (overlapSamples.length < 5) {
          overlapSamples.push(`${cur.id} / ${next.id}`);
        }
      }
    }
  }

  return {
    id: "slot_time_overlap",
    label: "スロット時間重複 (slot_kind=time)",
    status: overlapCount === 0 ? "ok" : "warn",
    count: overlapCount,
    samples: overlapSamples,
    note:
      overlapCount > 0
        ? "同一 event 内で時間が重複しているスロットペアがあります。reservation_group_id が異なるペアのみ検出。"
        : undefined,
  };
}

/** like_count 実数差分チェック */
const LIKE_COUNT_DRIFT_THRESHOLD = 5;

async function checkLikeCountDrift(db: AnyDb): Promise<HealthCheckResult> {
  // like_count >= 1 の videos を取得
  const videoRows = await db
    .select({ id: videosTable.id, like_count: videosTable.like_count })
    .from(videosTable)
    .where(gte(videosTable.like_count, 1));

  if (videoRows.length === 0) {
    return {
      id: "like_count_drift",
      label: "like_count 実数差分 (閾値 ±5)",
      status: "ok",
      count: 0,
      samples: [],
    };
  }

  // video_interactions から like 件数を group by video_id で取得
  const interactionRows = await db
    .select({
      video_id: videoInteractionsTable.video_id,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(videoInteractionsTable)
    .where(eq(videoInteractionsTable.interaction_type, "like"))
    .groupBy(videoInteractionsTable.video_id);

  // JS 側で video_id -> count のマップを作成
  const interactionMap = new Map<string, number>();
  for (const r of interactionRows) {
    interactionMap.set(r.video_id, Number(r.cnt));
  }

  const driftSamples: string[] = [];
  let driftCount = 0;

  for (const video of videoRows) {
    const actual = interactionMap.get(video.id) ?? 0;
    const stored = video.like_count ?? 0;
    if (Math.abs(stored - actual) >= LIKE_COUNT_DRIFT_THRESHOLD) {
      driftCount++;
      if (driftSamples.length < 5) {
        driftSamples.push(`video:${video.id} stored:${stored} actual:${actual}`);
      }
    }
  }

  return {
    id: "like_count_drift",
    label: `like_count 実数差分 (閾値 ±${LIKE_COUNT_DRIFT_THRESHOLD})`,
    status: driftCount === 0 ? "ok" : "warn",
    count: driftCount,
    samples: driftSamples,
    note:
      driftCount > 0
        ? "videos.like_count と video_interactions の実数が大きくズレている作品があります。"
        : undefined,
  };
}

/** deprecated: video_comments テーブルに新規データが入っていないか */
async function checkVideoCommentsLegacyRows(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(videoCommentsTable);
  const count = Number(rows[0]?.c ?? 0);
  return {
    id: "video_comments_legacy_rows",
    label: "video_comments 行数 (deprecated)",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: [],
    note:
      count > 0
        ? "video_comments は deprecated。新規利用は禁止。残行があれば移行/削除候補。"
        : undefined,
  };
}

/** deprecated: videos.outro_comment が non-null (closing_comment に統一済み) */
async function checkVideosOutroComment(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const rows = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(isNotNull(videosTable.outro_comment))
    .limit(10);
  const count = rows.length;
  return {
    id: "videos_outro_comment_legacy",
    label: "videos.outro_comment 残存行 (deprecated)",
    status: count === 0 ? "ok" : "info",
    count,
    samples: rows.slice(0, 5).map((r) => r.id),
    note:
      count > 0
        ? "outro_comment は closing_comment に統一済み。旧データは表示のみで、新規書き込みは行わない。"
        : undefined,
  };
}

/** deprecated: video_chapters.marker_kind != 'chapter' (MVPでは chapter 固定) */
async function checkChapterNonChapterMarker(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const rows = await db
    .select({ id: videoChaptersTable.id, marker_kind: videoChaptersTable.marker_kind })
    .from(videoChaptersTable)
    .where(
      and(
        isNotNull(videoChaptersTable.marker_kind),
        ne(videoChaptersTable.marker_kind, "chapter"),
      ),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "chapter_non_chapter_marker",
    label: "video_chapters.marker_kind != 'chapter' (旧データ)",
    status: count === 0 ? "ok" : "info",
    count,
    samples: rows.slice(0, 5).map((r) => `${r.id} (${r.marker_kind ?? "?"})`),
    note:
      count > 0
        ? "MVP は marker_kind=chapter 固定運用。旧データの comment/review/system は表示のみで、新規書き込みは chapter のみ。"
        : undefined,
  };
}

export async function runHealthChecks(db: AnyDb): Promise<HealthCheckResult[]> {
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
    checkSlotTimeOverlap(db),
    checkLikeCountDrift(db),
    checkVideoCommentsLegacyRows(db),
    checkVideosOutroComment(db),
    checkChapterNonChapterMarker(db),
  ]);
}

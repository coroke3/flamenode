import "server-only";

import { and, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  apiEndpoints as apiEndpointsTable,
  costUsageSnapshots as costUsageSnapshotsTable,
  events as eventsTable,
  historyLogs as historyLogsTable,
  notificationOutbox as notificationOutboxTable,
  slots as slotsTable,
  systemSettings,
  videoChapters as videoChaptersTable,
  videoEvents as videoEventsTable,
  videoInteractions as videoInteractionsTable,
  videoModerationCases as videoModerationCasesTable,
  videoStats,
  videoYoutubeMetadata as videoYoutubeMetadataTable,
  videos as videosTable,
  xIdMergeRequests as xIdMergeRequestsTable,
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
  // count は実数を返したいので COUNT(*) と LIMIT サンプルを分離する。
  const where = and(
    isNotNull(videosTable.primary_event_id),
    isNull(videoEventsTable.video_id),
  );
  const join = and(
    eq(videoEventsTable.video_id, videosTable.id),
    eq(videoEventsTable.event_id, videosTable.primary_event_id!),
  );
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .leftJoin(videoEventsTable, join)
      .where(where),
    db
      .select({ id: videosTable.id })
      .from(videosTable)
      .leftJoin(videoEventsTable, join)
      .where(where)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "primary_event_sync",
    label: "primary_event_id / video_events 同期",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
  };
}

/** video_events の event_id が events に存在するか */
async function checkOrphanEventRef(db: AnyDb): Promise<HealthCheckResult> {
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoEventsTable)
      .leftJoin(eventsTable, eq(eventsTable.id, videoEventsTable.event_id))
      .where(isNull(eventsTable.id)),
    db
      .select({ video_id: videoEventsTable.video_id })
      .from(videoEventsTable)
      .leftJoin(eventsTable, eq(eventsTable.id, videoEventsTable.event_id))
      .where(isNull(eventsTable.id))
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "orphan_event_ref",
    label: "video_events.event_id 参照整合性",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.video_id),
  };
}

/** video_events の video_id が videos に存在するか */
async function checkOrphanVideoRef(db: AnyDb): Promise<HealthCheckResult> {
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoEventsTable)
      .leftJoin(videosTable, eq(videosTable.id, videoEventsTable.video_id))
      .where(isNull(videosTable.id)),
    db
      .select({ video_id: videoEventsTable.video_id })
      .from(videoEventsTable)
      .leftJoin(videosTable, eq(videosTable.id, videoEventsTable.video_id))
      .where(isNull(videosTable.id))
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "orphan_video_ref",
    label: "video_events.video_id 参照整合性",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.video_id),
  };
}

/** available slot に video_id がある */
async function checkAvailableSlotWithVideo(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const where = and(
    eq(slotsTable.status, "available"),
    isNotNull(slotsTable.video_id),
  );
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(slotsTable).where(where),
    db.select({ id: slotsTable.id }).from(slotsTable).where(where).limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "available_slot_with_video",
    label: "available スロットに video_id あり",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
  };
}

/** submitted slot に video_id がない */
async function checkSubmittedSlotWithoutVideo(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const where = and(
    eq(slotsTable.status, "submitted"),
    isNull(slotsTable.video_id),
  );
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(slotsTable).where(where),
    db.select({ id: slotsTable.id }).from(slotsTable).where(where).limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "submitted_slot_without_video",
    label: "submitted スロットに video_id なし",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
  };
}

/** reservation_group_id 内に別ユーザー混在 */
async function checkReservationGroupUserMix(
  db: AnyDb,
): Promise<HealthCheckResult> {
  // 同一 reservation_group_id に Discord user または X ID が複数いるグループ。
  // count は混在グループの実数を返したいので、ノーリミットの中間結果から長さを取る。
  // (groupBy + HAVING を COUNT(*) でラップするには subquery が必要だが、混在は実運用で
  //  数十件以下に収まる想定のため、サンプル取得とは分けても合算でも変わらない。)
  const rows = await db
    .select({ reservation_group_id: slotsTable.reservation_group_id })
    .from(slotsTable)
    .where(isNotNull(slotsTable.reservation_group_id))
    .groupBy(slotsTable.reservation_group_id)
    .having(sql`
      COUNT(DISTINCT ${slotsTable.discord_user_id}) > 1
      OR COUNT(DISTINCT ${slotsTable.x_user_id}) > 1
    `);
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
  const where = and(
    eq(videosTable.visibility_status, "public"),
    or(
      isNull(videosTable.youtube_video_id),
      eq(videosTable.youtube_video_id, ""),
    ),
  );
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(videosTable).where(where),
    db.select({ id: videosTable.id }).from(videosTable).where(where).limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "public_video_without_youtube_id",
    label: "public 動画に youtube_video_id なし",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
  };
}

/** voided 動画が非削除・非非表示 */
async function checkVoidedVideoVisible(db: AnyDb): Promise<HealthCheckResult> {
  const where = eq(videosTable.visibility_status, "voided");
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(videosTable).where(where),
    db.select({ id: videosTable.id }).from(videosTable).where(where).limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "voided_video_visible",
    label: "voided videos (visibility_status=voided)",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
    note:
      "visibility_status=voided の動画です。公開導線から除外されているか確認してください。",
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
const LIKE_COUNT_DRIFT_ABS = 5;
const LIKE_COUNT_DRIFT_RATIO = 0.05;

async function checkLikeCountDrift(db: AnyDb): Promise<HealthCheckResult> {
  // like_count >= 1 の videos を取得
  const videoRows = await db
    .select({ id: videoStats.video_id, like_count: videoStats.app_like_count })
    .from(videoStats)
    .where(gte(videoStats.app_like_count, 1));

  if (videoRows.length === 0) {
    return {
      id: "like_count_drift",
      label: "like_count 実数差分 (閾値 max(±5, ±5%))",
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
    const absThreshold = LIKE_COUNT_DRIFT_ABS;
    const ratioThreshold = Math.ceil(actual * LIKE_COUNT_DRIFT_RATIO);
    const threshold = Math.max(absThreshold, ratioThreshold);
    const diff = Math.abs(stored - actual);
    if (diff >= threshold) {
      driftCount++;
      if (driftSamples.length < 5) {
        const triggeredBy =
          ratioThreshold >= absThreshold ? `ratio(${ratioThreshold})` : `abs(${absThreshold})`;
        driftSamples.push(
          `video:${video.id} stored:${stored} actual:${actual} diff:${diff} threshold:${threshold} [${triggeredBy}]`,
        );
      }
    }
  }

  return {
    id: "like_count_drift",
    label: "like_count 実数差分 (閾値 max(±5, ±5%))",
    status: driftCount === 0 ? "ok" : "warn",
    count: driftCount,
    samples: driftSamples,
    note:
      driftCount > 0
        ? "video_stats.app_like_count と video_interactions の実数が大きくズレている作品があります。"
        : undefined,
  };
}

/** videos に対応する video_stats が存在するか */
async function checkMissingVideoStats(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const where = isNull(videoStats.video_id);
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .leftJoin(videoStats, eq(videoStats.video_id, videosTable.id))
      .where(where),
    db
      .select({ id: videosTable.id })
      .from(videosTable)
      .leftJoin(videoStats, eq(videoStats.video_id, videosTable.id))
      .where(where)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "missing_video_stats",
    label: "video_stats 派生行不足",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
    note:
      count > 0
        ? "動画保存時の派生行作成漏れの可能性があります。ensureVideoDerivedRows 相当の処理で補完してください。"
        : undefined,
  };
}

/** videos に対応する video_youtube_metadata が存在するか */
async function checkMissingVideoYoutubeMetadata(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const where = isNull(videoYoutubeMetadataTable.video_id);
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videosTable)
      .leftJoin(
        videoYoutubeMetadataTable,
        eq(videoYoutubeMetadataTable.video_id, videosTable.id),
      )
      .where(where),
    db
      .select({ id: videosTable.id })
      .from(videosTable)
      .leftJoin(
        videoYoutubeMetadataTable,
        eq(videoYoutubeMetadataTable.video_id, videosTable.id),
      )
      .where(where)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "missing_video_youtube_metadata",
    label: "video_youtube_metadata 派生行不足",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
    note:
      count > 0
        ? "YouTube 同期状態の初期行がない作品があります。ensureVideoDerivedRows 相当の処理で pending 行を作成してください。"
        : undefined,
  };
}

/** deprecated: outro_comment は clean schema から削除済み */
async function checkVideosOutroComment(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const where = sql`0 = 1`;
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(videosTable).where(where),
    db.select({ id: videosTable.id }).from(videosTable).where(where).limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "videos_outro_comment_legacy",
    label: "outro_comment 削除済み確認",
    status: count === 0 ? "ok" : "info",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
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
  const where = and(
    isNotNull(videoChaptersTable.marker_kind),
    ne(videoChaptersTable.marker_kind, "chapter"),
  );
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(videoChaptersTable)
      .where(where),
    db
      .select({
        id: videoChaptersTable.id,
        marker_kind: videoChaptersTable.marker_kind,
      })
      .from(videoChaptersTable)
      .where(where)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "chapter_non_chapter_marker",
    label: "video_chapters.marker_kind != 'chapter' (旧データ)",
    status: count === 0 ? "ok" : "info",
    count,
    samples: sampleRows
      .slice(0, 5)
      .map((r) => `${r.id} (${r.marker_kind ?? "?"})`),
    note:
      count > 0
        ? "MVP は marker_kind=chapter 固定運用。旧データの comment/review/system は表示のみで、新規書き込みは chapter のみ。"
        : undefined,
  };
}

/** video_members.video_id が videos に存在するか (orphan) */
async function checkOrphanVideoMember(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(sql`video_members AS vm`)
      .where(sql`NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = vm.video_id)`),
    db
      .select({ id: sql<string>`vm.id`, video_id: sql<string>`vm.video_id` })
      .from(sql`video_members AS vm`)
      .where(sql`NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = vm.video_id)`)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "orphan_video_member",
    label: "video_members.video_id に対応する videos が無い (orphan)",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => `vm:${r.id} video:${r.video_id}`),
    note: count > 0 ? "video 削除時に video_members を残しています。" : undefined,
  };
}

/** video_members.chapters_json が valid JSON として保存されているか */
async function checkVideoMembersChaptersJsonInvalid(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const where = sql`chapters_json IS NOT NULL AND trim(chapters_json) <> '' AND json_valid(chapters_json) = 0`;
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(sql`video_members`).where(where),
    db
      .select({ id: sql<string>`id` })
      .from(sql`video_members`)
      .where(where)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "video_members_chapters_json_invalid",
    label: "video_members.chapters_json invalid JSON",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => r.id),
    note:
      count > 0
        ? "メンバー担当チャプターは video_members.chapters_json から生成します。JSON 形式を確認してください。"
        : undefined,
  };
}

/** notification_outbox の processing が固着していないか */
async function checkNotificationProcessingStuck(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 15 * 60;
  const where = and(
    eq(notificationOutboxTable.status, "processing"),
    isNotNull(notificationOutboxTable.processing_started_at),
    lt(notificationOutboxTable.processing_started_at, cutoff),
  );
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(notificationOutboxTable).where(where),
    db
      .select({
        id: notificationOutboxTable.id,
        processing_started_at: notificationOutboxTable.processing_started_at,
      })
      .from(notificationOutboxTable)
      .where(where)
      .orderBy(notificationOutboxTable.processing_started_at)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "notification_processing_stuck",
    label: "notification_outbox processing 固着",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows
      .slice(0, 5)
      .map((r) => `${r.id} (${r.processing_started_at ?? "?"})`),
    note:
      count > 0
        ? "Worker が処理中のまま戻せていない通知です。再送制御または手動キャンセルを確認してください。"
        : undefined,
  };
}

/** notification_outbox の failed が多すぎないか */
async function checkNotificationFailedVolume(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(notificationOutboxTable)
      .where(eq(notificationOutboxTable.status, "failed")),
    db
      .select({ id: notificationOutboxTable.id, type: notificationOutboxTable.type })
      .from(notificationOutboxTable)
      .where(eq(notificationOutboxTable.status, "failed"))
      .orderBy(desc(notificationOutboxTable.created_at))
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "notification_failed_volume",
    label: "notification_outbox failed 件数",
    status: count >= 20 ? "warn" : count > 0 ? "info" : "ok",
    count,
    samples: sampleRows.slice(0, 5).map((r) => `${r.id} (${r.type})`),
    note:
      count > 0
        ? "失敗通知は手動再送またはキャンセルし、古い failed は cleanup の TTL で削除します。"
        : undefined,
  };
}

/** cost_usage_snapshots の最新値が古すぎないか */
async function checkCostUsageSnapshotFreshness(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const latest = (
    await db
      .select({
        id: costUsageSnapshotsTable.id,
        captured_at: costUsageSnapshotsTable.captured_at,
        source: costUsageSnapshotsTable.source,
      })
      .from(costUsageSnapshotsTable)
      .orderBy(desc(costUsageSnapshotsTable.captured_at))
      .limit(1)
  )[0];
  if (!latest) {
    return {
      id: "cost_usage_snapshot_freshness",
      label: "cost_usage_snapshots 最新 snapshot",
      status: "info",
      count: 0,
      samples: [],
      note:
        "まだ usage snapshot がありません。Cloudflare API 未連携の場合は estimated_local の低頻度 snapshot から開始してください。",
    };
  }
  const now = Math.floor(Date.now() / 1000);
  const ageSec = now - latest.captured_at;
  return {
    id: "cost_usage_snapshot_freshness",
    label: "cost_usage_snapshots 最新 snapshot",
    status: ageSec > 24 * 3600 ? "warn" : ageSec > 6 * 3600 ? "info" : "ok",
    count: ageSec,
    samples: [`${latest.id} (${latest.source ?? "unknown"})`],
    note:
      ageSec > 6 * 3600
        ? "最新 snapshot が古くなっています。高頻度書き込みは避けつつ、1〜6時間程度の低頻度取得を推奨します。"
        : undefined,
  };
}

/** open の video_moderation_cases が期限切れになっていないか */
async function checkOpenModerationCasesOverdue(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const now = Math.floor(Date.now() / 1000);
  const where = and(
    eq(videoModerationCasesTable.status, "open"),
    isNotNull(videoModerationCasesTable.due_at),
    lt(videoModerationCasesTable.due_at, now),
  );
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(videoModerationCasesTable).where(where),
    db
      .select({
        id: videoModerationCasesTable.id,
        video_id: videoModerationCasesTable.video_id,
        due_at: videoModerationCasesTable.due_at,
      })
      .from(videoModerationCasesTable)
      .where(where)
      .orderBy(videoModerationCasesTable.due_at)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "open_moderation_cases_overdue",
    label: "未解決モデレーション期限切れ",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => `${r.id} video:${r.video_id}`),
    note:
      count > 0
        ? "期限切れの open case です。/admin/moderation で解決・却下・キャンセルしてください。"
        : undefined,
  };
}

/** 有効な api_endpoints が存在しない event を参照していないか */
async function checkActiveApiEndpointsOrphanEvent(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const where = and(eq(apiEndpointsTable.is_active, 1), isNull(eventsTable.id));
  const [countRows, sampleRows] = await Promise.all([
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(apiEndpointsTable)
      .leftJoin(eventsTable, eq(eventsTable.id, apiEndpointsTable.event_id))
      .where(where),
    db
      .select({ id: apiEndpointsTable.id, event_id: apiEndpointsTable.event_id })
      .from(apiEndpointsTable)
      .leftJoin(eventsTable, eq(eventsTable.id, apiEndpointsTable.event_id))
      .where(where)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "active_api_endpoints_orphan_event",
    label: "api_endpoints 有効 endpoint の event 参照",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows.slice(0, 5).map((r) => `${r.id} event:${r.event_id}`),
    note:
      count > 0
        ? "存在しない event を公開 API として有効化しています。無効化するか event_id を修正してください。"
        : undefined,
  };
}

/** x_id_merge_requests の pending が放置されていないか */
async function checkXIdMergePendingStale(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  const where = and(
    eq(xIdMergeRequestsTable.status, "pending"),
    lt(xIdMergeRequestsTable.created_at, cutoff),
  );
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(xIdMergeRequestsTable).where(where),
    db
      .select({
        id: xIdMergeRequestsTable.id,
        from_x_user_id: xIdMergeRequestsTable.from_x_user_id,
        to_x_user_id: xIdMergeRequestsTable.to_x_user_id,
      })
      .from(xIdMergeRequestsTable)
      .where(where)
      .orderBy(xIdMergeRequestsTable.created_at)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "x_id_merge_pending_stale",
    label: "X ID 統合申請 pending 放置",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: sampleRows
      .slice(0, 5)
      .map((r) => `${r.id} @${r.from_x_user_id} -> @${r.to_x_user_id}`),
    note:
      count > 0
        ? "危険操作のため自動実行せず、影響範囲を確認して承認・却下してください。"
        : undefined,
  };
}

/** history_logs の normal retention 対象件数 */
async function checkHistoryLogsRetentionCandidates(
  db: AnyDb,
): Promise<HealthCheckResult> {
  const settings = await db.select().from(systemSettings).limit(1);
  const days = Math.max(7, Number(settings[0]?.history_retention_days ?? 90) || 90);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const where = and(
    or(isNull(historyLogsTable.retention_class), eq(historyLogsTable.retention_class, "normal")),
    lt(historyLogsTable.created_at, cutoff),
  );
  const [countRows, sampleRows] = await Promise.all([
    db.select({ c: sql<number>`COUNT(*)` }).from(historyLogsTable).where(where),
    db
      .select({
        id: historyLogsTable.id,
        table_name: historyLogsTable.table_name,
        created_at: historyLogsTable.created_at,
      })
      .from(historyLogsTable)
      .where(where)
      .orderBy(historyLogsTable.created_at)
      .limit(10),
  ]);
  const count = Number(countRows[0]?.c ?? 0);
  return {
    id: "history_logs_retention_candidates",
    label: "history_logs normal retention 対象",
    status: count === 0 ? "ok" : "info",
    count,
    samples: sampleRows.slice(0, 5).map((r) => `${r.id} ${r.table_name}`),
    note:
      count > 0
        ? "normal 監査ログの削除候補です。cleanup Worker の retention 設定を確認してください。"
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
    checkMissingVideoStats(db),
    checkMissingVideoYoutubeMetadata(db),
    checkVideosOutroComment(db),
    checkChapterNonChapterMarker(db),
    checkOrphanVideoMember(db),
    checkVideoMembersChaptersJsonInvalid(db),
    checkNotificationProcessingStuck(db),
    checkNotificationFailedVolume(db),
    checkCostUsageSnapshotFreshness(db),
    checkOpenModerationCasesOverdue(db),
    checkActiveApiEndpointsOrphanEvent(db),
    checkXIdMergePendingStale(db),
    checkHistoryLogsRetentionCandidates(db),
  ]);
}

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  notLike,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { fetchVideoRowByIdOrYoutube } from "./videoIdLookup";
import {
  events,
  videoChapters,
  videoEvents,
  videoMembers,
  videos,
  xUsers,
} from "./schema";
import type { DB } from "./client";
import { uniqueBy } from "@/lib/utils/unique";
import { normalizeXId } from "@/lib/utils/xid";
import { approvedXIdsWhere } from "@/lib/auth/approvedX";
import { getEnv } from "@/lib/cloudflare";
import {
  eventPlaylistObjectKey,
  normalizeStaticEventPlaylist,
  type StaticEventPlaylistPayload,
} from "@/lib/publicData/staticEventPlaylistCore";
import {
  isPublicEntityVisibilityBlocked,
  resolvePublicVisibilityGuardModeFromEnv,
} from "@/lib/publicData/publicVisibilityManifest";
import {
  clampRelatedLimit,
  enforceDiversity,
  interleaveBuckets,
  perMemberLimit,
  uniqueByVideoId,
  type RelatedReason,
} from "./recommendation";
import { coalescedVideoScore } from "./videoScoreSql";
import { storedCreatorNameExpr } from "./displayExpr";
import { resolveMemberIcons, resolveMemberNames } from "./xIconResolution";

const videoScoreExpr = coalescedVideoScore;

/**
 * 作品詳細関連の集約クエリ。
 * Cloudflare D1 (SQLite) はネスト集約や CTE が制限的なので、複数クエリに分けてアプリ側で結合する。
 */

export interface VideoDetailViewer {
  /** Discord ID。未ログインなら null。 */
  id: string | null;
  /** role === "admin" は private チャプターも全件閲覧可。 */
  role: string | null;
  /** 自分が linked + approved な X ID 一覧。private チャプターの自己投稿判定に使う。 */
  approvedXIds: string[];
  /** 動画オーナー or chapter_admin 権限保持者は private チャプターを全件閲覧可。 */
  canEditChapters: boolean;
}

export interface AuthorizedPrivateVideoChapter {
  id: string;
  chapter_time: number;
  chapter_label: string;
  visibility: "private";
  note: string | null;
  x_user_id: string | null;
  author_name: string | null;
  author_icon: string | null;
}

/**
 * 公開動画詳細の静的JSONには private chapter を含めない。
 * この helper は、認証済み viewer に許可された private 行だけを
 * viewer overlay 用に読む。anonymous/未承認 viewer は空配列で早期終了する。
 */
export async function fetchAuthorizedPrivateVideoChapters(
  db: DB,
  videoId: string,
  viewer?: VideoDetailViewer,
): Promise<AuthorizedPrivateVideoChapter[]> {
  if (!viewer?.id) return [];

  const canSeeAllPrivate =
    viewer.role === "admin" || viewer.canEditChapters === true;
  const approvedXIds = viewer.approvedXIds ?? [];
  if (!canSeeAllPrivate && approvedXIds.length === 0) return [];

  const ownerCondition = canSeeAllPrivate
    ? eq(videoChapters.visibility, "private")
    : and(
        eq(videoChapters.visibility, "private"),
        // Keep the approved-link set in one JSON1 bind. A user can own many
        // approved X IDs; expanding them into an `IN (?, ...)` list would
        // cross D1's 100-bind limit and turn an otherwise optional overlay
        // into a page failure.
        sql`${videoChapters.x_user_id} IN (
          SELECT CAST(value AS TEXT)
          FROM json_each(${JSON.stringify(approvedXIds)})
        )`,
        // Re-check the canonical approval row in the same D1 statement so a
        // status change between the linked-ID read and this query fails closed.
        eq(xUsers.approval_status, "approved"),
      )!;

  return db
    .select({
      id: videoChapters.id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
      visibility: sql<"private">`'private'`,
      note: videoChapters.note,
      x_user_id: videoChapters.x_user_id,
      author_name: xUsers.x_name,
      author_icon: xUsers.icon_url,
    })
    .from(videoChapters)
    .leftJoin(xUsers, eq(xUsers.id, videoChapters.x_user_id))
    .where(
      and(
        eq(videoChapters.video_id, videoId),
        ownerCondition,
        // member/legacy chapters are rendered in their dedicated member
        // projection, never in the public chapter/comment timeline.
        notLike(videoChapters.id, "%:member:%"),
        notLike(videoChapters.id, "%:legacy:%"),
      )!,
    )
    .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id));
}

export async function fetchVideoDetail(
  db: DB,
  idOrYoutube: string,
  viewer?: VideoDetailViewer,
) {
  // 1) 作品本体 (内部 ID → miss 時のみ YouTube ID)
  const video = await fetchVideoRowByIdOrYoutube(db, idOrYoutube);
  if (!video) return null;

  // 2) 作者
  const creatorRows = video.creator_x_user_id
    ? await db
        .select()
        .from(xUsers)
        .where(eq(xUsers.id, video.creator_x_user_id))
        .limit(1)
    : [];
  const creator = creatorRows[0] ?? null;

  // 3) 所属イベント
  const eventRows = await db
    .select({
      id: events.id,
      title: events.title,
      icon_url: events.icon_url,
      accent_color: events.accent_color,
      start_time: events.start_time,
      end_time: events.end_time,
      visibility_status: events.visibility_status,
      entry_start_time: events.entry_start_time,
      entry_end_time: events.entry_end_time,
    })
    .from(videoEvents)
    .innerJoin(events, eq(videoEvents.event_id, events.id))
    .where(eq(videoEvents.video_id, video.id));

  // 4) 合作メンバー（代表表示は x_users.icon_url / x_users.x_name のみ）
  const rawMembers = await db
    .select({
      id: videoMembers.id,
      x_user_id: videoMembers.x_user_id,
      name: videoMembers.name,
      role: videoMembers.role,
      comment: videoMembers.comment,
      order_index: videoMembers.order_index,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
    })
    .from(videoMembers)
    .leftJoin(xUsers, eq(xUsers.id, videoMembers.x_user_id))
    .where(
      and(
        eq(videoMembers.video_id, video.id),
        // 公開ページでは is_public_member = 1 のメンバーのみ表示する。
        // 非公開編集者 (can_edit のためだけの video_members 行) は出さない。
        eq(videoMembers.is_public_member, 1),
      )!,
    )
    .orderBy(videoMembers.order_index);

  const membersWithIcons = await resolveMemberIcons(db, rawMembers);
  const members = await resolveMemberNames(db, membersWithIcons);

  // 5) チャプター。移行後の唯一の読み取り元は video_chapters。
  // 可視性ポリシー: public は全員可。private は admin / 動画オーナー (canEditChapters) /
  //                 投稿者本人 (approvedXIds に c.x_user_id を含む) のみ。
  const canSeeAllPrivate =
    viewer?.role === "admin" || viewer?.canEditChapters === true;
  const selfXIds = viewer?.approvedXIds ?? [];
  let chapterVisibilityCond;
  if (canSeeAllPrivate) {
    chapterVisibilityCond = undefined;
  } else if (selfXIds.length > 0) {
    chapterVisibilityCond = or(
      eq(videoChapters.visibility, "public"),
      and(
        eq(videoChapters.visibility, "private"),
        approvedXIdsWhere(videoChapters.x_user_id, selfXIds),
      ),
    )!;
  } else {
    chapterVisibilityCond = eq(videoChapters.visibility, "public");
  }
  const chapters = await db
    .select({
      id: videoChapters.id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
      visibility: videoChapters.visibility,
      note: videoChapters.note,
      x_user_id: videoChapters.x_user_id,
      author_name: xUsers.x_name,
      author_icon: xUsers.icon_url,
    })
    .from(videoChapters)
    .leftJoin(xUsers, eq(xUsers.id, videoChapters.x_user_id))
    .where(
      and(
        eq(videoChapters.video_id, video.id),
        chapterVisibilityCond ? chapterVisibilityCond : sql`1=1`,
      )!,
    )
    .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id));

  // 旧メンバー専用タブの返却形は移行期間中だけ空配列で維持する。
  // データ自体は migration で video_chapters へ展開済みであり、旧JSONは読まない。
  const memberChapters: Array<{
    id: string;
    video_member_id: string;
    chapter_time: number;
    chapter_label: string;
    note: string | null;
    order_index: number;
  }> = [];

  return {
    video,
    creator,
    events: eventRows,
    members,
    chapters,
    memberChapters,
  };
}

/**
 * 関連動画の取得 (bucket 混合版)。
 *
 * 最新順・スコア順の全体候補は混ぜず、現在の作品と明示的な接点がある
 * bucket だけを使う。reason は内部 result に保持するが、動画詳細 UI には
 * 表示しない (公開ページの「枠線で囲まれたタグ」が増えるのを避ける)。
 *
 *   - sameCreator: 同一 creator_x_user_id (max 2)
 *   - sameEvent: 同一 primary_event_id (max 3)
 *   - sharedMembers: video_members.x_user_id が現在動画のメンバーと一致 (max 2)
 *   - nearDate: scheduled_time が近い順 (max 3)
 *
 * 並び順は creator 連続を避けるため round-robin で interleave する。
 */
export interface RelatedVideoCardData {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  creator_x_user_id: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
  reason: RelatedReason;
}

export async function fetchRelatedVideos(
  db: DB,
  current: {
    id: string;
    creator_x_user_id: string | null;
    primary_event_id: string | null;
    scheduled_time?: number | null;
    eventIds?: string[];
  },
  limit = 18,
): Promise<RelatedVideoCardData[]> {
  const relatedLimit = clampRelatedLimit(limit);
  const minTarget = Math.min(15, relatedLimit);
  const sameEventLimit = relatedLimit >= 30 ? 8 : 5;
  const sameCreatorLimit = relatedLimit >= 30 ? 5 : 4;
  const nearDateLimit = relatedLimit >= 30 ? 6 : 4;
  const sharedLimit = relatedLimit >= 30 ? 12 : 8;

  const baseWhere = and(
    eq(videos.visibility_status, "public"),
    ne(videos.id, current.id),
  );
  const baseSelect = {
    id: videos.id,
    title: videos.title,
    youtube_video_id: videos.youtube_video_id,
    display_name: storedCreatorNameExpr,
    icon_url: videos.creator_icon_url,
    creator_x_user_id: videos.creator_x_user_id,
    primary_event_id: videos.primary_event_id,
    scheduled_time: videos.scheduled_time,
    video_score: videoScoreExpr,
  } as const;
  type Row = {
    id: string;
    title: string;
    youtube_video_id: string | null;
    display_name: string;
    icon_url: string | null;
    creator_x_user_id: string | null;
    primary_event_id: string | null;
    scheduled_time: number | null;
    video_score: number | null;
  };

  const toRelated = (
    candidate: { row: Row; reason: RelatedReason },
  ): RelatedVideoCardData => ({
    id: candidate.row.id,
    title: candidate.row.title,
    youtube_video_id: candidate.row.youtube_video_id,
    display_name: candidate.row.display_name,
    icon_url: candidate.row.icon_url,
    creator_x_user_id: candidate.row.creator_x_user_id,
    primary_event_id: candidate.row.primary_event_id,
    scheduled_time: candidate.row.scheduled_time,
    reason: candidate.reason,
  });

  const temporalPrevious: Row[] =
    current.scheduled_time != null
      ? await db
          .select(baseSelect)
          .from(videos)
          .where(
            and(
              baseWhere,
              isNotNull(videos.scheduled_time),
              lt(videos.scheduled_time, current.scheduled_time),
            )!,
          )
          .orderBy(desc(videos.scheduled_time), desc(videoScoreExpr))
          .limit(3)
      : [];

  const temporalNext: Row[] =
    current.scheduled_time != null
      ? await db
          .select(baseSelect)
          .from(videos)
          .where(
            and(
              baseWhere,
              isNotNull(videos.scheduled_time),
              gt(videos.scheduled_time, current.scheduled_time),
            )!,
          )
          .orderBy(asc(videos.scheduled_time), desc(videoScoreExpr))
          .limit(3)
      : [];

  const eventIds = Array.from(
    new Set(
      [...(current.eventIds ?? []), current.primary_event_id].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );

  const sameEvent: Row[] =
    eventIds.length > 0
      ? uniqueByVideoId(
          await db
            .select(baseSelect)
            .from(videos)
            .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
            .where(and(baseWhere, inArray(videoEvents.event_id, eventIds))!)
            .orderBy(desc(videos.scheduled_time), desc(videoScoreExpr))
            .limit(Math.min(24, sameEventLimit * 4)),
        )
      : [];

  const sameCreator: Row[] = current.creator_x_user_id
    ? await db
        .select(baseSelect)
        .from(videos)
        .where(and(baseWhere, eq(videos.creator_x_user_id, current.creator_x_user_id))!)
        .orderBy(desc(videos.scheduled_time), desc(videoScoreExpr))
        .limit(sameCreatorLimit)
    : [];

  const memberXIds = (
    await db
      .select({ x: videoMembers.x_user_id })
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, current.id),
          // 関連動画判定でも非公開編集者 (is_public_member=0) は除外する。
          // 非公開編集者は「メンバーが共通」概念には含めない。
          eq(videoMembers.is_public_member, 1),
        )!,
      )
  )
    .map((row) => normalizeXId(row.x))
    .filter((id): id is string => Boolean(id));
  const uniqueMemberXIds = Array.from(new Set(memberXIds));
  const memberLimit = perMemberLimit(uniqueMemberXIds.length);
  const sharedMemberIdsWhere =
    uniqueMemberXIds.length <= 80
      ? inArray(
          sql<string>`LOWER(${videoMembers.x_user_id})`,
          uniqueMemberXIds,
        )
      : sql`EXISTS (
          SELECT 1
          FROM json_each(${JSON.stringify(uniqueMemberXIds)}) AS related_member_x_ids
          WHERE CAST(related_member_x_ids.value AS TEXT) = LOWER(${videoMembers.x_user_id})
        )`;
  const sharedMembers: Row[] =
    uniqueMemberXIds.length > 0
      ? await db
          .select({
            ...baseSelect,
            member_x_user_id: videoMembers.x_user_id,
          })
          .from(videoMembers)
          .innerJoin(videos, eq(videos.id, videoMembers.video_id))
          .where(
            and(
              baseWhere,
              isNotNull(videoMembers.x_user_id),
              sharedMemberIdsWhere,
            )!,
          )
          .orderBy(desc(videos.scheduled_time), desc(videoScoreExpr))
          .limit(30)
          .then((rows) => {
            const byMember = new Map<string, (Row & { member_x_user_id: string | null })[]>();
            for (const row of rows) {
              const key = normalizeXId(row.member_x_user_id);
              if (!key) continue;
              const bucket = byMember.get(key) ?? [];
              if (!bucket.some((item) => item.id === row.id)) bucket.push(row);
              byMember.set(key, bucket);
            }

            const mixed: Row[] = [];
            const seen = new Set<string>();
            for (let i = 0; i < memberLimit; i++) {
              for (const memberId of uniqueMemberXIds) {
                const row = byMember.get(memberId)?.[i];
                if (!row || seen.has(row.id)) continue;
                seen.add(row.id);
                mixed.push(row);
                if (mixed.length >= 30) return mixed;
              }
            }
            return mixed;
          })
      : [];

  // `ORDER BY ABS(scheduled_time - ?)` forces SQLite to evaluate and sort the
  // full public-video candidate set. Split the search into two bounded range
  // scans so the existing `(visibility_status, scheduled_time)` indexes can
  // stop after a small number of rows on each side of the current video.
  const targetScheduledTime = current.scheduled_time;
  const nearDateCandidateLimit = Math.min(16, nearDateLimit * 3);
  const nearDate: Row[] =
    targetScheduledTime == null
      ? []
      : await Promise.all([
          db
            .select(baseSelect)
            .from(videos)
            .where(
              and(
                baseWhere,
                isNotNull(videos.scheduled_time),
                lte(videos.scheduled_time, targetScheduledTime),
              )!,
            )
            .orderBy(desc(videos.scheduled_time), desc(videoScoreExpr))
            .limit(nearDateCandidateLimit),
          db
            .select(baseSelect)
            .from(videos)
            .where(
              and(
                baseWhere,
                isNotNull(videos.scheduled_time),
                gt(videos.scheduled_time, targetScheduledTime),
              )!,
            )
            .orderBy(asc(videos.scheduled_time), desc(videoScoreExpr))
            .limit(nearDateCandidateLimit),
        ]).then(([previousRows, nextRows]) =>
          [...previousRows, ...nextRows]
            .sort((a, b) => {
              const aDistance = Math.abs(
                (a.scheduled_time ?? targetScheduledTime) - targetScheduledTime,
              );
              const bDistance = Math.abs(
                (b.scheduled_time ?? targetScheduledTime) - targetScheduledTime,
              );
              if (aDistance !== bDistance) return aDistance - bDistance;

              // Match the original SQL's secondary ordering. Equal-distance
              // ties intentionally remain unspecified, as they were before.
              // `videoScoreExpr` is COALESCE(score, 0) in SQL. Keep the
              // in-memory merge identical even if a driver returns NULL.
              return (b.video_score ?? 0) - (a.video_score ?? 0);
            })
            .slice(0, nearDateCandidateLimit),
        );

  let initialCandidates = interleaveBuckets<Row>([
    { reason: "previous_date", rows: temporalPrevious },
    { reason: "next_date", rows: temporalNext },
    { reason: "shared_member", rows: sharedMembers.slice(0, sharedLimit) },
    { reason: "same_event", rows: sameEvent.slice(0, sameEventLimit) },
    { reason: "same_creator", rows: sameCreator.slice(0, sameCreatorLimit) },
    { reason: "near_date", rows: nearDate.slice(0, nearDateLimit) },
  ]);

  // バケットから15件未満の場合、最新公開動画で補完
  if (initialCandidates.length < minTarget) {
    const existingIds = initialCandidates.map((c) => c.row.id);
    existingIds.push(current.id);
    const fallbackRows = await db
      .select(baseSelect)
      .from(videos)
      .where(
        and(
          baseWhere,
          notInArray(videos.id, existingIds),
        )!,
      )
      .orderBy(desc(videos.scheduled_time), desc(videoScoreExpr))
      .limit(minTarget - initialCandidates.length + 5);
    for (const row of fallbackRows) {
      if (!initialCandidates.some((c) => c.row.id === row.id)) {
        initialCandidates.push({ row, reason: "near_date" });
      }
    }
  }

  const selected = enforceDiversity(initialCandidates, {
    limit: relatedLimit,
    minTarget,
  });

  return selected.map(toRelated).slice(0, relatedLimit);
}

/**
 * 同一イベントの上映順 (scheduled_time 昇順) を返す。
 * R2 の厳密な video_events projection を優先し、欠損・不完全時だけ D1 に fallback する。
 */
export async function fetchEventPlaylistVideos(
  db: DB,
  eventId: string,
  limit = 50,
) {
  const eventRow = (
    await db
      .select({ visibility_status: events.visibility_status })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)
  )[0];
  if (eventRow?.visibility_status !== "public") return [];

  // During a public re-publish, D1 visibility can become public before the
  // event playlist artifact has been rebuilt. The public visibility fence is
  // the authoritative fail-closed guard for that window; never serve the old
  // R2 playlist while the event is still blocked/release-pending.
  try {
    if (
      await isPublicEntityVisibilityBlocked({
        entityType: "event",
        entityId: eventId,
        guardMode: resolvePublicVisibilityGuardModeFromEnv(),
      })
    ) {
      return [];
    }
  } catch {
    // A malformed/unavailable visibility manifest must fail closed for this
    // public projection rather than risk serving stale R2 content.
    return [];
  }

  const logPlaylistFallback = (reason: "r2_missing" | "r2_invalid" | "r2_incomplete" | "r2_error") => {
    console.warn(JSON.stringify({
      event: "event_playlist_d1_fallback",
      reason,
      event_id: eventId,
    }));
  };

  let object: R2ObjectBody | null = null;
  let readError = false;
  try {
    object = await getEnv().BUCKET.get(eventPlaylistObjectKey(eventId));
  } catch {
    readError = true;
    logPlaylistFallback("r2_error");
  }

  if (object) {
    let raw: string | null = null;
    try {
      raw = await object.text();
    } catch {
      logPlaylistFallback("r2_error");
    }
    if (raw !== null) {
      try {
        const payload = JSON.parse(raw) as StaticEventPlaylistPayload;
        const normalized = normalizeStaticEventPlaylist(payload, eventId);
        if (normalized && (normalized.complete || normalized.items.length >= limit)) {
          return uniqueBy(normalized.items.slice(0, limit), (row) => row.id);
        }
        logPlaylistFallback(normalized ? "r2_incomplete" : "r2_invalid");
      } catch {
        logPlaylistFallback("r2_invalid");
      }
    }
  } else if (!readError) {
    logPlaylistFallback("r2_missing");
  }

  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: storedCreatorNameExpr,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
    .innerJoin(events, eq(videoEvents.event_id, events.id))
    .where(
      and(
        eq(videoEvents.event_id, eventId),
        eq(events.visibility_status, "public"),
        eq(videos.visibility_status, "public"),
      )!,
    )
    .orderBy(asc(videos.scheduled_time))
    .limit(limit);
  return uniqueBy(rows, (row) => row.id);
}

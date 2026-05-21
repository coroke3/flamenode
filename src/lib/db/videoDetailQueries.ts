import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  events,
  videoChapters,
  videoEvents,
  videoMemberChapters,
  videoMembers,
  videos,
  xUsers,
} from "./schema";
import type { DB } from "./client";
import { resolveMissingIcons } from "./iconResolution";
import { resolveMemberIcons } from "./xIconResolution";
import { uniqueBy } from "@/lib/utils/unique";
import { normalizeXId } from "@/lib/utils/xid";
import {
  clampRelatedLimit,
  enforceDiversity,
  fillToMinimum,
  hashStringToInt,
  interleaveBuckets,
  perMemberLimit,
  seededShuffle,
  todayDateUtc,
  uniqueByVideoId,
  type RelatedReason,
} from "./recommendation";

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

export async function fetchVideoDetail(
  db: DB,
  idOrYoutube: string,
  viewer?: VideoDetailViewer,
) {
  // 1) 作品本体 (UUID または YouTubeID)
  const rows = await db
    .select()
    .from(videos)
    .where(
      or(
        eq(videos.id, idOrYoutube),
        eq(videos.youtube_video_id, idOrYoutube),
      )!,
    )
    .limit(1);
  const video = rows[0];
  if (!video) return null;

  // 2) 作者
  const creatorRows = video.creator_id
    ? await db
        .select()
        .from(xUsers)
        .where(eq(xUsers.id, video.creator_id))
        .limit(1)
    : [];
  let creator = creatorRows[0] ?? null;
  if (creator && !creator.icon_url) {
    const resolved = await resolveMissingIcons(db, [
      { creator_id: creator.id, icon_url: creator.icon_url },
    ]);
    creator = { ...creator, icon_url: resolved[0]?.icon_url ?? null };
  }

  // 3) 所属イベント
  const eventRows = await db
    .select({
      id: events.id,
      title: events.title,
      icon_url: events.icon_url,
      accent_color: events.accent_color,
      start_time: events.start_time,
      end_time: events.end_time,
      is_active: events.is_active,
      is_entry_open: events.is_entry_open,
      is_archived: events.is_archived,
    })
    .from(videoEvents)
    .innerJoin(events, eq(videoEvents.event_id, events.id))
    .where(eq(videoEvents.video_id, video.id));

  // 4) 合作メンバー
  // icon_url は xUsers.icon_url を 1 段目として取得し、null の場合は
  // resolveMemberIcons で「そのメンバー X ID の過去作品アイコン」から補完する。
  // (CLAUDE.md 方針: 作品アイコンとユーザー既定アイコンを完全分離する)
  const membersRaw = await db
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
  const members = await resolveMemberIcons(db, membersRaw);

  // 5) チャプター (再生バー点表示の元データ)
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
        inArray(videoChapters.x_user_id, selfXIds),
      ),
    )!;
  } else {
    chapterVisibilityCond = eq(videoChapters.visibility, "public");
  }
  // 通常チャプターコメントは video_chapters から取得。
  // 旧仕様で混在していた video_member_id 付き行は migration 0017 で
  // video_member_chapters に移行済み + 元行は削除済み。念のため video_member_id IS NULL
  // 条件を入れて、互換期間中に残った旧データが通常チャプターに紛れ込まないようガードする。
  const chapters = await db
    .select({
      id: videoChapters.id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
      visibility: videoChapters.visibility,
      marker_kind: videoChapters.marker_kind,
      show_on_player_bar: videoChapters.show_on_player_bar,
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
        sql`${videoChapters.video_member_id} IS NULL`,
        chapterVisibilityCond ? chapterVisibilityCond : sql`1=1`,
      )!,
    )
    .orderBy(videoChapters.chapter_time);

  // メンバーチャプターは別テーブル video_member_chapters。通常チャプターとは別 prop で
  // MemberSection に渡す。
  const memberChapters = await db
    .select({
      id: videoMemberChapters.id,
      video_member_id: videoMemberChapters.video_member_id,
      chapter_time: videoMemberChapters.chapter_time,
      chapter_label: videoMemberChapters.chapter_label,
      note: videoMemberChapters.note,
      order_index: videoMemberChapters.order_index,
    })
    .from(videoMemberChapters)
    .where(eq(videoMemberChapters.video_id, video.id))
    .orderBy(
      videoMemberChapters.video_member_id,
      videoMemberChapters.chapter_time,
    );

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
 * 旧版は同一作者最大4件 / 同一イベント最大6件 / score上位20件を順に詰める
 * だけで、結果として「毎回同じ作者・同じイベント・上位スコア」が顔を出していた。
 * これを以下の bucket に分け、各 bucket の最大件数を絞ったうえで偏らないように
 * インタリーブする。reason は将来用に内部 result に持つが、動画詳細 UI には
 * 表示しない (公開ページの「枠線で囲まれたタグ」が増えるのを避ける)。
 *
 *   - sameCreator: 同一 creator_id (max 2)
 *   - sameEvent: 同一 primary_event_id (max 3)
 *   - sharedMembers: video_members.x_user_id が現在動画のメンバーと一致 (max 2)
 *   - nearDate: scheduled_time が近い順 (max 3)
 *   - topScore: video_score 上位 (max 3)
 *   - discovery: 中位スコアからの日替わり seed 混合 (max 2)
 *
 * discovery は完全ランダムではなく、`current.id + YYYY-MM-DD` を seed にして
 * 1 日内では安定するようにする。1 日経つと組み合わせが入れ替わる。
 *
 * 並び順は creator 連続を避けるため round-robin で interleave する。
 */
export interface RelatedVideoCardData {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  creator_id: string | null;
  primary_event_id: string | null;
  scheduled_time: number | null;
  reason: RelatedReason;
}

export async function fetchRelatedVideos(
  db: DB,
  current: {
    id: string;
    creator_id: string | null;
    primary_event_id: string | null;
    scheduled_time?: number | null;
    eventIds?: string[];
  },
  limit = 18,
): Promise<RelatedVideoCardData[]> {
  const relatedLimit = clampRelatedLimit(limit);
  const minTarget = Math.min(15, relatedLimit);
  const sameEventLimit = relatedLimit >= 30 ? 6 : 4;
  const sameCreatorLimit = relatedLimit >= 30 ? 4 : 3;
  const nearDateLimit = relatedLimit >= 30 ? 5 : 3;
  const topScoreLimit = relatedLimit >= 30 ? 5 : 4;
  const discoveryLimit = relatedLimit >= 30 ? 4 : 2;
  const sharedLimit = relatedLimit >= 30 ? 10 : 6;

  const baseWhere = and(
    eq(videos.status, "public"),
    eq(videos.is_deleted, 0),
    eq(videos.is_manual_hidden, 0),
    ne(videos.id, current.id),
  );
  const iconExpr = sql<
    string | null
  >`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`;
  const baseSelect = {
    id: videos.id,
    title: videos.title,
    youtube_video_id: videos.youtube_video_id,
    display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
    icon_url: iconExpr,
    creator_id: videos.creator_id,
    primary_event_id: videos.primary_event_id,
    scheduled_time: videos.scheduled_time,
    video_score: videos.video_score,
  } as const;
  type Row = {
    id: string;
    title: string;
    youtube_video_id: string | null;
    display_name: string;
    icon_url: string | null;
    creator_id: string | null;
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
    creator_id: candidate.row.creator_id,
    primary_event_id: candidate.row.primary_event_id,
    scheduled_time: candidate.row.scheduled_time,
    reason: candidate.reason,
  });

  const temporalPrevious: Row[] =
    current.scheduled_time != null
      ? await db
          .select(baseSelect)
          .from(videos)
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
          .where(
            and(
              baseWhere,
              isNotNull(videos.scheduled_time),
              lt(videos.scheduled_time, current.scheduled_time),
            )!,
          )
          .orderBy(desc(videos.scheduled_time), desc(videos.video_score))
          .limit(3)
      : [];

  const temporalNext: Row[] =
    current.scheduled_time != null
      ? await db
          .select(baseSelect)
          .from(videos)
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
          .where(
            and(
              baseWhere,
              isNotNull(videos.scheduled_time),
              gt(videos.scheduled_time, current.scheduled_time),
            )!,
          )
          .orderBy(asc(videos.scheduled_time), desc(videos.video_score))
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
            .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
            .where(and(baseWhere, inArray(videoEvents.event_id, eventIds))!)
            .orderBy(desc(videos.scheduled_time), desc(videos.video_score))
            .limit(Math.min(24, sameEventLimit * 4)),
        )
      : [];

  const sameCreator: Row[] = current.creator_id
    ? await db
        .select(baseSelect)
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
        .where(and(baseWhere, eq(videos.creator_id, current.creator_id))!)
        .orderBy(desc(videos.scheduled_time), desc(videos.video_score))
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
  const sharedMembers: Row[] =
    uniqueMemberXIds.length > 0
      ? await db
          .select({
            ...baseSelect,
            member_x_user_id: videoMembers.x_user_id,
          })
          .from(videoMembers)
          .innerJoin(videos, eq(videos.id, videoMembers.video_id))
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
          .where(
            and(
              baseWhere,
              isNotNull(videoMembers.x_user_id),
              inArray(
                sql<string>`LOWER(${videoMembers.x_user_id})`,
                uniqueMemberXIds,
              ),
            )!,
          )
          .orderBy(desc(videos.scheduled_time), desc(videos.video_score))
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

  const nearDate: Row[] =
    current.scheduled_time != null
      ? await db
          .select(baseSelect)
          .from(videos)
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
          .where(and(baseWhere, isNotNull(videos.scheduled_time))!)
          .orderBy(
            sql`ABS(${videos.scheduled_time} - ${current.scheduled_time})`,
            desc(videos.video_score),
          )
          .limit(Math.min(16, nearDateLimit * 3))
      : await db
          .select(baseSelect)
          .from(videos)
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
          .where(baseWhere)
          .orderBy(desc(videos.scheduled_time), desc(videos.video_score))
          .limit(Math.min(16, nearDateLimit * 3));

  const topScore: Row[] = await db
    .select(baseSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(baseWhere)
    .orderBy(desc(videos.video_score), desc(videos.scheduled_time))
    .limit(Math.min(40, Math.max(20, topScoreLimit * 5)));

  const discovery = seededShuffle(
    topScore.slice(Math.min(8, Math.floor(topScore.length / 2))),
    `${current.id}|${todayDateUtc()}`,
  ).slice(0, discoveryLimit);

  const initialCandidates = interleaveBuckets<Row>([
    { reason: "previous_date", rows: temporalPrevious },
    { reason: "next_date", rows: temporalNext },
    { reason: "shared_member", rows: sharedMembers.slice(0, sharedLimit) },
    { reason: "same_event", rows: sameEvent.slice(0, sameEventLimit) },
    { reason: "same_creator", rows: sameCreator.slice(0, sameCreatorLimit) },
    { reason: "near_date", rows: nearDate.slice(0, nearDateLimit) },
    { reason: "top_score", rows: topScore.slice(0, topScoreLimit) },
    { reason: "discovery", rows: discovery },
  ]);

  let selected = enforceDiversity(initialCandidates, {
    limit: relatedLimit,
    minTarget,
  });

  if (selected.length < minTarget) {
    const latestFallback = await db
      .select(baseSelect)
      .from(videos)
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
      .where(baseWhere)
      .orderBy(desc(videos.scheduled_time), desc(videos.video_score))
      .limit(relatedLimit);
    selected = fillToMinimum(selected, latestFallback, "latest_fallback", {
      limit: relatedLimit,
      minTarget,
    });
  }

  if (selected.length < minTarget) {
    const broadFallback = await db
      .select(baseSelect)
      .from(videos)
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
      .where(baseWhere)
      .orderBy(desc(videos.video_score), desc(videos.scheduled_time))
      .limit(relatedLimit);
    selected = fillToMinimum(selected, broadFallback, "broad_fallback", {
      limit: relatedLimit,
      minTarget,
    });
  }

  return selected.map(toRelated).slice(0, relatedLimit);
}

async function fetchRelatedVideosLegacy(
  db: DB,
  current: {
    id: string;
    creator_id: string | null;
    primary_event_id: string | null;
    scheduled_time?: number | null;
  },
  limit = 15,
): Promise<RelatedVideoCardData[]> {
  const baseWhere = and(
    eq(videos.status, "public"),
    eq(videos.is_deleted, 0),
    eq(videos.is_manual_hidden, 0),
    ne(videos.id, current.id),
  );
  const iconExpr = sql<
    string | null
  >`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`;
  const baseSelect = {
    id: videos.id,
    title: videos.title,
    youtube_video_id: videos.youtube_video_id,
    display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
    icon_url: iconExpr,
    creator_id: videos.creator_id,
    primary_event_id: videos.primary_event_id,
    scheduled_time: videos.scheduled_time,
  } as const;
  type Row = {
    id: string;
    title: string;
    youtube_video_id: string | null;
    display_name: string;
    icon_url: string | null;
    creator_id: string | null;
    primary_event_id: string | null;
    scheduled_time: number | null;
  };

  // sameCreator: 同一 creator_id (新しい順、最大 2)
  const sameCreator: Row[] = current.creator_id
    ? await db
        .select(baseSelect)
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
        .where(and(baseWhere, eq(videos.creator_id, current.creator_id))!)
        .orderBy(desc(videos.scheduled_time))
        .limit(2)
    : [];

  // sameEvent: 同一 primary_event_id (新しい順、最大 3)
  const sameEvent: Row[] = current.primary_event_id
    ? await db
        .select(baseSelect)
        .from(videos)
        .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
        .where(
          and(baseWhere, eq(videos.primary_event_id, current.primary_event_id))!,
        )
        .orderBy(desc(videos.scheduled_time))
        .limit(3)
    : [];

  // sharedMembers: 現在動画の合作メンバー X ID と一致する creator_id を持つ作品 (最大 2)
  // 自分自身の作品との重複は uniqueBy で後段で除去。
  // 非公開編集者 (is_public_member = 0) は対象外。
  const memberXIds = (
    await db
      .select({ x: videoMembers.x_user_id })
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, current.id),
          eq(videoMembers.is_public_member, 1),
        )!,
      )
  )
    .map((r) => r.x)
    .filter((s): s is string => !!s);
  const sharedMembers: Row[] =
    memberXIds.length > 0
      ? await db
          .select(baseSelect)
          .from(videos)
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
          .where(and(baseWhere, inArray(videos.creator_id, memberXIds))!)
          .orderBy(desc(videos.scheduled_time))
          .limit(8)
      : [];

  // nearDate: scheduled_time が近い順 (最大 3)
  // current.scheduled_time が無い場合は全体の新しい順 fallback。
  let nearDate: Row[] = [];
  if (current.scheduled_time != null) {
    // |scheduled_time - current| が小さい順。SQLite には ABS があるので使う。
    const ord = sql`ABS(${videos.scheduled_time} - ${current.scheduled_time})`;
    nearDate = await db
      .select(baseSelect)
      .from(videos)
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
      .where(baseWhere)
      .orderBy(ord)
      .limit(8);
  }

  // topScore: video_score 上位 (最大 3)
  const topScore: Row[] = await db
    .select(baseSelect)
    .from(videos)
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(baseWhere)
    .orderBy(desc(videos.video_score))
    .limit(20);

  // discovery: 中位スコアからの日替わり seed 混合 (最大 2)
  // topScore の下位帯から、current.id + 日付で安定な擬似ランダムで 2 件選ぶ。
  const seedBase = hashStringToInt(`${current.id}|${todayDateUtc()}`);
  const discoveryPool = topScore.slice(8);
  const discovery: Row[] = [];
  if (discoveryPool.length > 0) {
    const indexA = seedBase % discoveryPool.length;
    const indexB =
      ((seedBase >>> 8) ^ 0x9e3779b1) % Math.max(1, discoveryPool.length);
    discovery.push(discoveryPool[indexA]);
    if (discoveryPool[indexB] && discoveryPool[indexB].id !== discoveryPool[indexA].id) {
      discovery.push(discoveryPool[indexB]);
    }
  }

  // 各 bucket に reason を付けて、creator 連続を避けつつ interleave する。
  const tagged: { row: Row; reason: RelatedReason; budget: number }[] = [];
  const push = (rows: Row[], reason: RelatedReason, max: number) => {
    for (const r of rows.slice(0, max)) {
      tagged.push({ row: r, reason, budget: max });
    }
  };
  push(sameCreator, "same_creator", 2);
  push(sameEvent, "same_event", 3);
  push(sharedMembers, "shared_member", 2);
  push(nearDate, "near_date", 3);
  push(topScore.slice(0, 8), "top_score", 3);
  push(discovery, "discovery", 2);

  // 重複排除 (id) + 連続する creator を避ける軽い後処理。
  const seen = new Set<string>();
  const result: RelatedVideoCardData[] = [];
  let lastCreator: string | null = null;
  let deferred: { row: Row; reason: RelatedReason }[] = [];
  for (const t of tagged) {
    if (seen.has(t.row.id)) continue;
    if (
      t.row.creator_id &&
      t.row.creator_id === lastCreator &&
      result.length > 0
    ) {
      // 直前と同じ creator は一旦保留して、別 creator を挟む
      deferred.push({ row: t.row, reason: t.reason });
      continue;
    }
    seen.add(t.row.id);
    result.push({ ...t.row, reason: t.reason });
    lastCreator = t.row.creator_id;
    if (result.length >= limit) break;
  }
  // 保留分を末尾に流す
  for (const d of deferred) {
    if (result.length >= limit) break;
    if (seen.has(d.row.id)) continue;
    seen.add(d.row.id);
    result.push({ ...d.row, reason: d.reason });
  }
  return result.slice(0, limit);
}

/**
 * 同一イベントの上映順 (scheduled_time 昇順) 全件を返す。
 * 再生リスト UI のソース。`primary_event_id` を主軸にする。
 */
export async function fetchEventPlaylistVideos(
  db: DB,
  eventId: string,
  limit = 50,
) {
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
    .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
    .where(
      and(
        eq(videoEvents.event_id, eventId),
        eq(videos.status, "public"),
        eq(videos.is_deleted, 0),
        eq(videos.is_manual_hidden, 0),
      )!,
    )
    .orderBy(asc(videos.scheduled_time))
    .limit(limit);
  return uniqueBy(rows, (row) => row.id);
}

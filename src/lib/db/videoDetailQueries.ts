import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  events,
  videoChapters,
  videoEvents,
  videoMembers,
  videos,
  xUsers,
} from "./schema";
import type { DB } from "./client";
import { resolveMissingIcons } from "./iconResolution";
import { resolveMemberIcons } from "./xIconResolution";
import { uniqueBy } from "@/lib/utils/unique";

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
    .where(eq(videoMembers.video_id, video.id))
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
      chapterVisibilityCond
        ? and(eq(videoChapters.video_id, video.id), chapterVisibilityCond)!
        : eq(videoChapters.video_id, video.id),
    )
    .orderBy(videoChapters.chapter_time);

  return { video, creator, events: eventRows, members, chapters };
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
export type RelatedReason =
  | "same_creator"
  | "same_event"
  | "shared_member"
  | "near_date"
  | "top_score"
  | "discovery";

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

function hashStringToInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function todayDateUtc(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchRelatedVideos(
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
  const memberXIds = (
    await db
      .select({ x: videoMembers.x_user_id })
      .from(videoMembers)
      .where(eq(videoMembers.video_id, current.id))
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

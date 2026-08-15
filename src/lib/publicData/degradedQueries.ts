import "server-only";

import { and, asc, desc, eq, exists, or, sql } from "drizzle-orm";
import type { VideoCardData } from "@/components/video/VideoCard";
import type { DB } from "@/lib/db/client";
import { fetchPublicAnnouncements } from "@/lib/db/announcementQueries";
import {
  countablePublicVideoCondition,
  eventPublicVideoLinkCondition,
  excludePvsfSummaryVideos,
} from "@/lib/db/queries";
import {
  eventStaff,
  events,
  termsVersions,
  videoChapters,
  videoEvents,
  videoMembers,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { creatorIconExpr, creatorNameExpr } from "@/lib/db/displayExpr";
import { coalescedVideoScoreDesc } from "@/lib/db/videoScoreSql";
import { parsePublicVideoSort } from "@/lib/db/listQueries";
import { getVideoSoftwareLabel } from "@/lib/db/software";
import { recordPublicD1Query } from "@/lib/observability/publicRequestMetrics";
import { publicListableXApprovalWhere } from "@/lib/utils/publicXUserWhere";
import { activeEventWhere } from "@/lib/utils/eventStatus";
import { MAX_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";
import { pickHeroEvents } from "@/lib/utils/pickHeroEvents";
import { buildDegradedUsersPageSql, DEGRADED_USERS_PAGE_SIZE } from "./degradedUsersPageSql";
import { buildHeroEventSlotStatsSql } from "./heroEventSlotStatsSql";
import { fetchVideoRowByIdOrYoutube } from "@/lib/db/videoIdLookup";
import type { StaticEventDetailPayload } from "./staticEventDetailCore";
import type { StaticEventsIndexPayload } from "./staticEventsIndexCore";
import type { StaticPopularVideosPayload } from "./staticPopularVideoCore";
import type { StaticRecentVideosPayload } from "./staticRecentVideoCore";
import type { StaticRulesPayload } from "./staticRulesCore";
import type { StaticTopPayload } from "./staticTopCore";
import type { StaticUserProfilePayload } from "./staticUserProfileCore";
import type { StaticUsersIndexPayload } from "./staticUsersIndexCore";
import type { StaticVideoDetailPayload } from "./staticVideoDetailCore";

type D1Queryable = Pick<D1Database, "prepare">;

function asD1Queryable(db: DB): D1Queryable {
  return db.$client;
}

export const DEGRADED_LIST_PAGE_SIZE = 24;
export const DEGRADED_USER_WORKS_LIMIT = 12;
export const DEGRADED_USER_COLLABS_LIMIT = 12;

function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function noteQuery(): void {
  recordPublicD1Query();
}

export async function fetchDegradedUsersIndexPayload(
  db: DB,
  params: { page: number; pageSize?: number; q?: string },
): Promise<StaticUsersIndexPayload | null> {
  const pageSize = Math.min(
    DEGRADED_USERS_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? DEGRADED_USERS_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(params.page));
  const offset = (page - 1) * pageSize;
  const q = params.q?.trim().toLocaleLowerCase() ?? "";
  const like = q ? `%${escapeLikeTerm(q)}%` : "";

  noteQuery();
  const rows = await asD1Queryable(db)
    .prepare(buildDegradedUsersPageSql())
    .bind(q, like, like, pageSize, offset)
    .all<Record<string, unknown>>();

  const items = (rows.results ?? [])
    .map((row) => ({
      x_id: String(row.x_id ?? "").trim(),
      x_name: String(row.x_name ?? row.x_id ?? "").trim(),
      icon_url:
        row.icon_url == null || String(row.icon_url).trim() === ""
          ? null
          : String(row.icon_url),
      personal_count: 0,
      collab_count: 0,
      total_works: 0,
      sort_score: 0,
      updated_at: 0,
    }))
    .filter((row) => row.x_id && row.x_name);

  return { generated_at: null, items };
}

export async function fetchDegradedTopPayload(db: DB): Promise<StaticTopPayload> {
  const now = Math.floor(Date.now() / 1000);
  noteQuery();
  const activeEventRows = await db
    .select()
    .from(events)
    .where(activeEventWhere(now))
    .orderBy(desc(events.start_time))
    .limit(12);

  const heroEvents = pickHeroEvents(activeEventRows, 3, now);
  const heroIds = heroEvents.map((event) => event.id);

  const slotStats: Array<{
    event_id: string;
    available: number;
    total: number;
  }> = [];
  const slotSql = buildHeroEventSlotStatsSql(heroIds);
  if (slotSql) {
    noteQuery();
    const slotRows = await asD1Queryable(db)
      .prepare(slotSql)
      .bind(...heroIds)
      .all<{ event_id: string; available: number; total: number }>();
    for (const row of slotRows.results ?? []) {
      if (!row.event_id) continue;
      slotStats.push({
        event_id: row.event_id,
        available: Number(row.available ?? 0),
        total: Number(row.total ?? 0),
      });
    }
  }

  noteQuery();
  const latest = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      part: videos.part,
    })
    .from(videos)
    .where(countablePublicVideoCondition)
    .orderBy(desc(videos.scheduled_time))
    .limit(12);

  noteQuery();
  const announcements = await fetchPublicAnnouncements(db, "all", 3);

  return {
    generated_at: null,
    active_events: heroEvents,
    recommended: [],
    latest,
    creators: [],
    latest_events: [],
    announcements,
    event_video_counts: {},
    slot_stats: slotStats,
    stats: {
      public_videos: latest.length,
      active_events: heroEvents.length,
      creators: 0,
    },
  };
}

export async function fetchDegradedRecommendPayload(
  db: DB,
): Promise<{ generated_at: null; recommended: []; latest: VideoCardData[]; underrated: []; creators: [] }> {
  noteQuery();
  const latest = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      part: videos.part,
    })
    .from(videos)
    .where(countablePublicVideoCondition)
    .orderBy(desc(videos.scheduled_time))
    .limit(12);

  return {
    generated_at: null,
    recommended: [],
    latest,
    underrated: [],
    creators: [],
  };
}

export async function fetchDegradedRecentListPayload(
  db: DB,
  params: {
    page: number;
    pageSize?: number;
    q?: string;
    sort?: string;
  },
): Promise<StaticRecentVideosPayload> {
  const pageSize = Math.min(
    DEGRADED_LIST_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? DEGRADED_LIST_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(params.page));
  const offset = (page - 1) * pageSize;
  const sort = parsePublicVideoSort(params.sort);
  const q = params.q?.trim() ?? "";
  const like = q ? `%${escapeLikeTerm(q)}%` : null;

  const searchCondition = like
    ? or(
        sql`${videos.title} LIKE ${like} ESCAPE '\\'`,
        sql`${videos.creator_x_user_id} LIKE ${like} ESCAPE '\\'`,
        sql`${videos.creator_display_name} LIKE ${like} ESCAPE '\\'`,
      )
    : undefined;

  noteQuery();
  const fetchLimit = pageSize + 1;
  const query = db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      part: videos.part,
    })
    .from(videos)
    .where(
      searchCondition
        ? and(countablePublicVideoCondition, searchCondition)
        : countablePublicVideoCondition,
    );

  const rows =
    sort === "old"
      ? await query
          .orderBy(asc(videos.scheduled_time), asc(videos.created_at))
          .limit(fetchLimit)
          .offset(offset)
      : sort === "score"
        ? await query
            .orderBy(coalescedVideoScoreDesc, desc(videos.scheduled_time))
            .limit(fetchLimit)
            .offset(offset)
        : await query
            .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
            .limit(fetchLimit)
            .offset(offset);

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const total = hasMore ? offset + pageSize + 1 : offset + items.length;

  return {
    generated_at: null,
    items,
    total,
  };
}

export async function fetchDegradedPopularListPayload(
  db: DB,
  params: { page: number; pageSize?: number },
): Promise<StaticPopularVideosPayload> {
  const pageSize = Math.min(
    DEGRADED_LIST_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? DEGRADED_LIST_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(params.page));
  const offset = (page - 1) * pageSize;
  const fetchLimit = pageSize + 1;

  noteQuery();
  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      part: videos.part,
    })
    .from(videos)
    .where(countablePublicVideoCondition)
    .orderBy(coalescedVideoScoreDesc, desc(videos.scheduled_time))
    .limit(fetchLimit)
    .offset(offset);

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const total = hasMore ? offset + pageSize + 1 : offset + items.length;

  return {
    generated_at: null,
    items,
    total,
  };
}

export type DegradedEventListPageResult = {
  eventInfo: { id: string; title: string };
  items: VideoCardData[];
  total: number;
};

export async function fetchDegradedEventListPage(
  db: DB,
  params: {
    eventId: string;
    sort?: string;
    page: number;
    pageSize?: number;
    q?: string;
  },
): Promise<DegradedEventListPageResult | null> {
  const eventId = params.eventId.trim();
  if (!eventId) return null;

  noteQuery();
  const eventRow = (
    await db
      .select({ id: events.id, title: events.title })
      .from(events)
      .where(
        and(eq(events.id, eventId), eq(events.visibility_status, "public"))!,
      )
      .limit(1)
  )[0];
  if (!eventRow) return null;

  const pageSize = Math.min(
    DEGRADED_LIST_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? DEGRADED_LIST_PAGE_SIZE)),
  );
  const page = Math.max(1, Math.floor(params.page));
  const offset = (page - 1) * pageSize;
  const sort = parsePublicVideoSort(params.sort);
  const q = params.q?.trim() ?? "";
  const like = q ? `%${escapeLikeTerm(q)}%` : null;
  const searchCondition = like
    ? or(
        sql`${videos.title} LIKE ${like} ESCAPE '\\'`,
        sql`${videos.creator_x_user_id} LIKE ${like} ESCAPE '\\'`,
        sql`${videos.creator_display_name} LIKE ${like} ESCAPE '\\'`,
      )
    : undefined;

  noteQuery();
  const fetchLimit = pageSize + 1;
  const query = db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: creatorNameExpr,
      icon_url: creatorIconExpr,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      primary_event_title: events.title,
      scheduled_time: videos.scheduled_time,
      part: videos.part,
    })
    .from(videos)
    .leftJoin(
      events,
      and(
        eq(events.id, videos.primary_event_id),
        eq(events.visibility_status, "public"),
      )!,
    )
    .where(
      and(
        countablePublicVideoCondition,
        eventPublicVideoLinkCondition(eventId),
        searchCondition,
      )!,
    );

  const rows =
    sort === "old"
      ? await query
          .orderBy(asc(videos.scheduled_time), asc(videos.created_at))
          .limit(fetchLimit)
          .offset(offset)
      : sort === "score"
        ? await query
            .orderBy(coalescedVideoScoreDesc, desc(videos.scheduled_time))
            .limit(fetchLimit)
            .offset(offset)
        : await query
            .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
            .limit(fetchLimit)
            .offset(offset);

  const hasMore = rows.length > pageSize;
  const items = (hasMore ? rows.slice(0, pageSize) : rows).map((row) => ({
    ...row,
    primary_event_title: row.primary_event_title ?? null,
  }));
  const total = hasMore ? offset + pageSize + 1 : offset + items.length;

  return {
    eventInfo: { id: eventRow.id, title: eventRow.title },
    items,
    total,
  };
}

export async function fetchDegradedEventsIndexPayload(
  db: DB,
): Promise<StaticEventsIndexPayload> {
  noteQuery();
  const eventRows = await db
    .select()
    .from(events)
    .where(eq(events.visibility_status, "public"))
    .orderBy(desc(events.start_time))
    .limit(20);

  return {
    generated_at: null,
    items: eventRows,
    group_sections: [],
  };
}

export async function fetchDegradedEventDetailPayload(
  db: DB,
  eventId: string,
): Promise<StaticEventDetailPayload | null> {
  noteQuery();
  const event = (
    await db.select().from(events).where(eq(events.id, eventId)).limit(1)
  )[0];
  if (!event || event.visibility_status !== "public") return null;

  noteQuery();
  const publicVideos = await db
    .select({
      id: videos.id,
      title: videos.title,
      creator_x_user_id: videos.creator_x_user_id,
      youtube_video_id: videos.youtube_video_id,
      creator_display_name: videos.creator_display_name,
      creator_icon_url: videos.creator_icon_url,
      visibility_status: videos.visibility_status,
      scheduled_time: videos.scheduled_time,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
    .where(
      and(
        eq(videoEvents.event_id, eventId),
        eq(videos.visibility_status, "public"),
        excludePvsfSummaryVideos(),
      )!,
    )
    .orderBy(desc(videos.scheduled_time))
    .limit(50);

  noteQuery();
  const publicStaff = await db
    .select({
      role: eventStaff.public_role_label,
      display_name: eventStaff.display_name,
      public_role_label: eventStaff.public_role_label,
      x_user_id: eventStaff.x_user_id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
    })
    .from(eventStaff)
    .leftJoin(xUsers, eq(xUsers.id, eventStaff.x_user_id))
    .where(and(eq(eventStaff.event_id, eventId), eq(eventStaff.is_public, 1))!)
    .orderBy(eventStaff.created_at)
    .limit(20);

  return {
    generated_at: null,
    event,
    public_staff: publicStaff.map((row) => ({
      role: row.role,
      display_name: row.display_name,
      public_role_label: row.public_role_label,
      x_user_id: row.x_user_id,
      x_name: row.x_name,
      icon_url: row.icon_url,
    })),
    slots_summary: [],
    slots: [],
    public_videos: publicVideos.map((row) => ({
      id: row.id,
      title: row.title,
      creator_x_user_id: row.creator_x_user_id,
      youtube_video_id: row.youtube_video_id,
      creator_display_name: row.creator_display_name ?? "",
      creator_icon_url: row.creator_icon_url,
      visibility_status: "public",
      scheduled_time: row.scheduled_time,
    })),
    video_total: publicVideos.length,
    creator_count: 0,
  };
}

async function resolveVideoByRawId(db: DB, rawId: string) {
  return fetchVideoRowByIdOrYoutube(db, rawId);
}

export async function fetchDegradedVideoDetailPayload(
  db: DB,
  rawId: string,
): Promise<StaticVideoDetailPayload | null> {
  noteQuery();
  const video = await resolveVideoByRawId(db, rawId);
  if (!video || video.visibility_status !== "public") return null;

  noteQuery();
  const publicEvents = await db
    .select({
      id: events.id,
      title: events.title,
      icon_url: events.icon_url,
      accent_color: events.accent_color,
      start_time: events.start_time,
      end_time: events.end_time,
      entry_start_time: events.entry_start_time,
      entry_end_time: events.entry_end_time,
      visibility_status: events.visibility_status,
    })
    .from(events)
    .innerJoin(videoEvents, eq(videoEvents.event_id, events.id))
    .where(
      and(
        eq(videoEvents.video_id, video.id),
        eq(events.visibility_status, "public"),
      )!,
    )
    .limit(10);

  noteQuery();
  const publicMembers = await db
    .select({
      id: videoMembers.id,
      display_name: videoMembers.name,
      x_user_id: videoMembers.x_user_id,
      role_label: videoMembers.role,
      order_index: videoMembers.order_index,
    })
    .from(videoMembers)
    .where(
      and(
        eq(videoMembers.video_id, video.id),
        eq(videoMembers.is_public_member, 1),
      )!,
    )
    .orderBy(videoMembers.order_index)
    .limit(MAX_VIDEO_MEMBERS);

  noteQuery();
  const publicChapters = await db
    .select({
      id: videoChapters.id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
      note: videoChapters.note,
      author_name: sql<string | null>`NULL`,
      author_icon: sql<string | null>`NULL`,
    })
    .from(videoChapters)
    .where(
      and(
        eq(videoChapters.video_id, video.id),
        eq(videoChapters.visibility, "public"),
      )!,
    )
    .orderBy(videoChapters.chapter_time)
    .limit(100);

  const softwareLabel = await getVideoSoftwareLabel(db, video.id);

  return {
    generated_at: null,
    video,
    event_ids: publicEvents.map((event) => event.id),
    public_events: publicEvents,
    public_members: publicMembers,
    public_chapters: publicChapters,
    member_chapters: [],
    software_labels: softwareLabel ? [softwareLabel] : [],
    related_videos: [],
    app_like_count: 0,
  };
}

export async function fetchDegradedUserProfilePayload(
  db: DB,
  userId: string,
): Promise<StaticUserProfilePayload | null> {
  const normalizedId = userId.trim().toLowerCase();
  noteQuery();
  const userRow = (
    await db
      .select()
      .from(xUsers)
      .where(
        and(
          sql`lower(${xUsers.id}) = ${normalizedId}`,
          publicListableXApprovalWhere(),
        )!,
      )
      .limit(1)
  )[0];

  if (!userRow) return null;

  const worksWhere = and(
    countablePublicVideoCondition,
    sql`lower(${videos.creator_x_user_id}) = ${normalizedId}`,
  )!;
  const collabMemberExists = exists(
    db
      .select({ one: sql`1` })
      .from(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, videos.id),
          eq(videoMembers.is_public_member, 1),
          sql`lower(${videoMembers.x_user_id}) = ${normalizedId}`,
        )!,
      ),
  );
  const collabsWhere = and(
    countablePublicVideoCondition,
    sql`lower(coalesce(${videos.creator_x_user_id}, '')) <> ${normalizedId}`,
    collabMemberExists,
  )!;

  noteQuery();
  const [worksRows, collabsRows] = await Promise.all([
    db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: creatorNameExpr,
        icon_url: creatorIconExpr,
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.visibility_status,
        part: videos.part,
        total_count: sql<number>`count(*) over()`,
      })
      .from(videos)
      .where(worksWhere)
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(DEGRADED_USER_WORKS_LIMIT),
    db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: creatorNameExpr,
        icon_url: creatorIconExpr,
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.visibility_status,
        part: videos.part,
        total_count: sql<number>`count(*) over()`,
      })
      .from(videos)
      .where(collabsWhere)
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(DEGRADED_USER_COLLABS_LIMIT),
  ]);

  const worksTotal =
    worksRows.length > 0 ? Number(worksRows[0]?.total_count ?? 0) : 0;
  const collabsTotal =
    collabsRows.length > 0 ? Number(collabsRows[0]?.total_count ?? 0) : 0;
  const works = worksRows.map(({ total_count: _totalCount, ...row }) => row);
  const collabs = collabsRows.map(({ total_count: _totalCount, ...row }) => row);

  return {
    generated_at: null,
    user: userRow,
    works: {
      total: worksTotal,
      items: works,
    },
    collabs: {
      total: collabsTotal,
      items: collabs,
    },
  };
}

export async function fetchDegradedRulesPayload(
  db: DB,
): Promise<StaticRulesPayload | null> {
  noteQuery();
  const row = (
    await db
      .select()
      .from(termsVersions)
      .where(eq(termsVersions.status, "published"))
      .orderBy(desc(termsVersions.published_at), desc(termsVersions.updated_at))
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    generated_at: null,
    version_label: row.version_label,
    body_markdown: row.body_markdown,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
}

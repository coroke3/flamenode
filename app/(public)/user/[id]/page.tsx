import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import {
  events,
  videoEvents,
  videoMembers,
  videos,
  videoStats,
  xUsers,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { normalizeXId } from "@/lib/utils/xid";
import { resolveXUserIcon } from "@/lib/db/xIconResolution";
import { Pagination } from "@/components/ui/Pagination";
import { clampPaging, totalPagesFor } from "@/lib/utils/sql";
import { formatUnix } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const WORKS_PAGE_SIZE = 24;
const COLLAB_PAGE_SIZE = 24;

type CreatorTab = "works" | "events" | "profile";

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    worksPage?: string;
    collabPage?: string;
    tab?: string;
    event?: string;
  }>;
}

interface ProfileUser {
  id: string;
  x_name: string;
  icon_url: string | null;
  profile_text: string | null;
  youtube_channel_url: string | null;
  creative_start_date: number | null;
  approval_requested_at: number | null;
}

type CreatorVideo = VideoCardData & { score: number };

interface CreatorEvent {
  id: string;
  title: string;
  explanation: string | null;
  start_time: number | null;
  end_time: number | null;
  entry_end_time: number | null;
  video_count: number;
  latest_time: number | null;
  roles: string | null;
}

interface EventOption {
  id: string;
  title: string;
  count: number;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = normalizeXId((await params).id);
  const data = await withDatabase(async (db) => {
    const u = await db
      .select()
      .from(xUsers)
      .where(sql`lower(${xUsers.id}) = ${id}`)
      .limit(1);
    if (u[0]) return { title: u[0].x_name };

    const fallback = await db
      .select({
        name: sql<string>`COALESCE(${videos.creator_display_name}, ${videos.creator_x_user_id})`,
      })
      .from(videos)
      .where(
        and(
          eq(videos.visibility_status, "public"),
          sql`lower(${videos.creator_x_user_id}) = ${id}`,
        )!,
      )
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(1);
    return { title: fallback[0]?.name ?? id };
  });
  return data ?? { title: id };
}

function resolveTab(value: string | undefined): CreatorTab {
  if (value === "events" || value === "profile") return value;
  return "works";
}

function format2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatScore(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function dateOnly(value: number | null | undefined): string {
  return value ? formatUnix(value, { dateOnly: true }) : "-";
}

function tabHref(basePath: string, tab: CreatorTab): string {
  return tab === "works" ? basePath : `${basePath}?tab=${tab}`;
}

function worksHref(basePath: string, eventId?: string): string {
  if (!eventId) return basePath;
  const usp = new URLSearchParams();
  usp.set("event", eventId);
  return `${basePath}?${usp.toString()}`;
}

export default async function UserPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const id = normalizeXId((await params).id);
  const sp = (await searchParams) ?? {};
  const activeTab = resolveTab(sp.tab);
  const selectedEventId =
    typeof sp.event === "string" && sp.event.trim().length > 0
      ? sp.event.trim()
      : "";
  const worksPaging = clampPaging({
    page: sp.worksPage,
    pageSize: WORKS_PAGE_SIZE,
    defaultPageSize: WORKS_PAGE_SIZE,
    maxPageSize: WORKS_PAGE_SIZE,
  });
  const collabPaging = clampPaging({
    page: sp.collabPage,
    pageSize: COLLAB_PAGE_SIZE,
    defaultPageSize: COLLAB_PAGE_SIZE,
    maxPageSize: COLLAB_PAGE_SIZE,
  });

  const bundle = await withDatabase(async (db) => {
    const userRow = await db
      .select()
      .from(xUsers)
      .where(sql`lower(${xUsers.id}) = ${id}`)
      .limit(1);
    const publicVideoBase = eq(videos.visibility_status, "public");

    const fallbackUserRows = userRow[0]
      ? []
      : await db
          .select({
            id: sql<string>`${videos.creator_x_user_id}`,
            x_name: sql<string>`COALESCE(${videos.creator_display_name}, ${videos.creator_x_user_id})`,
            icon_url: videos.creator_icon_url,
            profile_text: sql<string | null>`NULL`,
            youtube_channel_url: sql<string | null>`NULL`,
            creative_start_date: sql<number | null>`NULL`,
            approval_requested_at: sql<number | null>`NULL`,
          })
          .from(videos)
          .where(and(publicVideoBase, sql`lower(${videos.creator_x_user_id}) = ${id}`)!)
          .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
          .limit(1);

    const user: ProfileUser | null = userRow[0]
      ? {
          id: userRow[0].id,
          x_name: userRow[0].x_name,
          icon_url: userRow[0].icon_url,
          profile_text: userRow[0].profile_text,
          youtube_channel_url: userRow[0].youtube_channel_url,
          creative_start_date: userRow[0].creative_start_date,
          approval_requested_at: userRow[0].approval_requested_at,
        }
      : (fallbackUserRows[0] ?? null);
    if (!user) return null;

    if (!user.icon_url) {
      const resolved = await resolveXUserIcon(db, user.id);
      if (resolved) user.icon_url = resolved;
    }

    const ownWhere = and(
      publicVideoBase,
      sql`lower(${videos.creator_x_user_id}) = ${id}`,
    )!;
    const ownVideoSelect = {
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: videos.creator_display_name,
      icon_url: videos.creator_icon_url,
      creator_x_user_id: videos.creator_x_user_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      status: videos.visibility_status,
      part: videos.part,
      score: sql<number>`COALESCE(${videoStats.score}, 0)`,
    };

    const ownVideosRaw = selectedEventId
      ? await db
          .select(ownVideoSelect)
          .from(videos)
          .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
          .leftJoin(videoStats, eq(videoStats.video_id, videos.id))
          .where(and(ownWhere, eq(videoEvents.event_id, selectedEventId))!)
          .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
          .limit(worksPaging.pageSize)
          .offset(worksPaging.offset)
      : await db
          .select(ownVideoSelect)
          .from(videos)
          .leftJoin(videoStats, eq(videoStats.video_id, videos.id))
          .where(ownWhere)
          .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
          .limit(worksPaging.pageSize)
          .offset(worksPaging.offset);

    const ownCountRow = selectedEventId
      ? (
          await db
            .select({ c: sql<number>`COUNT(DISTINCT ${videos.id})` })
            .from(videos)
            .innerJoin(videoEvents, eq(videoEvents.video_id, videos.id))
            .where(and(ownWhere, eq(videoEvents.event_id, selectedEventId))!)
            .limit(1)
        )[0]
      : (
          await db
            .select({ c: sql<number>`COUNT(*)` })
            .from(videos)
            .where(ownWhere)
            .limit(1)
        )[0];
    const ownTotal = Number(ownCountRow?.c ?? 0);

    const ownVideos = ownVideosRaw.map((v) => ({
      ...v,
      display_name: user.x_name || v.display_name || user.id,
      icon_url: v.icon_url ?? user.icon_url,
      score: Number(v.score ?? 0),
    })) as CreatorVideo[];

    const eventOptions = (await db
      .select({
        id: events.id,
        title: events.title,
        count: sql<number>`COUNT(DISTINCT ${videos.id})`,
      })
      .from(events)
      .innerJoin(videoEvents, eq(videoEvents.event_id, events.id))
      .innerJoin(videos, eq(videos.id, videoEvents.video_id))
      .where(ownWhere)
      .groupBy(events.id)
      .orderBy(desc(sql`MAX(COALESCE(${videos.scheduled_time}, ${videos.created_at}))`))) as EventOption[];

    const collabWhere = and(
      publicVideoBase,
      sql`lower(${videoMembers.x_user_id}) = ${id}`,
      sql`lower(${videos.creator_x_user_id}) <> ${id}`,
    )!;
    const collabVideos = (await db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.creator_display_name}, ${videos.creator_x_user_id})`,
        icon_url: sql<string | null>`COALESCE(${videos.creator_icon_url}, ${xUsers.icon_url})`,
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.visibility_status,
        part: videos.part,
        score: sql<number>`COALESCE(${videoStats.score}, 0)`,
      })
      .from(videos)
      .innerJoin(videoMembers, eq(videos.id, videoMembers.video_id))
      .leftJoin(xUsers, sql`lower(${xUsers.id}) = lower(${videos.creator_x_user_id})`)
      .leftJoin(videoStats, eq(videoStats.video_id, videos.id))
      .where(collabWhere)
      .orderBy(desc(videos.scheduled_time), desc(videos.created_at))
      .limit(collabPaging.pageSize)
      .offset(collabPaging.offset)) as CreatorVideo[];
    const collabCountRow = (
      await db
        .select({ c: sql<number>`COUNT(DISTINCT ${videos.id})` })
        .from(videos)
        .innerJoin(videoMembers, eq(videos.id, videoMembers.video_id))
        .where(collabWhere)
        .limit(1)
    )[0];
    const collabTotal = Number(collabCountRow?.c ?? 0);

    const scoreRows = await db
      .select({
        id: videos.id,
        score: sql<number>`COALESCE(${videoStats.score}, 0)`,
        latest_time: sql<number | null>`MAX(COALESCE(${videos.scheduled_time}, ${videos.created_at}))`,
      })
      .from(videos)
      .leftJoin(videoStats, eq(videoStats.video_id, videos.id))
      .leftJoin(
        videoMembers,
        and(
          eq(videoMembers.video_id, videos.id),
          sql`lower(${videoMembers.x_user_id}) = ${id}`,
        ),
      )
      .where(
        and(
          publicVideoBase,
          sql`(lower(${videos.creator_x_user_id}) = ${id} OR ${videoMembers.id} IS NOT NULL)`,
        )!,
      )
      .groupBy(videos.id);
    const totalScore = scoreRows.reduce(
      (sum, row) => sum + Number(row.score ?? 0),
      0,
    );
    const latestPostAt =
      scoreRows.reduce<number | null>((latest, row) => {
        const value = row.latest_time == null ? null : Number(row.latest_time);
        if (value == null) return latest;
        return latest == null || value > latest ? value : latest;
      }, null) ?? null;

    const eventParticipationRows = (await db
      .select({
        id: events.id,
        title: events.title,
        explanation: events.explanation,
        start_time: events.start_time,
        end_time: events.end_time,
        entry_end_time: events.entry_end_time,
        video_count: sql<number>`COUNT(DISTINCT ${videos.id})`,
        latest_time: sql<number | null>`MAX(COALESCE(${videos.scheduled_time}, ${videos.created_at}))`,
        roles: sql<string | null>`GROUP_CONCAT(DISTINCT CASE WHEN lower(${videos.creator_x_user_id}) = ${id} THEN 'creator' ELSE 'member' END)`,
      })
      .from(events)
      .innerJoin(videoEvents, eq(videoEvents.event_id, events.id))
      .innerJoin(videos, eq(videos.id, videoEvents.video_id))
      .leftJoin(
        videoMembers,
        and(
          eq(videoMembers.video_id, videos.id),
          sql`lower(${videoMembers.x_user_id}) = ${id}`,
        ),
      )
      .where(
        and(
          publicVideoBase,
          sql`(lower(${videos.creator_x_user_id}) = ${id} OR ${videoMembers.id} IS NOT NULL)`,
        )!,
      )
      .groupBy(events.id)
      .orderBy(desc(sql`MAX(COALESCE(${videos.scheduled_time}, ${videos.created_at}))`))) as CreatorEvent[];

    return {
      user,
      ownVideos,
      ownTotal,
      eventOptions,
      collabVideos,
      collabTotal,
      totalScore,
      latestPostAt,
      eventParticipationRows,
    };
  });

  if (!bundle) notFound();
  const {
    user,
    ownVideos,
    ownTotal,
    eventOptions,
    collabVideos,
    collabTotal,
    totalScore,
    latestPostAt,
    eventParticipationRows,
  } = bundle;
  const ownTotalPages = totalPagesFor(ownTotal, worksPaging.pageSize);
  const collabTotalPages = totalPagesFor(collabTotal, collabPaging.pageSize);
  const basePath = `/user/${encodeURIComponent(user.id)}`;
  const buildOwnHref = (p: number) => {
    const usp = new URLSearchParams();
    usp.set("worksPage", String(p));
    if (selectedEventId) usp.set("event", selectedEventId);
    return `${basePath}?${usp.toString()}`;
  };
  const buildCollabHref = (p: number) => {
    const usp = new URLSearchParams();
    usp.set("collabPage", String(p));
    return `${basePath}?${usp.toString()}`;
  };

  const profileIcon = user.icon_url ?? null;
  const profileName = user.x_name || user.id;
  const totalWorks = ownTotal + collabTotal;

  return (
    <div className={styles.page}>
      <section className={styles.profile}>
        <Link href="/user" className={styles.backLink}>
          ← クリエイター一覧
        </Link>
        <Link href="/user" className={styles.closeLink} aria-label="閉じる">
          ×
        </Link>
        {profileIcon ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={profileIcon} alt="" className={styles.avatar} />
        ) : (
          <span className={styles.avatarFb}>
            {profileName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className={styles.profileBody}>
          <h1 className={styles.name}>{profileName}</h1>
          <div className={styles.socialLine}>
            <a href={`https://x.com/${user.id}`} target="_blank" rel="noopener noreferrer">
              X @ {user.id}
            </a>
            {user.youtube_channel_url ? (
              <a
                href={user.youtube_channel_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="youtube" size={12} aria-hidden />
                youtube.com/@{user.id}
              </a>
            ) : null}
          </div>
          {user.profile_text ? <p className={styles.bio}>{user.profile_text}</p> : null}
        </div>

        <dl className={styles.stats} aria-label="クリエイター統計">
          <div>
            <dt>Works</dt>
            <dd>{format2(ownTotal)}</dd>
          </div>
          <div>
            <dt>Events</dt>
            <dd>{format2(eventParticipationRows.length)}</dd>
          </div>
          <div>
            <dt>Total Score</dt>
            <dd>{formatScore(totalScore)}</dd>
          </div>
          <div>
            <dt>最新投稿</dt>
            <dd>{dateOnly(latestPostAt)}</dd>
          </div>
        </dl>
      </section>

      <nav className={styles.tabs} aria-label="クリエイターページ">
        <Link
          href={tabHref(basePath, "works")}
          className={activeTab === "works" ? styles.tabActive : styles.tab}
        >
          作品 <small>{ownTotal}</small>
        </Link>
        <Link
          href={tabHref(basePath, "events")}
          className={activeTab === "events" ? styles.tabActive : styles.tab}
        >
          参加履歴 <small>{eventParticipationRows.length}</small>
        </Link>
        <Link
          href={tabHref(basePath, "profile")}
          className={activeTab === "profile" ? styles.tabActive : styles.tab}
        >
          プロフィール
        </Link>
      </nav>

      {activeTab === "works" ? (
        <section className={styles.content}>
          {eventOptions.length > 0 ? (
            <div className={styles.filters} aria-label="イベント絞り込み">
              <Link
                href={worksHref(basePath)}
                className={!selectedEventId ? styles.filterActive : styles.filter}
              >
                すべて
              </Link>
              {eventOptions.map((event) => (
                <Link
                  key={event.id}
                  href={worksHref(basePath, event.id)}
                  className={
                    selectedEventId === event.id ? styles.filterActive : styles.filter
                  }
                >
                  {event.title}
                </Link>
              ))}
            </div>
          ) : null}

          {ownVideos.length === 0 ? (
            <div className="fn-empty">
              <Icon name="info" size={20} aria-hidden />
              <p className="fn-empty-message">
                まだ公開されている作品がありません。
              </p>
            </div>
          ) : (
            <>
              <div className={styles.grid}>
                {ownVideos.map((v, index) => (
                  <div key={`${v.id}-own-${index}`} className={styles.workCard}>
                    <VideoCard video={v} />
                    {v.score > 0 ? (
                      <span className={styles.workScore}>{formatScore(v.score)}</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <Pagination
                currentPage={worksPaging.page}
                totalPages={ownTotalPages}
                total={ownTotal}
                pageSize={worksPaging.pageSize}
                buildHref={buildOwnHref}
                unitLabel="件"
              />
            </>
          )}

          {collabTotal > 0 ? (
            <section className={styles.subSection}>
              <h2 className={styles.subTitle}>参加作品</h2>
              <div className={styles.grid}>
                {collabVideos.map((v, index) => (
                  <div key={`${v.id}-collab-${index}`} className={styles.workCard}>
                    <VideoCard video={v} />
                  </div>
                ))}
              </div>
              <Pagination
                currentPage={collabPaging.page}
                totalPages={collabTotalPages}
                total={collabTotal}
                pageSize={collabPaging.pageSize}
                buildHref={buildCollabHref}
                unitLabel="件"
              />
            </section>
          ) : null}
        </section>
      ) : null}

      {activeTab === "events" ? (
        <section className={styles.content}>
          {eventParticipationRows.length === 0 ? (
            <div className="fn-empty">
              <Icon name="info" size={20} aria-hidden />
              <p className="fn-empty-message">参加履歴はまだありません。</p>
            </div>
          ) : (
            <div className={styles.eventList}>
              {eventParticipationRows.map((event, index) => (
                <Link
                  key={event.id}
                  href={`/event/${event.id}`}
                  className={styles.eventRow}
                >
                  <span className={styles.eventIndex}>{format2(index + 1)}</span>
                  <div className={styles.eventBody}>
                    <div className={styles.eventTitleRow}>
                      <h2>{event.title}</h2>
                      <span className={styles.eventBadge}>
                        {event.roles?.includes("creator") ? "参加中" : "参加済み"}
                      </span>
                    </div>
                    {event.explanation ? <p>{event.explanation}</p> : null}
                    <span className={styles.eventMeta}>
                      {event.video_count} works
                    </span>
                  </div>
                  <span className={styles.eventDate}>
                    {event.start_time
                      ? event.end_time
                        ? `${dateOnly(event.start_time)} - ${dateOnly(event.end_time)}`
                        : dateOnly(event.start_time)
                      : dateOnly(event.latest_time)}
                    <Icon name="chevron-right" size={13} aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "profile" ? (
        <section className={styles.profileContent}>
          <div className={styles.profileBlock}>
            <p className={styles.blockTitle}>プロフィール</p>
            <dl className={styles.profileRows}>
              <div>
                <dt>活動名</dt>
                <dd>{profileName}</dd>
              </div>
              <div>
                <dt>X (Twitter)</dt>
                <dd>𝕏 @{user.id}</dd>
              </div>
              {user.youtube_channel_url ? (
                <div>
                  <dt>YouTube</dt>
                  <dd>{user.youtube_channel_url.replace(/^https?:\/\//, "")}</dd>
                </div>
              ) : null}
              <div>
                <dt>映像歴</dt>
                <dd>
                  {user.creative_start_date
                    ? `${dateOnly(user.creative_start_date)} から`
                    : "-"}
                </dd>
              </div>
            </dl>
          </div>
          <div className={styles.profileBlock}>
            <p className={styles.blockTitle}>FlameNode での活動</p>
            <dl className={styles.profileRows}>
              <div>
                <dt>登録日</dt>
                <dd>{dateOnly(user.approval_requested_at)}</dd>
              </div>
              <div>
                <dt>参加イベント</dt>
                <dd>{eventParticipationRows.length} 件</dd>
              </div>
              <div>
                <dt>投稿作品</dt>
                <dd>{ownTotal} 件</dd>
              </div>
              <div>
                <dt>Active X ID</dt>
                <dd>@{user.id}</dd>
              </div>
            </dl>
          </div>
          {user.profile_text ? (
            <div className={styles.profileBlock}>
              <p className={styles.blockTitle}>ひとこと</p>
              <p className={styles.profileText}>{user.profile_text}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

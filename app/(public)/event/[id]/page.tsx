import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabaseRead } from "@/lib/cloudflare";
import {
  eventStaff,
  events as eventsTable,
  slots as slotsTable,
  videoEvents,
  videoMembers,
  videos,
  xUsers,
} from "@/lib/db/schema";
import {
  countVideosForEvent,
  excludePvsfSummaryVideos,
  fetchAllPublicVideosForEvent,
} from "@/lib/db/queries";
import {
  computeEventStatus,
  eventStatusLabel,
  isAcceptingEntries,
  isPublicEventVisible,
} from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { JsonLd } from "@/components/seo/JsonLd";
import { EventRecruitCard } from "@/components/layout/EventRecruitCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { UserAvatar } from "@/components/user/UserAvatar";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatCount } from "@/lib/utils/format";
import { absoluteUrl, buildPageMetadata, compactText } from "@/lib/seo";
import { buildSlotParts, formatSlotPartLabel } from "@/lib/utils/slotGrouping";
import {
  canFallbackToDatabase,
  loadStaticEventDetail,
  type StaticEventDetail,
} from "@/lib/publicData/loader";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

type EventRow = typeof eventsTable.$inferSelect;
type SlotRow = typeof slotsTable.$inferSelect;
type EventVideo = VideoCardData;
type SlotFillStat = {
  label: string;
  total: number;
  filled: number;
  pct: number;
};
type SlotVisualStatus = SlotRow["status"];

const JST = { timeZone: "Asia/Tokyo" } as const;
const eventSectionHeaderClasses = {
  root: styles.sectionHead,
  titles: styles.sectionTitleGroup,
  eyebrow: styles.eyebrow,
  titleLine: styles.sectionTitleLine,
  title: styles.sectionTitle,
} as const;
const monthDay = new Intl.DateTimeFormat("ja-JP", {
  ...JST,
  month: "2-digit",
  day: "2-digit",
});
const dateFormat = {
  slotDateKey: new Intl.DateTimeFormat("ja-JP", {
    ...JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }),
  weekday: new Intl.DateTimeFormat("ja-JP", {
    ...JST,
    weekday: "short",
  }),
  slotTime: new Intl.DateTimeFormat("ja-JP", {
    ...JST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }),
} as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const staticLoaded = await loadStaticEventDetail(id);
  if (staticLoaded.data) {
    const event = staticLoaded.data.event;
    return buildPageMetadata({
      title: event.title,
      description: event.explanation,
      path: `/event/${event.id}`,
      image: event.img_url ?? event.icon_url,
      noIndex: !isPublicEventVisible(event),
    });
  }
  const event = await withDatabaseRead(async (db) =>
    (
      await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
    )[0] ?? null,
  );
  if (!event) return { title: id };
  return buildPageMetadata({
    title: event.title,
    description: event.explanation,
    path: `/event/${event.id}`,
    image: event.img_url ?? event.icon_url,
    noIndex: !isPublicEventVisible(event),
  });
}

export default async function EventDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const staticLoaded = await loadStaticEventDetail(id);
  if (!canFallbackToDatabase(staticLoaded.strategy)) {
    if (!staticLoaded.data) notFound();
    return <StaticEventDetailView detail={staticLoaded.data} />;
  }

  const bundle = await withDatabaseRead(async (db) => {
    const event = (
      await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
    )[0];
    if (!event || !isPublicEventVisible(event)) return null;
    const publicVideoWhere = and(
      eq(videoEvents.event_id, id),
      eq(videos.visibility_status, "public"),
    )!;
    const [eventVideos, eventVideoTotal, creatorCountRow, slotRows, staffRows] =
      await Promise.all([
        fetchAllPublicVideosForEvent(db, id),
        countVideosForEvent(db, id),
        db
          .select({
            c: sql<number>`(
              SELECT COUNT(*) FROM (
                SELECT LOWER(${videos.creator_x_user_id}) AS x_id
                FROM ${videos}
                INNER JOIN ${videoEvents} ON ${videos.id} = ${videoEvents.video_id}
                WHERE ${videoEvents.event_id} = ${id}
                  AND ${videos.visibility_status} = 'public'
                  AND ${excludePvsfSummaryVideos()}
                  AND ${videos.creator_x_user_id} IS NOT NULL
                UNION
                SELECT LOWER(${videoMembers.x_user_id}) AS x_id
                FROM ${videoMembers}
                INNER JOIN ${videos} ON ${videos.id} = ${videoMembers.video_id}
                INNER JOIN ${videoEvents} ON ${videos.id} = ${videoEvents.video_id}
                WHERE ${videoEvents.event_id} = ${id}
                  AND ${videos.visibility_status} = 'public'
                  AND ${videoMembers.is_public_member} = 1
                  AND ${videoMembers.x_user_id} IS NOT NULL
              )
            )`,
          })
          .from(videos)
          .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
          .where(publicVideoWhere)
          .limit(1),
        db
          .select()
          .from(slotsTable)
          .where(eq(slotsTable.event_id, id))
          .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order)),
        db
          .select({
            x_user_id: eventStaff.x_user_id,
            display_name: eventStaff.display_name,
            public_role_label: eventStaff.public_role_label,
            x_name: xUsers.x_name,
            icon_url: xUsers.icon_url,
          })
          .from(eventStaff)
          .leftJoin(xUsers, eq(xUsers.id, eventStaff.x_user_id))
          .where(and(eq(eventStaff.event_id, id), eq(eventStaff.is_public, 1))!)
          .orderBy(asc(eventStaff.created_at), asc(eventStaff.display_name)),
      ]);
    return {
      event,
      eventVideos: eventVideos as EventVideo[],
      eventVideoTotal: Number(eventVideoTotal ?? 0),
      creatorTotal: Number(creatorCountRow[0]?.c ?? 0),
      slotRows,
      staffRows,
    };
  });
  if (!bundle) notFound();

  return <EventDetailView {...bundle} />;
}

function EventDetailView({
  event,
  eventVideos,
  eventVideoTotal,
  creatorTotal,
  slotRows,
  staffRows,
}: {
  event: EventRow;
  eventVideos: EventVideo[];
  eventVideoTotal: number;
  creatorTotal: number;
  slotRows: SlotRow[];
  staffRows: Array<{
    x_user_id: string;
    display_name: string;
    public_role_label: string | null;
    x_name: string | null;
    icon_url: string | null;
  }>;
}): React.ReactElement {
  const accentVar = {
    "--event-accent": event.accent_color ?? "var(--accent-primary)",
  } as React.CSSProperties;
  const now = Math.floor(Date.now() / 1000);
  const status = computeEventStatus(event);
  const accepting = isAcceptingEntries(event);
  const slotTotal = slotRows.length;
  const availableSlots = slotRows.filter((slot) => slot.status === "available").length;
  const filledSlots = slotTotal - availableSlots;
  const slotSummary = buildSlotSummary(
    slotRows,
    (event.slot_part_gap_minutes ?? 15) * 60,
  );
  const inPostPeriod =
    !accepting &&
    event.entry_end_time != null &&
    now > event.entry_end_time &&
    event.start_time != null &&
    now < event.start_time;
  const dayMetric = getDayMetric(event, now);
  const eventJsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: compactText(event.explanation),
    url: absoluteUrl(`/event/${event.id}`),
    image: event.img_url ? [absoluteUrl(event.img_url)] : undefined,
    startDate: event.start_time
      ? new Date(event.start_time * 1000).toISOString()
      : undefined,
    endDate: event.end_time
      ? new Date(event.end_time * 1000).toISOString()
      : undefined,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: { "@type": "VirtualLocation", url: absoluteUrl(`/event/${event.id}`) },
    organizer: { "@type": "Organization", name: "FlameNode", url: absoluteUrl("/") },
  };

  return (
    <div className={`fn-public-container fn-page ${styles.page}`} style={accentVar}>
      <JsonLd data={eventJsonLd} />
      <header className={`fn-page-head fn-event-hero ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className="fn-eyebrow">EVENT</p>
          <h1 className={`fn-event-hero-title ${styles.heroTitle}`}>{event.title}</h1>
          {event.explanation ? (
            <p className={`fn-event-hero-lead fn-jp ${styles.heroLead}`}>
              {event.explanation}
            </p>
          ) : null}
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>
            {accepting ? "募集期間中" : eventStatusLabel(status)}
          </span>
          {accepting ? (
            <Link href={`/event/${event.id}/slots`} className={styles.reserveButton}>
              枠を確保する <Icon name="chevron-right" size={14} aria-hidden />
            </Link>
          ) : inPostPeriod ? (
            <Link href="/entry" className={styles.reserveButton}>
              作品を提出する <Icon name="chevron-right" size={14} aria-hidden />
            </Link>
          ) : null}
          <Link href="/rules" className={styles.guideLink}>ガイドライン</Link>
        </div>
      </header>

      <section className={styles.statsGrid} aria-label="イベント概要">
        <StatCard label="募集期間" value={formatRange(event.entry_start_time, event.entry_end_time)} />
        <StatCard label="投稿期間" value={formatRange(event.start_time, event.end_time)} />
        <StatCard label="ENTRIES" value={formatCount(eventVideoTotal)} />
        <StatCard label="CREATORS" value={formatCount(creatorTotal)} />
        <StatCard label="FILLED 枠" value={<>{filledSlots}<span>/{slotTotal}</span></>} />
        <StatCard label={dayMetric.label} value={<>{dayMetric.value}<span>日</span></>} />
      </section>

      {status !== "ended" ? (
        <EventRecruitCard
          event={event}
          available={availableSlots}
          total={slotTotal}
          actionHref={inPostPeriod ? "/entry" : slotTotal > 0 ? `/event/${event.id}/slots` : undefined}
          actionLabel={inPostPeriod ? "作品を提出する" : accepting ? "枠を確保する" : slotTotal > 0 ? "枠表へ" : undefined}
        />
      ) : null}

      {slotSummary ? (
        <section className={styles.section}>
          <SectionHeader
            eyebrow="枠の状態"
            title="上映枠の埋まり状況"
            moreHref={slotTotal > 0 ? `/event/${event.id}/slots` : undefined}
            moreLabel="枠を確認する →"
            classes={eventSectionHeaderClasses}
          />
          <div className={styles.slotSummaryGrid}>
            <SlotFillCard stat={slotSummary.overall} featured />
            {slotSummary.parts.map((part) => (
              <SlotFillCard key={part.label} stat={part} />
            ))}
          </div>
        </section>
      ) : null}

      {staffRows.length > 0 ? (
        <section className={styles.section}>
          <SectionHeader eyebrow="CREW" title="Crew" classes={eventSectionHeaderClasses} />
          <ul className={styles.crewList}>
            {staffRows.map((member) => (
              <li key={member.x_user_id} className={styles.crewRow}>
                <UserAvatar
                  iconUrl={member.icon_url}
                  label={member.x_name ?? member.display_name}
                  size={36}
                  className={styles.crewAvatar}
                  fallbackClassName={styles.crewAvatarFallback}
                />
                <Link href={`/user/${member.x_user_id}`} className={styles.crewName}>
                  {member.x_name ?? member.display_name}
                </Link>
                <span className={styles.crewRole}>
                  {member.public_role_label ?? "運営"}
                </span>
                <a
                  href={`https://x.com/${member.x_user_id}`}
                  className={styles.crewXLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="x" size={12} aria-hidden /> @{member.x_user_id}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <VideoSection eventId={event.id} videos={eventVideos} total={eventVideoTotal} />
    </div>
  );
}

function StaticEventDetailView({ detail }: { detail: StaticEventDetail }): React.ReactElement {
  const { event } = detail;
  if (!isPublicEventVisible(event)) notFound();
  const videosForCard = detail.publicVideos.map((video) => ({
    id: video.id,
    title: video.title,
    youtube_video_id: video.youtube_video_id,
    display_name: video.creator_display_name,
    icon_url: video.creator_icon_url,
    creator_x_user_id: video.creator_x_user_id,
    scheduled_time: video.scheduled_time,
    status: video.visibility_status,
  }));
  const slotTotal = detail.slotSummary.reduce((sum, row) => sum + row.count, 0);
  const available =
    detail.slotSummary.find((row) => row.status === "available")?.count ?? 0;
  const eventRow = event as EventRow;
  return (
    <EventDetailView
      event={eventRow}
      eventVideos={videosForCard as EventVideo[]}
      eventVideoTotal={videosForCard.length}
      creatorTotal={new Set(videosForCard.map((video) => video.creator_x_user_id).filter(Boolean)).size}
      slotRows={Array.from({ length: slotTotal }, (_, index) => ({
        id: `static-${index}`,
        event_id: event.id,
        reserved_by_user_id: null,
        x_user_id: null,
        display_name: null,
        slot_label: null,
        start_time: null,
        sort_order: index,
        reservation_group_id: null,
        video_id: null,
        status: index < available ? "available" : "reserved",
        updated_at: 0,
        version: 1,
      }))}
      staffRows={detail.publicStaff.map((member) => ({
        x_user_id: member.x_user_id ?? member.display_name,
        display_name: member.display_name,
        public_role_label: member.public_role_label,
        x_name: member.x_name,
        icon_url: member.icon_url,
      }))}
    />
  );
}

function VideoSection({ eventId, videos: rows, total }: { eventId: string; videos: EventVideo[]; total: number }): React.ReactElement {
  return (
    <section className={styles.section}>
      <SectionHeader
        eyebrow="投稿"
        title="投稿"
        classes={eventSectionHeaderClasses}
        action={
          total > rows.length ? (
            <Link href={`/list?event=${encodeURIComponent(eventId)}`} className={styles.moreLink}>
              すべて見る <Icon name="chevron-right" size={13} aria-hidden />
            </Link>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <p className={styles.emptyText}>このイベントの公開済み作品はまだありません。</p>
      ) : (
        <div className="fn-video-grid">
          {rows.map((video) => <VideoCard key={video.id} video={video} />)}
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return <div className={styles.statCard}><span>{label}</span><strong>{value}</strong></div>;
}

function SlotFillCard({ stat, featured = false }: { stat: SlotFillStat; featured?: boolean }): React.ReactElement {
  return (
    <article className={styles.slotSummaryCard} data-featured={featured ? "true" : undefined}>
      <div className={styles.slotSummaryTop}><span>{stat.label}</span><em>{stat.pct}%</em></div>
      <strong className={styles.slotSummaryCount}>{formatCount(stat.filled)}<small>/{formatCount(stat.total)}</small></strong>
      <div className={styles.slotSummaryProgress}><i style={{ width: `${stat.pct}%` }} /></div>
    </article>
  );
}

function formatRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "-";
  return `${start != null ? monthDay.format(new Date(start * 1000)) : "-"} - ${
    end != null ? monthDay.format(new Date(end * 1000)) : "-"
  }`;
}

function getDayMetric(event: EventRow, now: number) {
  const target = [
    { at: event.start_time, label: "投稿期間まで" },
    { at: event.entry_end_time, label: "募集締切まで" },
    { at: event.end_time, label: "終了まで" },
  ].find((item): item is { at: number; label: string } =>
    typeof item.at === "number" && item.at > now,
  );
  return target
    ? { label: target.label, value: Math.max(0, Math.ceil((target.at - now) / 86400)) }
    : { label: "終了", value: 0 };
}

function buildSlotSummary(rows: SlotRow[], gapSec: number) {
  if (rows.length === 0) return null;
  const toStat = (label: string, subset: SlotRow[]): SlotFillStat => {
    const total = subset.length;
    const filled = subset.filter((slot) => slot.status !== "available").length;
    return { label, total, filled, pct: total ? Math.round((filled / total) * 100) : 0 };
  };
  return {
    overall: toStat("全体", rows),
    parts: buildSlotParts(rows, gapSec).map((part) =>
      toStat(formatSlotPartLabel(part, "short"), part.rows as SlotRow[]),
    ),
  };
}

function buildSlotPreview(slots: SlotRow[]) {
  const timed = slots.filter((slot) => slot.start_time != null);
  if (timed.length === 0) return null;
  const dates = unique(timed.map((slot) => slotDateKey(slot.start_time ?? 0)))
    .slice(0, 3)
    .map((key) => ({ key, label: slotDateLabel(key) }));
  const dateKeys = new Set(dates.map((date) => date.key));
  const times = unique(
    timed
      .filter((slot) => dateKeys.has(slotDateKey(slot.start_time ?? 0)))
      .map((slot) => slotTimeKey(slot.start_time ?? 0)),
  )
    .slice(0, 8);
  const timeKeys = new Set(times);
  const cells = new Map<string, SlotRow>();
  for (const slot of timed) {
    const dateKey = slotDateKey(slot.start_time ?? 0);
    const timeKey = slotTimeKey(slot.start_time ?? 0);
    if (!dateKeys.has(dateKey) || !timeKeys.has(timeKey)) {
      continue;
    }
    cells.set(`${dateKey}:${timeKey}`, slot);
  }
  return { dates, times: times.map((key) => ({ key, label: key })), cells };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function slotDateKey(ts: number): string {
  return dateFormat.slotDateKey.format(new Date(ts * 1000));
}

function slotDateLabel(key: string): string {
  const [year, month, day] = key.split("/");
  const date = new Date(`${year}-${month}-${day}T00:00:00+09:00`);
  const weekday = dateFormat.weekday.format(date);
  return `${month}/${day} ${weekday}`;
}

function slotTimeKey(ts: number): string {
  return dateFormat.slotTime.format(new Date(ts * 1000));
}

function slotDisplayName(slot: SlotRow): string {
  if (slot.status === "available") return "空き枠";
  return slot.display_name ?? slot.x_user_id ?? "確保済み";
}

function slotVisualStatus(slot: SlotRow, _now: number): SlotVisualStatus {
  return slot.status;
}

function slotStatusLabel(status: SlotVisualStatus): string {
  if (status === "submitted") return "提出済み";
  if (status === "reserved") return "確保済み";
  return "選択可";
}

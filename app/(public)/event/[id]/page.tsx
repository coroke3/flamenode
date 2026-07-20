import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { withDatabase } from "@/lib/cloudflare";
import {
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
  fetchEventWithEditors,
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
import { loadStaticEventDetail } from "@/lib/publicData/loader";
import { canFallbackToDatabase } from "@/lib/publicData/loader";
import type { StaticEventDetail } from "@/lib/publicData/loader";

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
const dateFormat = {
  monthDay: new Intl.DateTimeFormat("ja-JP", { ...JST, month: "2-digit", day: "2-digit" }),
  slotDateKey: new Intl.DateTimeFormat("ja-JP", { ...JST, year: "numeric", month: "2-digit", day: "2-digit" }),
  slotTime: new Intl.DateTimeFormat("ja-JP", { ...JST, hour: "2-digit", minute: "2-digit", hour12: false }),
  weekday: new Intl.DateTimeFormat("en-US", { ...JST, weekday: "short" }),
};

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
  const event = await withDatabase(async (db) => {
    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  });
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

  const bundle =
    await withDatabase(async (db) => {
    const data = await fetchEventWithEditors(db, id);
    if (!data || !isPublicEventVisible(data.event)) return null;

    const publicVideoWhere = and(
      eq(videoEvents.event_id, id),
      eq(videos.visibility_status, "public"),
    )!;

    const [eventVideos, eventVideoTotal, creatorCountRow, slotRows] =
      await Promise.all([
        fetchAllPublicVideosForEvent(db, id),
        countVideosForEvent(db, id),
        db
          .select({
            c: sql<number>`(
              SELECT COUNT(*)
              FROM (
                SELECT LOWER(${videos.creator_x_user_id}) AS x_id
                FROM ${videos}
                INNER JOIN ${videoEvents}
                  ON ${videos.id} = ${videoEvents.video_id}
                INNER JOIN ${xUsers}
                  ON LOWER(${xUsers.id}) = LOWER(${videos.creator_x_user_id})
                WHERE ${videoEvents.event_id} = ${id}
                  AND ${videos.visibility_status} = 'public'
                  AND ${excludePvsfSummaryVideos()}
                  AND ${videos.creator_x_user_id} IS NOT NULL
                  AND ${videos.creator_x_user_id} <> ''
                UNION
                SELECT LOWER(${videoMembers.x_user_id}) AS x_id
                FROM ${videoMembers}
                INNER JOIN ${videos}
                  ON ${videos.id} = ${videoMembers.video_id}
                INNER JOIN ${videoEvents}
                  ON ${videos.id} = ${videoEvents.video_id}
                INNER JOIN ${xUsers}
                  ON LOWER(${xUsers.id}) = LOWER(${videoMembers.x_user_id})
                WHERE ${videoEvents.event_id} = ${id}
                  AND ${videos.visibility_status} = 'public'
                  AND ${excludePvsfSummaryVideos()}
                  AND ${videoMembers.is_public_member} = 1
                  AND ${videoMembers.x_user_id} IS NOT NULL
                  AND ${videoMembers.x_user_id} <> ''
              ) AS event_creators
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
          .orderBy(
            asc(slotsTable.start_time),
            asc(slotsTable.sort_order),
          ),
      ]);

    return {
      data,
      eventVideos: eventVideos as EventVideo[],
      eventVideoTotal: Number(eventVideoTotal ?? 0),
      creatorTotal: Number(creatorCountRow[0]?.c ?? 0),
      slotRows,
    };
  });

  if (!bundle) notFound();

  const {
    data: { event, editors },
    eventVideos,
    eventVideoTotal,
    creatorTotal,
    slotRows,
  } = bundle;

  const accentVar = {
    "--event-accent": event.accent_color ?? "var(--accent-primary)",
  } as React.CSSProperties;
  const status = computeEventStatus(event);
  const accepting = isAcceptingEntries(event);
  const showRecruitCard = status !== "ended" && status !== "private";
  const publicEditors = editors.filter((editor) => editor.is_public === 1);
  const now = Math.floor(Date.now() / 1000);
  const slotTotal = slotRows.length;
  const availableSlots = slotRows.filter(
    (slot) => slot.status === "available",
  ).length;
  const filledSlots = Math.max(0, slotTotal - availableSlots);
  const dayMetric = getDayMetric(event, now);
  const slotSummary = buildSlotSummary(
    slotRows,
    (event.slot_part_gap_minutes ?? 15) * 60,
  );
  const statusTitle = accepting ? "募集期間中" : eventStatusLabel(status);
  const inPostPeriod =
    !accepting &&
    event.entry_end_time != null &&
    now > event.entry_end_time &&
    event.start_time != null &&
    now < event.start_time;
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
    location: {
      "@type": "VirtualLocation",
      url: absoluteUrl(`/event/${event.id}`),
    },
    organizer: {
      "@type": "Organization",
      name: "FlameNode",
      url: absoluteUrl("/"),
    },
  };

  return (
    <div
      className={`fn-public-container fn-page ${styles.page}`}
      style={accentVar}
    >
      <JsonLd data={eventJsonLd} />
      <header className={`fn-page-head fn-event-hero ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className="fn-eyebrow">EVENT</p>
          <h1 className={`fn-event-hero-title ${styles.heroTitle}`}>{event.title}</h1>
          {event.explanation ? (
            <p className={`fn-event-hero-lead fn-jp ${styles.heroLead}`}>{event.explanation}</p>
          ) : null}
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>{statusTitle}</span>
          {accepting ? (
            <Link href={`/event/${event.id}/slots`} className={styles.reserveButton}>
              枠を確保する <Icon name="chevron-right" size={14} aria-hidden />
            </Link>
          ) : inPostPeriod ? (
            <Link
              href="/entry"
              className={styles.reserveButton}
            >
              作品を提出する <Icon name="chevron-right" size={14} aria-hidden />
            </Link>
          ) : null}
          <Link href="/rules" className={styles.guideLink}>
            ガイドライン
          </Link>
        </div>
      </header>

      <section className={styles.statsGrid} aria-label="イベント概要">
        <StatCard label="募集期間" value={formatRange(event.entry_start_time, event.entry_end_time)} />
        <StatCard label="投稿期間" value={formatRange(event.start_time, event.end_time)} />
        <StatCard label="ENTRIES" value={formatCount(eventVideoTotal)} />
        <StatCard label="CREATORS" value={formatCount(creatorTotal)} />
        <StatCard
          label="FILLED 枠"
          value={<>{filledSlots}<span>/{slotTotal}</span></>}
        />
        <StatCard
          label={dayMetric.label}
          value={<>{dayMetric.value}<span>日</span></>}
        />
      </section>

      {showRecruitCard ? (
        <EventRecruitCard
          event={event}
          available={availableSlots}
          total={slotTotal}
          actionHref={inPostPeriod ? "/entry" : slotTotal > 0 ? `/event/${event.id}/slots` : undefined}
          actionLabel={
            inPostPeriod
              ? "作品を提出する"
              : accepting
                ? "枠を確保する"
                : slotTotal > 0
                  ? "枠表へ"
                  : undefined
          }
        />
      ) : null}

      {slotSummary ? (
        <section className={styles.section}>
          <SectionHeader
            eyebrow="枠の状態 - 上映枠"
            title="上映枠の埋まり状況"
            moreHref={slotTotal > 0 ? `/event/${event.id}/slots` : undefined}
            moreLabel="枠を確保する →"
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

      {publicEditors.length > 0 ? (
        <section className={styles.section}>
          <SectionHeader
            eyebrow="CREW - 運営メンバー"
            title="Crew"
            classes={eventSectionHeaderClasses}
          />
          <ul className={styles.crewList}>
            {publicEditors.map((member) => (
              <li
                key={`${member.x_user_id}-${member.role}`}
                className={styles.crewRow}
              >
                <UserAvatar
                  iconUrl={member.icon_url}
                  label={member.x_name ?? member.x_user_id ?? ""}
                  size={36}
                  className={styles.crewAvatar}
                  fallbackClassName={styles.crewAvatarFallback}
                />
                <Link
                  href={`/user/${member.x_user_id}`}
                  className={styles.crewName}
                >
                  {member.x_name ?? member.x_user_id}
                </Link>
                <span className={styles.crewRole}>
                  {member.public_role_label ??
                    (member.role === "representative"
                      ? "代表"
                      : member.role === "staff"
                        ? "スタッフ"
                        : "運営")}
                </span>
                <a
                  href={`https://x.com/${member.x_user_id}`}
                  className={styles.crewXLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="x" size={12} aria-hidden />
                  @{member.x_user_id}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <SectionHeader
          eyebrow="投稿 - 提出済み"
          title="投稿"
          classes={eventSectionHeaderClasses}
          action={
            eventVideoTotal > eventVideos.length ? (
              <Link href={`/list?event=${encodeURIComponent(event.id)}`} className={styles.moreLink}>
                すべて見る <Icon name="chevron-right" size={13} aria-hidden />
              </Link>
            ) : null
          }
        />
        {eventVideos.length === 0 ? (
          <p className={styles.emptyText}>
            このイベントの提出済み作品はまだ表示できません。
          </p>
        ) : (
          <div className="fn-video-grid">
            {eventVideos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StaticEventDetailView({
  detail,
}: {
  detail: StaticEventDetail;
}): React.ReactElement {
  const { event } = detail;
  if (!isPublicEventVisible(event)) notFound();
  const now = Math.floor(Date.now() / 1000);
  const accentVar = {
    "--event-accent": event.accent_color ?? "var(--accent-primary)",
  } as React.CSSProperties;
  const status = computeEventStatus(event);
  const accepting = isAcceptingEntries(event);
  const slotTotal = detail.slotSummary.reduce((sum, row) => sum + row.count, 0);
  const availableSlots =
    detail.slotSummary.find((row) => row.status === "available")?.count ?? 0;
  const filledSlots = Math.max(0, slotTotal - availableSlots);
  const dayMetric = getDayMetric(event as EventRow, now);
  const eventVideos = detail.publicVideos.map((video) => ({
    id: video.id,
    title: video.title,
    youtube_video_id: video.youtube_video_id,
    display_name: video.creator_display_name,
    icon_url: video.creator_icon_url,
    creator_x_user_id: video.creator_x_user_id,
    scheduled_time: video.scheduled_time,
    status: video.visibility_status,
  }));

  return (
    <div
      className={`fn-public-container fn-page ${styles.page}`}
      style={accentVar}
    >
      <header className={`fn-page-head fn-event-hero ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className="fn-eyebrow">EVENT</p>
          <h1 className={`fn-event-hero-title ${styles.heroTitle}`}>
            {event.title}
          </h1>
          {event.explanation ? (
            <p className={`fn-event-hero-lead fn-jp ${styles.heroLead}`}>
              {event.explanation}
            </p>
          ) : null}
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>
            {accepting ? "募集中" : eventStatusLabel(status)}
          </span>
          {accepting ? (
            <Link href={`/event/${event.id}/slots`} className={styles.reserveButton}>
              枠を確保する <Icon name="chevron-right" size={14} aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>

      <section className={styles.statsGrid} aria-label="イベント概要">
        <StatCard label="募集期間" value={formatRange(event.entry_start_time, event.entry_end_time)} />
        <StatCard label="投稿期間" value={formatRange(event.start_time, event.end_time)} />
        <StatCard label="ENTRIES" value={formatCount(eventVideos.length)} />
        <StatCard label="CREW" value={formatCount(detail.publicStaff.length)} />
        <StatCard
          label="FILLED 枠"
          value={<>{filledSlots}<span>/{slotTotal}</span></>}
        />
        <StatCard
          label={dayMetric.label}
          value={<>{dayMetric.value}<span>日</span></>}
        />
      </section>

      <EventRecruitCard
        event={event}
        available={availableSlots}
        total={slotTotal}
        actionHref={accepting ? `/event/${event.id}/slots` : undefined}
        actionLabel={accepting ? "枠を確保する" : undefined}
      />

      {detail.publicStaff.length > 0 ? (
        <section className={styles.section}>
          <SectionHeader
            eyebrow="CREW"
            title="Crew"
            classes={eventSectionHeaderClasses}
          />
          <ul className={styles.crewList}>
            {detail.publicStaff.map((member) => (
              <li
                key={`${member.x_user_id ?? member.display_name}-${member.role ?? ""}`}
                className={styles.crewRow}
              >
                <UserAvatar
                  iconUrl={member.icon_url}
                  label={member.x_name ?? member.display_name}
                  size={36}
                  className={styles.crewAvatar}
                  fallbackClassName={styles.crewAvatarFallback}
                />
                {member.x_user_id ? (
                  <Link href={`/user/${member.x_user_id}`} className={styles.crewName}>
                    {member.x_name ?? member.display_name}
                  </Link>
                ) : (
                  <span className={styles.crewName}>{member.display_name}</span>
                )}
                <span className={styles.crewRole}>
                  {member.public_role_label ?? member.role ?? "staff"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <SectionHeader
          eyebrow="投稿"
          title="投稿"
          classes={eventSectionHeaderClasses}
        />
        {eventVideos.length === 0 ? (
          <p className={styles.emptyText}>
            このイベントの公開済み作品はまだ表示できません。
          </p>
        ) : (
          <div className="fn-video-grid">
            {eventVideos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.statCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SlotFillCard({
  stat,
  featured = false,
}: {
  stat: SlotFillStat;
  featured?: boolean;
}): React.ReactElement {
  return (
    <article
      className={styles.slotSummaryCard}
      data-featured={featured ? "true" : undefined}
    >
      <div className={styles.slotSummaryTop}>
        <span>{stat.label}</span>
        <em>{stat.pct}%</em>
      </div>
      <strong className={styles.slotSummaryCount}>
        {formatCount(stat.filled)}
        <small>/{formatCount(stat.total)}</small>
      </strong>
      <div
        className={styles.slotSummaryProgress}
        aria-label={`${stat.label}: ${stat.pct}%`}
      >
        <i style={{ width: `${stat.pct}%` }} />
      </div>
      <p>
        <span>{formatCount(stat.filled)}枠</span>
        <span>埋まっています</span>
      </p>
    </article>
  );
}

function formatRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "-";
  const s = start != null ? formatMonthDay(start) : "-";
  const e = end != null ? formatMonthDay(end) : "-";
  return `${s} - ${e}`;
}

function formatMonthDay(ts: number): string {
  return dateFormat.monthDay.format(new Date(ts * 1000));
}

function getDayMetric(event: EventRow, now: number) {
  const targets = [
    { at: event.start_time, label: "投稿期間まで", caption: "投稿期間まで" },
    { at: event.entry_end_time, label: "募集締切まで", caption: "募集締切まで" },
    { at: event.end_time, label: "終了まで", caption: "イベント終了まで" },
  ].filter((item): item is { at: number; label: string; caption: string } =>
    typeof item.at === "number" && item.at > now,
  );
  const target = targets[0] ?? { at: now, label: "終了", caption: "終了済み" };
  return {
    label: target.label,
    caption: target.caption,
    value: Math.max(0, Math.ceil((target.at - now) / 86400)),
  };
}

function buildSlotSummary(slots: SlotRow[], slotPartGapSec: number) {
  if (slots.length === 0) return null;
  const toStat = (label: string, rows: SlotRow[]): SlotFillStat => {
    const total = rows.length;
    const filled = rows.filter((slot) => slot.status !== "available").length;
    return {
      label,
      total,
      filled,
      pct: total > 0 ? Math.round((filled / total) * 100) : 0,
    };
  };
  return {
    overall: toStat("全体", slots),
    parts: buildSlotParts(slots, slotPartGapSec).map((part) =>
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

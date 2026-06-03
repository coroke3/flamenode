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
  videos,
  videoStats,
  videoYoutubeMetadata,
  xUsers,
} from "@/lib/db/schema";
import { fetchEventWithEditors } from "@/lib/db/queries";
import {
  computeEventStatus,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { formatCount, formatDuration, formatUnix } from "@/lib/utils/format";
import { youtubeThumbUrl } from "@/lib/youtube/id";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

type EventRow = typeof eventsTable.$inferSelect;
type SlotRow = typeof slotsTable.$inferSelect;

type EventVideo = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  icon_url: string | null;
  creator_x_user_id: string | null;
  score: number;
  duration_seconds: number | null;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await withDatabase(async (db) => {
    const rows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  });
  return event?.title ? { title: event.title } : { title: id };
}

export default async function EventDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;

  const bundle = await withDatabase(async (db) => {
    const data = await fetchEventWithEditors(db, id);
    if (!data) return null;

    const publicVideoWhere = and(
      eq(videoEvents.event_id, id),
      eq(videos.visibility_status, "public"),
    )!;

    const [eventVideos, eventVideoCountRow, creatorCountRow, slotRows] =
      await Promise.all([
        db
          .select({
            id: videos.id,
            title: videos.title,
            youtube_video_id: videos.youtube_video_id,
            display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.creator_display_name}, ${videos.creator_x_user_id})`,
            icon_url: sql<string | null>`COALESCE(${videos.creator_icon_url}, ${xUsers.icon_url})`,
            creator_x_user_id: videos.creator_x_user_id,
            score: sql<number>`COALESCE(${videoStats.score}, 0)`,
            duration_seconds: videoYoutubeMetadata.duration_seconds,
          })
          .from(videos)
          .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
          .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
          .leftJoin(videoStats, eq(videoStats.video_id, videos.id))
          .leftJoin(
            videoYoutubeMetadata,
            eq(videoYoutubeMetadata.video_id, videos.id),
          )
          .where(publicVideoWhere)
          .orderBy(asc(videos.scheduled_time), asc(videos.id))
          .limit(8),
        db
          .select({ c: sql<number>`COUNT(*)` })
          .from(videos)
          .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
          .where(publicVideoWhere)
          .limit(1),
        db
          .select({
            c: sql<number>`COUNT(DISTINCT ${videos.creator_x_user_id})`,
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
            asc(slotsTable.end_time),
            asc(slotsTable.sort_order),
          ),
      ]);

    return {
      data,
      eventVideos: eventVideos as EventVideo[],
      eventVideoTotal: Number(eventVideoCountRow[0]?.c ?? 0),
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
  const publicEditors = editors.filter((editor) => editor.is_public === 1);
  const now = Math.floor(Date.now() / 1000);
  const slotTotal = slotRows.length;
  const availableSlots = slotRows.filter(
    (slot) => slot.status === "available",
  ).length;
  const reservedSlots = slotRows.filter((slot) => slot.status === "reserved").length;
  const submittedSlots = slotRows.filter((slot) => slot.status === "submitted").length;
  const usedSlots = Math.max(0, slotTotal - availableSlots);
  const dayMetric = getDayMetric(event, now);
  const timeline = getTimeline(event, now);
  const slotPreview = buildSlotPreview(slotRows);
  const statusTitle = accepting ? "募集期間中" : eventStatusLabel(status);

  return (
    <div className={styles.page} style={accentVar}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>EVENT</p>
          <h1 className={styles.heroTitle}>{event.title}</h1>
          {event.explanation ? (
            <p className={styles.heroLead}>{event.explanation}</p>
          ) : null}
        </div>
        <div className={styles.heroActions}>
          <span className={styles.statusPill}>{statusTitle}</span>
          {accepting ? (
            <Link href={`/event/${event.id}/slots`} className={styles.reserveButton}>
              枠を確保する <Icon name="chevron-right" size={14} aria-hidden />
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
          label="SLOTS"
          value={
            <>
              {usedSlots}
              <span>/{slotTotal}</span>
            </>
          }
        />
        <StatCard
          label={dayMetric.label}
          value={
            <>
              {dayMetric.value}
              <span>日</span>
            </>
          }
        />
      </section>

      <section className={styles.recruitCard} aria-label="募集状況">
        <div className={styles.recruitMain}>
          <p className={styles.cardCode}>{event.id}</p>
          <h2>{statusTitle}</h2>
          <div className={styles.ruler}>
            <span className={styles.monthStart}>{timeline.startLabel}</span>
            <span className={styles.monthMid}>{timeline.midLabel}</span>
            <span className={styles.monthEnd}>{timeline.endLabel}</span>
            <span className={styles.rulerLine} />
            <span
              className={styles.rulerMarker}
              style={{ left: `${timeline.markerPct}%` }}
            >
              {timeline.markerLabel}
            </span>
            <span
              className={styles.rulerWindow}
              style={{
                left: `${timeline.windowLeftPct}%`,
                width: `${timeline.windowWidthPct}%`,
              }}
            />
          </div>
          <div className={styles.recruitFacts}>
            <MiniFact label="ENTRIES" value={formatCount(eventVideoTotal)} />
            <MiniFact label="CREATORS" value={formatCount(creatorTotal)} />
            <MiniFact
              label="SLOTS LEFT"
              value={`${availableSlots}/${slotTotal}`}
            />
            <MiniFact label="EVENT" value={event.title} wide />
          </div>
        </div>
        <div className={styles.recruitAside}>
          <Link href={`/event/${event.id}/slots`} className={styles.cardLink}>
            詳細ページへ <Icon name="chevron-right" size={14} aria-hidden />
          </Link>
          <div className={styles.daysBox}>
            <span>{dayMetric.label}</span>
            <strong>
              {dayMetric.value}
              <small>日</small>
            </strong>
            <em>{dayMetric.caption}</em>
          </div>
        </div>
      </section>

      {slotPreview ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>SLOT TABLE - 上映枠</p>
              <h2 className={styles.sectionTitle}>上映枠</h2>
            </div>
            <div className={styles.legend}>
              <span><i data-kind="available" />Available</span>
              <span><i data-kind="reserved" />Reserved</span>
              <span><i data-kind="submitted" />Submitted</span>
              <span><i data-kind="priority" />優先再取得中</span>
            </div>
          </div>
          <div className={styles.slotTableWrap}>
            <table className={styles.slotTable}>
              <thead>
                <tr>
                  <th />
                  {slotPreview.dates.map((date) => (
                    <th key={date.key}>{date.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slotPreview.times.map((time) => (
                  <tr key={time.key}>
                    <th>{time.label}</th>
                    {slotPreview.dates.map((date) => {
                      const cell = slotPreview.cells.get(`${date.key}:${time.key}`);
                      return (
                        <td
                          key={`${date.key}-${time.key}`}
                          data-status={cell?.status ?? "empty"}
                        >
                          {cell ? (
                            <>
                              <span>{slotDisplayName(cell)}</span>
                              <em>{slotStatusLabel(cell.status)}</em>
                            </>
                          ) : (
                            <span>-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {publicEditors.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>CREW - 運営メンバー</p>
              <h2 className={styles.sectionTitle}>Crew</h2>
            </div>
          </div>
          <div className={styles.crewGrid}>
            {publicEditors.map((member) => (
              <Link
                key={`${member.x_user_id}-${member.role}`}
                href={`/user/${member.x_user_id}`}
                className={styles.crewCard}
              >
                <div className={styles.crewTop}>
                  {member.icon_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={member.icon_url} alt="" />
                  ) : (
                    <span>{getInitial(member.x_name ?? member.x_user_id)}</span>
                  )}
                  <em>
                    {member.public_role_label ??
                      (member.role === "representative"
                        ? "REPRESENTATIVE"
                        : "EDITOR")}
                  </em>
                </div>
                <strong>{member.x_name ?? member.x_user_id}</strong>
                <small>X @ {member.x_user_id}</small>
                <p>{member.role === "representative" ? "event - slots - members" : "event - questions"}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>SUBMITTED - 提出済み</p>
            <h2 className={styles.sectionTitle}>Submitted videos</h2>
          </div>
          {eventVideoTotal > eventVideos.length ? (
            <Link href={`/list?event=${encodeURIComponent(event.id)}`} className={styles.moreLink}>
              すべて見る <Icon name="chevron-right" size={13} aria-hidden />
            </Link>
          ) : null}
        </div>
        {eventVideos.length === 0 ? (
          <p className={styles.emptyText}>
            このイベントの提出済み作品はまだ表示できません。
          </p>
        ) : (
          <div className={styles.videoGrid}>
            {eventVideos.map((video) => (
              <EventVideoCard key={video.id} video={video} />
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

function MiniFact({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}): React.ReactElement {
  return (
    <span className={wide ? styles.miniFactWide : styles.miniFact}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function EventVideoCard({ video }: { video: EventVideo }): React.ReactElement {
  const thumb = youtubeThumbUrl(video.youtube_video_id, "hqdefault");
  return (
    <Link
      href={`/${video.youtube_video_id ?? video.id}`}
      className={styles.videoCard}
      prefetch={false}
    >
      <span className={styles.videoThumb}>
        {thumb ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={thumb} alt="" loading="lazy" />
        ) : null}
        {video.duration_seconds ? (
          <em>{formatDuration(video.duration_seconds)}</em>
        ) : null}
      </span>
      <strong>{video.title}</strong>
      <span className={styles.videoMeta}>
        {video.icon_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={video.icon_url} alt="" loading="lazy" />
        ) : (
          <i>{getInitial(video.display_name)}</i>
        )}
        <span>{video.display_name}</span>
        {video.score > 0 ? <small>{formatCount(video.score)}</small> : null}
      </span>
    </Link>
  );
}

function formatRange(start: number | null, end: number | null): string {
  if (start == null && end == null) return "-";
  const s = start != null ? formatMonthDay(start) : "-";
  const e = end != null ? formatMonthDay(end) : "-";
  return `${s} - ${e}`;
}

function formatMonthDay(ts: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts * 1000));
}

function getInitial(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().replace(/^@/, "");
  return trimmed.slice(0, 1).toLowerCase() || "?";
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

function getTimeline(event: EventRow, now: number) {
  const start = event.entry_start_time ?? event.start_time ?? now;
  const end = event.end_time ?? event.entry_end_time ?? start + 86400;
  const span = Math.max(1, end - start);
  const markerPct = clampPct(((now - start) / span) * 100);
  const windowStart = event.start_time ?? start;
  const windowEnd = event.end_time ?? end;
  const windowLeftPct = clampPct(((windowStart - start) / span) * 100);
  const windowRightPct = clampPct(((windowEnd - start) / span) * 100);
  return {
    startLabel: monthLabel(start),
    midLabel: monthLabel(start + span / 2),
    endLabel: monthLabel(end),
    markerLabel: formatMonthDay(now),
    markerPct,
    windowLeftPct,
    windowWidthPct: Math.max(2, windowRightPct - windowLeftPct),
  };
}

function monthLabel(ts: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
  }).format(new Date(ts * 1000));
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
    .slice(0, 8)
    .map((key) => ({ key, label: key }));
  const cells = new Map<string, SlotRow>();
  for (const slot of timed) {
    const dateKey = slotDateKey(slot.start_time ?? 0);
    const timeKey = slotTimeKey(slot.start_time ?? 0);
    if (!dateKeys.has(dateKey) || !times.some((time) => time.key === timeKey)) {
      continue;
    }
    cells.set(`${dateKey}:${timeKey}`, slot);
  }
  return { dates, times, cells };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function slotDateKey(ts: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts * 1000));
}

function slotDateLabel(key: string): string {
  const [year, month, day] = key.split("/");
  const date = new Date(`${year}-${month}-${day}T00:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(date);
  return `${month}/${day} ${weekday}`;
}

function slotTimeKey(ts: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts * 1000));
}

function slotDisplayName(slot: SlotRow): string {
  if (slot.status === "available") return "空き枠";
  return slot.display_name ?? slot.x_user_id ?? "確保済";
}

function slotStatusLabel(status: SlotRow["status"]): string {
  if (status === "submitted") return "提出済";
  if (status === "reserved") return "確保済";
  return "空き";
}

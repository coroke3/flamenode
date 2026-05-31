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
  videos,
  videoEvents,
  xUsers,
} from "@/lib/db/schema";
import { fetchEventWithEditors } from "@/lib/db/queries";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatUnix } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

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

    const eventVideos = (await db
      .select({
        id: videos.id,
        title: videos.title,
        youtube_video_id: videos.youtube_video_id,
        display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.creator_display_name}, ${videos.creator_x_user_id})`,
        icon_url: sql<
          string | null
        >`COALESCE(${videos.creator_icon_url}, ${xUsers.icon_url})`,
        creator_x_user_id: videos.creator_x_user_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.visibility_status,
      })
      .from(videos)
      .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_x_user_id))
      .where(
        and(
          eq(videoEvents.event_id, id),
          eq(videos.visibility_status, "public"),
        )!,
      )
      .orderBy(asc(videos.scheduled_time), asc(videos.id))) as VideoCardData[];

    const eventVideoCountRow = (
      await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(videos)
        .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
        .where(
          and(
            eq(videoEvents.event_id, id),
            eq(videos.visibility_status, "public"),
          )!,
        )
        .limit(1)
    )[0];
    const eventVideoTotal = Number(eventVideoCountRow?.c ?? 0);

    const slotRows = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.event_id, id))
      .orderBy(
        asc(slotsTable.start_time),
        asc(slotsTable.end_time),
        asc(slotsTable.sort_order),
      );

    return { data, eventVideos, slotRows, eventVideoTotal };
  });

  if (!bundle) notFound();

  const {
    data: { event, editors },
    eventVideos,
    slotRows,
    eventVideoTotal,
  } = bundle;

  const visibleVideos = eventVideos.filter(
    (video) =>
      video.status === "public",
  );
  const firstVisibleVideo = visibleVideos[0] ?? null;
  const firstVisibleHref = firstVisibleVideo
    ? `/${firstVisibleVideo.youtube_video_id ?? firstVisibleVideo.id}`
    : null;

  const accentVar = {
    "--event-accent": event.accent_color ?? "var(--accent-primary)",
  } as React.CSSProperties;
  const publicEditors = editors.filter((editor) => editor.is_public === 1);
  const status = computeEventStatus(event);
  const accepting = isAcceptingEntries(event);
  const now = Math.floor(Date.now() / 1000);
  const entryNotStartedYet =
    !accepting &&
    event.is_entry_open === 1 &&
    event.entry_start_time != null &&
    now < event.entry_start_time;
  const entryClosed =
    !accepting &&
    event.is_entry_open === 1 &&
    event.entry_end_time != null &&
    now > event.entry_end_time;

  const slotTotal = slotRows.length;
  const availableSlots = slotRows.filter(
    (slot) => slot.status === "available",
  ).length;
  const filledSlots =
    slotTotal > 0 ? Math.max(0, slotTotal - availableSlots) : null;
  const slotFillRatio =
    filledSlots != null && slotTotal > 0
      ? Math.min(100, Math.round((filledSlots / slotTotal) * 100))
      : null;
  const infoItems = [
    event.start_time != null ? `開催 ${formatUnix(event.start_time)}` : null,
    event.entry_end_time != null
      ? `募集締切 ${formatUnix(event.entry_end_time)}`
      : null,
    slotTotal > 0 ? `残り枠 ${availableSlots} / ${slotTotal}` : null,
    `投稿数 ${eventVideoTotal}`,
    accepting ? "エントリー受付中" : eventStatusLabel(status),
  ].filter(Boolean) as string[];

  return (
    <div className={styles.page} style={accentVar}>
      <section className={styles.hero}>
        <div
          className={styles.heroBanner}
          style={
            event.img_url ? { backgroundImage: `url(${event.img_url})` } : undefined
          }
        />
        <div className={styles.heroBody}>
          <div className={styles.heroMeta}>
            <span className={`fn-badge ${eventStatusBadgeClass(status)}`}>
              {eventStatusLabel(status)}
            </span>
            {accepting ? (
              <span className="fn-badge fn-badge-soft">受付中</span>
            ) : entryNotStartedYet ? (
              <span className="fn-badge fn-badge-warning">募集開始前</span>
            ) : entryClosed ? (
              <span className="fn-badge fn-badge-neutral">募集終了</span>
            ) : null}
            <span>
              {formatUnix(event.start_time, { dateOnly: true })}
              {event.end_time
                ? ` - ${formatUnix(event.end_time, { dateOnly: true })}`
                : ""}
            </span>
            {event.entry_start_time != null || event.entry_end_time != null ? (
              <span className={styles.entryPeriod}>
                募集:{" "}
                {event.entry_start_time != null
                  ? formatUnix(event.entry_start_time)
                  : "-"}
                {" - "}
                {event.entry_end_time != null
                  ? formatUnix(event.entry_end_time)
                  : "-"}
              </span>
            ) : null}
          </div>

          <h1 className={styles.heroTitle}>{event.title}</h1>
          {event.explanation ? (
            <p className={styles.heroExplain}>{event.explanation}</p>
          ) : null}

          <div className={styles.heroActions}>
            {firstVisibleHref ? (
              <Link
                href={firstVisibleHref}
                className="fn-btn fn-btn-primary"
              >
                <Icon name="play" size={14} aria-hidden />
                作品を見る
              </Link>
            ) : null}
            {accepting ? (
              <Link href={`/event/${event.id}/slots`} className="fn-btn fn-btn-primary">
                <Icon name="calendar" size={14} aria-hidden />
                枠を確保する
              </Link>
            ) : null}
            <Link href="/event" className="fn-btn fn-btn-ghost">
              イベント一覧へ
            </Link>
          </div>

          {slotFillRatio != null && filledSlots != null ? (
            <div className={styles.heroSlotMeter}>
              <div className={styles.heroSlotMeterHead}>
                <span>参加枠 {filledSlots} / {slotTotal}</span>
                <span>{slotFillRatio}% 埋まり</span>
              </div>
              <span className={styles.heroSlotMeterTrack}>
                <span
                  className={styles.heroSlotMeterFill}
                  style={{ width: `${slotFillRatio}%` }}
                />
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {infoItems.length > 0 ? (
        <section className={styles.infoStrip} aria-label="イベント情報">
          <div className={styles.infoStripTrack}>
            {infoItems.map((item) => (
              <span key={item} className={styles.infoStripItem}>
                {item}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {publicEditors.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Icon name="users" size={16} aria-hidden />
            運営メンバー
          </h2>
          <div className={styles.staffList}>
            {publicEditors.map((member) => (
              <Link
                key={`${member.x_user_id}-${member.role}`}
                href={`/user/${member.x_user_id}`}
                className={styles.staff}
              >
                {member.icon_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={member.icon_url}
                    alt=""
                    className={styles.staffIcon}
                  />
                ) : (
                  <span className={styles.staffIconFb}>
                    <Icon name="user" size={14} aria-hidden />
                  </span>
                )}
                <div className={styles.staffBody}>
                  <span className={styles.staffName}>
                    {member.x_name ?? member.x_user_id}
                  </span>
                  <span className={styles.staffRole}>
                    {member.public_role_label ??
                      (member.role === "representative" ? "代表" : "運営")}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {slotRows.length > 0 || accepting ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Icon name="clock" size={16} aria-hidden />
            予約枠
          </h2>
          <div className={styles.slotSummary}>
            <div>
              <p className={styles.slotSummaryLead}>
                枠の確保・解放・連続枠の操作は専用ページで行います。
              </p>
              <div className={styles.slotSummaryStats}>
                <span>残り {availableSlots} / {slotTotal} 枠</span>
                {slotFillRatio != null ? <span>{slotFillRatio}% 埋まり</span> : null}
                <span>{accepting ? "受付中" : eventStatusLabel(status)}</span>
              </div>
            </div>
            <Link href={`/event/${event.id}/slots`} className="fn-btn fn-btn-primary">
              <Icon name="calendar" size={14} aria-hidden />
              枠確保ページへ
            </Link>
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="grid" size={16} aria-hidden />
          作品 ({eventVideoTotal})
        </h2>
        {visibleVideos.length === 0 ? (
          <div className="fn-empty">
            <Icon name="info" size={20} aria-hidden />
            <p className="fn-empty-message">
              まだこのイベントに作品が投稿されていません。
            </p>
          </div>
        ) : (
          <div className={styles.videoGrid}>
            {visibleVideos.map((video, index) => (
              <div key={`${video.id}-event-video-${index}`}>
                <VideoCard video={video} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

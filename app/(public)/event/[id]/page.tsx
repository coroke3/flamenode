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
import { getCurrentUser } from "@/lib/auth/currentUser";
import { fetchEventWithEditors } from "@/lib/db/queries";
import {
  computeEventStatus,
  eventStatusBadgeClass,
  eventStatusLabel,
  isAcceptingEntries,
} from "@/lib/utils/eventStatus";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { SlotGrid, type SlotRow } from "@/components/event/SlotGrid";
import { SlotStatusBoard } from "@/components/event/SlotStatusBoard";
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
        display_name: sql<string>`COALESCE(${xUsers.x_name}, ${videos.display_name}, ${videos.contact_x_id})`,
        icon_url: sql<
          string | null
        >`COALESCE(${videos.icon_url}, ${xUsers.icon_url})`,
        creator_id: videos.creator_id,
        primary_event_id: videos.primary_event_id,
        scheduled_time: videos.scheduled_time,
        status: videos.status,
      })
      .from(videos)
      .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
      .leftJoin(xUsers, eq(xUsers.id, videos.creator_id))
      .where(
        and(
          eq(videoEvents.event_id, id),
          eq(videos.is_deleted, 0),
          eq(videos.is_manual_hidden, 0),
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
            eq(videos.is_deleted, 0),
            eq(videos.is_manual_hidden, 0),
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
      video.status === "public" ||
      video.status === "x_reapply_required" ||
      video.status === "unlisted",
  );

  const accentVar = {
    "--event-accent": event.accent_color ?? "#ffd400",
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

  const viewer = await getCurrentUser();

  const slotRowsForGrid: SlotRow[] = slotRows.map((slot) => ({
    id: slot.id,
    slot_kind: (slot.slot_kind ?? "time") as "time" | "count",
    slot_label: slot.slot_label,
    start_time: slot.start_time,
    end_time: slot.end_time,
    sort_order: slot.sort_order,
    status: slot.status,
    display_name: slot.display_name,
    x_user_id: slot.x_user_id,
    discord_user_id: slot.discord_user_id,
    reservation_group_id: slot.reservation_group_id,
  }));

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
            {visibleVideos.length > 0 ? (
              <Link
                href={`/${visibleVideos[0]?.youtube_video_id ?? visibleVideos[0]?.id}?playlist=${event.id}`}
                className="fn-btn fn-btn-primary"
              >
                <Icon name="play" size={14} aria-hidden />
                作品を見る
              </Link>
            ) : null}
            {accepting ? (
              <Link href="#slot" className="fn-btn fn-btn-primary">
                <Icon name="calendar" size={14} aria-hidden />
                エントリーする
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
        <section className={styles.infoTicker} aria-label="イベント情報">
          <div className={styles.infoTickerTrack}>
            {[...infoItems, ...infoItems].map((item, index) => (
              <span key={`${item}-${index}`} className={styles.infoTickerItem}>
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
        <section id="slot" className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Icon name="clock" size={16} aria-hidden />
            予約枠
          </h2>
          <div className={styles.slotLayout}>
            <div className={styles.slotMain}>
              <SlotGrid
                slots={slotRowsForGrid}
                viewerXId={viewer?.active_x_user_id ?? null}
                viewerActiveX={viewer?.active_x_user_id ?? null}
                viewerDiscordId={viewer?.id ?? null}
                canReserve={accepting}
                slotKind={(event.slot_type ?? "time") as "time" | "count"}
                maxConsecutiveSlots={event.max_consecutive_slots_per_entry ?? 1}
                slotPartGapSec={(event.slot_part_gap_minutes ?? 30) * 60}
              />
              {!accepting ? (
                <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
                  <Icon name="info" size={12} aria-hidden />{" "}
                  {status === "ended"
                    ? "終了済みのため新規確保はできません。"
                    : status === "scheduled"
                      ? "受付開始までお待ちください。"
                      : "現在は受付停止中です。"}
                </p>
              ) : !viewer?.id ? (
                <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
                  <Icon name="info" size={12} aria-hidden /> 確保には{" "}
                  <Link
                    href={`/entry?next=${encodeURIComponent(`/event/${event.id}#slot`)}`}
                  >
                    ログイン
                  </Link>{" "}
                  とアクティブ X ID が必要です。
                </p>
              ) : !viewer.active_x_user_id ? (
                <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
                  <Icon name="info" size={12} aria-hidden /> アクティブ X ID
                  を選択してください ({" "}
                  <Link
                    href={`/dashboard/settings?next=${encodeURIComponent(`/event/${event.id}#slot`)}`}
                  >
                    設定
                  </Link>{" "}
                  )。
                </p>
              ) : null}
            </div>
            <aside className={styles.slotAside}>
              <SlotStatusBoard
                slots={slotRowsForGrid}
                slotPartGapSec={(event.slot_part_gap_minutes ?? 30) * 60}
              />
            </aside>
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
                <VideoCard
                  video={video}
                  href={`/${video.youtube_video_id ?? video.id}?playlist=${event.id}`}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

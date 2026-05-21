import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { getDatabase, withDatabase } from "@/lib/cloudflare";
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
  const ev = await withDatabase(async (db) => {
    const res = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1);
    return res[0] ?? null;
  });
  return ev?.title ? { title: ev.title } : { title: id };
}

export default async function EventDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;

  const bundle = await withDatabase(async (db) => {
    const data = await fetchEventWithEditors(db, id);
    if (!data) return null;

    // 作品取得 (上映順 = scheduled_time 昇順)。
    // イベントが大きくなりすぎたとき詳細ページが重くなるのを避けるため、
    // 48 件で頭打ち。「すべて見る」は /list?event=... へ誘導 (DB側ページング済み)。
    const EVENT_PREVIEW_LIMIT = 48;
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
        )!,
      )
      .orderBy(asc(videos.scheduled_time))
      .limit(EVENT_PREVIEW_LIMIT)) as VideoCardData[];

    const eventVideoCountRow = (
      await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(videos)
        .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
        .where(and(eq(videoEvents.event_id, id), eq(videos.is_deleted, 0))!)
        .limit(1)
    )[0];
    const eventVideoTotal = Number(eventVideoCountRow?.c ?? 0);

    // スロット
    const slotRows = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.event_id, id))
      .orderBy(asc(slotsTable.start_time), asc(slotsTable.end_time), asc(slotsTable.sort_order));

    return { data, eventVideos, slotRows, eventVideoTotal };
  });

  if (!bundle) notFound();
  const {
    data: { event, editors },
    eventVideos,
    slotRows,
    eventVideoTotal,
  } = bundle;
  const eventVideoHidden = Math.max(0, eventVideoTotal - eventVideos.length);

  const visibleVideos = eventVideos.filter(
    (v) =>
      v.status === "public" ||
      v.status === "x_reapply_required" ||
      v.status === "unlisted",
  );

  const accentVar = event.accent_color
    ? ({ ["--event-accent" as never]: event.accent_color } as React.CSSProperties)
    : undefined;
  const publicEditors = editors.filter((e) => e.is_public === 1);
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

  const slotRowsForGrid: SlotRow[] = slotRows.map((s) => ({
    id: s.id,
    slot_kind: (s.slot_kind ?? "time") as "time" | "count",
    slot_label: s.slot_label,
    start_time: s.start_time,
    end_time: s.end_time,
    sort_order: s.sort_order,
    status: s.status,
    display_name: s.display_name,
    x_user_id: s.x_user_id,
    discord_user_id: s.discord_user_id,
    reservation_group_id: s.reservation_group_id,
  }));

  return (
    <div className={styles.page} style={accentVar}>
      <section className={styles.hero}>
        <div
          className={styles.heroBanner}
          style={event.img_url ? { backgroundImage: `url(${event.img_url})` } : undefined}
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
                ? ` 〜 ${formatUnix(event.end_time, { dateOnly: true })}`
                : ""}
            </span>
            {(event.entry_start_time != null || event.entry_end_time != null) ? (
              <span className={styles.entryPeriod}>
                募集:{" "}
                {event.entry_start_time != null
                  ? formatUnix(event.entry_start_time)
                  : "—"}
                {" 〜 "}
                {event.entry_end_time != null
                  ? formatUnix(event.entry_end_time)
                  : "—"}
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
                全作品を連続再生
              </Link>
            ) : null}
            {visibleVideos.length > 0 ? (
              <Link
                href={`/list?event=${event.id}`}
                className="fn-btn fn-btn-ghost"
              >
                <Icon name="grid" size={14} aria-hidden />
                このイベントの作品を一覧で見る
              </Link>
            ) : null}
            <Link href="/event" className="fn-btn fn-btn-ghost">
              一覧へ戻る
            </Link>
          </div>
        </div>
      </section>

      {publicEditors.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Icon name="users" size={16} aria-hidden />
            運営メンバー
          </h2>
          <div className={styles.staffList}>
            {publicEditors.map((m) => (
              <Link
                key={`${m.x_user_id}-${m.role}`}
                href={`/user/${m.x_user_id}`}
                className={styles.staff}
              >
                {m.icon_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={m.icon_url} alt="" className={styles.staffIcon} />
                ) : (
                  <span className={styles.staffIconFb}>
                    <Icon name="user" size={14} aria-hidden />
                  </span>
                )}
                <div className={styles.staffBody}>
                  <span className={styles.staffName}>
                    {m.x_name ?? m.x_user_id}
                  </span>
                  <span className={styles.staffRole}>
                    {m.public_role_label ?? (m.role === "representative" ? "代表" : "運営")}
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
                <p
                  className="fn-muted fn-text-sm"
                  style={{ marginTop: 8 }}
                >
                  <Icon name="info" size={12} aria-hidden />{" "}
                  {status === "ended"
                    ? "終了済みのため新規確保はできません。"
                    : status === "scheduled"
                      ? "受付開始までお待ちください。"
                      : "現在は受付停止中です。"}
                </p>
              ) : !viewer?.id ? (
                <p
                  className="fn-muted fn-text-sm"
                  style={{ marginTop: 8 }}
                >
                  <Icon name="info" size={12} aria-hidden /> 確保には{" "}
                  <Link
                    href={`/entry?next=${encodeURIComponent(`/event/${event.id}#slot`)}`}
                  >
                    ログイン
                  </Link>{" "}
                  とアクティブ X ID が必要です。
                </p>
              ) : !viewer.active_x_user_id ? (
                <p
                  className="fn-muted fn-text-sm"
                  style={{ marginTop: 8 }}
                >
                  <Icon name="info" size={12} aria-hidden /> アクティブ X ID を選択してください ({" "}
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
          {eventVideoHidden > 0 ? (
            <Link
              href={`/list?event=${event.id}`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
              style={{ marginLeft: 8 }}
            >
              すべて見る ({eventVideoTotal} 件)
            </Link>
          ) : null}
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
            {visibleVideos.map((v, index) => (
              <div key={`${v.id}-event-video-${index}`}>
                <VideoCard video={v} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

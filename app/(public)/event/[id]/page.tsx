import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq } from "drizzle-orm";
import styles from "./page.module.css";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  videos,
  videoEvents,
} from "@/lib/db/schema";
import { fetchEventWithEditors } from "@/lib/db/queries";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatUnix } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: id };
  const ev = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, id))
    .limit(1);
  return ev[0]?.title ? { title: ev[0].title } : { title: "イベント" };
}

export default async function EventDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) notFound();

  const data = await fetchEventWithEditors(db, id);
  if (!data) notFound();
  const { event, editors } = data;

  // 作品取得 (上映順 = scheduled_time 昇順)
  const eventVideos = (await db
    .select({
      id: videos.id,
      title: videos.title,
      youtube_video_id: videos.youtube_video_id,
      display_name: videos.display_name,
      icon_url: videos.icon_url,
      creator_id: videos.creator_id,
      primary_event_id: videos.primary_event_id,
      scheduled_time: videos.scheduled_time,
      status: videos.status,
    })
    .from(videos)
    .innerJoin(videoEvents, eq(videos.id, videoEvents.video_id))
    .where(
      and(
        eq(videoEvents.event_id, id),
        eq(videos.is_deleted, 0),
      )!,
    )
    .orderBy(asc(videos.scheduled_time))) as VideoCardData[];

  const visibleVideos = eventVideos.filter(
    (v) =>
      v.status === "public" ||
      v.status === "x_reapply_required" ||
      v.status === "unlisted",
  );

  // スロット
  const slotRows = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.event_id, id))
    .orderBy(asc(slotsTable.start_time), asc(slotsTable.sort_order));

  const accentVar = event.accent_color
    ? ({ ["--event-accent" as never]: event.accent_color } as React.CSSProperties)
    : undefined;
  const publicEditors = editors.filter((e) => e.is_public === 1);

  return (
    <div className={styles.page} style={accentVar}>
      <section className={styles.hero}>
        <div
          className={styles.heroBanner}
          style={event.img_url ? { backgroundImage: `url(${event.img_url})` } : undefined}
        />
        <div className={styles.heroBody}>
          <div className={styles.heroMeta}>
            {event.is_active === 1 ? (
              <span className="fn-badge fn-badge-accent">開催中</span>
            ) : event.is_archived === 1 ? (
              <span className="fn-badge fn-badge-neutral">アーカイブ</span>
            ) : null}
            <span>
              {formatUnix(event.start_time, { dateOnly: true })}
              {event.end_time
                ? ` 〜 ${formatUnix(event.end_time, { dateOnly: true })}`
                : ""}
            </span>
          </div>
          <h1 className={styles.heroTitle}>{event.title}</h1>
          {event.explanation ? (
            <p className={styles.heroExplain}>{event.explanation}</p>
          ) : null}
          <div className={styles.heroActions}>
            {event.is_entry_open === 1 ? (
              <Link
                href={`/entry?event=${event.id}`}
                className="fn-btn fn-btn-primary"
              >
                <Icon name="calendar" size={14} aria-hidden />
                スロットを確保する
              </Link>
            ) : null}
            {visibleVideos.length > 0 ? (
              <Link
                href={`/${visibleVideos[0]?.youtube_video_id ?? visibleVideos[0]?.id}?playlist=${event.id}`}
                className="fn-btn fn-btn-ghost"
              >
                <Icon name="play" size={14} aria-hidden />
                全作品を連続再生
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

      {slotRows.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Icon name="clock" size={16} aria-hidden />
            予約枠
          </h2>
          <div className={styles.slotTable}>
            <table className="fn-table">
              <thead>
                <tr>
                  <th>日付</th>
                  <th>時間</th>
                  <th>取得者</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {slotRows.map((slot) => (
                  <tr key={slot.id}>
                    <td>
                      {slot.start_time
                        ? formatUnix(slot.start_time, { dateOnly: true })
                        : slot.slot_label || "—"}
                    </td>
                    <td>
                      {slot.start_time
                        ? formatUnix(slot.start_time, { timeOnly: true })
                        : "—"}
                    </td>
                    <td>
                      {slot.x_user_id ? (
                        <Link href={`/user/${slot.x_user_id}`}>
                          {slot.display_name ?? slot.x_user_id}
                        </Link>
                      ) : (
                        <span className="fn-muted">—</span>
                      )}
                    </td>
                    <td>
                      {slot.status === "available" ? (
                        slot.priority_reclaim_until ? (
                          <span className="fn-badge fn-badge-neutral">
                            確保処理中
                          </span>
                        ) : (
                          <span className="fn-badge fn-badge-soft">空き</span>
                        )
                      ) : slot.status === "submitted" ? (
                        <span className="fn-badge fn-badge-accent">提出済</span>
                      ) : (
                        <span className="fn-badge fn-badge-warning">確保済</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="grid" size={16} aria-hidden />
          作品 ({visibleVideos.length})
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
            {visibleVideos.map((v) => (
              <div key={v.id}>
                <VideoCard video={v} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

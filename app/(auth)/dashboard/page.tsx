import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import styles from "./page.module.css";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { getApprovedXIds } from "@/lib/auth/ownership";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatUnix, formatRelative } from "@/lib/utils/format";

export const metadata: Metadata = { title: "ダッシュボード" };
export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const guard = await requireSession();
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const db = getDatabase();

  let xIds: (typeof xUsersTable.$inferSelect)[] = [];
  let myVideos: VideoCardData[] = [];
  let mySlot: typeof slotsTable.$inferSelect | null = null;
  let mySlotEvent: typeof eventsTable.$inferSelect | null = null;
  let stats = { likes: 0, views: 0, video_count: 0, event_count: 0 };

  if (db) {
    try {
      xIds = await db
        .select()
        .from(xUsersTable)
        .where(eq(xUsersTable.linked_discord_user_id, user.id));

      // 「自分の作品」= 承認済み X ID の creator_id に一致する作品のみ。
      // owner_discord_user_id 単独一致は legacy import 混入を避けるため判定対象外にする。
      const approvedXIds = await getApprovedXIds(db, user.id);
      if (approvedXIds.length > 0) {
        myVideos = (await db
          .select({
            id: videosTable.id,
            title: videosTable.title,
            youtube_video_id: videosTable.youtube_video_id,
            display_name: sql<string>`COALESCE(${videosTable.display_name}, ${xUsersTable.x_name}, '@' || ${videosTable.contact_x_id})`,
            icon_url: sql<
              string | null
            >`COALESCE(${videosTable.icon_url}, ${xUsersTable.icon_url})`,
            creator_id: videosTable.creator_id,
            primary_event_id: videosTable.primary_event_id,
            scheduled_time: videosTable.scheduled_time,
            status: videosTable.status,
          })
          .from(videosTable)
          .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_id))
          .where(
            and(
              inArray(videosTable.creator_id, approvedXIds),
              eq(videosTable.is_deleted, 0),
            )!,
          )
          .orderBy(desc(videosTable.created_at))
          .limit(12)) as VideoCardData[];
      }

      // 直近のアクティブスロット (reserved or x_reapply_required)
      const slotRows = await db
        .select()
        .from(slotsTable)
        .where(eq(slotsTable.discord_user_id, user.id))
        .orderBy(desc(slotsTable.updated_at))
        .limit(1);
      mySlot = slotRows[0] ?? null;
      if (mySlot) {
        const ev = await db
          .select()
          .from(eventsTable)
          .where(eq(eventsTable.id, mySlot.event_id))
          .limit(1);
        mySlotEvent = ev[0] ?? null;
      }

      // 集計
      if (approvedXIds.length > 0) {
        const aggRows = await db
          .select({
            likes: sql<number>`COALESCE(SUM(${videosTable.like_count}),0)`,
            views: sql<number>`COALESCE(SUM(${videosTable.youtube_view_count}),0)`,
            c: sql<number>`COUNT(*)`,
            ec: sql<number>`COUNT(${videosTable.primary_event_id})`,
          })
          .from(videosTable)
          .where(
            and(
              inArray(videosTable.creator_id, approvedXIds),
              eq(videosTable.is_deleted, 0),
            )!,
          );
        stats = {
          likes: Number(aggRows[0]?.likes ?? 0),
          views: Number(aggRows[0]?.views ?? 0),
          video_count: Number(aggRows[0]?.c ?? 0),
          event_count: Number(aggRows[0]?.ec ?? 0),
        };
      }
    } catch (e) {
      console.error("[DashboardPage] fetch failed", e);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>ダッシュボード</h1>
        <p>
          {user.name} としてサインイン中。X ID 連携、作品投稿、イベント参加状況を一覧できます。
        </p>
      </header>

      <HeroCard slot={mySlot} event={mySlotEvent} />

      <section className={styles.statsGrid}>
        <Stat label="累計いいね" value={stats.likes.toLocaleString()} />
        <Stat label="累計再生数" value={stats.views.toLocaleString()} />
        <Stat label="投稿作品" value={`${stats.video_count} 本`} />
        <Stat label="参加イベント" value={`${stats.event_count} 本`} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>連携 X ID</h2>
        {xIds.length === 0 ? (
          <div className="fn-empty">
            <Icon name="user" size={20} aria-hidden />
            <p className="fn-empty-message">
              X ID がまだ連携されていません。
            </p>
            <Link
              href="/dashboard/settings"
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              X ID を連携する
            </Link>
          </div>
        ) : (
          <div className={styles.xidList}>
            {xIds.map((x) => (
              <div key={x.id} className={styles.xidCard}>
                {x.icon_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={x.icon_url} alt="" className={styles.xidIcon} />
                ) : (
                  <span className={styles.xidIconFb}>
                    <Icon name="user" size={16} aria-hidden />
                  </span>
                )}
                <div className={styles.xidBody}>
                  <div className={styles.xidName}>{x.x_name}</div>
                  <div className={styles.xidId}>@{x.id}</div>
                </div>
                {x.approval_status === "pending" ? (
                  <span className="fn-badge fn-badge-warning">承認待ち</span>
                ) : x.approval_status === "rejected" ? (
                  <span className="fn-badge fn-badge-danger">再申請</span>
                ) : x.id === user.active_x_user_id ? (
                  <span className="fn-badge fn-badge-accent">アクティブ</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>マイ・ギャラリー</h2>
        {myVideos.length === 0 ? (
          <div className="fn-empty">
            <Icon name="grid" size={20} aria-hidden />
            <p className="fn-empty-message">
              まだ作品が登録されていません。
            </p>
            <Link
              href="/dashboard/post"
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              作品を投稿する
            </Link>
          </div>
        ) : (
          <div className={styles.galleryGrid}>
            {myVideos.map((v) => (
              <div key={v.id}>
                <VideoCard video={v} href={`/dashboard/edit/${v.id}`} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

function HeroCard({
  slot,
  event,
}: {
  slot: typeof slotsTable.$inferSelect | null;
  event: typeof eventsTable.$inferSelect | null;
}): React.ReactElement {
  if (!slot || !event) {
    return (
      <section className="fn-card fn-mb-lg">
        <div className="fn-card-body">
          <p className="fn-muted fn-text-sm">
            現在、ステータス更新が必要なスロットはありません。
          </p>
          <p className="fn-mt-sm fn-text-sm">
            開催中のイベントがある場合は、エントリー画面から枠を確保できます。
          </p>
          <Link href="/entry" className="fn-btn fn-btn-primary fn-mt-md">
            <Icon name="calendar" size={14} aria-hidden /> エントリーへ
          </Link>
        </div>
      </section>
    );
  }

  const cardStyles =
    slot.status === "submitted"
      ? "fn-card-accent"
      : slot.priority_reclaim_until
        ? "fn-card-warning"
        : "";

  return (
    <section
      style={
        event.accent_color
          ? ({ ["--accent-primary" as never]: event.accent_color } as React.CSSProperties)
          : undefined
      }
    >
      <div className={`fn-card ${cardStyles}`} style={{ marginBottom: 24 }}>
        <div className="fn-card-body">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              color: "var(--accent-warning)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            <Icon name="alert" size={12} aria-hidden /> アクティブスロット
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>
            {event.title}
          </h2>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>
            {slot.start_time
              ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(
                  slot.start_time,
                  { timeOnly: true },
                )}`
              : (slot.slot_label ?? "未指定")}
            {" · "}
            <span>状態: {slot.status}</span>
            {slot.priority_reclaim_until
              ? ` · 確保期限 ${formatRelative(slot.priority_reclaim_until)}`
              : ""}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {slot.status === "submitted" && slot.video_id ? (
              <>
                <Link
                  href={`/dashboard/edit/${slot.video_id}`}
                  className="fn-btn fn-btn-primary"
                >
                  <Icon name="edit" size={14} aria-hidden /> 提出内容を確認
                </Link>
                <Link href={`/event/${event.id}`} className="fn-btn fn-btn-ghost">
                  イベントへ
                </Link>
              </>
            ) : slot.status === "reserved" ? (
              <Link
                href={`/dashboard/post/slotted?slot=${slot.id}`}
                className="fn-btn fn-btn-primary"
              >
                <Icon name="upload" size={14} aria-hidden /> 動画を提出する
              </Link>
            ) : (
              <Link href="/entry" className="fn-btn fn-btn-primary">
                <Icon name="calendar" size={14} aria-hidden /> 枠を確保する
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

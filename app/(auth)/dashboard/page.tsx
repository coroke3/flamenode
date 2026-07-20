import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getApprovedXIds } from "@/lib/auth/ownership";
import { getLinkedXUsersForAuthUser } from "@/lib/auth/xIdentity";
import styles from "./page.module.css";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  videoChapters as videoChaptersTable,
  videoYoutubeMetadata,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { getOnboardingState, onboardingHref } from "@/lib/auth/onboarding";
import {
  collapseReservationGroups,
  sortSlotsChronologically,
  type SlotBase,
  type SlotGroupRow,
} from "@/lib/utils/slotGrouping";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { excludePvsfSummaryVideos } from "@/lib/db/queries";

export const metadata: Metadata = { title: "ダッシュボード" };
export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/dashboard" });
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const db = getDatabase();
  const onboarding = await getOnboardingState(db, user);
  const activeX = user.active_x_user_id ?? null;
  let activeGalleryXId: string | null = null;

  let xIds: Array<{ id: string; x_name: string; icon_url: string | null; approval_status: string | null }> = [];
  let myVideos: VideoCardData[] = [];
  let mySlot: SlotGroupRow | null = null;
  let mySlotEvent: typeof eventsTable.$inferSelect | null = null;
  let myChapters: {
    id: string;
    video_id: string;
    youtube_video_id: string | null;
    video_title: string | null;
    chapter_time: number;
    chapter_label: string;
    visibility: "private" | "public" | null;
    created_at: number;
  }[] = [];
  let stats = { likes: 0, views: 0, video_count: 0, event_count: 0 };

  if (db) {
    try {
      xIds = (await getLinkedXUsersForAuthUser(db, user.id)).map((row) => ({
        id: row.x_user_id,
        x_name: row.x_name,
        icon_url: row.icon_url,
        approval_status: row.approval_status,
      }));

      // マイ・ギャラリーは現在の活動名義を確認する場所なので、
      // 表示対象をアクティブかつ承認済みの X ID に固定する。
      // チャプターと集計はアカウント全体の履歴として承認済み X ID 全件を使う。
      const approvedXIds = await getApprovedXIds(db, user.id);
      activeGalleryXId =
        activeX && approvedXIds.includes(activeX) ? activeX : null;
      if (approvedXIds.length > 0) {
        myVideos = (await db
          .select({
            id: videosTable.id,
            title: videosTable.title,
            youtube_video_id: videosTable.youtube_video_id,
            display_name: sql<string>`COALESCE(${videosTable.creator_display_name}, ${xUsersTable.x_name}, '@' || ${videosTable.creator_x_user_id})`,
            icon_url: sql<
              string | null
            >`COALESCE(${videosTable.creator_icon_url}, ${xUsersTable.icon_url})`,
            creator_x_user_id: videosTable.creator_x_user_id,
            primary_event_id: videosTable.primary_event_id,
            scheduled_time: videosTable.scheduled_time,
            status: videosTable.visibility_status,
          })
          .from(videosTable)
          .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
          .where(
            and(
              activeGalleryXId
                ? eq(videosTable.creator_x_user_id, activeGalleryXId)
                : sql`0 = 1`,
              ne(videosTable.visibility_status, "archived"),
            )!,
          )
          .orderBy(desc(videosTable.created_at))) as VideoCardData[];

        myChapters = await db
          .select({
            id: videoChaptersTable.id,
            video_id: videoChaptersTable.video_id,
            youtube_video_id: videosTable.youtube_video_id,
            video_title: videosTable.title,
            chapter_time: videoChaptersTable.chapter_time,
            chapter_label: videoChaptersTable.chapter_label,
            visibility: videoChaptersTable.visibility,
            created_at: videoChaptersTable.created_at,
          })
          .from(videoChaptersTable)
          .leftJoin(videosTable, eq(videosTable.id, videoChaptersTable.video_id))
          .where(inArray(videoChaptersTable.x_user_id, approvedXIds))
          .orderBy(desc(videoChaptersTable.created_at))
          .limit(80);
      }

      // 直近のアクティブスロット (reserved or x_reapply_required)
      const slotOwnerWhere = activeX
        ? or(
            eq(slotsTable.x_user_id, activeX),
            and(isNull(slotsTable.x_user_id), eq(slotsTable.reserved_by_user_id, user.id))!,
          )
        : eq(slotsTable.reserved_by_user_id, user.id);
      const slotRows = await db
        .select()
        .from(slotsTable)
        .where(
          and(
            slotOwnerWhere,
            or(eq(slotsTable.status, "reserved"), eq(slotsTable.status, "submitted"))!,
          )!,
        )
        .limit(50);
      const groupedSlots = collapseReservationGroups(slotRows as SlotBase[]);
      const sortedSlots = sortSlotsChronologically(groupedSlots);
      mySlot = sortedSlots[0] ?? null;
      if (mySlot && mySlot.event_id) {
        const ev = await db
          .select()
          .from(eventsTable)
          .where(eq(eventsTable.id, mySlot.event_id))
          .limit(1);
        mySlotEvent = ev[0] ?? null;
      }

      // 集計 (承認済み X ID 全件横断)
      if (approvedXIds.length > 0) {
        const aggRows = await db
          .select({
            likes: sql<number>`COALESCE(SUM(${videosTable.app_like_count}),0)`,
            views: sql<number>`COALESCE(SUM(${videoYoutubeMetadata.view_count}),0)`,
            c: sql<number>`COUNT(*)`,
            ec: sql<number>`COUNT(${videosTable.primary_event_id})`,
          })
          .from(videosTable)
          .leftJoin(
            videoYoutubeMetadata,
            eq(videoYoutubeMetadata.video_id, videosTable.id),
          )
          .where(
            and(
              inArray(videosTable.creator_x_user_id, approvedXIds),
              ne(videosTable.visibility_status, "archived"),
              excludePvsfSummaryVideos(),
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

  const activeXRow =
    xIds.find((x) => x.id === user.active_x_user_id) ?? xIds[0] ?? null;
  const dashboardName = activeXRow?.x_name ?? user.name ?? "FlameNode User";
  const dashboardHandle = activeXRow
    ? `@${activeXRow.id}`
    : user.active_x_user_id
      ? `@${user.active_x_user_id}`
      : xIds.length === 0
        ? "X ID 未連携"
        : "X ID 未選択";
  const dashboardIcon = activeXRow?.icon_url ?? user.image ?? null;
  const dashboardInitial =
    (dashboardName.trim().charAt(0) || user.name?.trim().charAt(0) || "F").toUpperCase();
  const galleryEmptyMessage =
    xIds.length === 0
      ? "X ID を連携すると、承認後に作品の投稿やマイ・ギャラリーが使えるようになります。"
      : !activeX
        ? "アクティブ X ID を設定すると、その名義の作品だけが表示されます。"
        : !activeGalleryXId
          ? "アクティブ X ID が未承認のため、マイ・ギャラリーには作品を表示していません。"
          : "アクティブ X ID の作品はまだ登録されていません。";

  return (
    <div className={`fn-public-container fn-page fn-dash ${styles.page}`}>
      <header className={`fn-dash-head ${styles.accountHeader}`}>
        <div className={`fn-dash-id ${styles.accountIdentity}`}>
          {dashboardIcon ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={dashboardIcon} alt="" className={`fn-dash-avatar ${styles.accountAvatar}`} />
          ) : (
            <span className={`fn-dash-avatar-fallback ${styles.accountAvatarFallback}`}>
              {dashboardInitial}
            </span>
          )}
          <div className="fn-dash-id-text">
            <span className="fn-eyebrow">my account</span>
            <h1 className="fn-display fn-dash-name">{dashboardName}</h1>
            <span className="fn-mono fn-dash-handle">{dashboardHandle}</span>
          </div>
        </div>
        <div className={`fn-dash-actions ${styles.accountActions}`}>
          <Link href="/dashboard/settings" className="fn-btn fn-btn-ghost fn-btn-sm">
            <Icon name="settings" size={13} aria-hidden />
            設定
          </Link>
          <Link href="/entry" className="fn-btn fn-btn-primary fn-btn-lg">
            <Icon name="plus" size={14} aria-hidden />
            新規投稿
          </Link>
        </div>
      </header>

      {!onboarding.isComplete ? (
        <div
          className="fn-pc-status-banner"
          role="status"
          style={{ marginBottom: 20 }}
        >
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">初期設定が未完了です</h3>
            <p className="fn-jp fn-pc-banner-lead">
              利用規約への同意とX ID連携を済ませると、投稿・枠確保が使えます。
            </p>
            <Link
              href={onboardingHref("/dashboard")}
              className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12"
            >
              初期設定を続ける
            </Link>
          </div>
        </div>
      ) : null}

      {!db ? (
        <div className="fn-empty" role="status">
          <p className="fn-empty-message">
            データを読み込めませんでした。しばらくしてからページを再読み込みしてください。
          </p>
        </div>
      ) : null}

      <HeroCard slot={mySlot} event={mySlotEvent} />

      <section className={`fn-dash-kpis ${styles.statsGrid}`} aria-label="アカウント統計">
        <Stat label="累計いいね" value={stats.likes.toLocaleString()} />
        <Stat label="累計再生数" value={stats.views.toLocaleString()} />
        <Stat label="投稿作品" value={`${stats.video_count} 本`} />
        <Stat label="参加イベント" value={`${stats.event_count} 本`} />
      </section>

      <section className={`fn-dash-section ${styles.section}`}>
        <h2 className={`fn-dash-section-title ${styles.sectionTitle}`}>連携 X ID</h2>
        {xIds.length === 0 ? (
          <div className="fn-empty">
            <Icon name="user" size={20} aria-hidden />
            <p className="fn-empty-message">
              X ID がまだ連携されていません。
            </p>
            <Link
              href={onboarding.isComplete ? "/dashboard/settings" : onboardingHref("/dashboard")}
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              {onboarding.isComplete ? "X ID を連携する" : "初期設定を続ける"}
            </Link>
          </div>
        ) : (
          <div className={styles.xidList}>
            {xIds.map((x, index) => (
              <div key={`${x.id}-xid-${index}`} className={styles.xidCard}>
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

      <section className={`fn-dash-section ${styles.section}`}>
        <h2 className={`fn-dash-section-title ${styles.sectionTitle}`}>マイ・ギャラリー</h2>
        {myVideos.length === 0 ? (
          <div className="fn-empty">
            <Icon name="grid" size={20} aria-hidden />
            <p className="fn-empty-message">
              {galleryEmptyMessage}
            </p>
            <Link
              href={xIds.length === 0 ? "/dashboard/settings" : "/entry"}
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              {xIds.length === 0 ? "X ID を連携する" : "作品を投稿する"}
            </Link>
          </div>
        ) : (
          <div className={`fn-gallery-grid ${styles.galleryGrid}`}>
            {myVideos.map((v, index) => (
              <div key={`${v.id}-video-${index}`}>
                <VideoCard video={v} href={`/dashboard/edit/${v.id}`} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`fn-dash-section ${styles.section}`}>
        <h2 className={`fn-dash-section-title ${styles.sectionTitle}`}>自分のチャプターコメント</h2>
        {myChapters.length === 0 ? (
          <div className="fn-empty">
            <Icon name="chapter" size={20} aria-hidden />
            <p className="fn-empty-message">
              まだ投稿したチャプターコメントはありません。
            </p>
          </div>
        ) : (
          <div className="fn-stack-list">
            {myChapters.map((chapter) => (
              <Link
                key={chapter.id}
                href={`/${chapter.youtube_video_id ?? chapter.video_id}`}
                className="fn-card fn-stack-item"
              >
                <div className="fn-stack-item-head">
                  <strong className="fn-stack-item-title">
                    {chapter.chapter_label}
                  </strong>
                  <span className={`fn-badge ${chapter.visibility === "private" ? "fn-badge-warning" : "fn-badge-accent"}`}>
                    {chapter.visibility === "private" ? "非公開" : "公開"}
                  </span>
                </div>
                <div className="fn-stack-item-meta">
                  {chapter.video_title ?? chapter.video_id} / {Math.floor(chapter.chapter_time)}秒 / {formatRelative(chapter.created_at)}
                </div>
              </Link>
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
    <div className={`fn-dash-kpi ${styles.statCard}`}>
      <span className="fn-dash-kpi-v">{value}</span>
      <span className="fn-dash-kpi-k fn-jp">{label}</span>
    </div>
  );
}

function HeroCard({
  slot,
  event,
}: {
  slot: SlotGroupRow | null;
  event: typeof eventsTable.$inferSelect | null;
}): React.ReactElement {
  if (!slot || !event) {
    return (
      <section className="fn-card fn-mb-lg">
        <div className="fn-card-body">
          <p className="fn-muted fn-text-sm">
            現在、ステータス更新が必要な枠はありません。
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
  const groupMeta = slot as typeof slot & { is_group?: boolean; group_size?: number };

  return (
    <section
      style={
        event.accent_color
          ? ({ ["--accent-primary" as never]: event.accent_color } as React.CSSProperties)
          : undefined
      }
    >
      <div className={`fn-card fn-highlight-card ${cardStyles}`}>
        <div className="fn-card-body">
          <div className="fn-highlight-card-kicker">
            <Icon name="alert" size={12} aria-hidden /> アクティブ枠
          </div>
          <h2 className="fn-highlight-card-title">{event.title}</h2>
          <p className="fn-highlight-card-lead">
            {slot.start_time
              ? `${formatUnix(slot.start_time, { dateOnly: true })} ${formatUnix(
                  slot.start_time,
                  { timeOnly: true },
                )}`
              : (slot.slot_label ?? "未指定")}
            {" · "}
            <span>状態: {slot.status}</span>
            {groupMeta.is_group ? ` · ${groupMeta.group_size ?? 0}連続` : ""}
            {slot.priority_reclaim_until
              ? ` · 確保期限 ${formatRelative(slot.priority_reclaim_until)}`
              : ""}
          </p>
          <div className="fn-highlight-card-actions">
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
                href={`/entry/slotted?slot=${slot.id}`}
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

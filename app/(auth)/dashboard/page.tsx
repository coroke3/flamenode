import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { getApprovedXIds } from "@/lib/auth/ownership";
import { getLinkedXUsersForAuthUser } from "@/lib/auth/xIdentity";
import styles from "./page.module.css";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  slots as slotsTable,
  videoChapters as videoChaptersTable,
  videoMembers,
  videoYoutubeMetadata,
  videos as videosTable,
  xUserAccountLinks,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { getOnboardingState, onboardingHref } from "@/lib/auth/onboarding";
import {
  sortSlotsChronologically,
} from "@/lib/utils/slotGrouping";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatUnix, formatRelative } from "@/lib/utils/format";
import { excludePvsfSummaryVideos } from "@/lib/db/queries";

export const metadata: Metadata = { title: "ダッシュボード" };
export const dynamic = "force-dynamic";

type LinkedXRow = {
  id: string;
  x_name: string;
  icon_url: string | null;
  approval_status: "pending" | "approved" | "rejected" | "imported" | null;
};

export default async function DashboardPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/dashboard" });
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const db = getDatabase();
  const onboarding = await getOnboardingState(db, user);
  const activeX = user.active_x_user_id ?? null;

  let xIds: LinkedXRow[] = [];
  let approvedXIds: string[] = [];
  let myVideos: VideoCardData[] = [];
  let collabVideos: VideoCardData[] = [];
  let mySlot: typeof slotsTable.$inferSelect | null = null;
  let mySlotEvent: typeof eventsTable.$inferSelect | null = null;
  let myChapters: Array<{
    id: string;
    video_id: string;
    youtube_video_id: string | null;
    video_title: string | null;
    chapter_time: number;
    chapter_label: string;
    visibility: "private" | "public" | null;
    created_at: number;
  }> = [];
  let stats = { likes: 0, views: 0, video_count: 0, event_count: 0 };

  if (db) {
    try {
      xIds = await db
        .select({
          id: xUsersTable.id,
          x_name: xUsersTable.x_name,
          icon_url: xUsersTable.icon_url,
          approval_status: xUsersTable.approval_status,
        })
        .from(xUserAccountLinks)
        .innerJoin(xUsersTable, eq(xUsersTable.id, xUserAccountLinks.x_user_id))
        .where(eq(xUserAccountLinks.auth_user_id, user.id));

      approvedXIds = await getApprovedXIds(db, user.id);

      if (approvedXIds.length > 0) {
        myVideos = (await db
          .select({
            id: videosTable.id,
            title: videosTable.title,
            youtube_video_id: videosTable.youtube_video_id,
            display_name: videosTable.creator_display_name,
            icon_url: videosTable.creator_icon_url,
            creator_x_user_id: videosTable.creator_x_user_id,
            primary_event_id: videosTable.primary_event_id,
            scheduled_time: videosTable.scheduled_time,
            status: videosTable.visibility_status,
          })
          .from(videosTable)
          .where(
            and(
              inArray(videosTable.creator_x_user_id, approvedXIds),
              ne(videosTable.visibility_status, "voided"),
            )!,
          )
          .orderBy(desc(videosTable.created_at))) as VideoCardData[];

        collabVideos = (await db
          .select({
            id: videosTable.id,
            title: videosTable.title,
            youtube_video_id: videosTable.youtube_video_id,
            display_name: sql<string>`COALESCE(${videosTable.creator_display_name}, ${xUsersTable.x_name}, '@' || ${videosTable.creator_x_user_id})`,
            icon_url: sql<string | null>`COALESCE(${videosTable.creator_icon_url}, ${xUsersTable.icon_url})`,
            creator_x_user_id: videosTable.creator_x_user_id,
            primary_event_id: videosTable.primary_event_id,
            scheduled_time: videosTable.scheduled_time,
            status: videosTable.visibility_status,
          })
          .from(videoMembers)
          .innerJoin(videosTable, eq(videosTable.id, videoMembers.video_id))
          .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
          .where(
            and(
              inArray(videoMembers.x_user_id, approvedXIds),
              eq(videoMembers.can_edit, 1),
              ne(videosTable.visibility_status, "voided"),
              or(
                isNull(videosTable.creator_x_user_id),
                notInArray(videosTable.creator_x_user_id, approvedXIds),
              )!,
            )!,
          )
          .orderBy(desc(videosTable.created_at))) as VideoCardData[];
        const collabById = new Map(collabVideos.map((video) => [video.id, video]));
        collabVideos = Array.from(collabById.values());

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

      const slotOwnerWhere = activeX
        ? or(
            eq(slotsTable.x_user_id, activeX),
            and(
              isNull(slotsTable.x_user_id),
              eq(slotsTable.reserved_by_user_id, user.id),
            )!,
          )
        : and(
            isNull(slotsTable.x_user_id),
            eq(slotsTable.reserved_by_user_id, user.id),
          )!;
      const slotRows = await db
        .select()
        .from(slotsTable)
        .where(
          and(
            slotOwnerWhere,
            or(
              eq(slotsTable.status, "reserved"),
              eq(slotsTable.status, "submitted"),
            )!,
          )!,
        )
        .limit(50);
      mySlot = sortSlotsChronologically(slotRows)[0] ?? null;
      if (mySlot) {
        mySlotEvent =
          (
            await db
              .select()
              .from(eventsTable)
              .where(eq(eventsTable.id, mySlot.event_id))
              .limit(1)
          )[0] ?? null;
      }

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
              ne(videosTable.visibility_status, "voided"),
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
    } catch (error) {
      console.error("[DashboardPage] fetch failed", error);
    }
  }

  const activeXRow = user.active_x_user_id
    ? xIds.find((x) => x.id === user.active_x_user_id) ?? null
    : null;
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
      : approvedXIds.length === 0
        ? "承認済み X ID がないため、作品を表示していません。"
        : "自分の作品はまだ登録されていません。";
  const collabEmptyMessage =
    xIds.length === 0
      ? "X ID を連携すると、共同編集できる作品が表示されます。"
      : approvedXIds.length === 0
        ? "承認済み X ID がないため、共同編集できる作品を表示していません。"
        : "共同編集できる作品はまだありません。";

  return (
    <div className={`fn-public-container fn-page fn-dash ${styles.page}`}>
      <header className={`fn-dash-head ${styles.accountHeader}`}>
        <div className={`fn-dash-id ${styles.accountIdentity}`}>
          {dashboardIcon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dashboardIcon}
              alt=""
              className={`fn-dash-avatar ${styles.accountAvatar}`}
            />
          ) : (
            <span
              className={`fn-dash-avatar-fallback ${styles.accountAvatarFallback}`}
            >
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
            <Icon name="settings" size={13} aria-hidden /> 設定
          </Link>
          <Link href="/entry" className="fn-btn fn-btn-primary fn-btn-lg">
            <Icon name="plus" size={14} aria-hidden /> 新規投稿
          </Link>
        </div>
      </header>

      {onboarding.needsTermsAcceptance || onboarding.xIdentityStatus === "none" ? (
        <div className="fn-pc-status-banner" role="status" style={{ marginBottom: 20 }}>
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">初期設定が未完了です</h3>
            <p className="fn-jp fn-pc-banner-lead">
              作品投稿やイベント参加には、利用規約への同意と活動名義の登録が必要です。
            </p>
            <Link
              href={onboardingHref("/dashboard")}
              className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12"
            >
              初期設定を進める
            </Link>
          </div>
        </div>
      ) : onboarding.xIdentityStatus === "rejected" ? (
        <div className="fn-pc-status-banner fn-pc-status-banner--warn" role="status" style={{ marginBottom: 20 }}>
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">X ID 申請を確認できませんでした</h3>
            <p className="fn-jp fn-pc-banner-lead">
              申請が却下されました。設定から再申請できます。
            </p>
            <Link
              href={onboardingHref("/dashboard")}
              className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12"
            >
              再申請する
            </Link>
          </div>
        </div>
      ) : onboarding.xIdentityStatus === "pending" ? (
        <div className="fn-pc-status-banner" role="status" style={{ marginBottom: 20 }}>
          <Icon name="clock" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">申請完了・承認待ち</h3>
            <p className="fn-jp fn-pc-banner-lead">
              {onboarding.requestedXId
                ? `@${onboarding.requestedXId} の連携を運営が確認しています。`
                : "X ID 連携の申請を運営が確認しています。"}
              {" "}
              イベント枠の確保は利用できます。作品投稿は承認後に利用可能です。
            </p>
            <Link
              href={onboardingHref("/dashboard")}
              className="fn-btn fn-btn-ghost fn-btn-sm fn-mt-12"
            >
              申請状況を見る
            </Link>
          </div>
        </div>
      ) : onboarding.xIdentityStatus === "approved" && !onboarding.activeApprovedXId ? (
        <div className="fn-pc-status-banner" role="status" style={{ marginBottom: 20 }}>
          <Icon name="alert" size={18} aria-hidden />
          <div>
            <h3 className="fn-jp">活動名義（Active X ID）の設定が必要です</h3>
            <p className="fn-jp fn-pc-banner-lead">
              承認済みの X ID があります。投稿に使う Active X ID を設定してください。
            </p>
            <Link
              href="/dashboard/settings?next=/dashboard"
              className="fn-btn fn-btn-primary fn-btn-sm fn-mt-12"
            >
              設定で Active X ID を選ぶ
            </Link>
          </div>
        </div>
      ) : null}

      {!db ? (
        <div className="fn-empty" role="status">
          <p className="fn-empty-message">
            データを読み込めませんでした。ページを再読み込みしてください。
          </p>
        </div>
      ) : null}

      <HeroCard slot={mySlot} event={mySlotEvent} canPost={onboarding.canPost} />

      <section className={`fn-dash-kpis ${styles.statsGrid}`} aria-label="アカウント統計">
        <Stat label="累計いいね" value={stats.likes.toLocaleString()} />
        <Stat label="累計再生数" value={stats.views.toLocaleString()} />
        <Stat label="投稿作品" value={`${stats.video_count} 本`} />
        <Stat label="参加イベント" value={`${stats.event_count} 本`} />
      </section>
      {xIds.length > 1 ? (
        <p className="fn-muted fn-text-sm" style={{ marginBottom: 20 }}>
          統計は連携済み名義の合算です。マイ・ギャラリーは Active X ID の作品のみ表示します。
        </p>
      ) : null}

      <section className={`fn-dash-section ${styles.section}`}>
        <h2 className={`fn-dash-section-title ${styles.sectionTitle}`}>連携 X ID</h2>
        {xIds.length === 0 ? (
          <div className="fn-empty">
            <Icon name="user" size={20} aria-hidden />
            <p className="fn-empty-message">X ID がまだ連携されていません。</p>
            <Link
              href={onboarding.canReserveSlot ? "/dashboard/settings" : onboardingHref("/dashboard")}
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              {onboarding.canReserveSlot ? "X ID を連携する" : "初期設定を続ける"}
            </Link>
          </div>
        ) : (
          <div className={styles.xidList}>
            {xIds.map((x) => (
              <div key={x.id} className={styles.xidCard}>
                {x.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
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
        <h2 className={`fn-dash-section-title ${styles.sectionTitle}`}>自分の作品</h2>
        {myVideos.length === 0 ? (
          <div className="fn-empty">
            <Icon name="grid" size={20} aria-hidden />
            <p className="fn-empty-message">{galleryEmptyMessage}</p>
            <Link
              href={xIds.length === 0 ? "/dashboard/settings" : "/entry"}
              className="fn-btn fn-btn-primary fn-mt-md"
            >
              {xIds.length === 0 ? "X ID を連携する" : "作品を投稿する"}
            </Link>
          </div>
        ) : (
          <div className={`fn-gallery-grid ${styles.galleryGrid}`}>
            {myVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                href={`/dashboard/edit/${video.id}`}
              />
            ))}
          </div>
        )}
      </section>

      <section className={`fn-dash-section ${styles.section}`}>
        <h2 className={`fn-dash-section-title ${styles.sectionTitle}`}>
          共同編集できる作品
        </h2>
        {collabVideos.length === 0 ? (
          <div className="fn-empty">
            <Icon name="users" size={20} aria-hidden />
            <p className="fn-empty-message">{collabEmptyMessage}</p>
          </div>
        ) : (
          <div className={`fn-gallery-grid ${styles.galleryGrid}`}>
            {collabVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                href={`/dashboard/edit/${video.id}`}
              />
            ))}
          </div>
        )}
      </section>

      <section className={`fn-dash-section ${styles.section}`}>
        <h2 className={`fn-dash-section-title ${styles.sectionTitle}`}>
          自分のチャプターコメント
        </h2>
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
                  <span
                    className={`fn-badge ${
                      chapter.visibility === "private"
                        ? "fn-badge-warning"
                        : "fn-badge-accent"
                    }`}
                  >
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

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
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
  canPost,
}: {
  slot: typeof slotsTable.$inferSelect | null;
  event: typeof eventsTable.$inferSelect | null;
  canPost: boolean;
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

  return (
    <section
      style={
        event.accent_color
          ? ({ ["--accent-primary" as never]: event.accent_color } as React.CSSProperties)
          : undefined
      }
    >
      <div
        className={`fn-card fn-highlight-card ${
          slot.status === "submitted" ? "fn-card-accent" : ""
        }`}
      >
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
                href={
                  canPost
                    ? `/entry/slotted?slot=${slot.id}`
                    : onboardingHref(`/entry/slotted?slot=${slot.id}`)
                }
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

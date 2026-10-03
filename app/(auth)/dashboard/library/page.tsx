import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  approvedXIdsNotWhere,
  approvedXIdsWhere,
} from "@/lib/auth/approvedX";
import {
  videoChapters as videoChaptersTable,
  videoInteractionsAuth,
  videoMembers,
  videos as videosTable,
  xUserAccountLinks,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { getOnboardingState } from "@/lib/auth/onboarding";
import { creatorIconExpr, creatorNameExpr } from "@/lib/db/displayExpr";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";
import { formatRelative } from "@/lib/utils/format";

export const metadata: Metadata = { title: "ライブラリ" };
export const dynamic = "force-dynamic";

const DASHBOARD_LIBRARY_PAGE_SIZE = 24;
const DASHBOARD_LIBRARY_MAX_PAGE = 500;

interface Props {
  searchParams: Promise<{ tab?: string; page?: string }>;
}

type Tab = "like" | "bookmark" | "mine" | "collab" | "chapters";

type ChapterRow = {
  id: string;
  video_id: string;
  youtube_video_id: string | null;
  video_title: string | null;
  chapter_time: number;
  chapter_label: string;
  visibility: "private" | "public" | null;
  created_at: number;
};

function parseTab(rawTab: string | undefined): Tab {
  if (rawTab === "bookmark" || rawTab === "mine" || rawTab === "collab" || rawTab === "chapters") {
    return rawTab;
  }
  return "like";
}

function parsePage(rawPage: string | undefined): number {
  const candidate = Number(rawPage);
  if (!Number.isSafeInteger(candidate) || candidate < 1) return 1;
  return Math.min(candidate, DASHBOARD_LIBRARY_MAX_PAGE);
}

export default async function DashboardLibraryPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/dashboard/library" });
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const { tab: rawTab, page: rawPage } = await searchParams;
  const tab = parseTab(rawTab);
  const page = parsePage(rawPage);
  const offset = (page - 1) * DASHBOARD_LIBRARY_PAGE_SIZE;

  const db = getDatabase();
  let videos: VideoCardData[] = [];
  let chapters: ChapterRow[] = [];
  let hasNextPage = false;
  let hasOtherTabHits = false;
  let activeApprovedXId: string | null = null;
  let approvedXIds: string[] = [];

  if (db) {
    if (tab === "like" || tab === "bookmark") {
      const otherTab = tab === "like" ? "bookmark" : "like";
      const otherTabHit = await db
        .select({ video_id: videoInteractionsAuth.video_id })
        .from(videoInteractionsAuth)
        .where(
          and(
            eq(videoInteractionsAuth.auth_user_id, user.id),
            eq(videoInteractionsAuth.interaction_type, otherTab),
          )!,
        )
        .limit(1);
      hasOtherTabHits = otherTabHit.length > 0;

      const rows = await db
        .select({
          id: videosTable.id,
          title: videosTable.title,
          youtube_video_id: videosTable.youtube_video_id,
          display_name: creatorNameExpr,
          icon_url: creatorIconExpr,
          creator_x_user_id: videosTable.creator_x_user_id,
          primary_event_id: videosTable.primary_event_id,
          scheduled_time: videosTable.scheduled_time,
          status: videosTable.visibility_status,
        })
        .from(videoInteractionsAuth)
        .innerJoin(
          videosTable,
          eq(videosTable.id, videoInteractionsAuth.video_id),
        )
        .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
        .where(
          and(
            eq(videoInteractionsAuth.auth_user_id, user.id),
            eq(videoInteractionsAuth.interaction_type, tab),
            eq(videosTable.visibility_status, "public"),
          )!,
        )
        .orderBy(desc(videosTable.scheduled_time), desc(videosTable.id))
        .limit(DASHBOARD_LIBRARY_PAGE_SIZE + 1)
        .offset(offset);
      hasNextPage =
        page < DASHBOARD_LIBRARY_MAX_PAGE &&
        rows.length > DASHBOARD_LIBRARY_PAGE_SIZE;
      videos = rows.slice(0, DASHBOARD_LIBRARY_PAGE_SIZE) as VideoCardData[];
    } else if (tab === "mine") {
      activeApprovedXId = (await getOnboardingState(db, user)).activeApprovedXId;
      if (activeApprovedXId) {
        const rows = await db
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
              eq(videosTable.creator_x_user_id, activeApprovedXId),
              ne(videosTable.visibility_status, "voided"),
            )!,
          )
          .orderBy(desc(videosTable.created_at), desc(videosTable.id))
          .limit(DASHBOARD_LIBRARY_PAGE_SIZE + 1)
          .offset(offset);
        hasNextPage =
          page < DASHBOARD_LIBRARY_MAX_PAGE &&
          rows.length > DASHBOARD_LIBRARY_PAGE_SIZE;
        videos = rows.slice(0, DASHBOARD_LIBRARY_PAGE_SIZE) as VideoCardData[];
      }
    } else {
      const linkedRows = await db
        .select({
          id: xUsersTable.id,
          approval_status: xUsersTable.approval_status,
        })
        .from(xUserAccountLinks)
        .innerJoin(xUsersTable, eq(xUsersTable.id, xUserAccountLinks.x_user_id))
        .where(eq(xUserAccountLinks.auth_user_id, user.id));
      approvedXIds = Array.from(
        new Set(
          linkedRows
            .filter((row) => row.approval_status === "approved")
            .map((row) => row.id),
        ),
      );

      if (approvedXIds.length > 0 && tab === "collab") {
        const rows = await db
          .selectDistinct({
            id: videosTable.id,
            title: videosTable.title,
            youtube_video_id: videosTable.youtube_video_id,
            display_name: creatorNameExpr,
            icon_url: creatorIconExpr,
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
              approvedXIdsWhere(videoMembers.x_user_id, approvedXIds),
              eq(videoMembers.can_edit, 1),
              ne(videosTable.visibility_status, "voided"),
              or(
                isNull(videosTable.creator_x_user_id),
                approvedXIdsNotWhere(videosTable.creator_x_user_id, approvedXIds),
              )!,
            )!,
          )
          .orderBy(desc(videosTable.created_at), desc(videosTable.id))
          .limit(DASHBOARD_LIBRARY_PAGE_SIZE + 1)
          .offset(offset);
        hasNextPage =
          page < DASHBOARD_LIBRARY_MAX_PAGE &&
          rows.length > DASHBOARD_LIBRARY_PAGE_SIZE;
        videos = rows.slice(0, DASHBOARD_LIBRARY_PAGE_SIZE) as VideoCardData[];
      } else if (approvedXIds.length > 0 && tab === "chapters") {
        const rows = await db
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
          .where(approvedXIdsWhere(videoChaptersTable.x_user_id, approvedXIds))
          .orderBy(desc(videoChaptersTable.created_at), desc(videoChaptersTable.id))
          .limit(DASHBOARD_LIBRARY_PAGE_SIZE + 1)
          .offset(offset);
        hasNextPage =
          page < DASHBOARD_LIBRARY_MAX_PAGE &&
          rows.length > DASHBOARD_LIBRARY_PAGE_SIZE;
        chapters = rows.slice(0, DASHBOARD_LIBRARY_PAGE_SIZE);
      }
    }
  }

  const playlistId = tab === "like" ? "lib-like" : "lib-bookmark";
  const playlistLabel = tab === "like" ? "いいねした作品" : "セーブした作品";
  const firstVideo = videos[0];
  const firstVideoHref = (tab === "like" || tab === "bookmark") && firstVideo
    ? `/${firstVideo.youtube_video_id?.trim() || firstVideo.id}?playlist=${playlistId}`
    : null;
  const title =
    tab === "mine"
      ? "自分の作品"
      : tab === "collab"
        ? "共同編集できる作品"
        : tab === "chapters"
          ? "自分のチャプターコメント"
          : "ライブラリ";
  const lead =
    tab === "mine"
      ? "Active X ID 名義で投稿した作品を表示します。"
      : tab === "collab"
        ? "承認済み X ID で共同編集できる作品を表示します。"
        : tab === "chapters"
          ? "承認済み X ID で投稿したチャプターコメントを表示します。"
          : "自分がいいね・セーブした作品を一覧表示します。";
  const emptyMessage =
    tab === "mine" && !activeApprovedXId
      ? "Active X ID を設定すると、その名義の作品を表示できます。"
      : tab === "mine"
        ? "自分の作品はまだ登録されていません。"
        : tab === "collab" && approvedXIds.length === 0
          ? "承認済み X ID がないため、共同編集できる作品を表示していません。"
          : tab === "collab"
            ? "共同編集できる作品はまだありません。"
            : tab === "chapters"
              ? "まだ投稿したチャプターコメントはありません。"
              : tab === "like"
                ? "まだ「いいね」した作品がありません。"
                : "まだ「セーブ」した作品がありません。";
  const itemCount = tab === "chapters" ? chapters.length : videos.length;
  const pageHref = (targetPage: number) =>
    `/dashboard/library?tab=${tab}&page=${targetPage}`;

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head fn-library-head">
        <span className="fn-eyebrow">library</span>
        <h1 className="fn-display fn-page-title">{title}</h1>
        <p className="fn-jp fn-page-lead">{lead}</p>
      </header>

      <nav role="tablist" className="fn-tab-row" aria-label="ライブラリ種別">
        {([
          ["like", "いいね"],
          ["bookmark", "セーブ"],
          ["mine", "自分の作品"],
          ["collab", "共同編集"],
          ["chapters", "チャプター"],
        ] as const).map(([value, label]) => (
          <Link
            key={value}
            role="tab"
            aria-selected={tab === value}
            href={`/dashboard/library?tab=${value}`}
            className={`fn-btn fn-btn-sm ${tab === value ? "fn-btn-primary" : "fn-btn-ghost"}`}
          >
            {value === "like" ? (
              <Icon name={tab === value ? "heart-filled" : "heart"} size={12} aria-hidden />
            ) : value === "bookmark" ? (
              <Icon
                name={tab === value ? "bookmark-filled" : "bookmark"}
                size={12}
                aria-hidden
              />
            ) : value === "mine" ? (
              <Icon name="grid" size={12} aria-hidden />
            ) : value === "collab" ? (
              <Icon name="users" size={12} aria-hidden />
            ) : (
              <Icon name="chapter" size={12} aria-hidden />
            )}
            {label}
          </Link>
        ))}
      </nav>

      {!db ? (
        <div className="fn-empty" role="status">
          <Icon name="info" size={20} aria-hidden />
          <p className="fn-empty-message">データを読み込めませんでした。ページを再読み込みしてください。</p>
        </div>
      ) : itemCount === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={20} aria-hidden />
          <p className="fn-empty-message">{emptyMessage}</p>
          {(tab === "like" || tab === "bookmark") && hasOtherTabHits ? (
            <p
              className="fn-muted fn-text-sm"
              style={{ textAlign: "center", marginTop: 6 }}
            >
              もう一方のタブには作品があります。
            </p>
          ) : null}
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="fn-btn fn-btn-ghost fn-btn-sm">
              前へ
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div className="fn-toolbar">
            <span className="fn-muted fn-text-sm">{itemCount} 件を表示（ページ {page}）</span>
            {firstVideoHref ? (
              <Link
                href={firstVideoHref}
                className="fn-btn fn-btn-primary fn-btn-sm fn-toolbar-spacer"
              >
                <Icon name="play" size={12} aria-hidden /> {playlistLabel}をプレイリストで見る
              </Link>
            ) : null}
          </div>
          {tab === "chapters" ? (
            <div className="fn-stack-list">
              {chapters.map((chapter) => (
                <Link
                  key={chapter.id}
                  href={`/${chapter.youtube_video_id?.trim() || chapter.video_id}`}
                  className="fn-card fn-stack-item"
                >
                  <div className="fn-stack-item-head">
                    <strong className="fn-stack-item-title">{chapter.chapter_label}</strong>
                    <span
                      className={`fn-badge ${chapter.visibility === "private" ? "fn-badge-warning" : "fn-badge-accent"}`}
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
          ) : (
            <div className="fn-media-grid">
              {videos.map((video) => (
                <div key={video.id}>
                  <VideoCard
                    video={video}
                    href={
                      tab === "mine" || tab === "collab"
                        ? `/dashboard/edit/${video.id}`
                        : `/${video.youtube_video_id?.trim() || video.id}?playlist=${playlistId}`
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {page > 1 || hasNextPage ? (
            <nav className="fn-toolbar" aria-label="ページ移動">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="fn-btn fn-btn-ghost fn-btn-sm">
                  前へ
                </Link>
              ) : <span />}
              {hasNextPage ? (
                <Link href={pageHref(page + 1)} className="fn-btn fn-btn-ghost fn-btn-sm">
                  次へ
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

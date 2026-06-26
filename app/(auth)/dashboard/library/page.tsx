import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoInteractions,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { creatorIconExpr, creatorNameExpr } from "@/lib/db/displayExpr";
import { resolveMissingIcons } from "@/lib/db/iconResolution";
import { Icon } from "@/components/ui/Icon";
import { VideoCard, type VideoCardData } from "@/components/video/VideoCard";

export const metadata: Metadata = { title: "ライブラリ" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

type Tab = "like" | "bookmark";

export default async function DashboardLibraryPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/dashboard/library" });
  if (!guard.ok) return guard.element;
  const user = guard.user;
  const { tab: rawTab = "like" } = await searchParams;
  const tab: Tab = rawTab === "bookmark" ? "bookmark" : "like";

  const db = getDatabase();
  let videos: VideoCardData[] = [];
  let hasOtherTabHits = false;

  if (db) {
    const activeX = user.active_x_user_id;
    if (activeX) {
      const myInteractions = await db
        .select({
          video_id: videoInteractions.video_id,
          interaction_type: videoInteractions.interaction_type,
          created_at: videoInteractions.created_at,
        })
        .from(videoInteractions)
        .where(eq(videoInteractions.x_user_id, activeX));

      const likeIds = myInteractions
        .filter((r) => r.interaction_type === "like")
        .map((r) => r.video_id);
      const bookmarkIds = myInteractions
        .filter((r) => r.interaction_type === "bookmark")
        .map((r) => r.video_id);
      hasOtherTabHits =
        tab === "like" ? bookmarkIds.length > 0 : likeIds.length > 0;
      const targetIds = tab === "like" ? likeIds : bookmarkIds;
      if (targetIds.length > 0) {
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
          .from(videosTable)
          .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
          .where(
            and(
              inArray(videosTable.id, targetIds),
              ne(videosTable.visibility_status, "archived"),
            )!,
          )
          .orderBy(desc(videosTable.scheduled_time));
        videos = (await resolveMissingIcons(db, rows)) as VideoCardData[];
      }
    }
  }

  const playlistId = tab === "like" ? "lib-like" : "lib-bookmark";
  const playlistLabel = tab === "like" ? "いいねした作品" : "セーブした作品";
  const firstVideo = videos[0];
  const firstVideoHref = firstVideo
    ? `/${firstVideo.youtube_video_id ?? firstVideo.id}?playlist=${playlistId}`
    : null;

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-page-head fn-library-head">
        <span className="fn-eyebrow">library</span>
        <h1 className="fn-display fn-page-title">ライブラリ</h1>
        <p className="fn-jp fn-page-lead">
          自分がいいね・セーブした作品を一覧表示します。
        </p>
      </header>

      <nav role="tablist" className="fn-tab-row" aria-label="ライブラリ種別">
        <Link
          role="tab"
          aria-selected={tab === "like"}
          href="/dashboard/library?tab=like"
          className={`fn-btn fn-btn-sm ${tab === "like" ? "fn-btn-primary" : "fn-btn-ghost"}`}
        >
          <Icon name={tab === "like" ? "heart-filled" : "heart"} size={12} aria-hidden />
          いいね
        </Link>
        <Link
          role="tab"
          aria-selected={tab === "bookmark"}
          href="/dashboard/library?tab=bookmark"
          className={`fn-btn fn-btn-sm ${tab === "bookmark" ? "fn-btn-primary" : "fn-btn-ghost"}`}
        >
          <Icon
            name={tab === "bookmark" ? "bookmark-filled" : "bookmark"}
            size={12}
            aria-hidden
          />
          セーブ
        </Link>
      </nav>

      {videos.length === 0 ? (
        <div className="fn-empty">
          <Icon name="info" size={20} aria-hidden />
          <p className="fn-empty-message">
            {tab === "like"
              ? "まだ「いいね」した作品がありません。"
              : "まだ「セーブ」した作品がありません。"}
          </p>
          {hasOtherTabHits ? (
            <p
              className="fn-muted fn-text-sm"
              style={{ textAlign: "center", marginTop: 6 }}
            >
              もう一方のタブには作品があります。
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="fn-toolbar">
            <span className="fn-muted fn-text-sm">{videos.length} 件</span>
            {firstVideoHref ? (
              <Link
                href={firstVideoHref}
                className="fn-btn fn-btn-primary fn-btn-sm fn-toolbar-spacer"
              >
                <Icon name="play" size={12} aria-hidden /> {playlistLabel}をプレイリストで見る
              </Link>
            ) : null}
          </div>
          <div className="fn-media-grid">
            {videos.map((v, index) => (
              <div key={`${v.id}-library-${index}`}>
                <VideoCard
                  video={v}
                  href={`/${v.youtube_video_id ?? v.id}?playlist=${playlistId}`}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

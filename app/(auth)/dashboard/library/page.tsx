import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  videoInteractions,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { getLinkedXUsersForAuthUser } from "@/lib/auth/xIdentity";
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
  let linkedXCount = 0;
  const activeX = user.active_x_user_id;

  if (db) {
    const linkedRows = await getLinkedXUsersForAuthUser(db, user.id);
    linkedXCount = linkedRows.length;

    if (activeX) {
      const otherTab: Tab = tab === "like" ? "bookmark" : "like";
      const otherTabHit = await db
        .select({ video_id: videoInteractions.video_id })
        .from(videoInteractions)
        .where(
          and(
            eq(videoInteractions.x_user_id, activeX),
            eq(videoInteractions.interaction_type, otherTab),
          )!,
        )
        .limit(1);
      hasOtherTabHits = otherTabHit.length > 0;

      // interaction IDを一度配列化してINへ渡すと、件数次第でD1の100 bind上限を超える。
      // relationを起点に直接JOINし、従来どおり動画の公開状態と上映時刻順を適用する。
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
        .from(videoInteractions)
        .innerJoin(videosTable, eq(videosTable.id, videoInteractions.video_id))
        .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
        .where(
          and(
            eq(videoInteractions.x_user_id, activeX),
            eq(videoInteractions.interaction_type, tab),
            ne(videosTable.visibility_status, "voided"),
          )!,
        )
        .orderBy(desc(videosTable.scheduled_time));
      videos = (await resolveMissingIcons(db, rows)) as VideoCardData[];
    }
  }

  const needsXIdLink = linkedXCount === 0;
  const needsActiveX = linkedXCount > 0 && !activeX;

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

      {needsXIdLink || needsActiveX ? (
        <div className="fn-empty">
          <Icon name="user" size={20} aria-hidden />
          <p className="fn-empty-message">
            {needsXIdLink
              ? "いいね・セーブには X ID の連携・利用規約への同意・承認済みの活動名義が必要です。"
              : "承認済みの活動名義（Active X ID）を選択すると、いいね・セーブした作品を表示できます。"}
          </p>
          <Link href="/dashboard/settings" className="fn-btn fn-btn-primary fn-mt-md">
            {needsXIdLink ? "X ID を連携する" : "X ID 設定を開く"}
          </Link>
        </div>
      ) : videos.length === 0 ? (
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

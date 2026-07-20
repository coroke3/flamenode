import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/guard";
import { getApprovedXIds } from "@/lib/auth/ownership";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventYoutubePlaylistItems,
  eventYoutubePlaylistSync,
  events as eventsTable,
  videoEvents,
  videos as videosTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";

export const metadata: Metadata = { title: "再生リスト同期状況" };
export const dynamic = "force-dynamic";

interface PlaylistStatusRow {
  video_id: string;
  title: string;
  youtube_video_id: string | null;
  visibility_status: string;
  scheduled_time: number | null;
  event_id: string;
  event_title: string;
  playlist_id: string;
  event_sync_status: string;
  next_sync_at: number | null;
  synced_count: number;
}

function waitingReason(row: PlaylistStatusRow): string {
  if (!row.youtube_video_id) return "YouTube URLの確認後に同期されます";
  if (row.visibility_status !== "public") {
    return "作品が公開された後に同期されます";
  }
  if (row.event_sync_status === "failed") return "運営が同期エラーを確認しています";
  if (row.event_sync_status === "scanning") return "再生リストを確認中です";
  if (row.event_sync_status === "deferred") return "無料枠の範囲で順番に同期しています";
  return "次回の同期処理を待っています";
}

export default async function DashboardYoutubePlaylistsPage(): Promise<React.ReactElement> {
  const guard = await requireSession({ next: "/dashboard/youtube-playlists" });
  if (!guard.ok) return guard.element;

  const db = getDatabase();
  let rows: PlaylistStatusRow[] = [];

  if (db) {
    const approvedXIds = await getApprovedXIds(db, guard.user.id);
    if (approvedXIds.length > 0) {
      const result = await db
        .select({
          video_id: videosTable.id,
          title: videosTable.title,
          youtube_video_id: videosTable.youtube_video_id,
          visibility_status: videosTable.visibility_status,
          scheduled_time: videosTable.scheduled_time,
          event_id: eventsTable.id,
          event_title: eventsTable.title,
          playlist_id: sql<string>`${eventYoutubePlaylistSync.playlist_id}`,
          event_sync_status: eventYoutubePlaylistSync.sync_status,
          next_sync_at: eventYoutubePlaylistSync.next_sync_at,
          synced_count: sql<number>`COUNT(DISTINCT ${eventYoutubePlaylistItems.playlist_item_id})`,
        })
        .from(videosTable)
        .innerJoin(videoEvents, eq(videoEvents.video_id, videosTable.id))
        .innerJoin(eventsTable, eq(eventsTable.id, videoEvents.event_id))
        .innerJoin(
          eventYoutubePlaylistSync,
          and(
            eq(eventYoutubePlaylistSync.event_id, videoEvents.event_id),
            eq(eventYoutubePlaylistSync.enabled, 1),
            ne(eventYoutubePlaylistSync.sync_mode, "off"),
            sql`${eventYoutubePlaylistSync.playlist_id} IS NOT NULL`,
            sql`${eventYoutubePlaylistSync.playlist_id} <> ''`,
          ),
        )
        .leftJoin(
          eventYoutubePlaylistItems,
          and(
            eq(eventYoutubePlaylistItems.event_id, videoEvents.event_id),
            eq(
              eventYoutubePlaylistItems.youtube_video_id,
              videosTable.youtube_video_id,
            ),
          ),
        )
        .where(
          and(
            inArray(videosTable.creator_x_user_id, approvedXIds),
            ne(videosTable.visibility_status, "voided"),
          ),
        )
        .groupBy(
          videosTable.id,
          videosTable.title,
          videosTable.youtube_video_id,
          videosTable.visibility_status,
          videosTable.scheduled_time,
          eventsTable.id,
          eventsTable.title,
          eventYoutubePlaylistSync.playlist_id,
          eventYoutubePlaylistSync.sync_status,
          eventYoutubePlaylistSync.next_sync_at,
        )
        .orderBy(
          desc(sql`COALESCE(${videosTable.scheduled_time}, ${videosTable.created_at})`),
          desc(videosTable.created_at),
        )
        .limit(300);

      rows = result.map((row) => ({
        ...row,
        playlist_id: row.playlist_id ?? "",
        synced_count: Number(row.synced_count ?? 0),
      })) as PlaylistStatusRow[];
    }
  }

  const synced = rows.filter((row) => row.synced_count > 0).length;
  const waiting = rows.length - synced;

  return (
    <div className="fn-public-container fn-page">
      <header className="fn-dash-head">
        <div>
          <span className="fn-eyebrow">YouTube playlist</span>
          <h1 className="fn-display">再生リスト同期状況</h1>
          <p className="fn-muted fn-text-sm" style={{ marginTop: 8 }}>
            再生リスト同期が有効なイベントに参加している自分の作品だけを表示します。
          </p>
        </div>
        <Link href="/dashboard" className="fn-btn fn-btn-ghost fn-btn-sm">
          ダッシュボードへ戻る
        </Link>
      </header>

      <section className="fn-dash-kpis" aria-label="同期状況集計">
        <Summary label="対象" value={rows.length} />
        <Summary label="同期済み" value={synced} tone="synced" />
        <Summary label="同期待ち" value={waiting} tone={waiting > 0 ? "waiting" : "normal"} />
      </section>

      {rows.length === 0 ? (
        <div className="fn-empty" style={{ marginTop: 24 }}>
          <Icon name="list" size={22} aria-hidden />
          <p className="fn-empty-message">
            現在、再生リスト同期が設定されたイベントの対象作品はありません。
          </p>
          <Link href="/dashboard" className="fn-btn fn-btn-primary fn-mt-md">
            自分の作品を見る
          </Link>
        </div>
      ) : (
        <div className="fn-stack-list" style={{ marginTop: 24 }}>
          {rows.map((row) => {
            const isSynced = row.synced_count > 0;
            return (
              <article
                key={`${row.video_id}:${row.event_id}`}
                className="fn-card fn-stack-item"
              >
                <div className="fn-stack-item-head" style={{ alignItems: "flex-start" }}>
                  <div>
                    <Link
                      href={`/dashboard/edit/${row.video_id}`}
                      className="fn-stack-item-title"
                    >
                      {row.title}
                    </Link>
                    <div className="fn-stack-item-meta" style={{ marginTop: 4 }}>
                      {row.event_title}
                      {row.scheduled_time
                        ? ` / 公開予定 ${formatUnix(row.scheduled_time)}`
                        : ""}
                    </div>
                  </div>
                  <span
                    className={`fn-badge ${
                      isSynced ? "fn-badge-accent" : "fn-badge-warning"
                    }`}
                  >
                    {isSynced ? "再生リスト同期済み" : "再生リスト同期待ち"}
                  </span>
                </div>

                {!isSynced ? (
                  <p className="fn-muted fn-text-sm" style={{ marginTop: 10 }}>
                    {waitingReason(row)}
                    {row.next_sync_at ? `。次回予定: ${formatUnix(row.next_sync_at)}` : ""}
                  </p>
                ) : null}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <Link
                    href={`/dashboard/edit/${row.video_id}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    作品を確認
                  </Link>
                  {row.playlist_id ? (
                    <Link
                      href={`https://www.youtube.com/playlist?list=${encodeURIComponent(row.playlist_id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="fn-btn fn-btn-ghost fn-btn-sm"
                    >
                      <Icon name="external" size={11} aria-hidden /> 再生リスト
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "normal" | "synced" | "waiting";
}): React.ReactElement {
  return (
    <div className="fn-dash-kpi">
      <span
        className="fn-dash-kpi-v"
        style={{
          color:
            tone === "synced"
              ? "var(--accent-primary)"
              : tone === "waiting"
                ? "var(--accent-warning)"
                : undefined,
        }}
      >
        {value.toLocaleString()}
      </span>
      <span className="fn-dash-kpi-k">{label}</span>
    </div>
  );
}

import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import {
  eventYoutubePlaylistItems,
  eventYoutubePlaylistSync,
  events as eventsTable,
  videoEvents,
  videos as videosTable,
} from "@/lib/db/schema";
import { ConsolePageHeader as AdminPageHeader } from "@/components/layout/ConsolePageHeader";
import { AdminVideoManagementTabs } from "@/components/admin/AdminVideoManagementTabs";
import { FnTable } from "@/components/ui/FnTable";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import {
  firstSearchParamValue,
  type SearchParamValue,
} from "#utils/next";

export const metadata: Metadata = { title: "イベント再生リスト同期" };
export const dynamic = "force-dynamic";

const LIMIT = 100;
// Keep one fixed bind for the event-id predicate and headroom for future
// conditions.  The visible page is still aggregated in at most two bounded
// queries (100 rows split into 80 + 20), never once per event.
const EVENT_ID_CHUNK_SIZE = 80;

function chunkEventIds(ids: readonly string[]): string[][] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += EVENT_ID_CHUNK_SIZE) {
    chunks.push(unique.slice(index, index + EVENT_ID_CHUNK_SIZE));
  }
  return chunks;
}

interface Props {
  searchParams?: Promise<{
    enabled?: SearchParamValue;
    status?: SearchParamValue;
  }>;
}

type PlaylistSyncAdminRow = {
  event_id: string;
  event_title: string;
  playlist_id: string | null;
  enabled: number;
  sync_mode: string;
  sync_interval_minutes: number;
  sync_status: string;
  next_sync_at: number | null;
  last_synced_at: number | null;
  last_full_scan_at: number | null;
  last_error: string | null;
  linked_count: number;
  eligible_count: number;
  synced_count: number;
};

function statusBadgeClass(status: string): string {
  if (status === "failed") return "fn-badge-danger";
  if (status === "deferred" || status === "scanning") return "fn-badge-warning";
  if (status === "synced") return "fn-badge-accent";
  return "fn-badge-soft";
}

function intervalLabel(minutes: number): string {
  if (minutes % 10080 === 0) return `${minutes / 10080}週間`;
  if (minutes % 1440 === 0) return `${minutes / 1440}日`;
  if (minutes % 60 === 0) return `${minutes / 60}時間`;
  return `${minutes}分`;
}

export default async function AdminYoutubePlaylistSyncPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const enabledFilter = firstSearchParamValue(sp.enabled);
  const statusFilter = firstSearchParamValue(sp.status);
  const db = getDatabase();
  let rows: PlaylistSyncAdminRow[] = [];
  let hasMore = false;

  if (db) {
    const conds = [];
    if (enabledFilter === "1" || enabledFilter === "0") {
      conds.push(eq(eventYoutubePlaylistSync.enabled, Number(enabledFilter)));
    }
    if (
      ["disabled", "idle", "scanning", "synced", "deferred", "failed"].includes(
        statusFilter,
      )
    ) {
      conds.push(eq(eventYoutubePlaylistSync.sync_status, statusFilter as never));
    }

    // Select the configured events first.  The playlist/video joins can fan
    // out to many rows per event, so applying LIMIT after GROUP BY would read
    // every configured event before the page boundary is known.
    const configResult = await db
      .select({
        event_id: eventYoutubePlaylistSync.event_id,
        event_title: eventsTable.title,
        playlist_id: eventYoutubePlaylistSync.playlist_id,
        enabled: eventYoutubePlaylistSync.enabled,
        sync_mode: eventYoutubePlaylistSync.sync_mode,
        sync_interval_minutes: eventYoutubePlaylistSync.sync_interval_minutes,
        sync_status: eventYoutubePlaylistSync.sync_status,
        next_sync_at: eventYoutubePlaylistSync.next_sync_at,
        last_synced_at: eventYoutubePlaylistSync.last_synced_at,
        last_full_scan_at: eventYoutubePlaylistSync.last_full_scan_at,
        last_error: eventYoutubePlaylistSync.last_error,
      })
      .from(eventYoutubePlaylistSync)
      .innerJoin(
        eventsTable,
        eq(eventsTable.id, eventYoutubePlaylistSync.event_id),
      )
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(
        desc(sql`CASE ${eventYoutubePlaylistSync.sync_status}
          WHEN 'failed' THEN 4
          WHEN 'deferred' THEN 3
          WHEN 'scanning' THEN 2
          ELSE 1 END`),
        asc(eventYoutubePlaylistSync.next_sync_at),
        asc(eventsTable.title),
      )
      .limit(LIMIT + 1);

    const visibleConfigs = configResult.slice(0, LIMIT);
    hasMore = configResult.length > LIMIT;

    if (visibleConfigs.length > 0) {
      const eventIds = visibleConfigs.map((row) => row.event_id);
      const aggregateResult = [];
      for (const eventIdChunk of chunkEventIds(eventIds)) {
        const chunkResult = await db
          .select({
            event_id: videoEvents.event_id,
            linked_count: sql<number>`COUNT(DISTINCT CASE
              WHEN ${videosTable.id} IS NOT NULL
               AND ${videosTable.visibility_status} <> 'voided'
              THEN ${videosTable.id} END)`,
            eligible_count: sql<number>`COUNT(DISTINCT CASE
              WHEN ${videosTable.visibility_status} = 'public'
               AND ${videosTable.youtube_video_id} IS NOT NULL
               AND ${videosTable.youtube_video_id} <> ''
              THEN ${videosTable.id} END)`,
            synced_count: sql<number>`COUNT(DISTINCT CASE
              WHEN ${eventYoutubePlaylistItems.playlist_item_id} IS NOT NULL
               AND ${videosTable.visibility_status} = 'public'
              THEN ${videosTable.id} END)`,
          })
          .from(videoEvents)
          .leftJoin(videosTable, eq(videosTable.id, videoEvents.video_id))
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
          .where(inArray(videoEvents.event_id, eventIdChunk))
          .groupBy(videoEvents.event_id);
        aggregateResult.push(...chunkResult);
      }
      const countsByEventId = new Map(
        aggregateResult.map((row) => [
          row.event_id,
          {
            linked_count: Number(row.linked_count ?? 0),
            eligible_count: Number(row.eligible_count ?? 0),
            synced_count: Number(row.synced_count ?? 0),
          },
        ]),
      );

      rows = visibleConfigs.map((row) => ({
        ...row,
        ...(countsByEventId.get(row.event_id) ?? {
          linked_count: 0,
          eligible_count: 0,
          synced_count: 0,
        }),
      })) as PlaylistSyncAdminRow[];
    } else {
      rows = [];
    }
  }

  const totalWaiting = rows.reduce(
    (sum, row) => sum + Math.max(0, row.eligible_count - row.synced_count),
    0,
  );
  const totalFailed = rows.filter((row) => row.sync_status === "failed").length;

  return (
    <div>
      <AdminPageHeader
        title="イベント再生リスト同期"
        description="同期を明示的に設定したイベントだけを対象に、YouTube再生リストへの反映状況を確認します。"
      />
      <AdminVideoManagementTabs active="youtube-playlists" />

      <section className="fn-admin-stat-grid" style={{ marginTop: 18 }}>
        <Stat label="設定イベント" value={rows.length} />
        <Stat label="同期待ち作品" value={totalWaiting} tone={totalWaiting > 0 ? "warn" : "normal"} />
        <Stat label="失敗イベント" value={totalFailed} tone={totalFailed > 0 ? "danger" : "normal"} />
      </section>

      <form method="get" className="fn-console-filter-form fn-console-filter-panel">
        <label>
          <span className="fn-label">有効状態</span>
          <select name="enabled" className="fn-select" defaultValue={enabledFilter}>
            <option value="">すべて</option>
            <option value="1">有効のみ</option>
            <option value="0">無効のみ</option>
          </select>
        </label>
        <label>
          <span className="fn-label">同期状態</span>
          <select name="status" className="fn-select" defaultValue={statusFilter}>
            <option value="">すべて</option>
            {[
              "disabled",
              "idle",
              "scanning",
              "synced",
              "deferred",
              "failed",
            ].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          絞り込む
        </button>
        <Link href="/admin/youtube-sync/playlists" className="fn-btn fn-btn-ghost fn-btn-sm">
          解除
        </Link>
      </form>

      <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
        {rows.length} 件表示中（最大 {LIMIT} 件）
        {hasMore ? "。条件に一致する設定がさらにあります。" : ""}
      </p>

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <FnTable style={{ minWidth: 1240 }}>
          <thead>
            <tr>
              <th>イベント</th>
              <th>設定</th>
              <th>作品</th>
              <th>同期状態</th>
              <th>日時</th>
              <th>エラー・警告</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  再生リスト同期が設定されたイベントはありません。
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const waiting = Math.max(0, row.eligible_count - row.synced_count);
                const blocked = Math.max(0, row.linked_count - row.eligible_count);
                return (
                  <tr key={row.event_id}>
                    <td>
                      <Link href={`/manage/events/${row.event_id}`} style={{ fontWeight: 700 }}>
                        {row.event_title}
                      </Link>
                      <div className="fn-muted fn-text-xs fn-mono">{row.event_id}</div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span className={`fn-badge ${row.enabled ? "fn-badge-accent" : "fn-badge-soft"}`}>
                          {row.enabled ? "有効" : "無効"}
                        </span>
                        <span className="fn-text-xs">{row.sync_mode}</span>
                        <span className="fn-muted fn-text-xs">{intervalLabel(row.sync_interval_minutes)}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <span>同期済み {row.synced_count} / 対象 {row.eligible_count}</span>
                        {waiting > 0 ? (
                          <span className="fn-badge fn-badge-warning">待ち {waiting}</span>
                        ) : null}
                        {blocked > 0 ? (
                          <span className="fn-muted fn-text-xs">公開前・YouTube ID待ち {blocked}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={`fn-badge ${statusBadgeClass(row.sync_status)}`}>
                        {row.sync_status}
                      </span>
                    </td>
                    <td className="fn-text-xs">
                      <div>最終: {formatUnix(row.last_synced_at)}</div>
                      <div>全件: {formatUnix(row.last_full_scan_at)}</div>
                      <div>次回: {formatUnix(row.next_sync_at)}</div>
                    </td>
                    <td style={{ maxWidth: 320, wordBreak: "break-word" }}>
                      {row.last_error ?? "-"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Link
                          href={`/manage/events/${row.event_id}/youtube-playlist`}
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                        >
                          設定
                        </Link>
                        {row.playlist_id ? (
                          <Link
                            href={`https://www.youtube.com/playlist?list=${encodeURIComponent(row.playlist_id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="fn-btn fn-btn-ghost fn-btn-sm"
                          >
                            <Icon name="external" size={11} aria-hidden /> YouTube
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </FnTable>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: number;
  tone?: "normal" | "warn" | "danger";
}): React.ReactElement {
  return (
    <div className="fn-card" style={{ padding: 16 }}>
      <div className="fn-muted fn-text-xs">{label}</div>
      <strong
        style={{
          display: "block",
          marginTop: 4,
          fontSize: 24,
          color:
            tone === "danger"
              ? "var(--accent-danger)"
              : tone === "warn"
                ? "var(--accent-warning)"
                : undefined,
        }}
      >
        {value.toLocaleString()}
      </strong>
    </div>
  );
}

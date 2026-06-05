import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDatabase } from "@/lib/cloudflare";
import {
  videos as videosTable,
  videoYoutubeMetadata,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { queueYoutubeMetadataResync } from "@/lib/actions/youtube-sync-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/ui/Icon";
import {
  formatCount,
  formatDuration as formatDurationSec,
  formatUnix,
} from "@/lib/utils/format";

export const metadata: Metadata = { title: "YouTube同期状態" };
export const dynamic = "force-dynamic";

const LIMIT = 100;
const STALE_SECONDS = 14 * 24 * 60 * 60;

interface Props {
  searchParams?: Promise<{
    sync_status?: string;
    privacy?: string;
    availability?: string;
    visibility?: string;
    failed?: string;
    stale?: string;
    missing?: string;
  }>;
}

type YoutubeSyncRow = {
  video_id: string;
  title: string;
  creator_name: string | null;
  youtube_video_id: string | null;
  visibility_status: string;
  youtube_privacy_status: string | null;
  youtube_availability_status: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  sync_status: "pending" | "synced" | "failed" | null;
  sync_error: string | null;
  synced_at: number | null;
  updated_at: number | null;
};

function cleanFilter(raw: string | undefined): string {
  return (raw ?? "").trim();
}

function statusBadgeClass(status: string | null): string {
  if (status === "failed") return "fn-badge-danger";
  if (status === "pending") return "fn-badge-warning";
  if (status === "synced") return "fn-badge-accent";
  return "fn-badge-soft";
}

function visibilityBadgeClass(status: string): string {
  if (status === "public") return "fn-badge-accent";
  if (status === "pending") return "fn-badge-warning";
  if (status === "voided" || status === "private") return "fn-badge-danger";
  return "fn-badge-soft";
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "-";
  return formatDurationSec(sec);
}

export default async function AdminYoutubeSyncPage({
  searchParams,
}: Props): Promise<React.ReactElement> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

  const sp = (await searchParams) ?? {};
  const syncStatus = cleanFilter(sp.sync_status);
  const privacy = cleanFilter(sp.privacy);
  const availability = cleanFilter(sp.availability);
  const visibility = cleanFilter(sp.visibility);
  const failedOnly = sp.failed === "1";
  const staleOnly = sp.stale === "1";
  const missingOnly = sp.missing === "1";

  const db = getDatabase();
  let rows: YoutubeSyncRow[] = [];
  let hasMore = false;
  if (db) {
    const now = Math.floor(Date.now() / 1000);
    const conds = [];
    if (syncStatus === "pending" || syncStatus === "synced" || syncStatus === "failed") {
      conds.push(eq(videoYoutubeMetadata.sync_status, syncStatus));
    }
    if (privacy) conds.push(eq(videoYoutubeMetadata.youtube_privacy_status, privacy));
    if (availability) {
      conds.push(eq(videoYoutubeMetadata.youtube_availability_status, availability));
    }
    if (visibility) conds.push(eq(videosTable.visibility_status, visibility as never));
    if (failedOnly) conds.push(eq(videoYoutubeMetadata.sync_status, "failed"));
    if (staleOnly) {
      conds.push(
        or(
          sql`${videoYoutubeMetadata.synced_at} IS NULL`,
          lt(videoYoutubeMetadata.synced_at, now - STALE_SECONDS),
        ),
      );
    }
    if (missingOnly) {
      conds.push(
        or(
          sql`${videosTable.youtube_video_id} IS NULL`,
          eq(videosTable.youtube_video_id, ""),
        ),
      );
    }

    const result = await db
      .select({
        video_id: videosTable.id,
        title: videosTable.title,
        creator_name: sql<string | null>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
        youtube_video_id: sql<string | null>`COALESCE(${videoYoutubeMetadata.youtube_video_id}, ${videosTable.youtube_video_id})`,
        visibility_status: videosTable.visibility_status,
        youtube_privacy_status: videoYoutubeMetadata.youtube_privacy_status,
        youtube_availability_status: videoYoutubeMetadata.youtube_availability_status,
        duration_seconds: videoYoutubeMetadata.duration_seconds,
        view_count: videoYoutubeMetadata.view_count,
        sync_status: videoYoutubeMetadata.sync_status,
        sync_error: videoYoutubeMetadata.sync_error,
        synced_at: videoYoutubeMetadata.synced_at,
        updated_at: videoYoutubeMetadata.updated_at,
      })
      .from(videosTable)
      .leftJoin(
        videoYoutubeMetadata,
        eq(videoYoutubeMetadata.video_id, videosTable.id),
      )
      .leftJoin(
        xUsersTable,
        sql`lower(${xUsersTable.id}) = lower(${videosTable.creator_x_user_id})`,
      )
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(sql`COALESCE(${videoYoutubeMetadata.updated_at}, ${videosTable.updated_at}, ${videosTable.created_at})`))
      .limit(LIMIT + 1);
    rows = result.slice(0, LIMIT) as YoutubeSyncRow[];
    hasMore = result.length > LIMIT;
  }

  return (
    <div>
      <AdminPageHeader
        title="YouTubeメタデータ同期状態"
        description="video_youtube_metadata と作品情報を照合し、同期失敗・未同期・YouTube ID なしを確認します。"
      />

      <form
        method="get"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
          marginTop: 16,
          padding: 12,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <SelectFilter
          name="sync_status"
          label="sync_status"
          value={syncStatus}
          options={["pending", "synced", "failed"]}
        />
        <SelectFilter
          name="privacy"
          label="YouTube privacy"
          value={privacy}
          options={["public", "unlisted", "private"]}
        />
        <SelectFilter
          name="availability"
          label="YouTube availability"
          value={availability}
          options={["available", "unavailable", "deleted", "private", "embed_disabled"]}
        />
        <SelectFilter
          name="visibility"
          label="FlameNode公開状態"
          value={visibility}
          options={["draft", "pending", "public", "limited", "private", "hidden", "archived", "voided"]}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" name="failed" value="1" defaultChecked={failedOnly} />
          同期失敗のみ
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" name="stale" value="1" defaultChecked={staleOnly} />
          長期間未同期
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" name="missing" value="1" defaultChecked={missingOnly} />
          YouTube IDなし
        </label>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          絞り込む
        </button>
        <Link href="/admin/youtube-sync" className="fn-btn fn-btn-ghost fn-btn-sm">
          解除
        </Link>
      </form>

      <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
        {rows.length} 件表示中 (最大 {LIMIT} 件)
        {hasMore ? "。条件に一致する行がさらにあります。" : ""}
      </p>

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <FnTable style={{ minWidth: 1180 }}>
          <thead>
            <tr>
              <th>作品</th>
              <th>YouTube ID</th>
              <th>FlameNode</th>
              <th>YouTube</th>
              <th>再生時間</th>
              <th>再生数</th>
              <th>同期</th>
              <th>日時</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ color: "var(--text-muted)", textAlign: "center" }}>
                  該当する同期状態はありません。
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.video_id}>
                  <td>
                    <Link href={`/admin/videos/${row.video_id}`} style={{ fontWeight: 700 }}>
                      {row.title}
                    </Link>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {row.creator_name ?? "-"}
                    </div>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                    {row.youtube_video_id || (
                      <span className="fn-badge fn-badge-warning">なし</span>
                    )}
                  </td>
                  <td>
                    <span className={`fn-badge ${visibilityBadgeClass(row.visibility_status)}`}>
                      {row.visibility_status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "grid", gap: 4 }}>
                      <span className="fn-badge fn-badge-soft">
                        privacy: {row.youtube_privacy_status ?? "-"}
                      </span>
                      <span className="fn-badge fn-badge-soft">
                        availability: {row.youtube_availability_status ?? "-"}
                      </span>
                    </div>
                  </td>
                  <td>{formatDuration(row.duration_seconds)}</td>
                  <td>{formatCount(row.view_count ?? 0)}</td>
                  <td>
                    <div style={{ display: "grid", gap: 4 }}>
                      <span className={`fn-badge ${statusBadgeClass(row.sync_status)}`}>
                        {row.sync_status ?? "metadataなし"}
                      </span>
                      {row.sync_error ? (
                        <details>
                          <summary style={{ cursor: "pointer", color: "var(--accent-danger)" }}>
                            sync_error
                          </summary>
                          <pre
                            style={{
                              maxWidth: 320,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-all",
                              fontSize: 11,
                            }}
                          >
                            {row.sync_error}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    <div>synced: {formatUnix(row.synced_at)}</div>
                    <div>updated: {formatUnix(row.updated_at)}</div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Link
                        href={`/admin/videos/${row.video_id}`}
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                      >
                        管理
                      </Link>
                      <Link
                        href={`/${row.youtube_video_id ?? row.video_id}`}
                        className="fn-btn fn-btn-ghost fn-btn-sm"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="external" size={11} aria-hidden /> 公開
                      </Link>
                      <form action={queueYoutubeMetadataResync}>
                        <input type="hidden" name="video_id" value={row.video_id} />
                        <button
                          type="submit"
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                          aria-label={`${row.title} のYouTubeメタデータ再同期を予約`}
                        >
                          <Icon name="refresh" size={11} aria-hidden /> 再同期予約
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </FnTable>
      </div>
    </div>
  );
}

function SelectFilter({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
}): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", fontSize: 11 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <select name={name} defaultValue={value} className="fn-input">
        <option value="">すべて</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

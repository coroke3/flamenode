import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events as eventsTable,
  videoEvents as videoEventsTable,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { Icon } from "@/components/ui/Icon";
import { formatRelative } from "@/lib/utils/format";
import { youtubeThumbUrl } from "@/lib/youtube/id";

export const metadata: Metadata = { title: "作品管理" };
export const dynamic = "force-dynamic";

type AdminVideoRow = {
  id: string;
  title: string;
  youtube_video_id: string | null;
  display_name: string;
  status: string;
  created_at: number;
};

export default async function AdminVideosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; event?: string }>;
}): Promise<React.ReactElement> {
  const { q = "", status = "", event = "" } = await searchParams;

  const db = getDatabase();
  let rows: AdminVideoRow[] = [];
  let events: { id: string; title: string }[] = [];
  if (db) {
    try {
      const term = `%${q}%`;
      const queryFilter = q
        ? or(
            like(videosTable.title, term),
            like(videosTable.display_name, term),
            like(videosTable.contact_x_id, term),
            like(xUsersTable.x_name, term),
            like(xUsersTable.id, term),
          )
        : undefined;
      const statusFilter = status
        ? eq(videosTable.status, status as never)
        : undefined;
      const eventFilter = event
        ? eq(videoEventsTable.event_id, event)
        : undefined;
      const conds = [queryFilter, statusFilter, eventFilter].filter(
        (c): c is NonNullable<typeof c> => c !== undefined,
      );
      const where =
        conds.length === 0
          ? undefined
          : conds.length === 1
            ? conds[0]
            : and(...conds);
      const base = db
        .select({
          id: videosTable.id,
          title: videosTable.title,
          youtube_video_id: videosTable.youtube_video_id,
          display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.display_name}, ${videosTable.contact_x_id})`,
          status: videosTable.status,
          created_at: videosTable.created_at,
        })
        .from(videosTable)
        .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_id));
      const withEventJoin = event
        ? base.innerJoin(
            videoEventsTable,
            eq(videoEventsTable.video_id, videosTable.id),
          )
        : base;
      rows = await withEventJoin
        .where(where)
        .orderBy(desc(videosTable.created_at))
        .limit(60);

      // event 候補 (active なもののみ)
      events = await db
        .select({ id: eventsTable.id, title: eventsTable.title })
        .from(eventsTable)
        .where(eq(eventsTable.is_archived, 0))
        .orderBy(desc(eventsTable.start_time))
        .limit(50);
    } catch (e) {
      console.error("[AdminVideosPage] fetch failed", e);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>作品管理</h1>
      <form
        method="get"
        style={{
          marginTop: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="タイトル / 作者で検索"
          className="fn-input"
          style={{ maxWidth: 320 }}
        />
        <select name="status" className="fn-select" defaultValue={status}>
          <option value="">すべて</option>
          <option value="public">公開</option>
          <option value="pending">審査待ち</option>
          <option value="x_reapply_required">調整中</option>
          <option value="unlisted">限定公開</option>
          <option value="voided">不備</option>
        </select>
        <select name="event" className="fn-select" defaultValue={event}>
          <option value="">全イベント</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.title}
            </option>
          ))}
        </select>
        <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm">
          検索
        </button>
      </form>

      <table className="fn-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>サムネ</th>
            <th>タイトル / 作者</th>
            <th>状態</th>
            <th>登録</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id}>
              <td>
                <div
                  style={{
                    width: 96,
                    aspectRatio: "16 / 9",
                    background: "var(--bg-elevated)",
                    borderRadius: "var(--radius-sm)",
                    overflow: "hidden",
                  }}
                >
                  {v.youtube_video_id ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={youtubeThumbUrl(v.youtube_video_id, "default") ?? ""}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        height: "100%",
                        color: "var(--text-muted)",
                      }}
                    >
                      <Icon name="youtube" size={18} aria-hidden />
                    </span>
                  )}
                </div>
              </td>
              <td>
                <div style={{ fontWeight: 600 }}>{v.title}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {v.display_name}
                </div>
              </td>
              <td>
                <span
                  className={`fn-badge ${
                    v.status === "public"
                      ? "fn-badge-accent"
                      : v.status === "pending"
                        ? "fn-badge-warning"
                        : v.status === "voided"
                          ? "fn-badge-danger"
                          : "fn-badge-soft"
                  }`}
                >
                  {v.status}
                </span>
              </td>
              <td>{formatRelative(v.created_at)}</td>
              <td>
                <Link
                  href={`/admin/videos/${v.id}`}
                  className="fn-btn fn-btn-ghost fn-btn-sm"
                >
                  詳細
                </Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <p
                  className="fn-empty-message"
                  style={{ padding: 16, textAlign: "center" }}
                >
                  対象作品が見つかりません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

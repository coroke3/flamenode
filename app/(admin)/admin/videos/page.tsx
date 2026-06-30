import * as React from "react";
import { FnTable } from "@/components/ui/FnTable";

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
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminVideoManagementTabs } from "@/components/admin/AdminVideoManagementTabs";
import { Pagination } from "@/components/ui/Pagination";
import { clampPaging, escapeLike, totalPagesFor } from "@/lib/utils/sql";
import { AutoSubmitSelect } from "@/components/forms/AutoSubmitSelect";

export const metadata: Metadata = { title: "作品管理" };
export const dynamic = "force-dynamic";

const VIDEO_PAGE_SIZE = 50;
const EVENT_OPTIONS_LIMIT = 200;

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
  searchParams: Promise<{
    q?: string;
    status?: string;
    event?: string;
    page?: string;
  }>;
}): Promise<React.ReactElement> {
  const { q = "", status = "", event = "", page: pageRaw = "1" } =
    await searchParams;
  const { page, pageSize, offset } = clampPaging({
    page: pageRaw,
    pageSize: VIDEO_PAGE_SIZE,
    defaultPageSize: VIDEO_PAGE_SIZE,
    maxPageSize: VIDEO_PAGE_SIZE,
  });

  const db = getDatabase();
  let rows: AdminVideoRow[] = [];
  let events: { id: string; title: string }[] = [];
  let total = 0;
  if (db) {
    try {
      const escaped = escapeLike(q);
      const term = `%${escaped}%`;
      const queryFilter = q
        ? or(
            like(videosTable.title, term),
            like(videosTable.creator_display_name, term),
            like(videosTable.creator_x_user_id, term),
            like(xUsersTable.x_name, term),
            like(xUsersTable.id, term),
          )
        : undefined;
      const statusFilter = status ? eq(videosTable.visibility_status, status as never) : undefined;
      const eventFilter = event ? eq(videoEventsTable.event_id, event) : undefined;
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
          display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
          status: videosTable.visibility_status,
          created_at: videosTable.created_at,
        })
        .from(videosTable)
        .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id));
      const withEventJoin = event
        ? base.innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
        : base;
      rows = await withEventJoin
        .where(where)
        .orderBy(desc(videosTable.created_at))
        .limit(pageSize)
        .offset(offset);

      const countBase = db
        .select({ c: sql<number>`COUNT(*)` })
        .from(videosTable)
        .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id));
      const countWithJoin = event
        ? countBase.innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
        : countBase;
      const countRow = (await countWithJoin.where(where).limit(1))[0];
      total = Number(countRow?.c ?? 0);

      events = await db
        .select({ id: eventsTable.id, title: eventsTable.title })
        .from(eventsTable)
        .where(eq(eventsTable.is_archived, 0))
        .orderBy(desc(eventsTable.start_time))
        .limit(EVENT_OPTIONS_LIMIT);
    } catch (e) {
      console.error("[AdminVideosPage] fetch failed", e);
    }
  }

  const totalPages = totalPagesFor(total, pageSize);
  const buildHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (event) sp.set("event", event);
    sp.set("page", String(p));
    return `/admin/videos?${sp.toString()}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="作品管理"
        description="作品の状態確認、監査ログ、参加者設定を行います。"
      />

      <AdminVideoManagementTabs q={q} status={status} event={event} />

      <form
        action="/admin/videos"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}
      >
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input
          className="fn-input"
          name="q"
          defaultValue={q}
          placeholder="タイトル / 作者 / X ID"
          style={{ minWidth: 240 }}
        />
        <AutoSubmitSelect className="fn-select" name="event" defaultValue={event}>
          <option value="">すべてのイベント</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.title}
            </option>
          ))}
        </AutoSubmitSelect>
        {(q || status || event) ? (
          <Link href="/admin/videos" className="fn-btn fn-btn-ghost">
            解除
          </Link>
        ) : null}
      </form>

      <FnTable style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>サムネイル</th>
            <th>作品</th>
            <th>状態</th>
            <th>登録</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v, index) => (
            <tr key={`${v.id}-admin-video-${index}`}>
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
                    // eslint-disable-next-line @next/next/no-img-element
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
                <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                  <Link
                    href={`/admin/videos/${v.id}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    詳細
                  </Link>
                  <Link
                    href={`/admin/videos/${v.id}/members`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                  >
                    参加者
                  </Link>
                  <Link
                    href={`/admin/audit?table=videos&record=${encodeURIComponent(v.id)}`}
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    title="この作品の監査ログ"
                  >
                    監査
                  </Link>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <p className="fn-empty-message" style={{ padding: 16, textAlign: "center" }}>
                  条件に合う作品がありません。
                </p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </FnTable>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        unitLabel="件"
        buildHref={buildHref}
      />
    </div>
  );
}

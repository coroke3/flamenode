import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import { canAccessManageEvent } from "@/lib/auth/ownership";
import {
  events as eventsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { EmptyState } from "@/components/ui/EmptyState";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { VideoReviewQueueTable } from "@/components/admin/VideoReviewQueueTable";
import { fetchVideoReviewSummaries } from "@/lib/admin/videoReviewMeta";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  { value: "all", label: "すべて" },
  { value: "pending", label: "審査待ち" },
  { value: "public", label: "公開" },
  { value: "hidden", label: "非表示" },
  { value: "private", label: "非公開" },
  { value: "limited", label: "限定" },
  { value: "draft", label: "下書き" },
] as const;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = getDatabase();
  if (!db) return { title: `審査キュー (${id})` };
  const ev = (
    await db
      .select({ title: eventsTable.title })
      .from(eventsTable)
      .where(eq(eventsTable.id, id))
      .limit(1)
  )[0];
  return { title: ev?.title ? `${ev.title} 審査キュー` : "審査キュー" };
}

export default async function ManageEventVideosPage({
  params,
  searchParams,
}: Props): Promise<React.ReactElement> {
  const { id } = await params;
  const { status: statusRaw = "pending" } = await searchParams;
  const statusFilter = statusRaw === "all" ? "" : statusRaw;

  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/videos`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();

  const isAdmin = user.role === "admin";
  if (!(await canAccessManageEvent(db, user, id))) notFound();

  const statusCond = statusFilter
    ? eq(videosTable.visibility_status, statusFilter as never)
    : undefined;

  const baseRows = await db
    .select({
      id: videosTable.id,
      title: videosTable.title,
      youtube_video_id: videosTable.youtube_video_id,
      display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
      visibility_status: videosTable.visibility_status,
      created_at: videosTable.created_at,
    })
    .from(videosTable)
    .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
    .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
    .where(and(eq(videoEventsTable.event_id, id), statusCond)!)
    .orderBy(desc(videosTable.created_at))
    .limit(200);

  const summaries = await fetchVideoReviewSummaries(
    db,
    baseRows.map((row) => row.id),
    id,
  );

  const rows = baseRows.map((row) => {
    const summary = summaries.get(row.id);
    return {
      ...row,
      stage_permission_summary: summary?.stage_permission_summary ?? "—",
      required_unanswered_count: summary?.required_unanswered_count ?? 0,
    };
  });

  return (
    <div style={manageEventAccentStyle(ev.accent_color)}>
      <p className="fn-muted fn-text-sm" style={{ margin: "0 0 12px" }}>
        <Link href={`/manage/events/${id}`}>← イベント運営トップへ</Link>
      </p>

      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>
          {ev.title} — 審査キュー
        </h1>
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          このイベントに紐づく作品 {rows.length} 件
          {statusFilter ? `（${statusFilter}）` : ""}
        </p>
      </header>
      <ManageEventTabs
        eventId={id}
        active={statusFilter === "pending" ? "review" : "submissions"}
        isAdmin={isAdmin}
      />

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 16,
          alignItems: "center",
        }}
      >
        {STATUS_FILTERS.map((f) => {
          const active =
            f.value === "all" ? statusFilter === "" : f.value === statusFilter;
          const href = `/manage/events/${id}/videos?status=${encodeURIComponent(f.value)}`;
          return (
            <Link
              key={f.value}
              href={href}
              className={`fn-btn fn-btn-sm ${active ? "fn-btn-primary" : "fn-btn-ghost"}`}
              aria-current={active ? "page" : undefined}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          tone={statusFilter === "pending" ? "success" : "neutral"}
          title={
            statusFilter === "pending"
              ? "審査待ちはありません"
              : "該当する作品はありません"
          }
          description={
            statusFilter === "pending"
              ? "現在、このイベントで対応が必要な作品はありません。"
              : "フィルタ条件を変えると、別の作品が表示される場合があります。"
          }
          iconName={statusFilter === "pending" ? "check" : "info"}
          actions={[
            { href: `/event/${id}`, label: "公開ページを見る", variant: "primary" },
            {
              href: `/manage/events/${id}`,
              label: "イベント運営トップへ",
              variant: "ghost",
            },
          ]}
        />
      ) : (
        <VideoReviewQueueTable
          rows={rows}
          reviewHref={(videoId) => `/manage/events/${id}/videos/${videoId}`}
          contentHref={(videoId) => `/dashboard/edit/${videoId}?privileged=event`}
        />
      )}
    </div>
  );
}

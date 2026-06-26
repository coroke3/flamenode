import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  canAccessManageEvent,
  canEditEvent,
} from "@/lib/auth/ownership";
import {
  events as eventsTable,
  videos as videosTable,
  videoEvents as videoEventsTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { ManageVideoStatusForm } from "@/components/manage/ManageVideoStatusForm";
import { Icon } from "@/components/ui/Icon";
import { formatUnix } from "@/lib/utils/format";
import { youtubeThumbUrl } from "@/lib/youtube/id";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string; videoId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { videoId } = await params;
  return { title: `作品審査 ${videoId}` };
}

export default async function ManageEventVideoDetailPage({
  params,
}: Props): Promise<React.ReactElement> {
  const { id, videoId } = await params;

  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/videos/${encodeURIComponent(videoId)}`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const ev = (
    await db.select().from(eventsTable).where(eq(eventsTable.id, id)).limit(1)
  )[0];
  if (!ev) notFound();
  if (!(await canAccessManageEvent(db, user, id))) notFound();

  const row = (
    await db
      .select({
        id: videosTable.id,
        title: videosTable.title,
        youtube_video_id: videosTable.youtube_video_id,
        visibility_status: videosTable.visibility_status,
        created_at: videosTable.created_at,
        display_name: sql<string>`COALESCE(${xUsersTable.x_name}, ${videosTable.creator_display_name}, ${videosTable.creator_x_user_id})`,
      })
      .from(videosTable)
      .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
      .leftJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id))
      .where(
        and(
          eq(videoEventsTable.event_id, id),
          eq(videosTable.id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!row) notFound();

  const isAdmin = user.role === "admin";
  const canReview =
    isAdmin || (await canEditEvent(db, user, id, "video.status"));

  const thumb = row.youtube_video_id
    ? youtubeThumbUrl(row.youtube_video_id)
    : null;

  return (
    <div style={manageEventAccentStyle(ev.accent_color)}>
      <p className="fn-muted fn-text-sm" style={{ margin: "0 0 12px" }}>
        <Link href={`/manage/events/${id}/videos?status=pending`}>
          ← 審査キューへ
        </Link>
      </p>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
          {row.title}
        </h1>
        <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
          {row.display_name} · 登録 {formatUnix(row.created_at)}
        </p>
      </header>
      <ManageEventTabs eventId={id} active="review" isAdmin={isAdmin} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 280px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            style={{
              width: "100%",
              aspectRatio: "16/9",
              objectFit: "cover",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-elevated)",
            }}
          />
        ) : (
          <div
            style={{
              aspectRatio: "16/9",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-md)",
              display: "grid",
              placeItems: "center",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            サムネイルなし
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p>
            現在の状態:{" "}
            <span className="fn-badge fn-badge-soft">{row.visibility_status}</span>
          </p>

          {canReview ? (
            <ManageVideoStatusForm
              eventId={id}
              videoId={row.id}
              currentStatus={row.visibility_status}
            />
          ) : (
            <p className="fn-muted fn-text-sm">
              公開状態の変更権限がありません。内容確認のみ可能です。
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`/dashboard/edit/${row.id}?privileged=event`}
              className="fn-btn fn-btn-primary fn-btn-sm"
            >
              <Icon name="edit" size={11} aria-hidden /> 作品内容を確認
            </Link>
            {row.youtube_video_id ? (
              <Link
                href={`/${row.youtube_video_id}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                公開ページ
              </Link>
            ) : null}
            {isAdmin ? (
              <Link
                href={`/admin/videos/${row.id}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                管理者用詳細
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

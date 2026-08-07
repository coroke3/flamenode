import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
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
} from "@/lib/db/schema";
import { ManageVideoStatusForm } from "@/components/video/VideoStatusForm";
import { VideoApproveActions } from "@/components/video/VideoApproveActions";
import {
  approveManageVideoPublic,
  approveManageVideoPublicAndNext,
} from "@/lib/actions/manage-video";
import { Icon } from "@/components/ui/Icon";
import { ManageEventTabs } from "@/components/manage/ManageEventTabs";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { VideoReviewDetailPanel } from "@/components/admin/VideoReviewDetailPanel";
import { fetchVideoReviewDetail } from "@/lib/admin/videoReviewDetail";

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

  const linked = (
    await db
      .select({ id: videosTable.id })
      .from(videosTable)
      .innerJoin(videoEventsTable, eq(videoEventsTable.video_id, videosTable.id))
      .where(
        and(
          eq(videoEventsTable.event_id, id),
          eq(videosTable.id, videoId),
        )!,
      )
      .limit(1)
  )[0];
  if (!linked) notFound();

  const video = await fetchVideoReviewDetail(db, videoId, [id]);
  if (!video) notFound();

  const isAdmin = user.role === "admin";
  const canReview =
    isAdmin || (await canEditEvent(db, user, id, "video.status"));

  return (
    <div style={manageEventAccentStyle(ev.accent_color)}>
      <p className="fn-muted fn-text-sm" style={{ margin: "0 0 12px" }}>
        <Link href={`/manage/events/${id}/videos?status=pending`}>
          ← 審査キューへ
        </Link>
      </p>

      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>
          {video.title}
        </h1>
      </header>
      <ManageEventTabs eventId={id} isAdmin={isAdmin} />

      <VideoReviewDetailPanel
        video={video}
        statusForm={
          canReview ? (
            <>
              <VideoApproveActions
                videoId={video.id}
                currentStatus={video.visibility_status}
                approveAction={approveManageVideoPublic}
                approveAndNextAction={approveManageVideoPublicAndNext}
                hiddenFields={{ event_id: id }}
              />
              <ManageVideoStatusForm
                eventId={id}
                videoId={video.id}
                currentStatus={video.visibility_status}
              />
            </>
          ) : (
            <p className="fn-muted fn-text-sm">
              公開状態の変更権限がありません。内容確認のみ可能です。
            </p>
          )
        }
        footerLinks={
          <>
            <Link
              href={`/dashboard/edit/${video.id}?privileged=event`}
              className="fn-btn fn-btn-primary fn-btn-sm"
            >
              <Icon name="edit" size={11} aria-hidden /> 作品内容を確認
            </Link>
            {video.youtube_video_id ? (
              <Link
                href={`/${video.youtube_video_id}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                公開ページ
              </Link>
            ) : null}
            {isAdmin ? (
              <Link
                href={`/admin/videos/${video.id}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                管理者用詳細
              </Link>
            ) : null}
          </>
        }
      />
    </div>
  );
}

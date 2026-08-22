import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDatabase } from "@/lib/cloudflare";
import { requireSession } from "@/lib/auth/guard";
import {
  canAccessManageEventFromSnapshot,
  canEditEventFromSnapshot,
  getManageAuthorizationSnapshot,
} from "@/lib/auth/manageAuthorization";
import { getManageNavigationSnapshot } from "@/lib/manage/navigationEvents";
import { ManageVideoStatusForm } from "@/components/video/VideoStatusForm";
import { VideoApproveActions } from "@/components/video/VideoApproveActions";
import {
  approveManageVideoPublic,
  approveManageVideoPublicAndNext,
} from "@/lib/actions/manage-video";
import { Icon } from "@/components/ui/Icon";
import { ManageEventPageShell } from "@/components/manage/ManageEventPageShell";
import { manageEventAccentStyle } from "@/lib/utils/eventAccent";
import { VideoReviewDetailPanel } from "@/components/admin/VideoReviewDetailPanel";
import { fetchEventVideoReviewDetail } from "@/lib/admin/videoReviewDetail";

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
  const eventHrefId = encodeURIComponent(id);

  const guard = await requireSession({
    next: `/manage/events/${encodeURIComponent(id)}/videos/${encodeURIComponent(videoId)}`,
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  if (!db) notFound();

  const authorization = await getManageAuthorizationSnapshot(
    user.id,
    user.role ?? null,
  );
  const navigation = await getManageNavigationSnapshot(user.id, user.role ?? null);
  if (!canAccessManageEventFromSnapshot(authorization, id)) notFound();
  const ev = navigation.events.find((event) => event.id === id);
  if (!ev) notFound();

  const video = await fetchEventVideoReviewDetail(db, id, videoId);
  if (!video) notFound();
  const youtubeVideoId = video.youtube_video_id?.trim() || null;

  const isAdmin = user.role === "admin";
  const canReview = canEditEventFromSnapshot(
    authorization,
    id,
    "video.status",
  );
  const pendingCount = navigation.pendingByEvent.get(id) ?? 0;

  return (
    <ManageEventPageShell
      eventId={id}
      title={ev.title}
      description={`作品審査 — ${video.title}`}
      backHref={`/manage/events/${eventHrefId}/videos?status=pending`}
      backLabel="審査キューへ"
      isAdmin={isAdmin}
      pendingCount={pendingCount}
      accentStyle={manageEventAccentStyle(ev.accent_color)}
    >
      <VideoReviewDetailPanel
        video={video}
        statusForm={
          canReview ? (
            <>
              <VideoApproveActions
                videoId={video.id}
                currentStatus={video.visibility_status}
                sourceType={video.source_type}
                youtubeVideoId={video.youtube_video_id}
                approveAction={approveManageVideoPublic}
                approveAndNextAction={approveManageVideoPublicAndNext}
                hiddenFields={{ event_id: id }}
              />
              <ManageVideoStatusForm
                eventId={id}
                videoId={video.id}
                currentStatus={video.visibility_status}
                sourceType={video.source_type}
                youtubeVideoId={video.youtube_video_id}
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
            <Link
              href={`/${youtubeVideoId ?? video.id}`}
              className="fn-btn fn-btn-ghost fn-btn-sm"
            >
              公開ページ
            </Link>
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
    </ManageEventPageShell>
  );
}

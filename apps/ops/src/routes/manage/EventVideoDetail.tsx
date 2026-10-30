/** MIG-0724 U03: guarded-by-parent Manage video detail and presentation.
 * Mutations are explicitly injected by U04 after MIG-0603 contract verification.
 */
import "../../styles/video-review.css";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import type { ManageVideoDetailResponse } from "@flamenode/contracts";
import type { OpsResult } from "../../api/read.js";
import type { ManageVideoDetailApi } from "../../api/manageVideoDetail.js";
import type { ReviewAction } from "../../components/videoReview/shared.js";
import { youtubeThumbUrl } from "../../components/videoReview/shared.js";
import { VideoReviewDetailPanel } from "../../components/videoReview/VideoReviewDetailPanel.js";
import { VideoApproveActions } from "../../components/videoReview/VideoApproveActions.js";
import { ManageVideoStatusForm } from "../../components/videoReview/VideoStatusForm.js";
import { ConsolePageHeader } from "../../components/shared/ConsolePageHeader.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { NotFoundView } from "../NotFoundView.js";
import { useApiResult } from "../useApiResult.js";

type Actions = {
  approveAction?: ReviewAction;
  approveAndNextAction?: ReviewAction;
  statusAction?: ReviewAction;
};
type DetailProps = Actions & { eventId: string; videoId: string; api: ManageVideoDetailApi };

function AccessRedirect({ target }: { target: string }): React.ReactElement {
  React.useEffect(() => { window.location.assign(target); }, [target]);
  return <p role="status">移動しています...</p>;
}

/** Only local links to the same event's video queue can be honored after an approval. */
export function safeReviewNextHref(eventId: string, href: string): string | null {
  const prefix = `/manage/events/${encodeURIComponent(eventId)}/videos/`;
  if (!href.startsWith(prefix) || href.includes("\\") || href.includes("//")) return null;
  try {
    const url = new URL(href, "https://flamenode.invalid");
    if (url.origin !== "https://flamenode.invalid") return null;
    const segment = url.pathname.slice(prefix.length);
    const decoded = decodeURIComponent(segment);
    if (!segment || segment.includes("/") || !decoded || decoded.includes("/") ||
        decoded.includes(String.fromCharCode(92)) || decoded === "." || decoded === "..") return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

export function EventVideoDetailContent({
  eventId, videoId, result, refresh, navigate, approveAction, approveAndNextAction, statusAction,
}: Actions & {
  eventId: string;
  videoId: string;
  result: OpsResult<ManageVideoDetailResponse>;
  refresh: () => void;
  navigate: (href: string) => void;
}): React.ReactElement {
  if (result.status === "anonymous") return <AccessRedirect target="/entry" />;
  if (result.status === "forbidden") return <AccessRedirect target="/dashboard" />;
  if (result.status === "notFound") return <NotFoundView />;
  if (result.status !== "ok") return (
    <section role="alert" className="fn-public-container fn-page">
      作品審査の詳細を取得できません。状態を確認して再読み込みしてください。
    </section>
  );

  const { event, video, canReview, isAdmin, truncated } = result.data;
  if (event.id !== eventId || video.id !== videoId || !video.event_ids.includes(eventId)) {
    return <p role="status" aria-busy="true">読み込み中...</p>;
  }
  const encodedEvent = encodeURIComponent(eventId);
  const encodedVideo = encodeURIComponent(videoId);
  const quickStatusReady = Boolean(approveAction && approveAndNextAction);
  const navigateSafe = (href: string) => {
    const destination = safeReviewNextHref(eventId, href);
    if (destination) navigate(destination);
    else refresh();
  };
  const externalVideoId = youtubeThumbUrl(video.youtube_video_id, "default")
    ? video.youtube_video_id?.trim() : null;

  const statusForm = !canReview ? (
    <p className="fn-muted fn-text-sm">
      公開状態の変更権限がありません。内容確認のみ可能です。
    </p>
  ) : (
    <div className="video-review-action-stack">
      {quickStatusReady && approveAction && approveAndNextAction ? (
        <VideoApproveActions
          videoId={video.id} currentStatus={video.visibility_status}
          sourceType={video.source_type} youtubeVideoId={video.youtube_video_id}
          approveAction={approveAction} approveAndNextAction={approveAndNextAction}
          hiddenFields={{ event_id: eventId }} onRefresh={refresh} onNavigate={navigateSafe}
        />
      ) : null}
      {statusAction ? (
        <ManageVideoStatusForm
          eventId={eventId} videoId={video.id} currentStatus={video.visibility_status}
          sourceType={video.source_type} youtubeVideoId={video.youtube_video_id}
          action={statusAction} onRefresh={refresh} onNavigate={navigateSafe}
        />
      ) : null}
      {!quickStatusReady || !statusAction ? (
        <p className="fn-muted fn-text-sm" role="status">
          作品状態の操作は、API移行の検証完了後に有効になります。
        </p>
      ) : null}
    </div>
  );

  return <div className="fn-public-container fn-page" data-fn-video-detail>
    <ConsolePageHeader title={event.title}
      description={`作品審査 — ${video.title}`}
      backHref={`/manage/events/${encodedEvent}/videos?status=pending`}
      backLabel="審査キューへ" />
    {truncated ? <p role="alert" className="fn-muted fn-text-sm">
      回答・メンバー・チャプターの一部はAPIの上限により省略されています。
      全件確認が必要な場合は旧管理画面で確認してください。
    </p> : null}
    <VideoReviewDetailPanel
      video={video} statusForm={statusForm}
      footerLinks={<>
        <OpsLink href={`/dashboard/edit/${encodedVideo}?privileged=event`}
          className="fn-btn fn-btn-primary fn-btn-sm">作品内容を確認</OpsLink>
        <OpsLink href={`/${encodeURIComponent(externalVideoId ?? video.id)}`}
          className="fn-btn fn-btn-ghost fn-btn-sm">公開ページ</OpsLink>
        {isAdmin ? <OpsLink href={`/admin/videos/${encodedVideo}`}
          className="fn-btn fn-btn-ghost fn-btn-sm">管理者用詳細</OpsLink> : null}
      </>}
    />
  </div>;
}

export function EventVideoDetail({
  eventId, videoId, api, approveAction, approveAndNextAction, statusAction,
}: DetailProps): React.ReactElement {
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = React.useState(0);
  const loader = React.useCallback(
    (signal: AbortSignal) => api.getDetail(eventId, videoId, signal),
    [api, eventId, videoId],
  );
  const dataKey = `${eventId.length}:${eventId}/${videoId.length}:${videoId}`;
  const result = useApiResult(loader, dataKey, refreshKey);
  if (result.status === "loading") return (
    <p role="status" aria-busy="true" className="fn-public-container fn-page">読み込み中...</p>
  );
  return <EventVideoDetailContent
    eventId={eventId} videoId={videoId} result={result}
    approveAction={approveAction} approveAndNextAction={approveAndNextAction}
    statusAction={statusAction}
    refresh={() => setRefreshKey(n => n + 1)} navigate={navigate} />;
}

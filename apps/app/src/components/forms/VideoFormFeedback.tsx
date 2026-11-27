// Unmounted B02 port: keep CURRENT feedback order and mutually exclusive blocking notices together.
// The six vform classes are registered with the future full VideoForm CSS integration.
import * as React from "react";
import { Icon } from "../../routes/ui/Icon.tsx";
import { ErrorCallout } from "../ui/ErrorCallout.tsx";
import { PublicReflectionDelayNotice } from "../ui/PublicReflectionDelayNotice.tsx";
import { videoPageHref } from "../../lib/youtubeId.ts";
import type { VideoActionResult } from "../../lib/videoTypes.ts";

interface VideoFormFeedbackProps {
  mode: "free" | "slot" | "edit";
  result: VideoActionResult | null;
  submitBlockedReason?: string;
  noEditableFormSections: boolean;
  permissionSubmitBlockedHint: string | null;
}

export function VideoFormFeedback({
  mode,
  result,
  submitBlockedReason,
  noEditableFormSections,
  permissionSubmitBlockedHint,
}: VideoFormFeedbackProps): React.ReactElement {
  return (
    <>
      {result && !result.ok ? (
        <ErrorCallout
          reason={result.reason}
          message={result.message ?? "提出に失敗しました。"}
        />
      ) : null}
      {result && result.ok ? (
        <div role="status" className="vform-resultNotice">
          <div className="vform-resultNoticeHeader">
            <Icon name="check" size={13} aria-hidden />{" "}
            {mode === "edit"
              ? "保存しました。"
              : "提出が完了しました。続けて以下から進めてください。"}
          </div>
          {mode === "slot" && !result.youtubeVideoId ? (
            <p className="vform-resultNoticeMessage">
              YouTube URLが未設定でも作品情報は公開できます。必要に応じて後から追加できます。
            </p>
          ) : null}
          {result.pendingPublicReflection ? <PublicReflectionDelayNotice /> : null}
          <div className="vform-resultActions">
            {(result.youtubeVideoId || result.videoId) ? (
              <a
                href={videoPageHref({ id: result.videoId ?? "", youtube_video_id: result.youtubeVideoId })}
                className="fn-btn fn-btn-primary fn-btn-sm"
              >
                <Icon name="external" size={12} aria-hidden /> 公開ページを見る
              </a>
            ) : null}
            {result.eventId ? (
              <a
                href={`/event/${result.eventId}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="calendar" size={12} aria-hidden /> イベントへ戻る
              </a>
            ) : null}
            {mode !== "edit" && result.videoId ? (
              <a
                href={`/dashboard/edit/${result.videoId}`}
                className="fn-btn fn-btn-ghost fn-btn-sm"
              >
                <Icon name="edit" size={12} aria-hidden /> 編集を続ける
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {submitBlockedReason ? (
        <div role="alert" className="vform-blockedNotice">
          <Icon name="warning" size={13} aria-hidden />
          <span>{submitBlockedReason}</span>
        </div>
      ) : noEditableFormSections && permissionSubmitBlockedHint ? (
        <div role="status" className="vform-permissionNotice">
          <Icon name="info" size={13} aria-hidden />
          <span>{permissionSubmitBlockedHint}</span>
        </div>
      ) : null}
    </>
  );
}

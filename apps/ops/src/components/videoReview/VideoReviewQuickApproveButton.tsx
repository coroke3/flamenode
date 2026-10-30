import * as React from "react";
import { COMMUNICATION_ERROR_MESSAGE, PUBLIC_REFLECTION_DELAY_MESSAGE, type ReviewAction } from "./shared.js";

export interface VideoReviewQuickApproveButtonProps {
  videoId: string;
  action: ReviewAction;
  hiddenFields?: Record<string, string>;
  /** Re-fetch the list after success, retryable failure or uncertain network outcome. */
  onRefresh: () => void;
}

export function VideoReviewQuickApproveButton({
  videoId, action, hiddenFields, onRefresh,
}: VideoReviewQuickApproveButtonProps): React.ReactElement {
  const [submitting, setSubmitting] = React.useState(false);
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingPublicReflection, setPendingPublicReflection] = React.useState(false);
  const onApprove = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setPendingPublicReflection(false);
    const fd = new FormData();
    for (const [key, value] of Object.entries(hiddenFields ?? {})) fd.set(key, value);
    fd.set("video_id", videoId);
    void (async () => {
      try {
        const result = await action(fd);
        if (!result.ok) {
          setError(result.message ?? "承認に失敗しました。");
          if (result.retryable) onRefresh();
          return;
        }
        setPendingPublicReflection(result.pendingPublicReflection === true);
        onRefresh();
      } catch {
        setError(COMMUNICATION_ERROR_MESSAGE);
        onRefresh();
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    })();
  };
  return (
    <span className="video-review-quick">
      <button type="button" className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={submitting} aria-busy={submitting} onClick={onApprove}>
        承認
      </button>
      {error ? <span role="alert" className="video-review-error">{error}</span> : null}
      {pendingPublicReflection ? (
        <span className="video-review-delay">{PUBLIC_REFLECTION_DELAY_MESSAGE}</span>
      ) : null}
    </span>
  );
}

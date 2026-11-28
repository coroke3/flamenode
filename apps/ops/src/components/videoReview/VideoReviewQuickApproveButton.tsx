import * as React from "react";
import { COMMUNICATION_ERROR_MESSAGE, PUBLIC_REFLECTION_DELAY_MESSAGE, reviewMutationScopeKey, type ReviewAction } from "./shared.js";

export interface VideoReviewQuickApproveButtonProps {
  videoId: string;
  action: ReviewAction;
  hiddenFields?: Record<string, string>;
  authorizationEpoch?: string;
  /** Re-fetch the list after success, retryable failure or uncertain network outcome. */
  onRefresh: () => void;
}

export function VideoReviewQuickApproveButton(props: VideoReviewQuickApproveButtonProps): React.ReactElement {
  return <ScopedQuickApproveButton
    key={reviewMutationScopeKey(props.videoId, props.hiddenFields, props.authorizationEpoch)} {...props} />;
}

function ScopedQuickApproveButton({
  videoId, action, hiddenFields, onRefresh,
}: VideoReviewQuickApproveButtonProps): React.ReactElement {
  const [submitting, setSubmitting] = React.useState(false);
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingPublicReflection, setPendingPublicReflection] = React.useState(false);
  const scopeRef = React.useRef<object | null>(null);
  React.useLayoutEffect(() => {
    scopeRef.current = {};
    // Adapter replacement retires the receipt, not the same-view write lock.
    if (!inFlight.current) setSubmitting(false);
    setError(null);
    setPendingPublicReflection(false);
    return () => { scopeRef.current = null; };
  }, [action]);
  const onApprove = () => {
    const scope = scopeRef.current;
    if (!scope || inFlight.current) return;
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
        if (scopeRef.current !== scope) return;
        if (!result.ok) {
          setError(result.message ?? "承認に失敗しました。");
          if (result.retryable) onRefresh();
          return;
        }
        setPendingPublicReflection(result.pendingPublicReflection === true);
        onRefresh();
      } catch {
        if (scopeRef.current !== scope) return;
        setError(COMMUNICATION_ERROR_MESSAGE);
        onRefresh();
      } finally {
        // Only this mounted instance can own this lock. Adapter rotation must
        // not start another write before the original request settles.
        inFlight.current = false;
        if (scopeRef.current !== null) {
          setSubmitting(false);
        }
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

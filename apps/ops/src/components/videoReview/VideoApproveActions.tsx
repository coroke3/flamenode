import * as React from "react";
import { COMMUNICATION_ERROR_MESSAGE, PUBLIC_REFLECTION_DELAY_MESSAGE, reviewMutationScopeKey, type ReviewAction } from "./shared.js";

export interface VideoApproveActionsProps {
  videoId: string;
  currentStatus: string;
  sourceType?: string | null;
  youtubeVideoId?: string | null;
  approveAction: ReviewAction;
  approveAndNextAction: ReviewAction;
  hiddenFields?: Record<string, string>;
  /** Opaque view epoch from the authorized host, rotated on authority changes. */
  authorizationEpoch?: string;
  onRefresh: () => void;
  onNavigate: (href: string) => void;
}

export function VideoApproveActions(props: VideoApproveActionsProps): React.ReactElement | null {
  if (props.currentStatus !== "pending") return null;
  return <ScopedVideoApproveActions
    key={reviewMutationScopeKey(props.videoId, props.hiddenFields, props.authorizationEpoch)} {...props} />;
}

function ScopedVideoApproveActions({
  videoId, approveAction, approveAndNextAction, hiddenFields, onRefresh, onNavigate,
}: VideoApproveActionsProps): React.ReactElement {
  const [pendingMode, setPendingMode] = React.useState<"approve" | "next" | null>(null);
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [pendingPublicReflection, setPendingPublicReflection] = React.useState(false);
  const scopeRef = React.useRef<object | null>(null);
  React.useLayoutEffect(() => {
    scopeRef.current = {};
    inFlight.current = false;
    setPendingMode(null);
    setError(null);
    setSuccess(false);
    setPendingPublicReflection(false);
    return () => { scopeRef.current = null; };
  }, [approveAction, approveAndNextAction]);
  const run = (mode: "approve" | "next") => {
    const scope = scopeRef.current;
    if (!scope || inFlight.current) return;
    inFlight.current = true;
    setPendingMode(mode);
    setError(null);
    setSuccess(false);
    setPendingPublicReflection(false);
    const fd = new FormData();
    for (const [key, value] of Object.entries(hiddenFields ?? {})) fd.set(key, value);
    fd.set("video_id", videoId);
    const action = mode === "next" ? approveAndNextAction : approveAction;
    void (async () => {
      try {
        const result = await action(fd);
        if (scopeRef.current !== scope) return;
        if (!result.ok) {
          setError(result.message ?? "承認に失敗しました。");
          if (result.retryable) onRefresh();
          return;
        }
        setSuccess(true);
        setPendingPublicReflection(result.pendingPublicReflection === true);
        if (result.nextHref) onNavigate(result.nextHref);
        else onRefresh();
      } catch {
        if (scopeRef.current !== scope) return;
        setError(COMMUNICATION_ERROR_MESSAGE);
        onRefresh();
      } finally {
        // A possibly committed POST is not aborted/replayed. Old receipts must
        // not alter another view's pending state or invoke its callbacks.
        if (scopeRef.current === scope) {
          inFlight.current = false;
          setPendingMode(null);
        }
      }
    })();
  };
  return (
    <div className="video-review-action-stack">
      <div className="video-review-actions">
        <button type="button" className="fn-btn fn-btn-primary fn-btn-sm"
          disabled={pendingMode !== null} aria-busy={pendingMode === "approve"} onClick={() => run("approve")}>承認</button>
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pendingMode !== null} aria-busy={pendingMode === "next"} onClick={() => run("next")}>承認して次へ</button>
      </div>
      {error ? <p role="alert" className="video-review-error">{error}</p> : null}
      {success ? <div role="status" className="video-review-success">承認しました。
        {pendingPublicReflection ? <p className="fn-muted">{PUBLIC_REFLECTION_DELAY_MESSAGE}</p> : null}
      </div> : null}
    </div>
  );
}

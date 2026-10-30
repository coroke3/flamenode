import * as React from "react";
import {
  COMMUNICATION_ERROR_MESSAGE, PUBLIC_REFLECTION_DELAY_MESSAGE,
  VIDEO_STATUS_LABELS, VOID_REASON_LABELS,
  type ReviewAction, type ReviewActionResult, type VideoVisibilityStatus,
} from "./shared.js";

export const ADMIN_STATUS_VALUES = ["pending", "public", "private", "voided"] as const;
export const MANAGE_STATUS_VALUES = ["pending", "public", "private"] as const;
const REASON_CATEGORIES = ["x_id_invalid", "duplicate", "withdrawn_by_creator", "operator_decision", "expired"] as const;

export interface VideoStatusFormProps {
  videoId: string;
  currentStatus: string;
  sourceType?: string | null;
  youtubeVideoId?: string | null;
  statuses: readonly [VideoVisibilityStatus, ...VideoVisibilityStatus[]];
  action: ReviewAction;
  formIdPrefix: string;
  statusLabel: string;
  submitLabel: string;
  optionDescription?: boolean;
  hiddenFields?: Record<string, string>;
  allowVoidReason?: boolean;
  openVoidCaseId?: string | null;
  showMessageIcons?: boolean;
  onRefresh: () => void;
  onNavigate: (href: string) => void;
}

export function ManageVideoStatusForm({
  eventId, videoId, currentStatus, sourceType, youtubeVideoId, action, onRefresh, onNavigate,
}: {
  eventId: string; videoId: string; currentStatus: string;
  sourceType?: string | null; youtubeVideoId?: string | null;
  action: ReviewAction; onRefresh: () => void; onNavigate: (href: string) => void;
}): React.ReactElement {
  return <VideoStatusForm videoId={videoId} currentStatus={currentStatus}
    sourceType={sourceType} youtubeVideoId={youtubeVideoId}
    statuses={MANAGE_STATUS_VALUES} action={action}
    formIdPrefix={`manage-video-${videoId}`} statusLabel="公開状態を変更"
    submitLabel="審査結果を保存" hiddenFields={{ event_id: eventId }}
    onRefresh={onRefresh} onNavigate={onNavigate} />;
}

export function AdminVideoStatusForm({
  videoId, currentStatus, sourceType, youtubeVideoId, openVoidCaseId, hiddenFields,
  action, onRefresh, onNavigate,
}: {
  videoId: string; currentStatus: string;
  sourceType?: string | null; youtubeVideoId?: string | null;
  openVoidCaseId?: string | null; hiddenFields?: Record<string, string>;
  action: ReviewAction; onRefresh: () => void; onNavigate: (href: string) => void;
}): React.ReactElement {
  return <VideoStatusForm videoId={videoId} currentStatus={currentStatus}
    sourceType={sourceType} youtubeVideoId={youtubeVideoId} statuses={ADMIN_STATUS_VALUES}
    action={action} formIdPrefix="admin-video" statusLabel="変更先ステータス"
    submitLabel="適用" optionDescription allowVoidReason openVoidCaseId={openVoidCaseId}
    showMessageIcons hiddenFields={hiddenFields} onRefresh={onRefresh} onNavigate={onNavigate} />;
}

function isVideoVisibilityStatus(value: string): value is VideoVisibilityStatus {
  return Object.prototype.hasOwnProperty.call(VIDEO_STATUS_LABELS, value);
}
function formatStatusOption(value: VideoVisibilityStatus, includeDescription: boolean): string {
  const meta = VIDEO_STATUS_LABELS[value];
  return includeDescription ? `${meta.label} (${value}) — ${meta.description}` : `${meta.label} (${value})`;
}

/** CURRENT VideoStatusForm's FormData and client-side validation, without Next Server Action imports. */
export function VideoStatusForm({
  videoId, currentStatus, statuses, action, formIdPrefix, statusLabel, submitLabel,
  optionDescription = false, hiddenFields, allowVoidReason = false, openVoidCaseId = null,
  showMessageIcons = false, onRefresh, onNavigate,
}: VideoStatusFormProps): React.ReactElement {
  const [status, setStatus] = React.useState(currentStatus);
  const [reason, setReason] = React.useState("");
  const [reasonCategory, setReasonCategory] = React.useState<string>("operator_decision");
  const [submitting, setSubmitting] = React.useState(false);
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [pendingPublicReflection, setPendingPublicReflection] = React.useState(false);
  const requiresReason = allowVoidReason && status === "voided";
  const requiresCaseId = allowVoidReason && currentStatus === "voided" && status !== "voided";
  const statusOptions = React.useMemo<VideoVisibilityStatus[]>(() => {
    const values: VideoVisibilityStatus[] = [...statuses];
    return isVideoVisibilityStatus(currentStatus) && !values.includes(currentStatus)
      ? [currentStatus, ...values] : values;
  }, [statuses, currentStatus]);
  React.useEffect(() => { setStatus(currentStatus); }, [currentStatus]);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current) return;
    if (status === currentStatus) {
      setError("変更先のステータスを選択してください。");
      return;
    }
    if (requiresReason && !reason.trim()) {
      setError("このステータスへ変更するには理由が必要です。");
      return;
    }
    if (requiresCaseId && !openVoidCaseId?.trim()) {
      setError("voided解除には open な moderation case_id が必要です。");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    setSuccessMessage(null);
    setPendingPublicReflection(false);
    const fd = new FormData();
    for (const [key, value] of Object.entries(hiddenFields ?? {})) fd.set(key, value);
    fd.set("video_id", videoId);
    fd.set("status", status);
    if (allowVoidReason) {
      fd.set("reason", reason);
      if (status === "voided") fd.set("void_reason_category", reasonCategory);
    }
    if (requiresCaseId && openVoidCaseId) fd.set("case_id", openVoidCaseId);
    void (async () => {
      try {
        let result: ReviewActionResult;
        try {
          result = await action(fd);
        } catch {
          setError(COMMUNICATION_ERROR_MESSAGE);
          onRefresh();
          return;
        }
        if (!result.ok) {
          setError(result.message ?? "更新に失敗しました。");
          if (result.retryable) onRefresh();
        } else {
          setSuccess(true);
          setSuccessMessage(result.message ?? "ステータスを更新しました。");
          setPendingPublicReflection(result.pendingPublicReflection === true);
          if (allowVoidReason) setReason("");
          if (result.nextHref) onNavigate(result.nextHref);
          else onRefresh();
        }
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    })();
  };
  return (
    <form onSubmit={onSubmit} className="video-review-status-form">
      <label className="fn-label" htmlFor={`${formIdPrefix}-status`}>{statusLabel}</label>
      <select id={`${formIdPrefix}-status`} className="fn-select" value={status}
        onChange={e => setStatus(e.target.value)} disabled={submitting}>
        {statusOptions.map(value => <option key={value} value={value}>
          {formatStatusOption(value, optionDescription)}
        </option>)}
      </select>
      {requiresReason ? <>
        <label className="fn-label" htmlFor={`${formIdPrefix}-void-category`}>無効化カテゴリ</label>
        <select id={`${formIdPrefix}-void-category`} className="fn-select" value={reasonCategory}
          onChange={e => setReasonCategory(e.target.value)} disabled={submitting}>
          {REASON_CATEGORIES.map(value => <option key={value} value={value}>
            {VOID_REASON_LABELS[value]} ({value})
          </option>)}
        </select>
        <label className="fn-label" htmlFor={`${formIdPrefix}-reason`}>理由 (必須)</label>
        <textarea id={`${formIdPrefix}-reason`} className="fn-input" rows={3} maxLength={500}
          placeholder="例: 重複投稿のため無効化 / X ID の本人確認が必要"
          value={reason} onChange={e => setReason(e.target.value)} disabled={submitting} />
      </> : null}
      {requiresCaseId ? <p className="fn-muted" id={`${formIdPrefix}-case-id`}>
        {openVoidCaseId ? `voided解除に case_id=${openVoidCaseId} を送信します。`
          : "voided解除には open な moderation case が必要です。先にモデレーション画面で case を確認してください。"}
      </p> : null}
      <button type="submit" className="fn-btn fn-btn-primary" aria-busy={submitting}
        disabled={submitting || status === currentStatus || (requiresCaseId && !openVoidCaseId?.trim())}>
        {submitLabel}
      </button>
      {error ? <p role="alert" className="video-review-error">
        {showMessageIcons ? "注意: " : null}{error}
      </p> : null}
      {success ? <div role="status" className="video-review-success">
        {successMessage ?? "ステータスを更新しました。"}
        {pendingPublicReflection ? <p className="fn-muted">{PUBLIC_REFLECTION_DELAY_MESSAGE}</p> : null}
      </div> : null}
    </form>
  );
}

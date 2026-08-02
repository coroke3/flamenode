"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PublicReflectionDelayNotice } from "@/components/ui/PublicReflectionDelayNotice";
import { setVideoStatus } from "@/lib/actions/admin";
import { setManageVideoStatus } from "@/lib/actions/manage-video";
import {
  VIDEO_STATUS_LABELS,
  VOID_REASON_LABELS,
  type VideoVisibilityStatus,
} from "@/lib/constants/collaborator-permissions";

type ActionResult = {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
};

type VideoStatusAction = (formData: FormData) => Promise<ActionResult>;

interface VideoStatusFormProps {
  videoId: string;
  currentStatus: string;
  statuses: readonly [VideoVisibilityStatus, ...VideoVisibilityStatus[]];
  action: VideoStatusAction;
  formIdPrefix: string;
  statusLabel: string;
  submitLabel: string;
  optionDescription?: boolean;
  hiddenFields?: Record<string, string>;
  allowVoidReason?: boolean;
  /** voided 解除時に必須。open moderation case id */
  openVoidCaseId?: string | null;
  showMessageIcons?: boolean;
}

const ADMIN_STATUS_VALUES = [
  "pending",
  "public",
  "private",
  "voided",
] as const;

const MANAGE_STATUS_VALUES = ["pending", "public", "private"] as const;

export function AdminVideoStatusForm({
  videoId,
  currentStatus,
  openVoidCaseId,
}: {
  videoId: string;
  currentStatus: string;
  openVoidCaseId?: string | null;
}): React.ReactElement {
  return (
    <VideoStatusForm
      videoId={videoId}
      currentStatus={currentStatus}
      statuses={ADMIN_STATUS_VALUES}
      action={setVideoStatus}
      formIdPrefix="admin-video"
      statusLabel="変更先ステータス"
      submitLabel="適用"
      optionDescription
      allowVoidReason
      openVoidCaseId={openVoidCaseId}
      showMessageIcons
    />
  );
}

export function ManageVideoStatusForm({
  eventId,
  videoId,
  currentStatus,
}: {
  eventId: string;
  videoId: string;
  currentStatus: string;
}): React.ReactElement {
  return (
    <VideoStatusForm
      videoId={videoId}
      currentStatus={currentStatus}
      statuses={MANAGE_STATUS_VALUES}
      action={setManageVideoStatus}
      formIdPrefix={`manage-video-${videoId}`}
      statusLabel="公開状態を変更"
      submitLabel="審査結果を保存"
      hiddenFields={{ event_id: eventId }}
    />
  );
}

const REASON_CATEGORIES = [
  "x_id_invalid",
  "duplicate",
  "withdrawn_by_creator",
  "operator_decision",
  "expired",
] as const;

export function VideoStatusForm({
  videoId,
  currentStatus,
  statuses,
  action,
  formIdPrefix,
  statusLabel,
  submitLabel,
  optionDescription = false,
  hiddenFields,
  allowVoidReason = false,
  openVoidCaseId = null,
  showMessageIcons = false,
}: VideoStatusFormProps): React.ReactElement {
  const router = useRouter();
  const [status, setStatus] = React.useState(currentStatus);
  const [reason, setReason] = React.useState("");
  const [reasonCategory, setReasonCategory] =
    React.useState<string>("operator_decision");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [pendingPublicReflection, setPendingPublicReflection] =
    React.useState(false);

  const requiresReason = allowVoidReason && status === "voided";
  const requiresCaseId =
    allowVoidReason &&
    currentStatus === "voided" &&
    status !== "voided";
  const statusFieldId = `${formIdPrefix}-status`;
  const categoryFieldId = `${formIdPrefix}-void-category`;
  const reasonFieldId = `${formIdPrefix}-reason`;
  const caseFieldId = `${formIdPrefix}-case-id`;
  const statusOptions = React.useMemo<VideoVisibilityStatus[]>(() => {
    const options = [...statuses];
    if (
      isVideoVisibilityStatus(currentStatus) &&
      !options.includes(currentStatus)
    ) {
      return [currentStatus, ...options];
    }
    return options;
  }, [currentStatus, statuses]);

  React.useEffect(() => {
    setStatus(currentStatus);
  }, [currentStatus]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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

    setError(null);
    setSuccess(false);
    setPendingPublicReflection(false);
    const fd = new FormData();
    for (const [key, value] of Object.entries(hiddenFields ?? {})) {
      fd.set(key, value);
    }
    fd.set("video_id", videoId);
    fd.set("status", status);
    if (allowVoidReason) {
      fd.set("reason", reason);
      if (status === "voided") {
        fd.set("void_reason_category", reasonCategory);
      }
    }
    if (requiresCaseId && openVoidCaseId) {
      fd.set("case_id", openVoidCaseId);
    }

    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
      } else {
        setSuccess(true);
        setPendingPublicReflection(result.pendingPublicReflection === true);
        if (allowVoidReason) {
          setReason("");
        }
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <label className="fn-label" htmlFor={statusFieldId}>
        {statusLabel}
      </label>
      <select
        id={statusFieldId}
        className="fn-select"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        disabled={pending}
      >
        {statusOptions.map((value) => (
          <option key={value} value={value}>
            {formatStatusOption(value, optionDescription)}
          </option>
        ))}
      </select>
      {requiresReason ? (
        <>
          <label className="fn-label" htmlFor={categoryFieldId}>
            無効化カテゴリ
          </label>
          <select
            id={categoryFieldId}
            className="fn-select"
            value={reasonCategory}
            onChange={(e) => setReasonCategory(e.target.value)}
            disabled={pending}
          >
            {REASON_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {VOID_REASON_LABELS[category]} ({category})
              </option>
            ))}
          </select>
          <label className="fn-label" htmlFor={reasonFieldId}>
            理由 (必須)
          </label>
          <textarea
            id={reasonFieldId}
            className="fn-input"
            rows={3}
            placeholder="例: 重複投稿のため無効化 / X ID の本人確認が必要"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            disabled={pending}
          />
        </>
      ) : null}
      {requiresCaseId ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }} id={caseFieldId}>
          {openVoidCaseId
            ? `voided解除に case_id=${openVoidCaseId} を送信します。`
            : "voided解除には open な moderation case が必要です。先にモデレーション画面で case を確認してください。"}
        </p>
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-primary"
        disabled={
          pending ||
          status === currentStatus ||
          (requiresCaseId && !openVoidCaseId?.trim())
        }
        aria-busy={pending}
      >
        <Icon name="check" size={13} aria-hidden /> {submitLabel}
      </button>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          {showMessageIcons ? (
            <>
              <Icon name="warning" size={12} aria-hidden />{" "}
            </>
          ) : null}
          {error}
        </p>
      ) : null}
      {success ? (
        <div role="status" style={{ color: "var(--accent-primary)", fontSize: 12 }}>
          {showMessageIcons ? (
            <>
              <Icon name="check" size={12} aria-hidden />{" "}
            </>
          ) : null}
          ステータスを更新しました。
          {pendingPublicReflection ? (
            <div style={{ marginTop: 8 }}>
              <PublicReflectionDelayNotice />
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function isVideoVisibilityStatus(value: string): value is VideoVisibilityStatus {
  return Object.prototype.hasOwnProperty.call(VIDEO_STATUS_LABELS, value);
}

function formatStatusOption(
  value: VideoVisibilityStatus,
  includeDescription: boolean,
): string {
  const meta = VIDEO_STATUS_LABELS[value];
  if (!meta) return value;
  if (includeDescription) {
    return `${meta.label} (${value}) — ${meta.description}`;
  }
  return `${meta.label} (${value})`;
}

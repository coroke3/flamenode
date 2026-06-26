"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  VIDEO_STATUS_LABELS,
  VOID_REASON_LABELS,
  type VideoVisibilityStatus,
} from "@/lib/constants/collaborator-permissions";

type ActionResult = {
  ok: boolean;
  message?: string;
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
  showMessageIcons?: boolean;
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

  const requiresReason = allowVoidReason && status === "voided";
  const statusFieldId = `${formIdPrefix}-status`;
  const categoryFieldId = `${formIdPrefix}-void-category`;
  const reasonFieldId = `${formIdPrefix}-reason`;

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

    setError(null);
    setSuccess(false);
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

    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
      } else {
        setSuccess(true);
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
        {statuses.map((value) => (
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
      <button
        type="submit"
        className="fn-btn fn-btn-primary"
        disabled={pending || status === currentStatus}
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
        <p role="status" style={{ color: "var(--accent-primary)", fontSize: 12 }}>
          {showMessageIcons ? (
            <>
              <Icon name="check" size={12} aria-hidden />{" "}
            </>
          ) : null}
          ステータスを更新しました。
        </p>
      ) : null}
    </form>
  );
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

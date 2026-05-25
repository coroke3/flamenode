"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { setVideoStatus } from "@/lib/actions/admin";
import {
  VIDEO_STATUS_LABELS,
  VOID_REASON_LABELS,
} from "@/lib/constants/collaborator-permissions";

interface AdminVideoStatusFormProps {
  videoId: string;
  currentStatus: string;
}

const STATUS_VALUES = [
  "draft",
  "pending",
  "public",
  "limited",
  "private",
  "hidden",
  "archived",
  "voided",
] as const;
const REASON_CATEGORIES = [
  "x_id_invalid",
  "duplicate",
  "withdrawn_by_creator",
  "operator_decision",
  "expired",
] as const;

export function AdminVideoStatusForm({
  videoId,
  currentStatus,
}: AdminVideoStatusFormProps): React.ReactElement {
  const router = useRouter();
  const [status, setStatus] = React.useState(currentStatus);
  const [reason, setReason] = React.useState("");
  const [reasonCategory, setReasonCategory] = React.useState<string>("operator_decision");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const requiresReason = status === "voided";

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
    fd.set("video_id", videoId);
    fd.set("status", status);
    fd.set("reason", reason);
    if (status === "voided") {
      fd.set("void_reason_category", reasonCategory);
    }
    startTransition(async () => {
      const r = await setVideoStatus(fd);
      if (!r.ok) {
        setError(r.message ?? "更新に失敗しました。");
      } else {
        setSuccess(true);
        setReason("");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="fn-label" htmlFor="admin-video-status">
        変更先ステータス
      </label>
      <select
        id="admin-video-status"
        className="fn-select"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        disabled={pending}
      >
        {STATUS_VALUES.map((value) => {
          const meta = VIDEO_STATUS_LABELS[value];
          return (
            <option key={value} value={value}>
              {meta.label} ({value}) — {meta.description}
            </option>
          );
        })}
      </select>
      {status === "voided" ? (
        <>
          <label className="fn-label" htmlFor="admin-void-category">
            無効化カテゴリ
          </label>
          <select
            id="admin-void-category"
            className="fn-select"
            value={reasonCategory}
            onChange={(e) => setReasonCategory(e.target.value)}
            disabled={pending}
          >
            {REASON_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {VOID_REASON_LABELS[c]} ({c})
              </option>
            ))}
          </select>
        </>
      ) : null}
      {requiresReason ? (
        <>
          <label className="fn-label" htmlFor="admin-video-reason">
            理由 (必須)
          </label>
          <textarea
            id="admin-video-reason"
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
        <Icon name="check" size={13} aria-hidden /> 適用
      </button>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" style={{ color: "var(--accent-primary)", fontSize: 12 }}>
          <Icon name="check" size={12} aria-hidden /> ステータスを更新しました。
        </p>
      ) : null}
    </form>
  );
}

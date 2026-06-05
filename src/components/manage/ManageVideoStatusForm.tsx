"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { setManageVideoStatus } from "@/lib/actions/manage-video";
import { VIDEO_STATUS_LABELS } from "@/lib/constants/collaborator-permissions";

const MANAGE_STATUS_VALUES = [
  "pending",
  "public",
  "hidden",
  "private",
  "limited",
  "draft",
] as const;

interface ManageVideoStatusFormProps {
  eventId: string;
  videoId: string;
  currentStatus: string;
}

export function ManageVideoStatusForm({
  eventId,
  videoId,
  currentStatus,
}: ManageVideoStatusFormProps): React.ReactElement {
  const router = useRouter();
  const [status, setStatus] = React.useState(currentStatus);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === currentStatus) {
      setError("変更先のステータスを選択してください。");
      return;
    }
    setError(null);
    setSuccess(false);
    const fd = new FormData();
    fd.set("event_id", eventId);
    fd.set("video_id", videoId);
    fd.set("status", status);
    startTransition(async () => {
      const r = await setManageVideoStatus(fd);
      if (!r.ok) {
        setError(r.message ?? "更新に失敗しました。");
      } else {
        setSuccess(true);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="fn-label" htmlFor={`manage-video-status-${videoId}`}>
        公開状態を変更
      </label>
      <select
        id={`manage-video-status-${videoId}`}
        className="fn-select"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        disabled={pending}
      >
        {MANAGE_STATUS_VALUES.map((value) => {
          const meta = VIDEO_STATUS_LABELS[value];
          return (
            <option key={value} value={value}>
              {meta?.label ?? value} ({value})
            </option>
          );
        })}
      </select>
      <button
        type="submit"
        className="fn-btn fn-btn-primary"
        disabled={pending || status === currentStatus}
        aria-busy={pending}
      >
        <Icon name="check" size={13} aria-hidden /> 審査結果を保存
      </button>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" style={{ color: "var(--accent-primary)", fontSize: 12 }}>
          ステータスを更新しました。
        </p>
      ) : null}
    </form>
  );
}

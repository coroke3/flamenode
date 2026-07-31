"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { storeModerationSaveNotice } from "@/components/admin/ModerationFlashNotice";
import { updateModerationCaseStatus } from "@/lib/actions/moderation-admin";

interface ModerationCaseStatusFormProps {
  caseId: string;
}

export function ModerationCaseStatusForm({
  caseId,
}: ModerationCaseStatusFormProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateModerationCaseStatus(formData);
      if (!result.ok) {
        setError(result.message ?? "更新に失敗しました。");
        return;
      }
      storeModerationSaveNotice({
        message: result.message ?? "case を更新しました。",
        pendingPublicReflection: result.pendingPublicReflection,
      });
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "grid", gap: 4, minWidth: 190 }}
    >
      <input type="hidden" name="id" value={caseId} />
      <select
        name="status"
        className="fn-select fn-input-sm"
        defaultValue="resolved"
        disabled={pending}
      >
        <option value="resolved">解決</option>
        <option value="rejected">却下</option>
        <option value="cancelled">キャンセル</option>
        <option value="expired">期限切れ</option>
      </select>
      <select
        name="video_status"
        className="fn-select fn-input-sm"
        defaultValue=""
        disabled={pending}
      >
        <option value="">作品状態は変更しない</option>
        <option value="pending">承認待ち</option>
        <option value="public">公開</option>
        <option value="private">非公開</option>
        <option value="voided">無効</option>
      </select>
      <textarea
        name="private_note"
        className="fn-input"
        rows={2}
        placeholder="対応メモ"
        maxLength={2000}
        disabled={pending}
      />
      {error ? (
        <p role="alert" className="fn-text-sm" style={{ color: "var(--accent-danger)" }}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-primary fn-btn-sm"
        disabled={pending}
      >
        {pending ? "更新中…" : "更新"}
      </button>
    </form>
  );
}

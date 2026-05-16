"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { deleteAnnouncement } from "@/lib/actions/announcement";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function DeleteAnnouncementForm({
  id,
}: {
  id: string;
}): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const handleConfirm = () => {
    setConfirmOpen(false);
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const r = await deleteAnnouncement(fd);
      if (!r.ok) {
        setError(r.message ?? "削除に失敗しました。");
        return;
      }
      router.push("/admin/announcements");
    });
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        className="fn-btn fn-btn-danger fn-btn-sm"
        disabled={busy}
        onClick={() => setConfirmOpen(true)}
      >
        <Icon name="trash" size={12} aria-hidden />
        {busy ? "削除中…" : "削除"}
      </button>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title="お知らせを削除"
        message="このお知らせを削除します。この操作は取り消せません。"
        confirmLabel="削除"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

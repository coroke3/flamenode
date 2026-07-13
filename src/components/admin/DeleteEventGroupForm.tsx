"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteEventGroup } from "@/lib/actions/event-group-admin";

interface Props {
  id: string;
  name: string;
}

export function DeleteEventGroupForm({
  id,
  name,
}: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const handleDelete = () => {
    setConfirmOpen(false);
    setError(null);

    startTransition(async () => {
      const result = await deleteEventGroup(id);

      if (!result.ok) {
        setError(result.message ?? "削除に失敗しました。");
        return;
      }

      router.push("/admin/event-groups");
      router.refresh();
    });
  };

  return (
    <div style={{ marginTop: 10 }}>
      <p
        style={{
          margin: "0 0 10px",
          color: "var(--text-secondary)",
          fontSize: 12,
        }}
      >
        削除するとグループ本体とイベント紐付けが完全に消えます。
      </p>

      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 13 }}>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="fn-btn fn-btn-danger fn-btn-sm"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
      >
        {busy ? "削除中…" : "グループを削除"}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="イベントグループを削除"
        message={
          <>
            「{name}」を削除します。
            <br />
            所属イベントとの紐付けも解除されます。
          </>
        }
        confirmLabel="削除する"
        tone="danger"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

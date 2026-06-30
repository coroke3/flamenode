"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { deleteEventGroup } from "@/lib/actions/event-group-admin";

interface Props {
  id: string;
  name: string;
}

export function DeleteEventGroupForm({ id, name }: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onDelete = () => {
    if (
      !window.confirm(
        `「${name}」を削除します。所属イベントの紐付けも解除されます。よろしいですか？`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await deleteEventGroup(id);
      if (!r.ok) {
        setError(r.message ?? "削除に失敗しました。");
        return;
      }
      router.push("/admin/event-groups");
      router.refresh();
    });
  };

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        削除するとグループ本体とイベント紐付けが完全に消えます。
      </p>
      {error ? (
        <p style={{ color: "var(--accent-danger)", fontSize: 13 }}>{error}</p>
      ) : null}
      <button
        type="button"
        className="fn-btn fn-btn-danger fn-btn-sm"
        onClick={onDelete}
        disabled={busy}
      >
        {busy ? "削除中…" : "グループを削除"}
      </button>
    </div>
  );
}

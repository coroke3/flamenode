"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { deleteEvent } from "@/lib/actions/event-admin";

export function DeleteEventForm({
  eventId,
}: {
  eventId: string;
}): React.ReactElement {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm !== eventId) {
      setError("イベント ID と完全一致する文字列を入力してください。");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("event_id", eventId);
    fd.set("confirm", confirm);
    startTransition(async () => {
      const r = await deleteEvent(fd);
      if (!r.ok) {
        setError(r.message ?? "削除に失敗しました。");
        return;
      }
      router.push("/admin/events");
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <label className="fn-label">
        確認のためイベント ID <code>{eventId}</code> を入力
      </label>
      <input
        type="text"
        className="fn-input"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={eventId}
      />
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="fn-btn fn-btn-danger fn-btn-sm"
        disabled={busy || confirm !== eventId}
      >
        <Icon name="trash" size={12} aria-hidden />
        {busy ? "削除中…" : "イベントを削除"}
      </button>
    </form>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cancelNotification } from "@/lib/actions/notification-admin";

interface Props {
  id: string;
}

export function NotificationCancelButton({ id }: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);

  const run = () => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("reason", reason);
    setMessage(null);
    startTransition(async () => {
      const result = await cancelNotification(fd);
      setMessage(result.message ?? (result.ok ? "キャンセルしました。" : "失敗しました。"));
      if (result.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      }
    });
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={busy}
        aria-label={`通知 ${id} をキャンセル`}
        onClick={() => setOpen((cur) => !cur)}
      >
        キャンセル
      </button>
      {open ? (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          <input
            className="fn-input fn-input-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="理由 (任意)"
            maxLength={500}
            style={{ maxWidth: 180 }}
          />
          <button
            type="button"
            className="fn-btn fn-btn-danger fn-btn-sm"
            disabled={busy}
            onClick={run}
          >
            確定
          </button>
        </span>
      ) : null}
      {message ? (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{message}</span>
      ) : null}
    </span>
  );
}

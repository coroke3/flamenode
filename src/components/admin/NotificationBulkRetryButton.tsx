"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { retryAllFailedNotifications } from "@/lib/actions/notification-admin";

export function NotificationBulkRetryButton(): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const onClick = () => {
    if (!window.confirm("failed 通知をまとめてリトライしますか? (上限 50 件)")) return;
    setMsg(null);
    startTransition(async () => {
      const r = await retryAllFailedNotifications(new FormData());
      setMsg(r.message ?? (r.ok ? "OK" : "失敗"));
      if (r.ok) router.refresh();
    });
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        className="fn-btn fn-btn-danger fn-btn-sm"
        disabled={busy}
        onClick={onClick}
      >
        {busy ? "..." : "failed を一括リトライ (上限 50)"}
      </button>
      {msg ? (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{msg}</span>
      ) : null}
    </span>
  );
}

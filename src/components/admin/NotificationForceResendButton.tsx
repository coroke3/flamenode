"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { forceResendNotification } from "@/lib/actions/notification-admin";

interface Props {
  id: string;
}

export function NotificationForceResendButton({ id }: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const onClick = () => {
    if (!window.confirm("同内容の通知を再送キューに追加しますか？")) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      const r = await forceResendNotification(fd);
      if (!r.ok) {
        setError(r.message ?? "再送に失敗しました。");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={busy}
        onClick={onClick}
      >
        {busy ? "..." : "強制再送"}
      </button>
      {error ? (
        <span style={{ color: "var(--accent-danger)", fontSize: 10 }}>{error}</span>
      ) : null}
    </div>
  );
}

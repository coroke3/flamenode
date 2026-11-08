// Port of CURRENT src/components/admin/NotificationCancelButton.tsx (MIG-0734 U02). router.refresh() -> onSuccess (D-17-3).
import * as React from "react";
import type { AdminNotificationsApi } from "../../api/adminNotifications.js";
import { leaveWhenAnonymous } from "./adminWrite.js";

export function NotificationCancelButton({ id, api, onSuccess }: {
  id: string; api: AdminNotificationsApi; onSuccess: (message?: string) => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const pending = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);

  const run = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.cancel(id, reason);
      if (leaveWhenAnonymous(result)) return;
      setMessage(result.message ?? (result.ok ? "キャンセルしました。" : "失敗しました。"));
      if (result.ok) {
        setOpen(false);
        setReason("");
        onSuccess(result.message ?? "キャンセルしました。");
      }
    } catch {
      setMessage("失敗しました。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={busy}
        aria-label={`通知 ${id} をキャンセル`}
        aria-expanded={open}
        onClick={() => setOpen((cur) => !cur)}
      >
        キャンセル
      </button>
      {open ? (
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          <input
            className="fn-input fn-input-sm"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="理由 (任意)"
            aria-label="キャンセル理由 (任意)"
            maxLength={500}
            style={{ maxWidth: 180 }}
          />
          <button type="button" className="fn-btn fn-btn-danger fn-btn-sm" disabled={busy} onClick={() => void run()}>
            確定
          </button>
        </span>
      ) : null}
      {message ? <span role="status" style={{ fontSize: 11, color: "var(--text-muted)" }}>{message}</span> : null}
    </span>
  );
}

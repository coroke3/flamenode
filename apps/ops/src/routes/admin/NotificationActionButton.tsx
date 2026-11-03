// Port of CURRENT src/components/admin/NotificationActionButton.tsx (MIG-0734 U02). router.refresh() -> onSuccess (refreshKey, D-17-3).
import * as React from "react";
import type { AdminNotificationsApi } from "../../api/adminNotifications.js";
import { leaveWhenAnonymous } from "./adminWrite.js";

type Props =
  | { kind: "retry" | "force-resend"; id: string; api: AdminNotificationsApi; onSuccess: () => void }
  | { kind: "bulk-retry"; id?: never; api: AdminNotificationsApi; onSuccess: () => void };

// The Hono SA-048 endpoint currently mutates at most 10 rows atomically per call.
// CURRENT's legacy 50-row label would overstate the migrated API's actual batch size.
export const NOTIFICATION_CONFIRM = {
  "force-resend": "同内容の通知を再送キューに追加しますか？",
  "bulk-retry": "failed 通知をまとめてリトライしますか? (上限 10 件)",
} as const;

const CONFIG = {
  retry: { label: "再試行", className: "fn-btn fn-btn-ghost fn-btn-sm", fallbackError: "リトライに失敗しました。", showSuccess: false },
  "force-resend": { label: "強制再送", className: "fn-btn fn-btn-ghost fn-btn-sm", fallbackError: "再送に失敗しました。", showSuccess: false },
  "bulk-retry": { label: "failed を一括リトライ (上限 10)", className: "fn-btn fn-btn-danger fn-btn-sm", fallbackError: "一括リトライに失敗しました。", showSuccess: true },
} as const;

export function NotificationActionButton(props: Props): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [message, setMessage] = React.useState<{ text: string; error: boolean } | null>(null);
  const config = CONFIG[props.kind];

  const run = async (): Promise<void> => {
    if (busyRef.current) return;
    const confirmMessage = props.kind === "retry" ? null : NOTIFICATION_CONFIRM[props.kind];
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = props.kind === "retry" ? await props.api.retry(props.id)
        : props.kind === "force-resend" ? await props.api.forceResend(props.id)
        : await props.api.retryFailed();
      if (leaveWhenAnonymous(result)) return;
      if (!result.ok) {
        setMessage({ text: result.message ?? config.fallbackError, error: true });
        return;
      }
      if (config.showSuccess && result.message) setMessage({ text: result.message, error: false });
      props.onSuccess();
    } catch {
      setMessage({ text: config.fallbackError, error: true });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" className={config.className} disabled={busy} onClick={() => void run()}>
        {busy ? "..." : config.label}
      </button>
      {message ? (
        <span
          role={message.error ? "alert" : "status"}
          style={{ color: message.error ? "var(--accent-danger)" : "var(--text-muted)", fontSize: 10 }}
        >
          {message.text}
        </span>
      ) : null}
    </span>
  );
}

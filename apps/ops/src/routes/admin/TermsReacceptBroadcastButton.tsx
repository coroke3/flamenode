/** MIG-0727 U03: SA-054 terms reaccept broadcast modal (CURRENT TermsReacceptBroadcastButton.tsx). */
import * as React from "react";
import { createAdminTermsApi } from "../../api/adminTerms.js";

export interface TermsReacceptBroadcastButtonProps {
  termsId: string;
  versionLabel: string;
  affectedCount: number;
  api?: Pick<ReturnType<typeof createAdminTermsApi>, "broadcast">;
  onSuccess?: () => void;
}

const defaultApi = createAdminTermsApi();

export function TermsReacceptBroadcastButton({
  termsId,
  versionLabel,
  affectedCount,
  api = defaultApi,
  onSuccess,
}: TermsReacceptBroadcastButtonProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [cursor, setCursor] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [enqueuedTotal, setEnqueuedTotal] = React.useState(0);
  const [content, setContent] = React.useState(
    `FlameNode の利用規約が更新されました。\n次回投稿前に /rules から内容を確認し、再同意してください。\nversion: ${versionLabel}`,
  );

  // Closing the confirmation, including via its backdrop, invalidates the
  // one-time TERMS acknowledgement. Keep content/cursor for deliberate retry.
  function closeDialog(): void {
    if (busyRef.current) return;
    setOpen(false);
    setConfirmText("");
  }

  async function onSubmit(): Promise<void> {
    if (busyRef.current || confirmText !== "TERMS" || !content.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    setWarning(null);
    try {
      const result = await api.broadcast(termsId, confirmText, cursor, content);
      if (result.ok) {
        setMessage(result.message ?? "OK");
        setWarning(result.warning ?? null);
        setEnqueuedTotal((value) => value + (result.enqueued ?? 0));
        if (result.cursor != null) setCursor(result.cursor);
        onSuccess?.();
      } else {
        setMessage(result.message ?? "失敗しました。");
      }
    } catch {
      setMessage("失敗しました。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="fn-btn fn-btn-warning fn-btn-sm"
        onClick={() => setOpen(true)}
        disabled={affectedCount === 0}
      >
        再同意通知 enqueue
      </button>

      {open ? (
        <div
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="terms-reaccept-broadcast-title"
            style={{
              width: "min(560px, 92vw)",
              maxHeight: "90vh",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 24,
              border: "1px solid var(--accent-warning)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-surface)",
            }}
          >
            <h3
              id="terms-reaccept-broadcast-title"
              style={{
                margin: 0,
                color: "var(--accent-warning)",
                fontSize: 16,
                fontWeight: 800,
              }}
            >
              再同意通知 enqueue
            </h3>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
              対象は最新major版以降へ未同意のユーザーです。1回30件までenqueueします。
            </p>

            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              content
              <textarea
                className="fn-input"
                rows={4}
                value={content}
                maxLength={1000}
                onChange={(event) => setContent(event.currentTarget.value)}
                disabled={busy}
              />
            </label>

            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              cursor (前回処理した最後の user_id。初回は空欄)
              <input
                className="fn-input"
                value={cursor}
                maxLength={128}
                onChange={(event) => setCursor(event.currentTarget.value)}
                disabled={busy}
              />
            </label>

            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              確認のため <strong>TERMS</strong> と入力
              <input
                className="fn-input"
                value={confirmText}
                placeholder="TERMS"
                onChange={(event) => setConfirmText(event.currentTarget.value)}
                disabled={busy}
              />
            </label>

            {warning ? (
              <p
                role="alert"
                style={{
                  margin: 0,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--accent-warning)",
                  background: "color-mix(in srgb, var(--accent-warning) 12%, var(--bg-elevated))",
                  color: "var(--accent-warning)",
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: "pre-wrap",
                }}
              >
                {warning}
              </p>
            ) : null}

            {message ? (
              <p
                role="status"
                style={{
                  margin: 0,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                }}
              >
                {message}
              </p>
            ) : null}

            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 11 }}>
              このセッションでの合計 enqueued: <strong>{enqueuedTotal}</strong>
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 4,
              }}
            >
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={closeDialog}
                disabled={busy}
              >
                閉じる
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-warning fn-btn-sm"
                onClick={() => void onSubmit()}
                disabled={busy || confirmText !== "TERMS" || !content.trim()}
              >
                {busy ? "送信中..." : "30 件 enqueue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

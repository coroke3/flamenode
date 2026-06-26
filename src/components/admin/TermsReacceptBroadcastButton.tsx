"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { broadcastTermsReaccept } from "@/lib/actions/rules";

interface Props {
  termsId: string;
  versionLabel: string;
  affectedCount: number;
}

export function TermsReacceptBroadcastButton({
  termsId,
  versionLabel,
  affectedCount,
}: Props): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, startTransition] = React.useTransition();
  const [cursor, setCursor] = React.useState(0);
  const [confirmText, setConfirmText] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [enqueuedTotal, setEnqueuedTotal] = React.useState(0);
  const [content, setContent] = React.useState(
    `FlameNode の利用規約が更新されました。\n次回投稿前に /rules から内容を確認し、再同意してください。\nversion: ${versionLabel}`,
  );

  const onSubmit = () => {
    setMessage(null);
    const fd = new FormData();
    fd.set("terms_id", termsId);
    fd.set("cursor", String(cursor));
    fd.set("confirm", confirmText);
    fd.set("content", content);
    startTransition(async () => {
      const result = await broadcastTermsReaccept(fd);
      setMessage(result.message ?? (result.ok ? "OK" : "失敗しました。"));
      if (result.ok) {
        setEnqueuedTotal((value) => value + (result.enqueued ?? 0));
        if (result.cursor != null) setCursor(result.cursor);
        router.refresh();
      }
    });
  };

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
            if (event.target === event.currentTarget && !busy) setOpen(false);
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
              対象は terms_reaccept_required=1 のユーザーです。1 回 50 件まで enqueue します。
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
              cursor
              <input
                className="fn-input"
                type="number"
                min={0}
                value={cursor}
                onChange={(event) =>
                  setCursor(Math.max(0, Number(event.currentTarget.value) || 0))
                }
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

            {message ? (
              <p
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
                onClick={() => {
                  setOpen(false);
                  setConfirmText("");
                }}
                disabled={busy}
              >
                閉じる
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-warning fn-btn-sm"
                onClick={onSubmit}
                disabled={busy || confirmText !== "TERMS" || !content.trim()}
              >
                {busy ? "送信中..." : "50 件 enqueue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

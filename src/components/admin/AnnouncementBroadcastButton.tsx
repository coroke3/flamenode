"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { broadcastAnnouncement } from "@/lib/actions/broadcast-admin";

interface Props {
  announcementId: string;
  defaultContent: string;
  defaultAudience: "all" | "creators" | "admins";
}

/**
 * 段階 broadcast UI (Opus #7 Phase 2)。
 *
 * - 1回30件までenqueue
 * - 最後に処理した内部user IDをcursorとして保持
 * - 'BROADCAST' 入力で確認
 * - 完了したら status=failed の Worker リトライを /admin/notifications で確認
 */
export function AnnouncementBroadcastButton({
  announcementId,
  defaultContent,
  defaultAudience,
}: Props): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, startTransition] = React.useTransition();
  const [content, setContent] = React.useState(defaultContent.slice(0, 1000));
  const [audience, setAudience] = React.useState<"all" | "creators" | "admins">(
    defaultAudience,
  );
  const [cursor, setCursor] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [enqueuedTotal, setEnqueuedTotal] = React.useState(0);

  const onSubmit = () => {
    setMsg(null);
    const fd = new FormData();
    fd.set("announcement_id", announcementId);
    fd.set("audience", audience);
    fd.set("content", content);
    fd.set("cursor", String(cursor));
    fd.set("confirm", confirmText);
    startTransition(async () => {
      const r = await broadcastAnnouncement(fd);
      setMsg(r.message ?? (r.ok ? "OK" : "失敗"));
      if (r.ok) {
        setEnqueuedTotal((n) => n + (r.enqueued ?? 0));
        if (r.cursor != null) setCursor(r.cursor);
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
      >
        broadcast (段階)
      </button>

      {open ? (
        <div
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--accent-warning)",
              borderRadius: "var(--radius-md)",
              padding: 24,
              maxWidth: 560,
              width: "92%",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-warning)" }}>
              段階 broadcast
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              1回30件までenqueueします。続きは最後の内部user IDから再開します。
              Worker の rate-limit を考慮し、cursor 進行は手動で確認しながら行ってください。
            </p>

            <label style={{ fontSize: 12 }}>
              対象
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as typeof audience)}
                className="fn-select"
                disabled={busy}
                style={{ marginTop: 4 }}
              >
                <option value="creators">creators (approved X ID 持ち)</option>
                <option value="admins">admins</option>
                <option value="all">all users</option>
              </select>
            </label>

            <label style={{ fontSize: 12 }}>
              content (最大 1000 文字)
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, 1000))}
                className="fn-input"
                rows={3}
                disabled={busy}
                style={{ marginTop: 4 }}
              />
            </label>

            <label style={{ fontSize: 12 }}>
              cursor（前回処理した最後の内部user ID。初回は空欄）
              <input
                type="text"
                value={cursor}
                onChange={(e) => setCursor(e.target.value.slice(0, 128))}
                className="fn-input"
                maxLength={128}
                disabled={busy}
                style={{ marginTop: 4 }}
              />
            </label>

            <label style={{ fontSize: 12 }}>
              確認のため <strong>BROADCAST</strong> と入力
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="fn-input"
                placeholder="BROADCAST"
                disabled={busy}
                style={{ marginTop: 4 }}
              />
            </label>

            {msg ? (
              <div
                style={{
                  fontSize: 11,
                  padding: "6px 8px",
                  background: "var(--bg-elevated)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                {msg}
              </div>
            ) : null}

            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              このセッションでの合計 enqueued: <strong>{enqueuedTotal}</strong>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
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
                disabled={busy || confirmText !== "BROADCAST" || !content.trim()}
              >
                {busy ? "送信中..." : "30件 enqueue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

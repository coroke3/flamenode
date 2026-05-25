"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { mergeXIds } from "@/lib/actions/merge-admin";

interface Props {
  fromXId: string;
  toXId: string | null;
}

/**
 * X ID merge 申請の承認用クライアントボタン (Opus #8 Phase C)。
 *
 * - target_x_user_id が無いと merge できない (新 ID 不明)
 * - 確認モーダルで "MERGE" 入力を要求
 * - 成功後 router.refresh()
 */
export function MergeRequestButton({ fromXId, toXId }: Props): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  if (!toXId) {
    return (
      <span style={{ fontSize: 11, color: "var(--accent-danger)" }}>
        target 未設定のため merge 不可
      </span>
    );
  }

  const onSubmit = () => {
    setMsg(null);
    const fd = new FormData();
    fd.set("from", fromXId);
    fd.set("to", toXId);
    fd.set("confirm", confirmText);
    startTransition(async () => {
      const r = await mergeXIds(fd);
      setMsg(r.message ?? (r.ok ? "merge 完了" : "merge 失敗"));
      if (r.ok) {
        setOpen(false);
        setConfirmText("");
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        className="fn-btn fn-btn-danger fn-btn-sm"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        merge 承認
      </button>
      {msg ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          {msg}
        </div>
      ) : null}

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
              border: "1px solid var(--accent-danger)",
              borderRadius: "var(--radius-md)",
              padding: 24,
              maxWidth: 480,
              width: "90%",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-danger)" }}>
              X ID merge 確認
            </h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              <strong>@{fromXId}</strong> の全データを{" "}
              <strong>@{toXId}</strong> に統合します。
              この操作は <strong>取り消し不可</strong> です。
              videos / video_chapters / video_members / slots / video_interactions /
              event_staff の x_user_id が付け替えられ、旧 ID の Discord 紐付けは解除されます。
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              事前に <code>npm run merge:dry-run -- --from @{fromXId} --to @{toXId}</code> で
              影響件数を確認してください。
            </p>
            <label style={{ fontSize: 12 }}>
              確認のため <strong>MERGE</strong> と入力してください
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="fn-input"
                placeholder="MERGE"
                disabled={busy}
                style={{ marginTop: 4 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                onClick={() => {
                  setOpen(false);
                  setConfirmText("");
                }}
                disabled={busy}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="fn-btn fn-btn-danger fn-btn-sm"
                onClick={onSubmit}
                disabled={busy || confirmText !== "MERGE"}
              >
                {busy ? "実行中..." : "merge を実行"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

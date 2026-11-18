import * as React from "react";
import { deleteAdminEventTemplate } from "../../api/adminEvents.js";
import type { OpsFetch } from "../../api/read.js";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.js";

/** CURRENT DeleteEventTemplateButton: ConfirmDialog first, then one DELETE; cancel never writes. */
export function DeleteEventTemplateButton({
  id,
  name,
  onDeleted,
  fetchFn,
}: {
  id: string;
  name: string;
  onDeleted: () => void;
  fetchFn?: OpsFetch;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const lock = React.useRef(false);

  async function confirm(): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setOpen(false);
    setError(null);
    try {
      const result = await deleteAdminEventTemplate(id, fetchFn);
      if (result.status === "ok") {
        onDeleted();
      } else if (result.status === "rejected") {
        setError(result.message);
      } else if (result.status === "anonymous") {
        setError("再ログインが必要です。");
        window.location.assign("/entry");
      } else {
        setError("削除に失敗しました。更新して状態を確認してください。");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
      }}
    >
      <button
        type="button"
        className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {busy ? "削除中…" : "削除"}
      </button>

      {error ? (
        <span role="alert" style={{ color: "var(--accent-danger)", fontSize: 10 }}>
          {error}
        </span>
      ) : null}

      <ConfirmDialog
        open={open}
        title="イベントテンプレートを削除"
        message={`テンプレート「${name}」を削除します。`}
        confirmLabel="削除する"
        tone="danger"
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </span>
  );
}

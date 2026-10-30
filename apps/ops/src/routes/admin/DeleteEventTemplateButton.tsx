import * as React from "react";
import { deleteAdminEventTemplate } from "../../api/adminEvents.js";
import type { OpsFetch } from "../../api/read.js";

/** CURRENT DeleteEventTemplateButton: confirm first, then one DELETE; cancel never writes. */
export function DeleteEventTemplateButton({ id, name, onDeleted, fetchFn }: {
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
      if (result.status === "ok") onDeleted();
      else if (result.status === "rejected") setError(result.message);
      else setError(result.status === "anonymous"
        ? "再ログインが必要です。"
        : "削除に失敗しました。更新して状態を確認してください。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <span>
    <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={busy}
      onClick={() => { setError(null); setOpen(true); }}>{busy ? "削除中…" : "削除"}</button>
    {open && <span role="group" aria-label="イベントテンプレートを削除">
      <span>テンプレート「{name}」を削除します。</span>
      <button type="button" className="fn-btn fn-btn-danger" disabled={busy}
        onClick={() => void confirm()}>削除する</button>
      <button type="button" className="fn-btn" disabled={busy} onClick={() => setOpen(false)}>キャンセル</button>
    </span>}
    {error && <span role="alert">{error}</span>}
  </span>;
}

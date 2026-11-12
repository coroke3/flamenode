import * as React from "react";
import type { XIdentityRequestRow } from "@flamenode/contracts";
import type { XidRequestsApi } from "../../../api/xidRequests.js";

const WITHDRAWABLE_TYPES = new Set(["new_link", "existing_link", "alias", "merge", "revert_merge"]);

/** Keep the CURRENT approval/deadline guards visible; the API checks permission again. */
export function XIdRequestActions({
  row, blockedRevert, api, onRefresh,
}: {
  row: XIdentityRequestRow;
  blockedRevert: boolean;
  api: XidRequestsApi;
  onRefresh: () => void;
}): React.ReactElement | null {
  const busy = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const canWithdraw = row.status === "pending" && WITHDRAWABLE_TYPES.has(row.request_type);
  const canRevert = row.request_type === "merge" && row.status === "done"
    && typeof row.revert_deadline_at === "number"
    && row.revert_deadline_at >= Math.floor(Date.now() / 1000) && !blockedRevert;

  if (!canWithdraw && !canRevert) return null;

  const run = (kind: "withdraw" | "revert") => {
    if (busy.current) return;
    const prompt = kind === "withdraw"
      ? "この申請を取り下げますか？"
      : "統合の取り消しを申請します。運営が承認すると、統合前の名義へ戻ります。よろしいですか？";
    if (!window.confirm(prompt)) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    void (async () => {
      try {
        const result = kind === "withdraw"
          ? await api.cancelRequest(row.id)
          : await api.requestMergeRevert(row.id);
        const fallback = kind === "withdraw"
          ? (result.ok ? "申請を取り下げました。" : "取り下げに失敗しました。")
          : (result.ok ? "統合の差し戻し申請を受け付けました。" : "申請に失敗しました。");
        if (result.ok) {
          setMessage(result.message ?? fallback);
          onRefresh();
        } else {
          setError(result.message ?? fallback);
        }
      } catch {
        setError("通信または処理中に問題が発生しました。再読み込みしてお試しください。");
      } finally {
        busy.current = false;
        setPending(false);
      }
    })();
  };

  return (
    <div className="settings-rowOps">
      {canRevert ? (
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={pending}
          aria-busy={pending} onClick={() => run("revert")}>
          {pending ? "申請中…" : "統合を取り消す申請"}
        </button>
      ) : null}
      {canWithdraw ? (
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={pending}
          aria-busy={pending} onClick={() => run("withdraw")}>
          {pending ? "取下げ中…" : "取り下げる"}
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

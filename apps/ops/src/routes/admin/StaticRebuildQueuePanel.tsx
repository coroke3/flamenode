import * as React from "react";
import type { AdminStaticBuildsResponse } from "@flamenode/contracts";

export function StaticRebuildQueuePanel({
  rows, busy, retry, retryAll,
}: {
  rows: AdminStaticBuildsResponse["rows"];
  busy: boolean;
  retry: (queueId: string) => void;
  retryAll: () => void;
}): React.ReactElement {
  const failed = rows.filter(row => row.status === "failed").length;
  return <section aria-label="静的再生成キュー">
    <h2>静的再生成キュー</h2>
    {failed > 0 && <button type="button" className="fn-btn" disabled={busy}
      onClick={retryAll}>失敗 {failed} 件を一括再試行</button>}
    <div style={{ overflowX: "auto" }}>
      <table className="fn-table">
        <thead><tr><th>状態</th><th>種別</th><th>対象ID</th><th>理由</th><th>優先度</th><th>試行</th><th>更新</th><th>操作</th></tr></thead>
        <tbody>{rows.length === 0
          ? <tr><td colSpan={8}>キューは空です（編集がなければ再生成されません）。</td></tr>
          : rows.map(row => <tr key={row.id}>
            <td>{row.status}</td><td>{row.target_type}</td><td><code>{row.target_id}</code></td>
            <td>{row.reason ?? "—"}</td><td>{row.priority ?? "—"}</td><td>{row.attempt_count ?? 0}</td>
            <td>{new Date(row.updated_at * 1000).toLocaleString("ja-JP")}</td>
            <td>{row.status === "failed"
              ? <button type="button" disabled={busy} onClick={() => retry(row.id)}
                className="fn-btn fn-btn-ghost fn-btn-sm">再試行</button> : null}
              {row.error && <details><summary>エラー詳細</summary><pre>{row.error}</pre></details>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

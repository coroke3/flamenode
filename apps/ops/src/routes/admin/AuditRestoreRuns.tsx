import * as React from "react";
import type { AdminAuditRestoreResponse } from "@flamenode/contracts";
import { createAdminAuditApi, type AuditAuditApi } from "../../api/adminAudit.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";

const format = (at:number)=>new Intl.DateTimeFormat("ja-JP",{
  timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
}).format(new Date(at*1000));
export function AuditRestoreRuns({fetchFn=fetch}:{fetchFn?:OpsFetch}):React.ReactElement {
  const api=React.useMemo(()=>createAdminAuditApi(fetchFn),[fetchFn]);
  const state=useApiResult(signal=>api.runs(signal),"audit-restore-runs");
  return <AuditRestoreRunsContent state={state}/>;
}
export function AuditRestoreRunsContent({state}:{
  state:OpsDataState<AdminAuditRestoreResponse>;
}):React.ReactElement {
  return <section className="fn-public-container fn-page" aria-label="復元履歴">
    <header className="fn-page-head"><h1>復元履歴</h1><p>直近 50 件のリストア実行履歴を表示します。</p></header>
    <nav aria-label="監査メニュー"><a href="/admin/audit">監査ログ一覧へ</a></nav>
    {state.status==="loading"?<p role="status">読み込み中...</p>
      :state.status==="anonymous"?<p role="alert">ログインが必要です。</p>
      :state.status==="forbidden"?<p role="alert">権限がありません。</p>
      :state.status!=="ok"?<p role="alert">復元履歴の取得に失敗しました。</p>
      :state.data.runs.length===0?<p className="fn-empty-message">復元履歴はまだありません。</p>
      :<div style={{overflowX:"auto"}}><table className="fn-table">
        <thead><tr><th>実行日時</th><th>状態</th><th>対象ログ</th>
          <th>テーブル / レコード</th><th>実行者</th><th>理由</th><th>エラー</th></tr></thead>
        <tbody>{state.data.runs.slice(0,50).map(run=><tr key={run.id}>
          <td><time>{format(run.executed_at)}</time></td>
          <td><span className={"fn-badge "+(run.status==="success"?"fn-badge-accent":"fn-badge-danger")}>{run.status}</span></td>
          <td><a href={"/admin/audit/"+encodeURIComponent(run.audit_log_id)}>{run.audit_log_id}</a></td>
          <td>{run.log?<><code>{run.log.table_name}</code> / <code>{run.log.target_id}</code></>:"—"}</td>
          <td><code>{run.executed_by_user_id}</code></td>
          <td>{run.reason}</td><td>{run.error_message??"—"}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

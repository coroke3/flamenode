import * as React from "react";
import type { AuditAuditApi } from "../../api/adminAudit.js";

type Submission = {ok:boolean;message?:string;restore_run_id?:string;diff?:{
  current: Record<string,unknown>|null;target:Record<string,unknown>|null;conflicts:string[];
}};
export function AuditRestoreForm({auditId,restoreStatus,unavailableMessage,reasonCode,api}:{
  auditId:string;restoreStatus:string;unavailableMessage?:string|null;reasonCode?:string|null;api:AuditAuditApi;
}):React.ReactElement {
  const [reason,setReason]=React.useState("");
  const [confirm,setConfirm]=React.useState("");
  const [force,setForce]=React.useState(false);
  const [dryBusy,setDryBusy]=React.useState(false);
  const [restoreBusy,setRestoreBusy]=React.useState(false);
  const [dry,setDry]=React.useState<Submission|null>(null);
  const [restored,setRestored]=React.useState<Submission|null>(null);
  const [error,setError]=React.useState("");
  const canRestore=restoreStatus==="restorable";
  const required="RESTORE "+auditId;
  React.useEffect(()=>{
    setReason("");setConfirm("");setForce(false);setDry(null);setRestored(null);setError("");
  },[auditId]);
  async function dryRun(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!canRestore || !reason.trim()) return;
    setDryBusy(true);setError("");setDry(null);
    try {
      const result=await api.dryRun(auditId,reason);
      if(result.status==="ok")setDry(result.data);
      else setError(result.status==="anonymous"?"セッションが期限切れです。":"競合チェックに失敗しました。");
    }catch{setError("競合チェックに失敗しました。");}
    finally{setDryBusy(false);}
  }
  async function execute(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!canRestore || !reason.trim() || confirm!==required || dryBusy || restoreBusy)return;
    setRestoreBusy(true);setError("");setRestored(null);
    try {
      const result=await api.restore(auditId,reason,confirm,force);
      if(result.status==="ok")setRestored(result.data);
      else setError(result.status==="anonymous"?"セッションが期限切れです。":"リストアに失敗しました。");
    }catch{setError("リストアに失敗しました。");}
    finally{setRestoreBusy(false);}
  }
  return <section aria-label="リストア" className="fn-panel">
    <h2>リストア</h2>
    <p role="note" className="fn-entry-status fn-entry-status--warn">
      <strong>注意:</strong> アプリDB上の状態のみ復元します。YouTube / Discord / 外部APIの状態は復元されません。
    </p>
    {!canRestore ? <div role="status"><strong>このログは復元できません。</strong>
      <p>{unavailableMessage||"復元状態: "+restoreStatus}</p>
      {reasonCode&&<code>{reasonCode}</code>}
    </div> : <>
      <label>理由 <span aria-hidden="true">*</span>
        <textarea className="fn-input" rows={2} value={reason}
          onChange={e=>setReason(e.target.value)} maxLength={500}
          placeholder="リストアの理由を入力してください"/>
      </label>
      <form onSubmit={dryRun}>
        <h3>ドライラン (競合チェック)</h3>
        <button className="fn-btn fn-btn-ghost" type="submit" disabled={dryBusy||!reason.trim()}>
          {dryBusy?"確認中…":"競合チェック実行"}</button>
        {dry&&<div role="status">
          <strong>{dry.ok?"ドライラン成功":"ドライランエラー"}</strong>
          {dry.message&&<p>{dry.message}</p>}
          {dry.diff&&<details><summary>差分詳細を表示 (競合キー {dry.diff.conflicts.length} 件)</summary>
            <ul>{dry.diff.conflicts.map(c=><li key={c}>{c}</li>)}</ul>
            <h4>現行レコード</h4><pre>{JSON.stringify(dry.diff.current,null,2)??"(null)"}</pre>
            <h4>復元後 (target)</h4><pre>{JSON.stringify(dry.diff.target,null,2)??"(null)"}</pre>
          </details>}
        </div>}
      </form>
      <form onSubmit={execute}>
        <h3>リストア実行</h3>
        <label>確認テキスト: <code>{required}</code> と入力してください
          <input className="fn-input" value={confirm} onChange={e=>setConfirm(e.target.value)}
            placeholder={required} autoComplete="off" />
        </label>
        <label><input type="checkbox" checked={force} onChange={e=>setForce(e.target.checked)}/>
          競合を強制上書き (force_overwrite) ― 現行レコードと競合しても上書きします
        </label>
        <button type="submit" className="fn-btn fn-btn-danger"
          disabled={restoreBusy||dryBusy||confirm!==required||!reason.trim()}>
          {restoreBusy?"実行中…":"リストア実行"}
        </button>
        {restored&&<p role="status">{restored.ok?"リストア完了":"エラー"}
          {restored.message&&" — "+restored.message}
          {restored.restore_run_id&&<code>run_id: {restored.restore_run_id}</code>}
        </p>}
      </form>
    </>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

import * as React from "react";
import type { AdminAuditSettingsResponse } from "@flamenode/contracts";
import { createAdminAuditApi, type AuditAuditApi } from "../../api/adminAudit.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";
type Settings=AdminAuditSettingsResponse["settings"];
type Key=keyof Settings;
const FIELDS:readonly {key:Key;label:string;min:number;max:number;unit:string}[]=[
  {key:"normal_retention_days",label:"通常ログ 保持日数",min:7,max:365,unit:"日"},
  {key:"restorable_retention_days",label:"復元可能ログ 保持日数",min:14,max:1095,unit:"日"},
  {key:"long_audit_retention_days",label:"長期監査ログ 保持日数",min:30,max:3650,unit:"日"},
  {key:"max_payload_bytes",label:"最大ペイロードサイズ",min:1000,max:1000000,unit:"bytes"},
  {key:"compact_after_days",label:"コンパクト化開始日数",min:1,max:365,unit:"日"},
];
export function retentionShortened(before:Settings,after:Settings):boolean {
  return (["normal_retention_days","restorable_retention_days","long_audit_retention_days"] as const)
    .some(key=>after[key]<before[key]);
}
export function validAuditSettings(value:Settings):boolean {
  return FIELDS.every(({key,min,max})=>Number.isSafeInteger(value[key])&&value[key]>=min&&value[key]<=max);
}
export function AuditSettings({fetchFn=fetch}:{fetchFn?:OpsFetch}):React.ReactElement {
  const api=React.useMemo(()=>createAdminAuditApi(fetchFn),[fetchFn]);
  const [refreshKey,setRefreshKey]=React.useState(0);
  const state=useApiResult(signal=>api.settings(signal),"audit-settings",refreshKey);
  return <AuditSettingsContent state={state} api={api} refresh={()=>setRefreshKey(v=>v+1)}/>;
}
export function AuditSettingsContent({state,api,refresh}:{
  state:OpsDataState<AdminAuditSettingsResponse>;api:AuditAuditApi;refresh:()=>void;
}):React.ReactElement {
  return <section className="fn-public-container fn-page" aria-label="監査ログ設定">
    <header className="fn-page-head"><h1>監査ログ設定</h1>
      <p>監査ログの保持期間・ペイロードサイズ上限などを管理します。</p></header>
    <nav aria-label="監査メニュー"><a href="/admin/audit">監査ログ一覧へ</a></nav>
    {state.status==="loading"?<p role="status">読み込み中...</p>
      :state.status==="anonymous"?<p role="alert">ログインが必要です。</p>
      :state.status==="forbidden"?<p role="alert">権限がありません。</p>
      :state.status!=="ok"?<p role="alert">監査設定の取得に失敗しました。</p>
      :<AuditSettingsForm key={JSON.stringify(state.data.settings)} initial={state.data.settings}
        api={api} onSaved={refresh}/>}
  </section>;
}
export function AuditSettingsForm({initial,api,onSaved}:{initial:Settings;api:AuditAuditApi;onSaved:()=>void}):React.ReactElement {
  const [values,setValues]=React.useState<Settings>(initial);
  const [loading,setLoading]=React.useState(false);
  const [result,setResult]=React.useState<{ok:boolean;message?:string}|null>(null);
  const [error,setError]=React.useState("");
  const shortened=retentionShortened(initial,values);
  async function save(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(loading||!validAuditSettings(values))return;
    setLoading(true);setResult(null);setError("");
    try{
      const response=await api.saveSettings(values);
      if(response.status!=="ok")setError(response.status==="anonymous"?"セッションが期限切れです。":"設定の更新に失敗しました。");
      else{setResult(response.data);if(response.data.ok)onSaved();}
    }catch{setError("設定の更新に失敗しました。");}
    finally{setLoading(false);}
  }
  return <div className="fn-panel">
    <section><h2>現在の設定</h2><dl>
      {FIELDS.map(({key,label,unit})=><React.Fragment key={key}>
        <dt>{label}</dt><dd>{initial[key].toLocaleString()} {unit}</dd>
      </React.Fragment>)}
    </dl></section>
    <form onSubmit={save} style={{display:"grid",gap:12,maxWidth:480}}>
      {FIELDS.map(({key,label,min,max,unit})=><label key={key}>
        {label} ({key})
        <div><input type="number" className="fn-input" value={values[key]} min={min} max={max}
          onChange={e=>setValues(current=>({...current,[key]:Number(e.target.value)}))}/>
          <span> {unit} ({min}〜{max})</span></div>
      </label>)}
      {shortened&&<p role="alert" className="fn-entry-status fn-entry-status--warn">
        <strong>警告:</strong> 保持日数を短くすると、既存ログが次回クリーンアップ時に削除される可能性があります。
        リストア可能なログが失われる場合があります。
      </p>}
      <button type="submit" className="fn-btn fn-btn-primary"
        disabled={loading||!validAuditSettings(values)}>{loading?"保存中…":"設定を保存"}</button>
      {result&&<p role="status">{result.ok?"保存しました":result.message??"エラーが発生しました"}</p>}
      {error&&<p role="alert">{error}</p>}
    </form>
  </div>;
}

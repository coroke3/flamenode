import * as React from "react";
import type { AdminAuditDetailResponse } from "@flamenode/contracts";
import { createAdminAuditApi, type AuditAuditApi } from "../../api/adminAudit.js";
import type { OpsFetch } from "../../api/read.js";
import { useApiResult, type OpsDataState } from "../useApiResult.js";
import { AuditRestoreForm } from "./AuditRestoreForm.js";
import { AuditDiffGrid } from "./AuditDiffGrid.js";

const STATUS_LABELS:Record<string,string> = {
  restorable:"復元可能",restored:"復元済み",expired:"期限切れ",
  not_restorable:"復元不可",blocked:"競合",failed:"失敗",
};
const TARGET_LINKS:Record<string,(id:string)=>string> = {
  videos:id=>"/admin/videos/"+encodeURIComponent(id),
  events:id=>"/manage/events/"+encodeURIComponent(id)+"/edit",
  users:id=>"/admin/users/"+encodeURIComponent(id),
  x_identity_requests:()=>"/admin/x-link-requests",
  notification_outbox:()=>"/admin/notifications?status=failed",
  system_settings:()=>"/admin/cost-guard",
};
function dateJst(timestamp:number):string {
  return new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(timestamp*1000));
}
function jsonPretty(raw:string|null):string {
  if(raw===null)return "(null)";
  try{return JSON.stringify(JSON.parse(raw),null,2)??raw;}catch{return raw;}
}
function jsonKeys(raw:string|null):string[] {
  try { const value:unknown=JSON.parse(raw??"null");
    return Array.isArray(value)?value.filter((x):x is string=>typeof x==="string"):[];
  }catch{return [];}
}
function Meta({label,value,href}:{label:string;value:string;href?:string}):React.ReactElement {
  return <div className="fn-panel-actions"><span className="fn-text-muted-sm">{label}</span>
    {href?<a href={href}>{value}</a>:<span>{value}</span>}</div>;
}
type AuditPayloads = {before:string|null;after:string|null;inverse:string|null};
export function AuditDetail({id,fetchFn=fetch}:{id:string;fetchFn?:OpsFetch}):React.ReactElement {
  const api=React.useMemo(()=>createAdminAuditApi(fetchFn),[fetchFn]);
  const state=useApiResult((signal)=>api.detail(id,signal),id);
  return <AuditDetailContent id={id} state={state} api={api}/>;
}
export function AuditDetailContent({id,state,api}:{
  id:string;state:OpsDataState<AdminAuditDetailResponse>;api:AuditAuditApi;
}):React.ReactElement {
  return <section className="fn-public-container fn-page" aria-label="監査ログ詳細">
    <p><a href="/admin/audit">監査ログ一覧へ</a></p>
    {state.status==="loading"?<p role="status">読み込み中...</p>
      :state.status==="notFound"?<p role="alert">監査ログが見つかりません。</p>
      :state.status==="anonymous"?<p role="alert">ログインが必要です。</p>
      :state.status==="forbidden"?<p role="alert">閲覧権限がありません。</p>
      :state.status!=="ok"?<p role="alert">監査ログの詳細を取得できません。</p>
      :<AuditDetailBody id={id} detail={state.data} api={api}/>}
  </section>;
}
function AuditDetailBody({id,detail,api}:{
  id:string;detail:AdminAuditDetailResponse;api:AuditAuditApi;
}):React.ReactElement {
  const row=detail.row;
  const [payload,setPayload]=React.useState<{status:"loading"}|{status:"error"}|
    {status:"ok";value:AuditPayloads}>({status:"loading"});
  React.useEffect(()=>{
    const controller=new AbortController();setPayload({status:"loading"});
    // The detail screen displays all three raw fields; list view does not.
    const read=async(field:"before"|"after"|"inverse")=>{
      if(detail.payload[field]===null)return {status:"ok" as const,data:null};
      return api.payload(id,field,controller.signal);
    };
    void Promise.all([read("before"),read("after"),read("inverse")])
      .then(([before,after,inverse])=>{
        if(controller.signal.aborted)return;
        if(before.status==="ok"&&after.status==="ok"&&inverse.status==="ok")
          setPayload({status:"ok",value:{before:before.data,after:after.data,inverse:inverse.data}});
        else setPayload({status:"error"});
      }).catch(()=>{if(!controller.signal.aborted)setPayload({status:"error"});});
    return ()=>controller.abort();
  },[api,id,detail]);
  const targetLink=TARGET_LINKS[row.table_name]?.(row.target_id);
  const changedKeys=jsonKeys(row.changed_keys_json);
  return <>
    <header className="fn-page-head"><h1>監査ログ {row.id}</h1><p>{dateJst(row.created_at)}</p></header>
    <nav aria-label="同 target_id の前後遷移" className="fn-panel-actions">
      {detail.prev&&<a href={"/admin/audit/"+encodeURIComponent(detail.prev.id)}>
        前 ({dateJst(detail.prev.created_at)})</a>}
      {detail.next&&<a href={"/admin/audit/"+encodeURIComponent(detail.next.id)}>
        次 ({dateJst(detail.next.created_at)})</a>}
      <a href={"/admin/audit?record="+encodeURIComponent(row.target_id)}>同じ target_id を一覧表示</a>
    </nav>
    <section className="fn-panel" aria-label="基本情報">
      <Meta label="ID" value={row.id}/><Meta label="テーブル" value={row.table_name}/>
      <Meta label="操作種別" value={row.operation}/>
      <Meta label="対象レコード ID" value={row.target_id}
        href={"/admin/audit?record="+encodeURIComponent(row.target_id)}/>
      <Meta label="実行者 user_id" value={row.actor_user_id}
        href={"/admin/users/"+encodeURIComponent(row.actor_user_id)}/>
      {row.context&&<Meta label="コンテキスト" value={row.context}/>}
      {row.reason&&<Meta label="理由" value={row.reason}/>}
      <Meta label="復元ステータス" value={STATUS_LABELS[row.restore_status]||row.restore_status}/>
      {row.restore_unavailable_message&&<Meta label="復元不可理由" value={row.restore_unavailable_message}/>}
      {row.restore_unavailable_reason_code&&<Meta label="理由コード" value={row.restore_unavailable_reason_code}/>}
      <Meta label="復元戦略" value={row.restore_strategy}/>
      <Meta label="retention_class" value={row.retention_class}/>
      <Meta label="payload_size_bytes" value={String(row.payload_size_bytes)}/>
      {row.expires_at&&<Meta label="有効期限" value={dateJst(row.expires_at)}/>}
      {targetLink&&<Meta label="詳細ページ" value="開く" href={targetLink}/>}
    </section>
    {row.actor_snapshot_json&&<section className="fn-panel"><h2>実行者スナップショット (当時)</h2>
      <pre>{jsonPretty(row.actor_snapshot_json)}</pre></section>}
    {changedKeys.length>0&&<section className="fn-panel"><h2>変更されたキー ({changedKeys.length})</h2>
      <ul>{changedKeys.map((key,i)=><li key={key+"-"+i}><code>{key}</code></li>)}</ul>
    </section>}
    <section className="fn-panel" aria-label="変更前後の差分">
      <h2>差分</h2>
      {payload.status==="loading"?<p role="status">変更履歴を読み込み中...</p>
        :payload.status==="error"?<p role="alert">JSONの取得に失敗しました。リストア前に再読み込みしてください。</p>
        :<AuditDiffDetail before={payload.value.before} after={payload.value.after}
          inverse={payload.value.inverse} changedKeys={changedKeys}/>}
    </section>
    <AuditRestoreForm auditId={row.id} restoreStatus={row.restore_status}
      unavailableMessage={row.restore_unavailable_message}
      reasonCode={row.restore_unavailable_reason_code} api={api}/>
  </>;
}
export function AuditDiffDetail({before,after,inverse,changedKeys}:{
  before:string|null;after:string|null;inverse:string|null;changedKeys:string[];
}):React.ReactElement {
  const [showDiff,setShowDiff]=React.useState(false);
  return <div>
    <button type="button" className="fn-btn fn-btn-ghost" aria-expanded={showDiff}
      onClick={()=>setShowDiff(value=>!value)}>{showDiff?"閉じる":"差分"}</button>
    {showDiff&&<div role="region" aria-label="変更差分"><p>変更キー: {changedKeys.join(", ")||"変更なし"}</p><AuditDiffGrid before={before} after={after}/>
      <div className="fn-grid"><section><h3>変更前</h3><pre>{jsonPretty(before)}</pre></section>
        <section><h3>変更後</h3><pre>{jsonPretty(after)}</pre></section></div></div>}
    <section><h3>before</h3><pre>{jsonPretty(before)}</pre></section>
    <section><h3>after</h3><pre>{jsonPretty(after)}</pre></section>
    {inverse!==null&&<section><h3>inverse_patch_json</h3><pre>{jsonPretty(inverse)}</pre></section>}
  </div>;
}

import * as React from "react";
import {useSearchParams} from "react-router-dom";
import {createAdminNotificationsApi,notificationQuery,type NotificationFilters,type AdminNotificationsApi} from "../../api/adminNotifications.js";
import {NotificationActionButton} from "./NotificationActionButton.js";
import {NotificationCancelButton} from "./NotificationCancelButton.js";
import {NotificationPayloadButton} from "./NotificationPayloadButton.js";
const defaultApi=createAdminNotificationsApi();
const STATUSES=[["all","すべて"],["pending","配信待ち"],["processing","送信中"],["sent","送信済み"],["failed","最終失敗"],["cancelled","キャンセル"]] as const;
const CATS=["all","video","slot","x_id","chapter","moderation","announcement","event","system","unknown"];
export function readNotificationFilters(params:URLSearchParams):NotificationFilters{
 const status=params.get("status")??"all",cat=params.get("cat")??"all";
 return {
  status:STATUSES.some(row=>row[0]===status)?status:"all",
  cat:CATS.includes(cat)?cat:"all",
  type:(params.get("type")??"").trim(),event:(params.get("event")??"").trim(),
  q:(params.get("q")??"").trim().slice(0,100),
 };
}
export function AdminNotifications({api=defaultApi}:{api?:AdminNotificationsApi}):React.ReactElement{
 const [params,setParams]=useSearchParams();
 const filters=readNotificationFilters(params);
 const query=notificationQuery(filters);
 const [refresh,setRefresh]=React.useState(0);
 const [result,setResult]=React.useState<Awaited<ReturnType<AdminNotificationsApi["list"]>>|null>(null);
 React.useEffect(()=>{
  let alive=true;setResult(null);
  api.list(filters).then(v=>{if(alive)setResult(v);});
  return ()=>{alive=false;};
 // Re-fetch only when GET query or explicit write refresh changes.
 },[api,query,refresh]);
 const reload=()=>setRefresh(v=>v+1);
 const statusHref=(status:string)=>{
  const next={...filters,status};const qs=notificationQuery(next);
  return "/admin/notifications"+(qs?"?"+qs:"");
 };
 return <section aria-label="通知配信状況">
  <h1>通知配信状況</h1><p>直近100件。失敗時は1/5/15分間隔で最大4回試行します。</p>
  <nav aria-label="ステータスフィルタ">{STATUSES.map(([key,label])=>
   <a key={key} href={statusHref(key)} aria-current={filters.status===key?"page":undefined}>{label}</a>)}</nav>
  <form method="get" onSubmit={e=>{
    e.preventDefault();
    const form=new FormData(e.currentTarget);const next=new URLSearchParams();
    for(const [key,value] of form)if(typeof value==="string"&&value.trim())next.set(key,value.trim());
    if(filters.status!=="all")next.set("status",filters.status);
    setParams(next);
  }}>
   <label>カテゴリ <select name="cat" defaultValue={filters.cat} key={query}>{CATS.map(cat=><option key={cat} value={cat}>{cat}</option>)}</select></label>
   <label>種類 <input name="type" defaultValue={filters.type} placeholder="type 完全一致"/></label>
   <label>イベント <input name="event" defaultValue={filters.event} placeholder="event_id 完全一致"/></label>
   <label>本文 <input name="q" defaultValue={filters.q} maxLength={100} placeholder="通知本文を検索"/></label>
   <button type="submit">検索</button>
  </form>
  {!result?<p role="status">読み込み中…</p>:result.status!=="ok"?
   <p role="alert">通知ログを取得できません（{result.status}）。<button onClick={reload}>再試行</button></p>:
   <React.Fragment>
    <p>pending: {result.data.counts.pending} / processing: {result.data.counts.processing} / failed: {result.data.counts.failed} / dead_letter: {result.data.counts.deadLetter}</p>
    {result.data.counts.unhealthyLease>0?<p role="alert">配送リース期限超過・欠損 {result.data.counts.unhealthyLease} 件</p>:null}
    {result.data.counts.failed+result.data.counts.deadLetter>0?<NotificationActionButton kind="bulk-retry" api={api} onSuccess={reload}/>:null}
    {result.data.error?<p role="alert">通知ログの取得に失敗しました。</p>:null}
    {result.data.truncated?<p role="status">最新100件の一部は応答サイズ制限で省略されています。</p>:null}
    {result.data.rows.length===0?<p>{filters.status==="failed"?"失敗通知はありません":"通知ログはありません"}</p>:null}
    <table><thead><tr><th>状態</th><th>通知</th><th>試行</th><th>次試行</th><th>登録</th><th>操作</th></tr></thead>
     <tbody>{result.data.rows.map(row=><tr key={row.id}><td>{row.status==="dead_letter"?"最終失敗":row.status}</td>
      <td><strong>{row.type}</strong><p>{row.event_id??""}</p><p>{row.last_error??""}</p></td>
      <td>{row.attempt_count??0}</td><td>{row.next_attempt_at?new Date(row.next_attempt_at*1000).toLocaleString("ja-JP"):"—"}</td>
      <td>{new Date(row.created_at*1000).toLocaleString("ja-JP")}</td>
      <td><NotificationPayloadButton payload={row.payload_json}/>
       {(row.status==="failed"||row.status==="dead_letter")?<NotificationActionButton kind="retry" id={row.id} api={api} onSuccess={reload}/>:null}
       <NotificationActionButton kind="force-resend" id={row.id} api={api} onSuccess={reload}/>
       {(row.status==="pending"||row.status==="processing")?<NotificationCancelButton id={row.id} api={api} onSuccess={reload}/>:null}
      </td>
     </tr>)}</tbody>
    </table>
   </React.Fragment>}
 </section>;
}

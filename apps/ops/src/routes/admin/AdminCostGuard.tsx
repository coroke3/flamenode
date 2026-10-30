import * as React from "react";
import {createAdminCostGuardApi,type AdminCostGuardApi} from "../../api/adminCostGuard.js";
import {CostGuardForm} from "./CostGuardForm.js";
import {CostGuardOverrideForm} from "./CostGuardOverrideForm.js";
import {CostGuardDisabledFeaturesForm} from "./CostGuardDisabledFeaturesForm.js";
export function changedCostGuardKeys(before:string|null,after:string|null):string[]{
  const parse=(raw:string|null):Record<string,unknown>|null=>{
    if(!raw)return {};
    try{
      const value:unknown=JSON.parse(raw);
      return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{value};
    }catch{return null;}
  };
  const a=parse(before),b=parse(after);
  if(a===null||b===null)return [];
  return [...new Set([...Object.keys(a),...Object.keys(b)])]
    .sort().filter(key=>JSON.stringify(a[key])!==JSON.stringify(b[key]));
}
const defaultApi=createAdminCostGuardApi();
export function AdminCostGuard({api=defaultApi}:{api?:AdminCostGuardApi}):React.ReactElement{
  const [refresh,setRefresh]=React.useState(0);
  const [result,setResult]=React.useState<Awaited<ReturnType<AdminCostGuardApi["read"]>>|null>(null);
  React.useEffect(()=>{
    let alive=true;
    setResult(null);
    api.read().then(r=>{if(alive)setResult(r);});
    return ()=>{alive=false;};
  },[api,refresh]);
  if(!result)return <p role="status">読み込み中…</p>;
  if(result.status!=="ok")return <section role="alert">コストガード設定を取得できません（{result.status}）。書き込みは利用できません。
    <button onClick={()=>setRefresh(v=>v+1)}>再試行</button>
  </section>;
  const {data}=result;
  const reload=()=>setRefresh(v=>v+1);
  return <section aria-label="コストガード">
    <h1>コストガード</h1>
    <p>実測collectorがないため、自動判定せず手動モードと15分限定overrideを管理します。</p>
    <p>mode: {data.mode} / メンテナンス: {data.isMaintenance?"ON":"OFF"}</p>
    <CostGuardForm settings={data} api={api} onSuccess={reload}/>
    <CostGuardOverrideForm settings={data} api={api} onSuccess={reload}/>
    <CostGuardDisabledFeaturesForm settings={data} api={api} onSuccess={reload}/>
    <h2>変更履歴（最大20件）</h2>
    {data.truncated?<p role="status">一部の履歴はサイズ制限で省略されています。</p>:null}
    <table><thead><tr><th>変更日時</th><th>操作者</th><th>変更キー</th></tr></thead><tbody>
    {data.history.map(row=><tr key={row.id}><td>{new Date(row.created_at*1000).toLocaleString("ja-JP")}</td><td>{row.actor_user_id}</td><td>{(()=>{const keys=changedCostGuardKeys(row.before_json,row.after_json);return keys.length?keys.slice(0,6).join(", ")+(keys.length>6?" ほか "+(keys.length-6)+" 件":""):"変更なし";})()} {" "}<a href={"/admin/audit?table=system_settings&record="+encodeURIComponent(row.target_id)}>詳細</a></td></tr>)}
    </tbody></table>
  </section>;
}

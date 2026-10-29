import * as React from "react";
import {createAdminCostGuardApi,type AdminCostGuardApi} from "../../api/adminCostGuard.js";
import {CostGuardForm} from "./CostGuardForm.js";
import {CostGuardOverrideForm} from "./CostGuardOverrideForm.js";
import {CostGuardDisabledFeaturesForm} from "./CostGuardDisabledFeaturesForm.js";
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
    <table><thead><tr><th>変更日時</th><th>対象</th><th>操作者</th></tr></thead><tbody>
    {data.history.map(row=><tr key={row.id}><td>{new Date(row.created_at*1000).toLocaleString("ja-JP")}</td><td>{row.target_id}</td><td>{row.actor_user_id}</td></tr>)}
    </tbody></table>
  </section>;
}

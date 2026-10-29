import * as React from "react";
import type { AdminCostGuardResponse } from "@flamenode/contracts";
import type { AdminCostGuardApi } from "../../api/adminCostGuard.js";
import { WRITE_FEATURE_KEYS } from "./costGuardFeatures.js";
export function CostGuardOverrideForm({settings,api,onSuccess}:{settings:AdminCostGuardResponse;api:AdminCostGuardApi;onSuccess:()=>void}):React.ReactElement{
  const [reason,setReason]=React.useState("");
  const [confirm,setConfirm]=React.useState("");
  const [features,setFeatures]=React.useState<string[]>([]);
  const [busy,setBusy]=React.useState(false);
  const [message,setMessage]=React.useState("");
  const active=settings.exceptionUntil!==null&&settings.exceptionUntil>Math.floor(Date.now()/1000);
  async function submit(clear:boolean){
    if(busy||!reason.trim()||confirm!==(clear?"CLEAR":"OVERRIDE")||(!clear&&features.length===0))return;
    setBusy(true);setMessage("");
    try{
      const result=clear?await api.clearOverride(reason):await api.setOverride(reason,features);
      setMessage(result.message??(result.ok?"完了しました。":"失敗しました。"));
      if(result.ok){setReason("");setConfirm("");onSuccess();}
    }finally{setBusy(false);}
  }
  return <section aria-label="緊急override"><h2>15分限定の緊急override</h2>
    <p>状態: {active?"有効":"無効"} {settings.exceptionFeaturesJson??""}</p>
    <fieldset disabled={busy}><legend>対象機能（最大8件）</legend>
      {WRITE_FEATURE_KEYS.map(feature=><label key={feature}>
        <input type="checkbox" checked={features.includes(feature)} onChange={e=>{const checked=e.currentTarget.checked;setFeatures(current=>checked?[...current,feature].slice(0,8):current.filter(v=>v!==feature));}} />{feature}
      </label>)}
    </fieldset>
    <label>理由 <input maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.currentTarget.value)} /></label>
    <label>確認文字列 <input disabled={busy} value={confirm} onChange={e=>setConfirm(e.currentTarget.value)} placeholder="OVERRIDE / CLEAR" /></label>
    <button type="button" disabled={busy||!reason.trim()||!features.length||confirm!=="OVERRIDE"} onClick={()=>void submit(false)}>15分有効化</button>
    <button type="button" disabled={busy||!reason.trim()||confirm!=="CLEAR"} onClick={()=>void submit(true)}>即時解除</button>
    {message?<p role="status">{message}</p>:null}
  </section>;
}

import * as React from "react";
import type { AdminCostGuardResponse } from "@flamenode/contracts";
import type { AdminCostGuardApi } from "../../api/adminCostGuard.js";
import { WRITE_FEATURE_KEYS,parseCostFeatures } from "./costGuardFeatures.js";
export function CostGuardDisabledFeaturesForm({settings,api,onSuccess}:{settings:AdminCostGuardResponse;api:AdminCostGuardApi;onSuccess:()=>void}):React.ReactElement{
  const initial=React.useMemo(()=>parseCostFeatures(settings.disabledFeaturesJson),[settings.disabledFeaturesJson]);
  const [features,setFeatures]=React.useState(initial.features);
  const [reason,setReason]=React.useState("");
  const [confirm,setConfirm]=React.useState("");
  const [busy,setBusy]=React.useState(false);
  const [message,setMessage]=React.useState("");
  React.useEffect(()=>setFeatures(initial.features),[initial]);
  async function submit(){
    if(busy||!reason.trim()||confirm!=="APPLY")return;
    setBusy(true);setMessage("");
    try{
      const result=await api.setDisabled(reason,features,settings.disabledFeaturesJson);
      setMessage(result.message??(result.ok?"更新しました。":"更新に失敗しました。"));
      if(result.ok){setReason("");setConfirm("");onSuccess();}
    }finally{setBusy(false);}
  }
  return <section aria-label="恒久的な無効化機能"><h2>恒久的な無効化機能</h2>
    {initial.malformed?<p role="alert">現在の無効化機能設定が不正なため、安全のため書込み機能は停止中です。</p>:null}
    <fieldset disabled={busy}><legend>無効化する機能（空欄で全て有効）</legend>
      {WRITE_FEATURE_KEYS.map(feature=><label key={feature}><input type="checkbox" checked={features.includes(feature)}
      onChange={e=>{const checked=e.currentTarget.checked;setFeatures(v=>checked?[...v,feature]:v.filter(k=>k!==feature));}}/>{feature}</label>)}
    </fieldset>
    <label>変更理由 <input maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.currentTarget.value)}/></label>
    <label>確認文字列 <input value={confirm} disabled={busy} onChange={e=>setConfirm(e.currentTarget.value)} placeholder="APPLY"/></label>
    <button type="button" disabled={busy||confirm!=="APPLY"||!reason.trim()} onClick={()=>void submit()}>無効化設定を保存</button>
    {message?<p role="status">{message}</p>:null}
  </section>;
}

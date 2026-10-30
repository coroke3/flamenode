import * as React from "react";
import type { AdminCostGuardResponse } from "@flamenode/contracts";
import type { AdminCostGuardApi } from "../../api/adminCostGuard.js";
const MODES=[["normal","通常"],["economy","省エネ"],["read_only","読み取り専用"],["static_only","静的のみ"]] as const;
export function CostGuardForm({settings,api,onSuccess}:{settings:AdminCostGuardResponse;api:AdminCostGuardApi;onSuccess:()=>void}):React.ReactElement{
  const [mode,setMode]=React.useState<string>(settings.mode);
  const [reason,setReason]=React.useState(settings.reason??"");
  const [busy,setBusy]=React.useState(false);
  const [message,setMessage]=React.useState("");
  React.useEffect(()=>{setMode(settings.mode);setReason(settings.reason??"");},[settings.mode,settings.reason]);
  async function save(kind:"mode"|"maintenance",on=false){
    if(busy||!reason.trim())return;
    if(kind==="maintenance"&&on&&!window.confirm("一般ユーザーの通常操作を停止します。理由と監査記録を確認して続行してください。"))return;
    setBusy(true);setMessage("");
    try{
      const result=kind==="mode"?await api.setMode(mode,reason):await api.setMaintenance(on,reason);
      setMessage(result.message??(result.ok?"更新しました。":"失敗しました。"));
      if(result.ok)onSuccess();
    }finally{setBusy(false);}
  }
  return <section aria-label="動作モード">
    <h2>手動動作モード</h2><div role="group" aria-label="動作モード選択">
      {MODES.map(([value,label])=><button key={value} type="button" disabled={busy} aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}
    </div>
    <label>変更理由 <input value={reason} maxLength={500} disabled={busy} onChange={e=>setReason(e.currentTarget.value)} /></label>
    <button type="button" disabled={busy||!reason.trim()} onClick={()=>void save("mode")}>モードを更新</button>
    <h2>メンテナンス即時切替</h2>
    <button type="button" disabled={busy||!reason.trim()} onClick={()=>void save("maintenance",!settings.isMaintenance)}>{settings.isMaintenance?"OFFにする":"ONにする"}</button>
    {message?<p role="status">{message}</p>:null}
  </section>;
}

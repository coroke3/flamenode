import * as React from "react";
import type {AdminNotificationsApi} from "../../api/adminNotifications.js";
export function NotificationCancelButton({id,api,onSuccess}:{id:string;api:AdminNotificationsApi;onSuccess:()=>void}):React.ReactElement{
 const [open,setOpen]=React.useState(false),[reason,setReason]=React.useState(""),[message,setMessage]=React.useState(""),[busy,setBusy]=React.useState(false);
 const pending=React.useRef(false);
 const run=async()=>{
  if(pending.current)return;pending.current=true;setBusy(true);setMessage("");
  try{
    const result=await api.cancel(id,reason);
    setMessage(result.message??(result.ok?"キャンセルしました。":"失敗しました。"));
    if(result.ok){setOpen(false);setReason("");onSuccess();}
  }catch{setMessage("失敗しました。");}
  finally{pending.current=false;setBusy(false);}
 };
 return <span><button type="button" aria-label={"通知 "+id+" をキャンセル"} disabled={busy} onClick={()=>setOpen(v=>!v)}>キャンセル</button>
   {open?<span><input placeholder="理由 (任意)" maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.currentTarget.value)}/>
     <button type="button" disabled={busy} onClick={()=>void run()}>確定</button></span>:null}
   {message?<span role="status">{message}</span>:null}
 </span>;
}

import * as React from "react";
import type {AdminNotificationsApi} from "../../api/adminNotifications.js";
type Props={kind:"retry"|"force-resend";id:string;api:AdminNotificationsApi;onSuccess:()=>void}|
  {kind:"bulk-retry";api:AdminNotificationsApi;onSuccess:()=>void};
export const NOTIFICATION_CONFIRM={
  "force-resend":"同内容の通知を再送キューに追加しますか？",
  "bulk-retry":"failed 通知をまとめてリトライしますか? (上限 50 件)",
} as const;
export function NotificationActionButton(props:Props):React.ReactElement{
  const [busy,setBusy]=React.useState(false);
  const busyRef=React.useRef(false);
  const [message,setMessage]=React.useState("");
  const config=props.kind==="retry"?{label:"再試行",error:"リトライに失敗しました。"}:
    props.kind==="force-resend"?{label:"強制再送",error:"再送に失敗しました。"}:
    {label:"failed を一括リトライ (上限 50)",error:"一括リトライに失敗しました。"};
  const run=async()=>{
    if(busyRef.current)return;
    const confirm=props.kind==="retry"?null:NOTIFICATION_CONFIRM[props.kind];
    if(confirm&&!window.confirm(confirm))return;
    busyRef.current=true;setBusy(true);setMessage("");
    try{
      const result=props.kind==="retry"?await props.api.retry(props.id):
        props.kind==="force-resend"?await props.api.forceResend(props.id):await props.api.retryFailed();
      if(!result.ok)setMessage(result.message??config.error);
      else{if(props.kind==="bulk-retry"&&result.message)setMessage(result.message);props.onSuccess();}
    }catch{setMessage(config.error);}
    finally{busyRef.current=false;setBusy(false);}
  };
  return <span><button type="button" disabled={busy} onClick={()=>void run()}>{busy?"...":config.label}</button>
    {message?<span role="status">{message}</span>:null}
  </span>;
}

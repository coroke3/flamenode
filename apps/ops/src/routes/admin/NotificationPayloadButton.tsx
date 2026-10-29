import * as React from "react";
export function NotificationPayloadButton({payload}:{payload:string}):React.ReactElement{
 const [open,setOpen]=React.useState(false);
 const pretty=React.useMemo(()=>{try{return JSON.stringify(JSON.parse(payload),null,2);}catch{return payload;}},[payload]);
 return <span><button type="button" onClick={()=>setOpen(true)}>payload</button>
  {open?<div role="dialog" aria-modal="true" aria-label="notification payload">
   <button type="button" onClick={()=>setOpen(false)}>閉じる</button>
   <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:400,overflow:"auto"}}>{pretty}</pre>
  </div>:null}
 </span>;
}

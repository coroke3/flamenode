import * as React from "react";

export type AuditChange={key:string;label:string;kind:"added"|"removed"|"changed";before:string;after:string;important:boolean};
const LABELS:Record<string,string>={
  title:"作品タイトル",youtube_video_id:"YouTube ID",creator_x_user_id:"投稿者X ID",
  creator_display_name:"投稿者名",visibility_status:"公開状態",primary_event_id:"主イベント",
  event_id:"イベント",stage_permission:"ステージ利用許可",music:"楽曲",credit:"クレジット",
  role:"権限",is_banned:"BAN状態",approval_status:"承認状態",status:"状態",slot_status:"枠状態",
  sync_status:"同期状態",sync_error:"同期エラー",can_edit:"編集権限",
  is_public_member:"公開メンバー",collaboration_type:"合作種別",
};
const IMPORTANT=new Set(["visibility_status","youtube_video_id","creator_x_user_id","role",
  "is_banned","approval_status","event_id","primary_event_id","slot_status","status","can_edit","sync_status"]);
const readObject=(raw:string|null):{valid:boolean;value:Record<string,unknown>}=>{
  if(!raw)return {valid:true,value:{}};
  try{
    const value:unknown=JSON.parse(raw);
    return {valid:true,value:value&&typeof value==="object"&&!Array.isArray(value)
      ? value as Record<string,unknown>:{value}};
  }catch{return {valid:false,value:{}}}
};
const print=(v:unknown):string=>{
  if(v===undefined)return "(未設定)";
  if(v===null)return "(null)";
  if(v==="")return "(空文字)";
  const text=typeof v==="string"?v:JSON.stringify(v)??String(v);
  return text.length>160?text.slice(0,160)+"…":text;
};
export function parseAuditChanges(before:string|null,after:string|null):{valid:boolean;changes:AuditChange[]}{
  const b=readObject(before),a=readObject(after);
  if(!b.valid||!a.valid)return {valid:false,changes:[]};
  const changes:AuditChange[]=[];
  const keys=[...new Set([...Object.keys(b.value),...Object.keys(a.value)])].sort();
  for(const key of keys){
    const had=Object.hasOwn(b.value,key),has=Object.hasOwn(a.value,key);
    const bv=had?b.value[key]:undefined,av=has?a.value[key]:undefined;
    if(had===has&&JSON.stringify(bv)===JSON.stringify(av))continue;
    changes.push({key,label:LABELS[key]??key,kind:!had?"added":!has?"removed":"changed",
      before:print(bv),after:print(av),important:IMPORTANT.has(key)});
  }
  return {valid:true,changes};
}
export function AuditDiffGrid({before,after}:{before:string|null;after:string|null}):React.ReactElement {
  const result=React.useMemo(()=>parseAuditChanges(before,after),[before,after]);
  if(!result.valid)return <p role="alert">JSONを解析できません。下のJSON全文で元データを確認してください。</p>;
  if(result.changes.length===0)return <p>変更なし</p>;
  const labels={added:"追加",removed:"削除",changed:"変更"};
  return <div style={{overflowX:"auto"}}>
    <table className="fn-table" aria-label="変更差分">
      <thead><tr><th>項目</th><th>種別</th><th>変更前</th><th>変更後</th></tr></thead>
      <tbody>{result.changes.map(c=><tr key={c.key}>
        <th scope="row">{c.label}{c.label!==c.key&&<small> ({c.key})</small>}</th>
        <td><span className={"fn-badge "+(c.important?"fn-badge-warning":"fn-badge-soft")}>{labels[c.kind]}</span></td>
        <td><code>{c.before}</code></td><td><code>{c.after}</code></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

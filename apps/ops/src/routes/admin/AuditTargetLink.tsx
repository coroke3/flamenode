import * as React from "react";

/** Preserve CURRENT AuditTargetLink routes and unknown-table plain-text behavior. */
export function auditTargetLinks(tableName:string,id:string):{
  adminHref?:string;publicHref?:string;
} {
  const v=encodeURIComponent(id);
  switch(tableName) {
    case "videos": return {adminHref:"/admin/videos/"+v};
    case "events": return {adminHref:"/manage/events/"+v+"/edit",publicHref:"/event/"+v};
    case "users": return {adminHref:"/admin/users/"+v};
    case "x_users": return {adminHref:"/admin/users?view=xid&q="+v,publicHref:"/user/"+v};
    case "slots": return {adminHref:"/admin/audit?table=slots&record="+v};
    case "x_identity_requests": return {adminHref:"/admin/x-link-requests?record="+v};
    default:return {};
  }
}
export function AuditTargetLink({tableName,recordId,maxChars=24}:{
  tableName:string;recordId:string;maxChars?:number;
}):React.ReactElement {
  const links=auditTargetLinks(tableName,recordId);
  const text=recordId.length>maxChars?recordId.slice(0,maxChars)+"…":recordId;
  return <span style={{display:"inline-flex",gap:4,flexWrap:"wrap",alignItems:"center",minWidth:0}}>
    <code title={recordId}>{text}</code>
    {links.adminHref&&<a href={links.adminHref} className="fn-btn fn-btn-ghost fn-btn-sm"
      aria-label="管理画面で開く">管理</a>}
    {links.publicHref&&<a href={links.publicHref} className="fn-btn fn-btn-ghost fn-btn-sm"
      aria-label="公開ページを開く">公開</a>}
  </span>;
}

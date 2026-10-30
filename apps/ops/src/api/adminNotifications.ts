// D-16-1 provisional: replace with @flamenode/contracts at merge
import {AdminNotificationsResponseSchema,type AdminNotificationsResponse} from "@flamenode/contracts";
import type {AdminReadResult,AdminWriteResult} from "./adminCostGuard.js";
type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
export type NotificationFilters={status:string;cat:string;type:string;event:string;q:string};
export function notificationQuery(filters:NotificationFilters):string{
  const params=new URLSearchParams();
  if(filters.status&&filters.status!=="all")params.set("status",filters.status);
  if(filters.cat&&filters.cat!=="all")params.set("cat",filters.cat);
  if(filters.type.trim())params.set("type",filters.type.trim());
  if(filters.event.trim())params.set("event",filters.event.trim());
  if(filters.q.trim())params.set("q",filters.q.trim().slice(0,100));
  return params.toString();
}
export function createAdminNotificationsApi(fetcher:Fetcher=(url,init)=>fetch(url,init)){
  async function list(filters:NotificationFilters):Promise<AdminReadResult<AdminNotificationsResponse>>{
    try{
      const query=notificationQuery(filters);
      const res=await fetcher("/api/admin-read/ops/notifications"+(query?"?"+query:""),{
        method:"GET",cache:"no-store",credentials:"same-origin",headers:{accept:"application/json"},signal:AbortSignal.timeout(5000),
      });
      if(res.status===401)return {status:"anonymous"};
      if(res.status===403)return {status:"forbidden"};
      if(!res.ok)return {status:"unavailable"};
      const parsed=AdminNotificationsResponseSchema.safeParse(await res.json());
      return parsed.success?{status:"ok",data:parsed.data}:{status:"unavailable"};
    }catch{return {status:"unavailable"};}
  }
  async function write(path:string,body:object={}):Promise<AdminWriteResult>{
    try{
      const response=await fetcher(path,{
        method:"POST",cache:"no-store",credentials:"same-origin",
        headers:{accept:"application/json","content-type":"application/json"},body:JSON.stringify(body),
        signal:AbortSignal.timeout(5000),
      });
      if(response.status===401)return {ok:false,message:"ログインしてください。"};
      if(response.status===403)return {ok:false,message:"操作する権限がありません。"};
      const value:unknown=await response.json();
      if(value&&typeof value==="object"&&"ok" in value&&typeof value.ok==="boolean")
        return {ok:value.ok,message:"message" in value&&typeof value.message==="string"?value.message:undefined};
    }catch{/* fail closed */}
    return {ok:false,message:"通信エラーが発生しました。"};
  }
  return {
    list,
    retry:(id:string)=>write("/api/admin/notifications/"+encodeURIComponent(id)+"/retry"),
    cancel:(id:string,reason:string)=>write("/api/admin/notifications/"+encodeURIComponent(id)+"/cancel",{reason}),
    forceResend:(id:string)=>write("/api/admin/notifications/"+encodeURIComponent(id)+"/force-resend"),
    retryFailed:()=>write("/api/admin/notifications/retry-failed"),
  };
}
export type AdminNotificationsApi=ReturnType<typeof createAdminNotificationsApi>;

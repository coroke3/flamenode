// D-16-1 provisional: replace with @flamenode/contracts at merge
import { AdminCostGuardResponseSchema, type AdminCostGuardResponse } from "@flamenode/contracts";
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type AdminWriteResult = {ok:boolean;message?:string};
export type AdminReadResult<T> = {status:"ok";data:T} | {status:"anonymous"|"forbidden"|"unavailable"};
const jsonInit = (method:"GET"|"POST",body?:object):RequestInit => ({
  method,cache:"no-store",credentials:"same-origin",
  headers:{"accept":"application/json",...(body?{"content-type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(5000),
});
export function createAdminCostGuardApi(fetcher:Fetcher=(url,init)=>fetch(url,init)){
  async function read():Promise<AdminReadResult<AdminCostGuardResponse>>{
    try{
      const res=await fetcher("/api/admin-read/ops/cost-guard",jsonInit("GET"));
      if(res.status===401)return {status:"anonymous"};
      if(res.status===403)return {status:"forbidden"};
      if(!res.ok)return {status:"unavailable"};
      const parsed=AdminCostGuardResponseSchema.safeParse(await res.json());
      return parsed.success?{status:"ok",data:parsed.data}:{status:"unavailable"};
    }catch{return {status:"unavailable"};}
  }
  async function write(path:string,body:object):Promise<AdminWriteResult>{
    try{
      const res=await fetcher(path,jsonInit("POST",body));
      if(res.status===401)return {ok:false,message:"ログインしてください。"};
      if(res.status===403)return {ok:false,message:"操作する権限がありません。"};
      const data:unknown=await res.json();
      if(data&&typeof data==="object"&&"ok" in data&&typeof data.ok==="boolean")
        return {ok:data.ok,message:"message" in data&&typeof data.message==="string"?data.message:undefined};
    }catch{/* fail closed */}
    return {ok:false,message:"通信エラーが発生しました。"};
  }
  return {
    read,
    setMode:(mode:string,reason:string)=>write("/api/admin/cost-guard/mode",{mode,reason}),
    setMaintenance:(enabled:boolean,reason:string)=>write("/api/admin/cost-guard/maintenance",{is_maintenance_mode:String(enabled?1:0),reason}),
    setOverride:(reason:string,features:readonly string[])=>write("/api/admin/cost-guard/override",{reason,confirm:"OVERRIDE",features:[...features]}),
    clearOverride:(reason:string)=>write("/api/admin/cost-guard/override/clear",{reason,confirm:"CLEAR"}),
    setDisabled:(reason:string,features:readonly string[],expected:string|null)=>write("/api/admin/cost-guard/disabled-features",{
      reason,confirm:"APPLY",features:[...features],expected_disabled_features_json:JSON.stringify(expected),
    }),
  };
}
export type AdminCostGuardApi=ReturnType<typeof createAdminCostGuardApi>;

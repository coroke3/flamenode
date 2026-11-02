/**
 * MIG-0637 U02 (SA-016..020). All five CostGuard control operations must BYPASS the
 * ordinary costGuardMiddleware (CURRENT requireCostGuardControlAdmin), while the
 * parent /api/admin router still enforces origin -> session -> admin/TOS/BAN -> db.
 * Strict full-row CAS + audit is atomic. D1 write precedes best-effort KV mirror.
 * No production access, Queue binding, or direct drizzle import is used.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  parseCostGuardModeInput, parseMaintenanceModeInput, resolveMaintenanceTargetMode,
  resolveOperationMode, parseCostGuardOverrideInput, parseDisabledFeaturesInput,
  checkExpectedDisabledFeatures, parseClearCostGuardOverrideInput, OVERRIDE_DURATION_SEC,
} from "@flamenode/domain/admin";
import {
  CostGuardModeBodySchema, CostGuardMaintenanceBodySchema, CostGuardOverrideBodySchema,
  CostGuardDisabledBodySchema, CostGuardClearBodySchema,
  type AdminOpsResult,
} from "@flamenode/contracts";
import { sql } from "@flamenode/server-core/sql";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { mapAuditSettings, type AuditSettingsRow } from "@flamenode/server-core/audit/settings";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "./body.ts";

const SETTINGS_KEY = "default";
export const COST_GUARD_CONFLICT_MESSAGE = "設定が競合したか、監査記録に失敗しました。再読み込みしてください。";
export const KV_MIRROR_KEY = "operation_mode:mirror";
type SettingsRow = Record<string, unknown> & {
  id: string; operation_mode: string | null; disabled_features_json: string | null;
};
type Patch = Record<string, unknown>;
const fail = (c:Context<AppEnv>, status:400|404|409|413|500, message:string) =>
  c.json<AdminOpsResult>({ok:false,message}, status);

/** SQL identifiers are generated only from literal keys in the source patch. */
function patchSql(patch:Patch){
  return sql.join(Object.entries(patch).map(([column,value])=>
    sql`${sql.raw('"'+column.replaceAll('"','""')+'"')} = ${value}`),sql`, `);
}
export async function loadCostGuardRow(db:D1Database):Promise<SettingsRow|null>{
  return db.prepare("SELECT * FROM system_settings WHERE id = ? LIMIT 1").bind(SETTINGS_KEY).first<SettingsRow>();
}
async function writeCostGuard(c:Context<AppEnv>,before:SettingsRow,patch:Patch,reason:string,context:string):Promise<Response>{
  const actor=c.get("user")!.id;
  const after={...before,...patch};
  try{
    await mutateWithAudit(c.get("db"),{
      mutationStatements:[c.get("db").run(sql`UPDATE system_settings SET ${patchSql(patch)}
        WHERE id = ${SETTINGS_KEY} AND ${expectedRowCondition({expectedCurrent:{...before}})}`)],
      expectedMutationChanges:[1],
      // CostGuard controls intentionally bypass costGuardMiddleware. Reuse the
      // settings row already loaded above; a second audit settings SELECT
      // would exceed ZERO_1102 S3 (session + TOS + settings = 3 reads).
      preloaded:{...auditPreloaded(c),settings:mapAuditSettings(before as SettingsRow & AuditSettingsRow)},
      audits:[{table_name:"system_settings",target_id:SETTINGS_KEY,operation:"UPDATE",
        before:{...before},after,actor_user_id:actor,reason,context,retention_class:"long_audit",strict:true}],
    });
    return c.json<AdminOpsResult>({ok:true},200);
  }catch{
    // Provider/SQLite exception text may contain SQL or secret-bearing context.
    console.error("[MIG-0637] cost guard atomic mutation failed");
    return fail(c,409,COST_GUARD_CONFLICT_MESSAGE);
  }
}
async function mirrorBestEffort(c:Context<AppEnv>,mode:string,reason:string,updatedAt:number):Promise<string|undefined>{
  try{
    if(!c.env.KV)throw Error("KV binding unavailable");
    await c.env.KV.put(KV_MIRROR_KEY,JSON.stringify({mode,reason,updated_at:updatedAt}));
  }catch{
    return "D1は更新済みですが、KV複製の更新に失敗しました。時間をおいて再度更新してください。";
  }
  return undefined;
}
async function readBody(c:Context<AppEnv>,schema:{safeParse:(value:unknown)=>{success:boolean;data?:unknown}}){
  const raw=await readAdminJsonBody(c.req.raw);
  if(raw.kind==="too_large")return {ok:false as const,response:fail(c,413,BODY_TOO_LARGE_MESSAGE)};
  if(raw.kind!=="ok")return {ok:false as const,response:fail(c,400,"入力エラー")};
  const parsed=schema.safeParse(raw.value);
  if(!parsed.success)return {ok:false as const,response:fail(c,400,"入力エラー")};
  return {ok:true as const,data:raw.value};
}
// Never let a failed preflight D1 read or a late binding getter throw into
// Hono's default error handler. Keep the provider error out of logs/responses.
const failClosedPreflight = (_error: Error, c: Context<AppEnv>) => {
  c.header("Cache-Control", "private, no-store");
  return c.json<AdminOpsResult>({ ok: false, message: "管理操作を処理できませんでした。再度お試しください。" }, 503);
};
export const costGuardAdminRoutes=new Hono<AppEnv>();
costGuardAdminRoutes.onError(failClosedPreflight);

// SA-016: setCostGuardMode
costGuardAdminRoutes.post("/mode",async c=>{
  const req=await readBody(c,CostGuardModeBodySchema);if(!req.ok)return req.response;
  const parsed=parseCostGuardModeInput(req.data);if(!parsed.ok)return fail(c,400,parsed.message);
  const before=await loadCostGuardRow(c.env.DB);if(!before)return fail(c,404,"system_settingsが見つかりません。");
  const now=Math.floor(Date.now()/1000);
  const committed=await writeCostGuard(c,before,{operation_mode:parsed.mode,cost_guard_reason:parsed.reason,
    cost_guard_updated_by_user_id:c.get("user")!.id,cost_guard_updated_at:now},parsed.reason,"cost_guard_mode");
  if(committed.status!==200)return committed;
  const warning=await mirrorBestEffort(c,parsed.mode,parsed.reason,now);
  return c.json<AdminOpsResult>({ok:true,...(warning?{warning,message:warning}:{})},200);
});
// SA-017: setMaintenanceMode; always allows admin to exit maintenance.
costGuardAdminRoutes.post("/maintenance",async c=>{
  const req=await readBody(c,CostGuardMaintenanceBodySchema);if(!req.ok)return req.response;
  const parsed=parseMaintenanceModeInput({isMaintenanceMode:req.data.is_maintenance_mode,reason:req.data.reason});
  if(!parsed.ok)return fail(c,400,parsed.message);
  const before=await loadCostGuardRow(c.env.DB);if(!before)return fail(c,404,"system_settingsが見つかりません。");
  const mode=resolveMaintenanceTargetMode(resolveOperationMode(before),parsed.enable);
  const now=Math.floor(Date.now()/1000);
  const committed=await writeCostGuard(c,before,{operation_mode:mode,cost_guard_reason:parsed.reason,
    cost_guard_updated_by_user_id:c.get("user")!.id,cost_guard_updated_at:now},parsed.reason,"cost_guard_maintenance");
  if(committed.status!==200)return committed;
  const warning=await mirrorBestEffort(c,mode,parsed.reason,now);
  return c.json<AdminOpsResult>({ok:true,...(warning?{warning,message:warning}:{})},200);
});
// SA-018: confirmed 15 minute per-feature exception, no KV mirror.
costGuardAdminRoutes.post("/override",async c=>{
  const req=await readBody(c,CostGuardOverrideBodySchema);if(!req.ok)return req.response;
  const parsed=parseCostGuardOverrideInput({reason:req.data.reason,confirm:req.data.confirm,features:req.data.features as unknown[]});
  if(!parsed.ok)return fail(c,400,parsed.message);
  const before=await loadCostGuardRow(c.env.DB);if(!before)return fail(c,404,"system_settingsが見つかりません。");
  const now=Math.floor(Date.now()/1000);
  const committed=await writeCostGuard(c,before,{cost_guard_exception_until:now+OVERRIDE_DURATION_SEC,
    cost_guard_exception_features_json:JSON.stringify(parsed.features),cost_guard_reason:`[15m override] ${parsed.reason}`,
    cost_guard_updated_by_user_id:c.get("user")!.id,cost_guard_updated_at:now},
    parsed.reason,"cost_guard_override_enable");
  return committed.status===200?c.json<AdminOpsResult>({ok:true,message:"15分間の例外を有効化しました。"},200):committed;
});
// SA-019: exact serialized expected_disabled_features_json CAS.
costGuardAdminRoutes.post("/disabled-features",async c=>{
  const req=await readBody(c,CostGuardDisabledBodySchema);if(!req.ok)return req.response;
  const parsed=parseDisabledFeaturesInput({reason:req.data.reason,confirm:req.data.confirm,features:req.data.features as unknown[]});
  if(!parsed.ok)return fail(c,400,parsed.message);
  const before=await loadCostGuardRow(c.env.DB);if(!before)return fail(c,404,"system_settings が見つかりません。");
  const expected=checkExpectedDisabledFeatures(req.data.expected_disabled_features_json,before.disabled_features_json??null);
  if(!expected.ok)return fail(c,409,expected.message);
  const now=Math.floor(Date.now()/1000);
  const committed=await writeCostGuard(c,before,{disabled_features_json:JSON.stringify(parsed.features),
    cost_guard_reason:`[disabled features] ${parsed.reason}`,
    cost_guard_updated_by_user_id:c.get("user")!.id,cost_guard_updated_at:now},
    parsed.reason,"cost_guard_disabled_features");
  return committed.status===200?c.json<AdminOpsResult>({ok:true,message:"Cost Guard の無効化機能を更新しました。"},200):committed;
});
// SA-020: clear override, reason and CLEAR token mandatory.
costGuardAdminRoutes.post("/override/clear",async c=>{
  const req=await readBody(c,CostGuardClearBodySchema);if(!req.ok)return req.response;
  const parsed=parseClearCostGuardOverrideInput({reason:req.data.reason,confirm:req.data.confirm});
  if(!parsed.ok)return fail(c,400,parsed.message);
  const before=await loadCostGuardRow(c.env.DB);if(!before)return fail(c,404,"system_settingsが見つかりません。");
  const now=Math.floor(Date.now()/1000);
  const committed=await writeCostGuard(c,before,{cost_guard_exception_until:null,cost_guard_exception_features_json:null,
    cost_guard_reason:`[override cleared] ${parsed.reason}`,
    cost_guard_updated_by_user_id:c.get("user")!.id,cost_guard_updated_at:now},
    parsed.reason,"cost_guard_override_clear");
  return committed.status===200?c.json<AdminOpsResult>({ok:true,message:"例外を解除しました。"},200):committed;
});

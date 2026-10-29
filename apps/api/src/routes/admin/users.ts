/**
 * MIG-0637 U03 (SA-077..081): user admin mutators.
 * Parent route verifies origin, session, role and TOS. Each feature has its own
 * CostGuard middleware; writes use full-row CAS + strict audit in one D1 batch.
 * Notification cancellation and static rebuild enqueue share that same batch.
 * D-0603-1: never wake a Queue in this Worker (Cron handles pending rows).
 */
import { Hono, type Context } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  parseSetUserRoleInput, parseSetUserBannedInput, parseSetUserNotificationsInput,
  parseSetUserCanCreateEventsInput, userNotificationsAuditReason,
} from "@flamenode/domain/user";
import { normalizeXId } from "@flamenode/domain/xid";
import {
  AdminUserRoleBodySchema, AdminUserBanBodySchema, AdminUserNotificationsBodySchema,
  AdminUserEventCreateBodySchema, AdminXIconRefreshBodySchema, type AdminOpsResult,
} from "@flamenode/contracts";
import { sql } from "@flamenode/server-core/sql";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "./body.ts";

const ATOMIC_FAILURE = "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。";
type UserRow=Record<string,unknown>&{id:string};
type XRow=Record<string,unknown>&{id:string};
function fail(c:Context<AppEnv>,status:400|404|409|413|500,message:string){
  return c.json<AdminOpsResult>({ok:false,message},status);
}
function setClause(values:Record<string,unknown>){
  return sql.join(Object.entries(values).map(([key,value])=>
    sql`${sql.raw('"'+key.replaceAll('"','""')+'"')} = ${value}`),sql`, `);
}
async function readBody(c:Context<AppEnv>,schema:{safeParse:(v:unknown)=>{success:boolean}}){
  const parsed=await readAdminJsonBody(c.req.raw);
  if(parsed.kind==="too_large")return {ok:false as const,res:fail(c,413,BODY_TOO_LARGE_MESSAGE)};
  if(parsed.kind!=="ok"||!schema.safeParse(parsed.value).success)
    return {ok:false as const,res:fail(c,400,"入力エラー")};
  return {ok:true as const,body:parsed.value};
}
async function loadUser(c:Context<AppEnv>,id:string,includePending:boolean):
 Promise<{target:UserRow|null;pendingCount:number}>{
  // SA-079: pending cancellation COUNT is folded into the same preflight SELECT.
  // No additional S3 D1 pre-read; no derived _pending_count in audit/CAS snapshot.
  const query=includePending
    ? `SELECT u.*, (SELECT COUNT(*) FROM notification_outbox n WHERE n.recipient_user_id = u.id AND n.status='pending') AS _pending_count
         FROM "user" u WHERE u.id = ? LIMIT 1`
    : `SELECT * FROM "user" WHERE id = ? LIMIT 1`;
  const row=await c.env.DB.prepare(query).bind(id).first<UserRow&{_pending_count?:number}>();
  if(!row)return {target:null,pendingCount:0};
  const {_pending_count,...target}=row;
  // CURRENT drizzle timestamp_ms snapshots this field as a Date.
  // expectedRowCondition converts Date back to milliseconds for full-row CAS.
  if (typeof target.emailVerified === "number") {
    target.emailVerified = new Date(target.emailVerified);
  }
  return {target,pendingCount:Number(_pending_count??0)};
}
export async function mutateUserWithAudit(
 c:Context<AppEnv>,target:UserRow,patch:Record<string,unknown>,retention:"normal"|"long_audit",
 context:string,reason:string|null=null,
 extraStatements:ReturnType<typeof sql>[]=[],extraExpectedChanges:number[]=[],
):Promise<Response>{
  const after={...target,...patch};
  try{
    await mutateWithAudit(c.get("db"),{
      mutationStatements:[
        c.get("db").run(sql`UPDATE "user" SET ${setClause(patch)}
          WHERE id = ${target.id} AND ${expectedRowCondition({expectedCurrent:{...target}})}`),
        ...extraStatements.map(statement=>c.get("db").run(statement)),
      ],
      expectedMutationChanges:[1,...extraExpectedChanges],
      preloaded:auditPreloaded(c),
      audits:[{table_name:"user",target_id:target.id,operation:"UPDATE",
        before:{...target},after:{...after},actor_user_id:c.get("user")!.id,
        retention_class:retention,context,reason,strict:true}],
    });
    return c.json<AdminOpsResult>({ok:true},200);
  }catch(e){
    console.error("[MIG-0637] user admin atomic mutation failed",e);
    return fail(c,409,ATOMIC_FAILURE);
  }
}
export const adminUsersRoutes=new Hono<AppEnv>();
export const adminXUsersRoutes=new Hono<AppEnv>();
adminUsersRoutes.use("/:userId/role",onlyMutating(costGuardMiddleware("admin_user_role")));
adminUsersRoutes.use("/:userId/banned",onlyMutating(costGuardMiddleware("admin_user_ban")));
adminUsersRoutes.use("/:userId/notifications",onlyMutating(costGuardMiddleware("admin_user_notifications")));
adminUsersRoutes.use("/:userId/can-create-events",onlyMutating(costGuardMiddleware("admin_user_event_create")));
adminXUsersRoutes.use("/:xUserId/icon-refresh",onlyMutating(costGuardMiddleware("admin_x_icon_refresh")));

// SA-077 self role protection is centralized in @flamenode/domain/user.
adminUsersRoutes.post("/:userId/role",async c=>{
  const req=await readBody(c,AdminUserRoleBodySchema);if(!req.ok)return req.res;
  const parsed=parseSetUserRoleInput({...req.body,user_id:c.req.param("userId")},c.get("user")!.id);
  if(!parsed.ok)return fail(c,400,parsed.message);
  const {target}=await loadUser(c,parsed.user_id,false);
  if(!target)return fail(c,404,"対象ユーザーが見つかりません。");
  return mutateUserWithAudit(c,target,{role:parsed.role},"long_audit","admin_user_role");
});
// SA-078 a BAN requires reason, self BAN is denied.
adminUsersRoutes.post("/:userId/banned",async c=>{
  const req=await readBody(c,AdminUserBanBodySchema);if(!req.ok)return req.res;
  const parsed=parseSetUserBannedInput({...req.body,user_id:c.req.param("userId")},c.get("user")!.id);
  if(!parsed.ok)return fail(c,400,parsed.message);
  const {target}=await loadUser(c,parsed.user_id,false);
  if(!target)return fail(c,404,"対象ユーザーが見つかりません。");
  return mutateUserWithAudit(c,target,{is_banned:parsed.is_banned},"long_audit","admin_user_ban",parsed.auditReason);
});
// SA-079 cancel pending outbox rows atomically when turning notifications OFF.
adminUsersRoutes.post("/:userId/notifications",async c=>{
  const req=await readBody(c,AdminUserNotificationsBodySchema);if(!req.ok)return req.res;
  const parsed=parseSetUserNotificationsInput({...req.body,user_id:c.req.param("userId")});
  if(!parsed.ok)return fail(c,400,parsed.message);
  const {target,pendingCount}=await loadUser(c,parsed.user_id,parsed.is_notification_enabled===0);
  if(!target)return fail(c,404,"対象ユーザーが見つかりません。");
  const disabling=parsed.is_notification_enabled===0;
  const now=Math.floor(Date.now()/1000);
  const cancel=disabling?[sql`UPDATE notification_outbox SET
    status='cancelled', processing_started_at=NULL, lease_token=NULL,
    lease_expires_at=NULL, next_attempt_at=NULL,
    last_error='notification disabled before delivery', processed_at=${now}
    WHERE recipient_user_id=${target.id} AND status='pending'`]:[];
  return mutateUserWithAudit(c,target,{is_notification_enabled:parsed.is_notification_enabled},
    "normal","admin_user_notifications",userNotificationsAuditReason(disabling,pendingCount),
    cancel,disabling?[pendingCount]:[]);
});
// SA-080
adminUsersRoutes.post("/:userId/can-create-events",async c=>{
  const req=await readBody(c,AdminUserEventCreateBodySchema);if(!req.ok)return req.res;
  const parsed=parseSetUserCanCreateEventsInput({...req.body,user_id:c.req.param("userId")});
  if(!parsed.ok)return fail(c,400,parsed.message);
  const {target}=await loadUser(c,parsed.user_id,false);
  if(!target)return fail(c,404,"対象ユーザーが見つかりません。");
  return mutateUserWithAudit(c,target,{can_create_events:parsed.can_create_events},
    "long_audit","admin_user_event_create");
});
// SA-081: use the latest individual/collab submitted creator icon, enqueue 2
// static rebuild targets in the same D1 batch; never call Queue.send().
adminXUsersRoutes.post("/:xUserId/icon-refresh",async c=>{
  // Apply the same 64KiB JSON cap to SA-081 as every other admin write.
  const req=await readBody(c,AdminXIconRefreshBodySchema);if(!req.ok)return req.res;
  const xUserId=normalizeXId(c.req.param("xUserId"));
  if(!xUserId)return fail(c,400,"x_user_id が必要です。");
  const found=await c.env.DB.prepare(`SELECT x.*,
    (SELECT v.creator_icon_url FROM videos v
     WHERE v.creator_x_user_id=x.id AND v.creator_icon_url IS NOT NULL
       AND v.collaboration_type IN ('individual','collab')
       AND v.visibility_status != 'voided'
     ORDER BY CASE WHEN v.collaboration_type='individual' THEN 0 ELSE 1 END,
       v.created_at DESC LIMIT 1) AS _candidate_icon
    FROM x_users x WHERE x.id=? LIMIT 1`).bind(xUserId).first<XRow&{_candidate_icon:string|null}>();
  if(!found)return fail(c,404,"対象Xユーザーが見つかりません。");
  const {_candidate_icon:icon,...before}=found;
  if(!icon)return fail(c,400,"候補アイコンが見つかりませんでした。");
  try{
    const queue=await buildStaticRebuildQueueBatch(c.get("db"),[
      {targetType:"user",targetId:xUserId,reason:"admin_x_icon_refresh",priority:"normal",requestedByUserId:c.get("user")!.id},
      {targetType:"users_index",targetId:"global",reason:"admin_x_icon_refresh",priority:"normal",requestedByUserId:c.get("user")!.id},
    ]);
    await mutateWithAudit(c.get("db"),{
      mutationStatements:[
        c.get("db").run(sql`UPDATE x_users SET icon_url=${icon} WHERE id=${xUserId}
          AND ${expectedRowCondition({expectedCurrent:{...before}})}`),
        ...queue.statements,
      ],
      expectedMutationChanges:[1,...queue.expectedChanges],
      preloaded:auditPreloaded(c),
      audits:[{table_name:"x_users",target_id:xUserId,operation:"UPDATE",before:{...before},
        after:{...before,icon_url:icon},actor_user_id:c.get("user")!.id,
        retention_class:"normal",context:"admin_x_icon_refresh",
        reason:"作品の最新アイコンから再計算",strict:true}],
    });
    return c.json<AdminOpsResult>({ok:true,...(queue.statements.length>0?{pendingPublicReflection:true}:{})},200);
  }catch(e){
    console.error("[MIG-0637] x icon refresh atomic mutation failed",e);
    return fail(c,409,ATOMIC_FAILURE);
  }
});

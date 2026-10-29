// MIG-0637: end-to-end Hono admin writes against atomic node:sqlite D1 fake.
// This suite is deliberately offline: it never contacts production KV/D1/Queue.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";
import { CostGuardModeBodySchema, AdminUserRoleBodySchema } from "@flamenode/contracts";

const SITE="https://app.flamenode.example";
const ADMIN={id:"admin-1",name:"Admin",email:null,image:null,role:"admin",is_banned:0,active_x_user_id:null};
const routes=[
  ["/cost-guard/mode",{mode:"economy",reason:"節約"}],
  ["/cost-guard/maintenance",{is_maintenance_mode:"1",reason:"保守"}],
  ["/cost-guard/override",{reason:"緊急",confirm:"OVERRIDE",features:["edit_video"]}],
  ["/cost-guard/disabled-features",{reason:"制限",confirm:"APPLY",features:["edit_video"],expected_disabled_features_json:"null"}],
  ["/cost-guard/override/clear",{reason:"解除",confirm:"CLEAR"}],
  ["/users/target-1/role",{role:"moderator"}],
  ["/users/target-1/banned",{is_banned:"1",reason:"規約違反"}],
  ["/users/target-1/notifications",{is_notification_enabled:"0"}],
  ["/users/target-1/can-create-events",{can_create_events:"1"}],
  ["/x-users/twitter1/icon-refresh",{}],
];
function setup({user=ADMIN,settings="normal",onFirst,mirror=true}={}){
  const {db,sqlite,stats}=createAdminD1({onFirst});
  sqlite.exec(`
    ALTER TABLE "user" ADD COLUMN can_create_events INTEGER DEFAULT 0;
    ALTER TABLE "user" ADD COLUMN is_notification_enabled INTEGER DEFAULT 1;
    ALTER TABLE "user" ADD COLUMN emailVerified INTEGER;
    CREATE TABLE notification_outbox (
      id TEXT PRIMARY KEY,recipient_user_id TEXT,status TEXT,processing_started_at INTEGER,
      lease_token TEXT,lease_expires_at INTEGER,next_attempt_at INTEGER,last_error TEXT,processed_at INTEGER
    );
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,creator_x_user_id TEXT,creator_icon_url TEXT,collaboration_type TEXT,
      visibility_status TEXT,created_at INTEGER
    );
  `);
  seedBase(sqlite,{role:user?.role??"admin",settings});
  sqlite.prepare("INSERT INTO \"user\" (id,name,role,is_tos_accepted,is_banned) VALUES ('target-1','Target','user',1,0)").run();
  sqlite.prepare("INSERT INTO x_users (id,x_name,icon_url,approval_status) VALUES ('twitter1','Name','old.png','approved')").run();
  sqlite.prepare("INSERT INTO videos (id,creator_x_user_id,creator_icon_url,collaboration_type,visibility_status,created_at) VALUES ('v1','twitter1','new.png','individual','public',100)").run();
  const kvPuts=[];
  const hono=new Hono();
  hono.route("/api/admin",createAdminRoutes({session:async(c,next)=>{
    c.set("user",user);c.set("sessionState",user?"user":"none");await next();
  }}));
  const env={DB:db,NEXT_PUBLIC_SITE_URL:SITE,...(mirror?{KV:{put:async(k,v)=>kvPuts.push([k,v])}}:{})};
  const request=(path,body,headers={Origin:SITE})=>hono.request("/api/admin"+path,{
    method:"POST",headers:{"content-type":"application/json",...headers},
    body:JSON.stringify(body),
  },env);
  const counts=()=>({
    audit:sqlite.prepare("SELECT COUNT(*) n FROM audit_logs").get().n,
    rebuild:sqlite.prepare("SELECT COUNT(*) n FROM static_rebuild_queue").get().n,
  });
  return {sqlite,stats,request,counts,kvPuts};
}
test("MIG-0637 contracts define FormData keys used by both clients",()=>{
  assert.equal(CostGuardModeBodySchema.safeParse({mode:"economy",reason:"x"}).success,true);
  assert.equal(AdminUserRoleBodySchema.safeParse({role:"moderator"}).success,true);
  assert.equal(CostGuardModeBodySchema.safeParse({mode:"economy"}).success,false);
  assert.equal(CostGuardModeBodySchema.safeParse({reason:"x"}).success,false);
  assert.equal(AdminUserRoleBodySchema.safeParse({}).success,false);
});
test("MIG-0637 T02: other origin stops all ten mutations before D1 reads",async()=>{
  for(const [path,body] of routes){
    const x=setup();
    const r=await x.request(path,body,{Origin:"https://evil.invalid"});
    assert.equal(r.status,403,path);
    assert.equal((await r.json()).reason,"invalid_origin");
    assert.equal(x.counts().audit,0);
    assert.equal(x.stats.reads,0,path);
  }
});
test("MIG-0637 T02: non-admin cannot call any mutations including CostGuard bypass",async()=>{
  for(const [path,body] of routes){
    const x=setup({user:{...ADMIN,role:"moderator"}});
    const r=await x.request(path,body);
    assert.equal(r.status,403,path);
    assert.equal((await r.json()).reason,"forbidden",path);
    assert.equal(x.counts().audit,0);
  }
});
test("MIG-0637 T02: CostGuard control bypasses maintenance, user administration remains denied",async()=>{
  const x=setup({settings:"maintenance"});
  const mode=await x.request("/cost-guard/mode",{mode:"normal",reason:"復旧"});
  assert.equal(mode.status,200,JSON.stringify(await mode.clone().json()));
  const m=setup({settings:"maintenance"});
  const denied=await m.request("/users/target-1/role",{role:"moderator"});
  assert.equal(denied.status,503);
  assert.equal((await denied.json()).reason,"maintenance_mode");
  assert.equal(m.counts().audit,0);
});
test("MIG-0637 U02 SA-016: mode is atomic, strict audit, KV after commit",async()=>{
  const x=setup();
  const r=await x.request("/cost-guard/mode",{mode:"economy",reason:"save"});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.deepEqual(await r.json(),{ok:true});
  const row=x.sqlite.prepare("SELECT * FROM system_settings").get();
  assert.equal(row.operation_mode,"economy");
  assert.equal(row.cost_guard_reason,"save");
  assert.equal(row.cost_guard_updated_by_user_id,ADMIN.id);
  const audit=x.sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(audit.table_name,"system_settings");
  assert.equal(audit.context,"cost_guard_mode");
  assert.equal(audit.retention_class,"long_audit");
  assert.equal(JSON.parse(audit.before_json).operation_mode,"normal");
  assert.equal(JSON.parse(audit.after_json).operation_mode,"economy");
  assert.deepEqual(x.kvPuts.map(v=>v[0]),["operation_mode:mirror"]);
  assert.equal(JSON.parse(x.kvPuts[0][1]).mode,"economy");
  assert.equal(x.stats.batches,1);
});
test("MIG-0637 U02 SA-017: maintenance ON and OFF restore normal mode",async()=>{
  const x=setup();
  assert.equal((await x.request("/cost-guard/maintenance",{is_maintenance_mode:"1",reason:"保守"})).status,200);
  assert.equal(x.sqlite.prepare("SELECT operation_mode FROM system_settings").get().operation_mode,"maintenance");
  assert.equal((await x.request("/cost-guard/maintenance",{is_maintenance_mode:"0",reason:"復旧"})).status,200);
  assert.equal(x.sqlite.prepare("SELECT operation_mode FROM system_settings").get().operation_mode,"normal");
});
test("MIG-0637 U02 SA-018/020: override TTL, strict confirmation, clearing in maintenance",async()=>{
  const x=setup({settings:"maintenance"});
  const bad=await x.request("/cost-guard/override",{reason:"緊急",confirm:"wrong",features:["edit_video"]});
  assert.equal(bad.status,400);assert.equal(x.counts().audit,0);
  const now=Math.floor(Date.now()/1000);
  const r=await x.request("/cost-guard/override",{reason:"緊急",confirm:"OVERRIDE",features:["edit_video"]});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.equal((await r.json()).message,"15分間の例外を有効化しました。");
  let row=x.sqlite.prepare("SELECT * FROM system_settings").get();
  assert.ok(row.cost_guard_exception_until>=now+900);
  assert.equal(row.cost_guard_exception_features_json,'["edit_video"]');
  const clear=await x.request("/cost-guard/override/clear",{reason:"解除",confirm:"CLEAR"});
  assert.equal(clear.status,200);
  row=x.sqlite.prepare("SELECT * FROM system_settings").get();
  assert.equal(row.cost_guard_exception_until,null);
  assert.equal(row.cost_guard_exception_features_json,null);
  assert.equal(x.kvPuts.length,0);
});
test("MIG-0637 U02 SA-019: disabled features sorted, CAS mismatch returns 409 without writing",async()=>{
  const x=setup({settings:"maintenance"});
  let r=await x.request("/cost-guard/disabled-features",{reason:"x",confirm:"APPLY",features:["edit_video","post_video_unslotted"],expected_disabled_features_json:"null"});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.equal(x.sqlite.prepare("SELECT disabled_features_json FROM system_settings").get().disabled_features_json,'["post_video_unslotted","edit_video"]');
  const prior=x.counts().audit;
  r=await x.request("/cost-guard/disabled-features",{reason:"x",confirm:"APPLY",features:[],expected_disabled_features_json:"null"});
  assert.equal(r.status,409);
  assert.match((await r.json()).message,/別の管理者/);
  assert.equal(x.counts().audit,prior);
});
test("MIG-0637 U02: KV failure after D1 COMMIT yields CURRENT warning",async()=>{
  const x=setup({mirror:false});
  const res=await x.request("/cost-guard/mode",{mode:"economy",reason:"x"});
  assert.equal(res.status,200);
  assert.match((await res.json()).warning,/D1は更新済み/);
  assert.equal(x.sqlite.prepare("SELECT operation_mode FROM system_settings").get().operation_mode,"economy");
});
test("MIG-0637 U02: stale full-row CAS rolls back DML and audit",async()=>{
  let raced=false;
  const x=setup({onFirst:(sql,sqlite)=>{
    if(!raced&&sql.startsWith("SELECT * FROM system_settings")){
      raced=true;
      sqlite.prepare("UPDATE system_settings SET cost_guard_reason='other admin'").run();
    }
  }});
  const r=await x.request("/cost-guard/mode",{mode:"economy",reason:"mine"});
  assert.equal(r.status,409);
  assert.equal(x.sqlite.prepare("SELECT operation_mode FROM system_settings").get().operation_mode,"normal");
  assert.equal(x.counts().audit,0);
  assert.equal(x.kvPuts.length,0);
});
test("MIG-0637 U03 SA-077: self role downgrade forbidden; another role audited",async()=>{
  const x=setup();
  const bad=await x.request("/users/admin-1/role",{role:"user"});
  assert.equal(bad.status,400);
  assert.equal(x.counts().audit,0);
  const r=await x.request("/users/target-1/role",{role:"moderator"});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.equal(x.sqlite.prepare("SELECT role FROM \"user\" WHERE id='target-1'").get().role,"moderator");
  assert.equal(x.sqlite.prepare("SELECT context FROM audit_logs").get().context,"admin_user_role");
});
test("MIG-0637 U03 SA-078: self BAN denied, reason required, unban allowed",async()=>{
  const x=setup();
  assert.equal((await x.request("/users/admin-1/banned",{is_banned:"1",reason:"a"})).status,400);
  assert.equal((await x.request("/users/target-1/banned",{is_banned:"1",reason:""})).status,400);
  assert.equal((await x.request("/users/target-1/banned",{is_banned:"1",reason:"違反"})).status,200);
  assert.equal(x.sqlite.prepare("SELECT is_banned FROM \"user\" WHERE id='target-1'").get().is_banned,1);
  assert.equal(x.sqlite.prepare("SELECT reason FROM audit_logs").get().reason,"違反");
});
test("MIG-0637 U03 SA-079: pending notifications cancelled in SAME batch, sent kept",async()=>{
  const x=setup();
  const stmt=x.sqlite.prepare("INSERT INTO notification_outbox (id,recipient_user_id,status) VALUES (?,?,?)");
  stmt.run("n1","target-1","pending");stmt.run("n2","target-1","pending");stmt.run("n3","target-1","sent");
  const r=await x.request("/users/target-1/notifications",{is_notification_enabled:"0"});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.equal(x.sqlite.prepare("SELECT is_notification_enabled FROM \"user\" WHERE id='target-1'").get().is_notification_enabled,0);
  assert.deepEqual(x.sqlite.prepare("SELECT status FROM notification_outbox ORDER BY id").all().map(x=>x.status),["cancelled","cancelled","sent"]);
  assert.match(x.sqlite.prepare("SELECT reason FROM audit_logs").get().reason,/2件をキャンセル/);
  assert.equal(x.stats.batches,1);
  assert.ok(x.stats.reads<=3,"S3 pre-read limit");
});
test("MIG-0637 U03 SA-080: event creation flag audit and id from path",async()=>{
  const x=setup();
  const r=await x.request("/users/target-1/can-create-events",{can_create_events:"1",user_id:"admin-1"});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.equal(x.sqlite.prepare("SELECT can_create_events FROM \"user\" WHERE id='target-1'").get().can_create_events,1);
  assert.equal(x.sqlite.prepare("SELECT can_create_events FROM \"user\" WHERE id='admin-1'").get().can_create_events,0);
});
test("MIG-0637 U03 SA-081: candidate icon and both queued targets atomic",async()=>{
  const x=setup();
  const r=await x.request("/x-users/twitter1/icon-refresh",{});
  assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.deepEqual(await r.json(),{ok:true,pendingPublicReflection:true});
  assert.equal(x.sqlite.prepare("SELECT icon_url FROM x_users WHERE id='twitter1'").get().icon_url,"new.png");
  assert.deepEqual(x.sqlite.prepare("SELECT target_type,target_id FROM static_rebuild_queue ORDER BY target_type").all().map(v=>[v.target_type,v.target_id]),[["user","twitter1"],["users_index","global"]]);
  const a=x.sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(a.context,"admin_x_icon_refresh");
  assert.equal(a.reason,"作品の最新アイコンから再計算");
  assert.equal(x.stats.batches,1);
});
test("MIG-0637 user CostGuard feature flag denies exactly one operation",async()=>{
  const x=setup();
  x.sqlite.prepare("UPDATE system_settings SET disabled_features_json=?").run('["admin_user_role"]');
  const denied=await x.request("/users/target-1/role",{role:"moderator"});
  assert.equal(denied.status,503);
  assert.equal((await denied.json()).reason,"cost_guard_blocked");
  const allowed=await x.request("/users/target-1/can-create-events",{can_create_events:"1"});
  assert.equal(allowed.status,200);
});

test("MIG-0637 U03: Date timestamp_ms CAS and CURRENT audit sanitizer parity",async()=>{
  const x=setup();
  const timestamp=1700000000000;
  x.sqlite.prepare('UPDATE "user" SET emailVerified=? WHERE id=?').run(timestamp,"target-1");
  const result=await x.request("/users/target-1/role",{role:"moderator"});
  assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
  const audit=x.sqlite.prepare("SELECT before_json,after_json FROM audit_logs").get();
  // CURRENT drizzle returns a Date. sanitizeForAudit recursively treats Date
  // as a plain object, so both snapshots contain {}, not an ISO string.
  assert.deepEqual(JSON.parse(audit.before_json).emailVerified,{});
  assert.deepEqual(JSON.parse(audit.after_json).emailVerified,{});
  assert.equal(x.sqlite.prepare('SELECT emailVerified FROM "user" WHERE id=?').get("target-1").emailVerified,timestamp);
  assert.equal(x.stats.batches,1);
});

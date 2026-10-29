import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {createAdminCostGuardApi} from "../.test-dist/apps/ops/src/api/adminCostGuard.js";
import {createAdminNotificationsApi,notificationQuery} from "../.test-dist/apps/ops/src/api/adminNotifications.js";
import {CostGuardForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardForm.js";
import {CostGuardOverrideForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardOverrideForm.js";
import {CostGuardDisabledFeaturesForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardDisabledFeaturesForm.js";
import {NotificationActionButton,NOTIFICATION_CONFIRM} from "../.test-dist/apps/ops/src/routes/admin/NotificationActionButton.js";
import {readNotificationFilters} from "../.test-dist/apps/ops/src/routes/admin/AdminNotifications.js";
import {parseCostFeatures,WRITE_FEATURE_KEYS} from "../.test-dist/apps/ops/src/routes/admin/costGuardFeatures.js";
import {readFileSync} from "node:fs";
const h=React.createElement;
const response=(status,data)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const settings={
  mode:"normal",isMaintenance:false,reason:null,updatedAt:null,exceptionUntil:null,
  exceptionFeaturesJson:null,disabledFeaturesJson:null,truncated:false,history:[],
};

test("MIG-0734 T01 U01 cost writes preserve 5 exact D-17-4 paths and JSON keys",async()=>{
  const calls=[];
  const api=createAdminCostGuardApi(async(path,init)=>{calls.push({path,init});return response(200,{ok:true,message:"更新しました。"});});
  await api.setMode("economy","節約");
  await api.setMaintenance(true,"保守");
  await api.setOverride("緊急",["edit_video"]);
  await api.clearOverride("解除");
  await api.setDisabled("変更",["edit_video"],'["like_or_bookmark"]');
  assert.deepEqual(calls.map(v=>v.path),[
    "/api/admin/cost-guard/mode","/api/admin/cost-guard/maintenance",
    "/api/admin/cost-guard/override","/api/admin/cost-guard/override/clear",
    "/api/admin/cost-guard/disabled-features",
  ]);
  assert.deepEqual(calls.map(v=>JSON.parse(v.init.body)),[
    {mode:"economy",reason:"節約"},
    {is_maintenance_mode:"1",reason:"保守"},
    {reason:"緊急",confirm:"OVERRIDE",features:["edit_video"]},
    {reason:"解除",confirm:"CLEAR"},
    {reason:"変更",confirm:"APPLY",features:["edit_video"],expected_disabled_features_json:'"["like_or_bookmark"]"'},
  ]);
  for(const {init} of calls){
    assert.equal(init.credentials,"same-origin");
    assert.equal(init.cache,"no-store");
    assert.equal(init.headers["content-type"],"application/json");
  }
});

test("MIG-0734 T03 409 CAS conflict body is preserved; invalid HTTP/JSON fails closed",async()=>{
  const api=createAdminCostGuardApi(async()=>response(409,{ok:false,message:"設定が別の管理者によって変更されています"}));
  assert.deepEqual(await api.setDisabled("change",[],"[]"),{ok:false,message:"設定が別の管理者によって変更されています"});
  const malformed=createAdminCostGuardApi(async()=>new Response("oops",{status:200}));
  assert.equal((await malformed.setMode("normal","reason")).ok,false);
  assert.deepEqual(await malformed.read(),{status:"unavailable"});
  const forbidden=createAdminCostGuardApi(async()=>response(403,{error:"forbidden"}));
  assert.equal((await forbidden.setOverride("x",["edit_video"])).ok,false);
});

test("MIG-0734 cost feature allowlist remains byte-identical to CURRENT core",()=>{
  const current=readFileSync(new URL("../../../packages/domain/src/admin/costGuard.ts",import.meta.url),"utf8");
  const span=current.match(/export const WRITE_FEATURE_KEYS = \[([\s\S]*?)\] as const/);
  assert.ok(span,"CURRENT feature list missing");
  const expected=[...span[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
  assert.deepEqual(WRITE_FEATURE_KEYS,expected);
  assert.deepEqual(parseCostFeatures('["edit_video","edit_video"]'),{features:["edit_video"],malformed:false});
  assert.equal(parseCostFeatures('["unrecognized"]',{malformed:true}).malformed,true);
});

test("MIG-0734 U01 server markup keeps OVERRIDE/CLEAR/APPLY disabled until token",()=>{
  const api=createAdminCostGuardApi(async()=>response(500,{})),refresh=()=>{};
  const text=renderToStaticMarkup(h(React.Fragment,null,
    h(CostGuardOverrideForm,{settings,api,onSuccess:refresh}),
    h(CostGuardDisabledFeaturesForm,{settings,api,onSuccess:refresh})));
  assert.match(text,/15分有効化/);
  assert.match(text,/placeholder="OVERRIDE \/ CLEAR"/);
  assert.match(text,/placeholder="APPLY"/);
  assert.match(text,/disabled=""/);
});

async function inDom(callback){
  const dom=new JSDOM("<!doctype html><div id='root'></div>",{url:"https://flamenode.test/admin/cost-guard"});
  const keys=["window","document","Element","HTMLElement","Node","CustomEvent","navigator"];
  const prior=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;
  for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:dom.window[k]});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const root=createRoot(dom.window.document.getElementById("root"));
  try{await callback(dom,root);}finally{
    await React.act(async()=>root.unmount());
    for(const [k,descriptor] of prior){if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}
    globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;
    dom.window.close();
  }
}

test("MIG-0734 T01 maintenance ON confirm suppresses write on cancel; OFF has no confirm",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={setMode:async()=>({ok:true}),setMaintenance:async(enabled)=>{calls.push(enabled);return {ok:true};}};
    const settingsCopy={...settings,reason:"検証"};
    await React.act(async()=>root.render(h(CostGuardForm,{settings:settingsCopy,api,onSuccess:()=>{}})));
    dom.window.confirm=()=>false;
    let button=[...dom.window.document.querySelectorAll("button")].find(b=>b.textContent==="ONにする");
    await React.act(async()=>button.click());
    assert.deepEqual(calls,[]);
    dom.window.confirm=()=>true;
    await React.act(async()=>button.click());
    assert.deepEqual(calls,[true]);
    await React.act(async()=>root.render(h(CostGuardForm,{settings:{...settingsCopy,isMaintenance:true},api,onSuccess:()=>{}})));
    dom.window.confirm=()=>{throw Error("OFF must not confirm");};
    button=[...dom.window.document.querySelectorAll("button")].find(b=>b.textContent==="OFFにする");
    await React.act(async()=>button.click());
    assert.deepEqual(calls,[true,false]);
  });
});

test("MIG-0734 T04 force-resend and bulk-retry cancelled confirmation never calls API",async()=>{
  await inDom(async(dom,root)=>{
    let calls=0;
    const api={retry:async()=>{calls++;return {ok:true};},forceResend:async()=>{calls++;return {ok:true};},retryFailed:async()=>{calls++;return {ok:true};}};
    dom.window.confirm=()=>false;
    await React.act(async()=>root.render(h("div",null,
      h(NotificationActionButton,{api,kind:"force-resend",id:"note-1",onSuccess:()=>{}}),
      h(NotificationActionButton,{api,kind:"bulk-retry",onSuccess:()=>{}})
    )));
    for(const button of dom.window.document.querySelectorAll("button"))await React.act(async()=>button.click());
    assert.equal(calls,0);
    assert.equal(NOTIFICATION_CONFIRM["force-resend"],"同内容の通知を再送キューに追加しますか？");
    assert.equal(NOTIFICATION_CONFIRM["bulk-retry"],"failed 通知をまとめてリトライしますか? (上限 50 件)");
  });
});

test("MIG-0734 T05 failed status is sent to Hono unchanged (backend includes failed + dead_letter)",async()=>{
  const filters=readNotificationFilters(new URLSearchParams("status=failed&type=x_id_approved&cat=x_id&q="+("x".repeat(110))));
  assert.deepEqual(filters,{status:"failed",cat:"x_id",type:"x_id_approved",event:"",q:"x".repeat(100)});
  assert.equal(notificationQuery(filters),"status=failed&cat=x_id&type=x_id_approved&q="+("x".repeat(100)));
  const calls=[];
  const api=createAdminNotificationsApi(async(path,init)=>{calls.push({path,init});return response(500,{});});
  assert.deepEqual(await api.list(filters),{status:"unavailable"});
  assert.match(calls[0].path,/status=failed/);
  assert.equal(calls[0].init.credentials,"same-origin");
});

test("MIG-0734 U02 notifications four actions use D-17-4 paths, path id not repeated in body",async()=>{
  const calls=[];
  const api=createAdminNotificationsApi(async(path,init)=>{calls.push({path,init});return response(200,{ok:true});});
  await api.retry("note/1");await api.cancel("note/1","理由");await api.forceResend("note/1");await api.retryFailed();
  assert.deepEqual(calls.map(v=>v.path),[
    "/api/admin/notifications/note%2F1/retry",
    "/api/admin/notifications/note%2F1/cancel",
    "/api/admin/notifications/note%2F1/force-resend",
    "/api/admin/notifications/retry-failed",
  ]);
  assert.deepEqual(calls.map(v=>JSON.parse(v.init.body)),[{},{reason:"理由"},{},{}]);
});

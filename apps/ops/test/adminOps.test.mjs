import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {createAdminCostGuardApi} from "../.test-dist/apps/ops/src/api/adminCostGuard.js";
import {createAdminNotificationsApi,notificationQuery,notificationFilterHref} from "../.test-dist/apps/ops/src/api/adminNotifications.js";
import {CostGuardForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardForm.js";
import {AdminCostGuardView,changedCostGuardKeys,MODES} from "../.test-dist/apps/ops/src/routes/admin/AdminCostGuard.js";
import {CostGuardOverrideForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardOverrideForm.js";
import {CostGuardDisabledFeaturesForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardDisabledFeaturesForm.js";
import {NotificationActionButton,NOTIFICATION_CONFIRM} from "../.test-dist/apps/ops/src/routes/admin/NotificationActionButton.js";
import {NotificationCancelButton} from "../.test-dist/apps/ops/src/routes/admin/NotificationCancelButton.js";
import {NotificationPayloadButton} from "../.test-dist/apps/ops/src/routes/admin/NotificationPayloadButton.js";
import {AdminNotificationsView,readNotificationFilters} from "../.test-dist/apps/ops/src/routes/admin/AdminNotifications.js";
import {parseCostFeatures,WRITE_FEATURE_KEYS,FEATURE_LABELS} from "../.test-dist/apps/ops/src/routes/admin/costGuardFeatures.js";
import {leaveWhenAnonymous} from "../.test-dist/apps/ops/src/routes/admin/adminWrite.js";
import {formatRelative,formatUnix} from "../.test-dist/apps/ops/src/routes/admin/adminFormat.js";
import {TYPE_LABELS,STATUS_LABELS} from "../.test-dist/apps/ops/src/components/notifications/notificationDisplay.js";
import {readFileSync} from "node:fs";
const h=React.createElement;
const response=(status,data)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const settings={
  mode:"normal",isMaintenance:false,reason:null,updatedAt:null,exceptionUntil:null,
  exceptionFeaturesJson:null,disabledFeaturesJson:null,truncated:false,history:[],
};
const read=rel=>readFileSync(new URL(rel,import.meta.url),"utf8");

test("MIG-0734 T01 U01 cost writes preserve 5 exact D-17-4 paths and JSON keys",async()=>{
  const calls=[];
  const api=createAdminCostGuardApi(async(path,init)=>{calls.push({path,init});return response(200,{ok:true,message:"更新しました。"});});
  await api.setMode("economy","節約");
  await api.setMaintenance(true,"保守");
  await api.setOverride("緊急","OVERRIDE",["edit_video"]);
  await api.clearOverride("解除","CLEAR");
  await api.setDisabled("変更","APPLY",["edit_video"],'["like_or_bookmark"]');
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
    {reason:"変更",confirm:"APPLY",features:["edit_video"],expected_disabled_features_json:JSON.stringify('["like_or_bookmark"]')},
  ]);
  for(const {init} of calls){
    assert.equal(init.method,"POST");
    assert.equal(init.credentials,"same-origin");
    assert.equal(init.cache,"no-store");
    assert.equal(init.headers["content-type"],"application/json");
  }
});

test("MIG-0734 T03 409 CAS conflict body is preserved; invalid HTTP/JSON fails closed",async()=>{
  const api=createAdminCostGuardApi(async()=>response(409,{ok:false,message:"設定が別の管理者によって変更されています"}));
  assert.deepEqual(await api.setDisabled("change","APPLY",[],"[]"),{ok:false,message:"設定が別の管理者によって変更されています"});
  const malformed=createAdminCostGuardApi(async()=>new Response("oops",{status:200}));
  assert.equal((await malformed.setMode("normal","reason")).ok,false);
  assert.deepEqual(await malformed.read(),{status:"unavailable"});
});

test("MIG-0734 write guard denials keep CURRENT message (D-17-3 send); 401 without body leaves for /entry",async()=>{
  const guard={ok:false,reason:"cost_guard_blocked",message:"現在、この機能の書き込みは一時的に無効化されています。"};
  const notifications=createAdminNotificationsApi(async()=>response(403,guard));
  assert.deepEqual(await notifications.retry("n1"),{ok:false,message:guard.message});
  const cost=createAdminCostGuardApi(async()=>response(403,{ok:false,reason:"maintenance_mode",message:"メンテナンス中です。"}));
  assert.deepEqual(await cost.setMode("normal","r"),{ok:false,message:"メンテナンス中です。"});
  const anonymous=createAdminCostGuardApi(async()=>response(401,{error:"unauthenticated"}));
  const result=await anonymous.setMode("normal","r");
  assert.equal(result.ok,false);
  assert.equal(result.anonymous,true);
  const assigned=[];
  assert.equal(leaveWhenAnonymous(result,url=>assigned.push(url)),true);
  assert.deepEqual(assigned,["/entry"]);
  // Hono writeGuardDenyBody sends a JSON `ok:false` on 401. D-17-3 send()
  // accepts this as a result body rather than the anonymous transport variant.
  const guard401={ok:false,reason:"unauthenticated",message:"ログインが必要です。"};
  const expiredCost=createAdminCostGuardApi(async()=>response(401,guard401));
  const expiredCostResult=await expiredCost.setMode("normal","r");
  assert.deepEqual(expiredCostResult,{ok:false,message:guard401.message,anonymous:true});
  const expiredNotifications=createAdminNotificationsApi(async()=>response(401,guard401));
  const expiredNotificationResult=await expiredNotifications.retry("n1");
  assert.deepEqual(expiredNotificationResult,{ok:false,message:guard401.message,anonymous:true});
  assert.equal(leaveWhenAnonymous(expiredNotificationResult,url=>assigned.push(url)),true);
  assert.deepEqual(assigned,["/entry","/entry"]);
  assert.equal(leaveWhenAnonymous({ok:false,message:"x"},url=>assigned.push(url)),false);
  const unavailable=createAdminCostGuardApi(async()=>{throw new Error("offline");});
  assert.deepEqual(await unavailable.setMode("normal","r"),{ok:false,message:"通信エラーが発生しました。"});
});

test("MIG-0734 reads use D-17-2 getJson: 401 anonymous, 403 redirect, 404 and 501 mapped",async()=>{
  const filters=readNotificationFilters(new URLSearchParams());
  const statusOf=async status=>(await createAdminNotificationsApi(async()=>response(status,{redirect:"/dashboard",reason:"admin_required"})).list(filters));
  assert.deepEqual(await statusOf(401),{status:"anonymous"});
  assert.deepEqual(await statusOf(403),{status:"forbidden",redirect:"/dashboard",reason:"admin_required"});
  assert.deepEqual(await statusOf(404),{status:"notFound"});
  assert.deepEqual(await statusOf(501),{status:"unsupported"});
  assert.deepEqual(await statusOf(500),{status:"unavailable"});
  const cost=createAdminCostGuardApi(async()=>response(403,{redirect:"/entry"}));
  assert.deepEqual(await cost.read(),{status:"forbidden",redirect:"/entry"});
  const invalid=createAdminCostGuardApi(async()=>response(200,{mode:1}));
  assert.deepEqual(await invalid.read(),{status:"unavailable"});
  const ok=createAdminCostGuardApi(async()=>response(200,settings));
  assert.equal((await ok.read()).status,"ok");
});

test("MIG-0734 cost feature allowlist remains byte-identical to CURRENT core",()=>{
  const current=read("../../../packages/domain/src/admin/costGuard.ts");
  const span=current.match(/export const WRITE_FEATURE_KEYS = \[([\s\S]*?)\] as const/);
  assert.ok(span,"CURRENT feature list missing");
  const expected=[...span[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
  assert.deepEqual(WRITE_FEATURE_KEYS,expected);
  assert.deepEqual(parseCostFeatures('["edit_video","edit_video"]'),{features:["edit_video"],malformed:false});
  assert.equal(parseCostFeatures('["unrecognized"]').malformed,true);
});

test("MIG-0734 FEATURE_LABELS and notification labels match CURRENT sources",()=>{
  const form=read("../../../src/components/admin/CostGuardDisabledFeaturesForm.tsx");
  const block=form.match(/const FEATURE_LABELS[^=]*= \{([\s\S]*?)\n\};/)[1];
  const expected=Object.fromEntries([...block.matchAll(/(\w+): "([^"]+)"/g)].map(m=>[m[1],m[2]]));
  assert.deepEqual(FEATURE_LABELS,expected);
  const types=read("../../../src/lib/notifications/types.ts");
  const labels=types.match(/const TYPE_LABELS[^=]*= \{([\s\S]*?)\n\};/)[1];
  assert.deepEqual(TYPE_LABELS,Object.fromEntries([...labels.matchAll(/(\w+): "([^"]+)"/g)].map(m=>[m[1],m[2]])));
  const display=read("../../../src/lib/notifications/display.ts");
  const statuses=display.match(/const STATUS_LABELS[^=]*= \{([\s\S]*?)\n\};/)[1];
  assert.deepEqual(STATUS_LABELS,Object.fromEntries([...statuses.matchAll(/(\w+): "([^"]+)"/g)].map(m=>[m[1],m[2]])));
});

test("MIG-0734 MODES descriptions match CURRENT cost-guard page",()=>{
  const page=read("../../../app/(admin)/admin/cost-guard/page.tsx");
  for(const mode of MODES){
    assert.ok(page.includes(`description: "${mode.description}"`),mode.value);
    assert.ok(page.includes(`badge: "${mode.badge}"`),mode.value);
  }
});

test("MIG-0734 U01 server markup keeps OVERRIDE/CLEAR/APPLY disabled until token",()=>{
  const api=createAdminCostGuardApi(async()=>response(500,{})),refresh=()=>{};
  const text=renderToStaticMarkup(h(React.Fragment,null,
    h(CostGuardOverrideForm,{settings,api,onSuccess:refresh}),
    h(CostGuardDisabledFeaturesForm,{settings,api,onSuccess:refresh})));
  assert.match(text,/15分有効化/);
  assert.match(text,/placeholder="OVERRIDE"/);
  assert.match(text,/placeholder="APPLY"/);
  assert.match(text,/枠なし作品の投稿/);
  assert.match(text,/disabled=""/);
  const active=renderToStaticMarkup(h(CostGuardOverrideForm,{settings:{...settings,exceptionUntil:4102444800,exceptionFeaturesJson:'["edit_video"]'},api,onSuccess:refresh}));
  assert.match(active,/placeholder="有効化はOVERRIDE、解除はCLEAR"/);
  assert.match(active,/状態: 有効（/);
  assert.match(active,/\/ \[&quot;edit_video&quot;\]/);
});

async function inDom(callback){
  const dom=new JSDOM("<!doctype html><div id='root'></div>",{url:"https://flamenode.test/admin/cost-guard"});
  const keys=["window","document","Element","HTMLElement","Node","CustomEvent","navigator","KeyboardEvent","FormData"];
  const prior=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;
  for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:dom.window[k]});
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const {createRoot}=await import("react-dom/client");
  const root=createRoot(dom.window.document.getElementById("root"));
  try{await callback(dom,root);}finally{
    await React.act(async()=>root.unmount());
    for(const [k,descriptor] of prior){if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}
    globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;
    dom.window.close();
  }
}
const buttons=dom=>[...dom.window.document.querySelectorAll("button")];
const byText=(dom,text)=>buttons(dom).find(b=>b.textContent===text);
const type=async(dom,input,value)=>{
  const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set;
  await React.act(async()=>{setter.call(input,value);input.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});
};

test("MIG-0734 T01 maintenance ON uses ConfirmDialog and writes only after confirm; OFF has no dialog",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={setMode:async()=>({ok:true}),setMaintenance:async(enabled)=>{calls.push(enabled);return {ok:true};}};
    const settingsCopy={...settings,reason:"検証"};
    dom.window.confirm=()=>{throw Error("window.confirm must not be used for maintenance");};
    await React.act(async()=>root.render(h(CostGuardForm,{settings:settingsCopy,api,onSuccess:()=>{}})));
    await React.act(async()=>byText(dom,"ONにする").click());
    const dialog=dom.window.document.querySelector('[role="alertdialog"]');
    assert.ok(dialog,"ConfirmDialog opens");
    assert.match(dialog.textContent,/メンテナンスモードをONにする/);
    assert.match(dialog.textContent,/一般ユーザーの通常操作を停止します。理由と監査記録を確認して続行してください。/);
    assert.deepEqual(calls,[]);
    await React.act(async()=>byText(dom,"キャンセル").click());
    assert.equal(dom.window.document.querySelector('[role="alertdialog"]'),null);
    assert.deepEqual(calls,[]);
    await React.act(async()=>byText(dom,"ONにする").click());
    await React.act(async()=>dom.window.document.querySelector('[role="alertdialog"]').querySelector(".fn-btn-danger").click());
    assert.deepEqual(calls,[true]);
    await React.act(async()=>root.render(h(CostGuardForm,{settings:{...settingsCopy,isMaintenance:true},api,onSuccess:()=>{}})));
    await React.act(async()=>byText(dom,"OFFにする").click());
    assert.equal(dom.window.document.querySelector('[role="alertdialog"]'),null);
    assert.deepEqual(calls,[true,false]);
  });
});

test("MIG-0734 T01 maintenance and mode need a reason; failed write shows the server message and keeps the form",async()=>{
  await inDom(async(dom,root)=>{
    let refreshed=0;
    const api={setMode:async()=>({ok:false,message:"現在、この機能の書き込みは一時的に無効化されています。"}),setMaintenance:async()=>({ok:true})};
    await React.act(async()=>root.render(h(CostGuardForm,{settings,api,onSuccess:()=>{refreshed++;}})));
    assert.equal(byText(dom,"モードを更新").disabled,true);
    assert.equal(byText(dom,"ONにする").disabled,true);
    await type(dom,dom.window.document.querySelector("input"),"理由");
    await React.act(async()=>byText(dom,"省エネ").click());
    await React.act(async()=>byText(dom,"モードを更新").click());
    assert.match(dom.window.document.querySelector('[role="status"]').textContent,/一時的に無効化/);
    assert.equal(refreshed,0);
  });
});

test("MIG-0734 T01 maintenance cannot submit an invalid SA-016 manual mode",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={
      setMode:async(mode,reason)=>{calls.push({mode,reason});return {ok:true};},
      setMaintenance:async()=>({ok:true}),
    };
    const duringMaintenance={...settings,mode:"maintenance",isMaintenance:true,reason:"保守中"};
    await React.act(async()=>root.render(h(CostGuardForm,{settings:duringMaintenance,api,onSuccess:()=>{}})));
    const update=byText(dom,"モードを更新");
    assert.equal(update.disabled,true,"maintenance must not be passed to the four-mode write API");
    assert.match(dom.window.document.querySelector('[role="status"]').textContent,/手動モードを選択/);
    assert.equal(byText(dom,"OFFにする").disabled,false,"the dedicated maintenance-off path remains available");
    await React.act(async()=>update.click());
    assert.deepEqual(calls,[]);
    await React.act(async()=>byText(dom,"通常").click());
    assert.equal(update.disabled,false,"explicit valid manual mode should re-enable the operation");
    await React.act(async()=>update.click());
    assert.deepEqual(calls,[{mode:"normal",reason:"保守中"}]);
  });
});

test("MIG-0734 T02 override and clear never send until the exact token is typed",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={
      setOverride:async(reason,confirm,features)=>{calls.push({kind:"set",reason,confirm,features});return {ok:true};},
      clearOverride:async(reason,confirm)=>{calls.push({kind:"clear",reason,confirm});return {ok:true};},
    };
    await React.act(async()=>root.render(h(CostGuardOverrideForm,{settings,api,onSuccess:()=>{}})));
    const [reason,confirm]=dom.window.document.querySelectorAll("input[type=text],input:not([type])");
    await type(dom,reason,"緊急対応");
    await React.act(async()=>dom.window.document.querySelector("input[type=checkbox]").click());
    await type(dom,confirm,"override");
    assert.equal(byText(dom,"15分有効化").disabled,true);
    await React.act(async()=>byText(dom,"15分有効化").click());
    assert.deepEqual(calls,[]);
    await type(dom,confirm,"OVERRIDE");
    assert.equal(byText(dom,"15分有効化").disabled,false);
    assert.equal(byText(dom,"即時解除").disabled,true);
    await React.act(async()=>byText(dom,"15分有効化").click());
    assert.deepEqual(calls,[{kind:"set",reason:"緊急対応",confirm:"OVERRIDE",features:["post_video_unslotted"]}]);
  });
});

test("MIG-0734 T03 disabled-features form sends the rendered value as the CAS token and surfaces a 409",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={setDisabled:async(reason,confirm,features,expected)=>{calls.push({reason,confirm,features,expected});return {ok:false,message:"設定が別の管理者によって変更されています"};}};
    const withDisabled={...settings,disabledFeaturesJson:'["edit_video"]'};
    await React.act(async()=>root.render(h(CostGuardDisabledFeaturesForm,{settings:withDisabled,api,onSuccess:()=>{}})));
    const inputs=[...dom.window.document.querySelectorAll("input:not([type=checkbox])")];
    await type(dom,inputs[0],"変更理由");
    await type(dom,inputs[1],"APPLY");
    await React.act(async()=>byText(dom,"無効化設定を保存").click());
    assert.deepEqual(calls,[{reason:"変更理由",confirm:"APPLY",features:["edit_video"],expected:'["edit_video"]'}]);
    assert.match(dom.window.document.querySelector('[role="status"]').textContent,/別の管理者によって変更/);
    assert.equal(inputs[0].value,"変更理由","reason is kept after a failed write");
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
    assert.equal(NOTIFICATION_CONFIRM["bulk-retry"],"failed 通知をまとめてリトライしますか? (上限 10 件)");
  });
});

test("MIG-0734 notification actions: retry needs no confirm, failed write is an alert, bulk success shows the message",async()=>{
  await inDom(async(dom,root)=>{
    let refreshed=0;
    dom.window.confirm=()=>true;
    const failing={retry:async()=>({ok:false,message:"対象の通知は再試行できません。"}),retryFailed:async()=>({ok:true,message:"3件をリトライしました。"})};
    await React.act(async()=>root.render(h("div",null,
      h(NotificationActionButton,{api:failing,kind:"retry",id:"n1",onSuccess:()=>{refreshed++;}}),
      h(NotificationActionButton,{api:failing,kind:"bulk-retry",onSuccess:()=>{refreshed++;}}))));
    await React.act(async()=>byText(dom,"再試行").click());
    assert.match(dom.window.document.querySelector('[role="alert"]').textContent,/再試行できません/);
    assert.equal(refreshed,0);
    await React.act(async()=>byText(dom,"failed を一括リトライ (上限 10)").click());
    assert.match(dom.window.document.querySelector('[role="status"]').textContent,/3件をリトライしました/);
    assert.equal(refreshed,1);
  });
});

test("MIG-0734 notification cancel sends the reason (optional) and keeps the dialog open on failure",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={cancel:async(id,reason)=>{calls.push({id,reason});return {ok:false,message:"キャンセルできません。"};}};
    await React.act(async()=>root.render(h(NotificationCancelButton,{id:"n1",api,onSuccess:()=>{}})));
    await React.act(async()=>byText(dom,"キャンセル").click());
    await type(dom,dom.window.document.querySelector("input"),"重複");
    await React.act(async()=>byText(dom,"確定").click());
    assert.deepEqual(calls,[{id:"n1",reason:"重複"}]);
    assert.match(dom.window.document.querySelector('[role="status"]').textContent,/キャンセルできません/);
    assert.ok(byText(dom,"確定"),"form stays open");
  });
});

test("MIG-0734 notification payload dialog traps Tab and restores trigger focus on Escape and close",async()=>{
  await inDom(async(dom,root)=>{
    await React.act(async()=>root.render(h(NotificationPayloadButton,{payload:'{"content":"test"}'})));
    const trigger=byText(dom,"payload");
    trigger.focus();
    await React.act(async()=>trigger.click());
    assert.ok(dom.window.document.querySelector('[role="dialog"][aria-modal="true"]'));
    const close=byText(dom,"閉じる");
    assert.equal(dom.window.document.activeElement,close,"dialog close receives initial focus");
    const tab=new dom.window.KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true});
    await React.act(async()=>close.dispatchEvent(tab));
    assert.equal(tab.defaultPrevented,true,"Tab cannot leave the modal");
    assert.equal(dom.window.document.activeElement,close);
    const shiftTab=new dom.window.KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true});
    await React.act(async()=>close.dispatchEvent(shiftTab));
    assert.equal(shiftTab.defaultPrevented,true,"Shift+Tab cannot leave the modal");
    await React.act(async()=>dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})
    ));
    assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
    assert.equal(dom.window.document.activeElement,trigger,"Escape restores the invoking button");
    await React.act(async()=>trigger.click());
    await React.act(async()=>byText(dom,"閉じる").click());
    assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
    assert.equal(dom.window.document.activeElement,trigger,"close restores the invoking button");
  });
});

test("MIG-0734 T05 failed status is sent to Hono unchanged (backend includes failed + dead_letter)",async()=>{
  const filters=readNotificationFilters(new URLSearchParams("status=failed&type=x_id_approved&cat=x_id&q="+("x".repeat(110))));
  assert.deepEqual(filters,{status:"failed",cat:"x_id",type:"x_id_approved",event:"",q:"x".repeat(100)});
  assert.equal(notificationQuery(filters),"status=failed&cat=x_id&type=x_id_approved&q="+("x".repeat(100)));
  assert.equal(notificationFilterHref(filters),"/admin/notifications?status=failed&type=x_id_approved&q="+("x".repeat(100))+"&cat=x_id");
  assert.equal(notificationFilterHref({status:"all",cat:"all",type:"",event:"",q:""}),"/admin/notifications");
  assert.equal(readNotificationFilters(new URLSearchParams("status=bogus&cat=bogus")).status,"all");
  const calls=[];
  const api=createAdminNotificationsApi(async(path,init)=>{calls.push({path,init});return response(500,{});});
  assert.deepEqual(await api.list(filters),{status:"unavailable"});
  assert.match(calls[0].path,/status=failed/);
  assert.equal(calls[0].init.credentials,"same-origin");
});

test("MIG-0734 U02 notifications four actions use D-17-4 paths and send no body except cancel",async()=>{
  const calls=[];
  const api=createAdminNotificationsApi(async(path,init)=>{calls.push({path,init});return response(200,{ok:true});});
  await api.retry("note/1");await api.cancel("note/1","理由");await api.forceResend("note/1");await api.retryFailed();
  assert.deepEqual(calls.map(v=>v.path),[
    "/api/admin/notifications/note%2F1/retry",
    "/api/admin/notifications/note%2F1/cancel",
    "/api/admin/notifications/note%2F1/force-resend",
    "/api/admin/notifications/retry-failed",
  ]);
  assert.deepEqual(calls.map(v=>v.init.body===undefined?undefined:JSON.parse(v.init.body)),[undefined,{reason:"理由"},undefined,undefined]);
  assert.ok(calls.every(v=>v.init.method==="POST"&&v.init.credentials==="same-origin"));
});

test("MIG-0734 U01 audit history changed keys remains compatible with CURRENT",()=>{
 assert.deepEqual(changedCostGuardKeys('{"mode":"normal","reason":"before"}','{"mode":"economy","reason":"after"}'),["mode","reason"]);
 assert.deepEqual(changedCostGuardKeys('{"mode":"normal"}','{"mode":"normal"}'),[]);
 assert.deepEqual(changedCostGuardKeys("not-json",'{"mode":"normal"}'),[]);
 assert.deepEqual(changedCostGuardKeys(null,'{"mode":"normal"}'),["mode"]);
});

test("MIG-0734 U03 cost-guard bodies go through shared contract schemas and fail closed when invalid",async()=>{
  const calls=[];
  const api=createAdminCostGuardApi(async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return response(200,{ok:true});});
  assert.deepEqual(await api.setMode("normal","r"),{ok:true});
  assert.deepEqual(calls[0],{url:"/api/admin/cost-guard/mode",body:{mode:"normal",reason:"r"}});
  assert.equal((await api.setMode(undefined,"r")).ok,false);
  assert.equal((await api.clearOverride(null,"CLEAR")).ok,false);
  assert.equal(calls.length,1);
  const sent=[];
  const notifications=createAdminNotificationsApi(async(url,init)=>{sent.push(init.body);return response(200,{ok:true});});
  await notifications.cancel("n1","");
  assert.deepEqual(sent.map(v=>JSON.parse(v)),[{reason:""}]);
});

test("MIG-0734 cost-guard view ports CURRENT status badges, updatedAt, mode descriptions and history",()=>{
  const api=createAdminCostGuardApi(async()=>response(500,{}));
  const data={...settings,mode:"maintenance",isMaintenance:true,updatedAt:1700000000,history:[
    {id:"a1",created_at:1700000000,actor_user_id:"u/1",target_id:"cost_guard",before_json:'{"mode":"normal"}',after_json:'{"mode":"economy","reason":"x"}'},
    {id:"a2",created_at:1700000100,actor_user_id:"",target_id:"",before_json:'{"a":1}',after_json:'{"a":1}'},
  ]};
  const text=renderToStaticMarkup(h(MemoryRouter,null,h(AdminCostGuardView,{data,api,onSuccess:()=>{}})));
  assert.match(text,/class="fn-console-title">コストガード</);
  assert.match(text,/fn-badge fn-badge-danger">mode: maintenance</);
  assert.match(text,/メンテナンス: ON/);
  assert.match(text,/最終更新: /);
  assert.match(text,/モードの説明:/);
  assert.match(text,/<strong>静的のみ<\/strong> \(static_only\)/);
  assert.match(text,/変更履歴 \(直近 20 件\)/);
  assert.match(text,/href="\/admin\/users\/u%2F1"/);
  assert.match(text,/mode, reason/);
  assert.match(text,/href="\/admin\/audit\?table=system_settings&amp;record=cost_guard"/);
  assert.match(text,/変更なし/);
  const empty=renderToStaticMarkup(h(MemoryRouter,null,h(AdminCostGuardView,{data:settings,api,onSuccess:()=>{}})));
  assert.match(empty,/まだ system_settings の変更履歴はありません。/);
  assert.doesNotMatch(empty,/最終更新/);
});

const row=(over={})=>({
  id:"n1",type:"x_id_approved",status:"failed",payload_json:JSON.stringify({content:"承認しました\n詳細"}),event_id:"evt_abcdefghijkl",
  recipient_user_id:"u1",attempt_count:4,next_attempt_at:null,created_at:1700000000,last_error:"discord_recipient_missing",dedupe_key:"dk-1",
  recipient:{userId:"u1",discordId:"d-9",userName:"花子",notificationsEnabled:false},...over,
});
const notificationData=(over={},counts={})=>({
  status:"all",category:"all",truncated:false,error:null,rows:[row()],
  counts:{pending:0,processing:0,failed:1,deadLetter:1,unhealthyLease:0,...counts},...over,
});
const filtersOf=(query="")=>readNotificationFilters(new URLSearchParams(query));
const renderNotifications=(data,query="")=>{
  const api=createAdminNotificationsApi(async()=>response(500,{}));
  return renderToStaticMarkup(h(MemoryRouter,null,h(AdminNotificationsView,{data,filters:filtersOf(query),api,onSuccess:()=>{}})));
};

test("MIG-0734 SPA navigation resets uncontrolled notification filter fields",async()=>{
  await inDom(async(dom,root)=>{
    const api=createAdminNotificationsApi(async()=>response(500,{}));
    const data=notificationData({rows:[]},{failed:0,deadLetter:0});
    const render=async(query)=>{
      await React.act(async()=>root.render(h(MemoryRouter,null,h(AdminNotificationsView,{
        data,filters:filtersOf(query),api,onSuccess:()=>{}
      }))));
    };
    await render("status=failed&type=old-type&event=old-event&cat=x_id&q=old-query");
    const field=name=>dom.window.document.querySelector(`[name="${name}"]`);
    assert.equal(field("type").value,"old-type");
    assert.equal(field("event").value,"old-event");
    assert.equal(field("cat").value,"x_id");
    assert.equal(field("q").value,"old-query");
    // Typing an unsubmitted draft must not survive a URL change to a different query.
    field("type").value="unsaved-edit";
    await render("status=pending&type=new-type&event=new-event&cat=all&q=new-query");
    assert.equal(field("type").value,"new-type");
    assert.equal(field("event").value,"new-event");
    assert.equal(field("cat").value,"all");
    assert.equal(field("q").value,"new-query");
    await render("");
    assert.equal(field("type").value,"");
    assert.equal(field("event").value,"");
    assert.equal(field("cat").value,"all");
    assert.equal(field("q").value,"");
  });
});

test("MIG-0734 D-17-7 category auto-filter uses SPA URL state and retains draft GET fields",async()=>{
  await inDom(async(dom,root)=>{
    const queries=[];
    const api=createAdminNotificationsApi(async()=>response(500,{}));
    const data=notificationData({rows:[]},{failed:0,deadLetter:0});
    await React.act(async()=>root.render(h(MemoryRouter,null,h(AdminNotificationsView,{
      data,filters:filtersOf("status=failed&type=old&event=evt-1&q=query&cat=all"),
      api,onSuccess:()=>{},onSearch:next=>queries.push(next.toString()),
    }))));
    const field=name=>dom.window.document.querySelector(`[name="${name}"]`);
    // Category changes must call useSearchParams instead of AutoSubmitSelect's
    // navigateGetForm/window.location.assign (which reloads the entire Ops SPA).
    field("type").value="draft-type";
    await React.act(async()=>{
      field("cat").value="x_id";
      field("cat").dispatchEvent(new dom.window.Event("change",{bubbles:true}));
    });
    assert.equal(queries.length,1,"category change must use the SPA query callback");
    const next=new URLSearchParams(queries[0]);
    assert.equal(next.get("status"),"failed");
    assert.equal(next.get("cat"),"x_id");
    assert.equal(next.get("type"),"draft-type");
    assert.equal(next.get("event"),"evt-1");
    assert.equal(next.get("q"),"query");

    // Explicit GET form submits still share exactly the same query contract.
    const form=dom.window.document.querySelector('form[role="search"]');
    await React.act(async()=>form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(queries.length,2);
    assert.equal(queries[1],queries[0]);
  });
});

test("MIG-0734 notifications view ports CURRENT row content: recipient, summary, labels, tab counts, links",()=>{
  const text=renderNotifications(notificationData());
  assert.match(text,/class="fn-console-title">通知配信状況</);
  assert.match(text,/直近の一括再試行履歴を見る →/);
  assert.match(text,/宛先: 花子 \(d-9\)/);
  assert.match(text,/discord_id: d-9/);
  assert.match(text,/（通知OFF）/);
  assert.match(text,/X ID が承認されました/);
  assert.match(text,/DM（Bot）/);
  assert.match(text,/重複防止キー: dk-1/);
  assert.match(text,/宛先ユーザーの Discord ID が未連携のため/);
  assert.match(text,/最終失敗 \(2\)/);
  assert.match(text,/配信待ち \(0\)/);
  assert.match(text,/href="\/manage\/events\/evt_abcdefghijkl"/);
  assert.match(text,/evt_abcdef…/);
  assert.match(text,/href="\/admin\/audit\?table=notification_outbox&amp;record=n1"/);
  assert.match(text,/失敗 1 件 \/ dead_letter 1 件/);
  assert.match(text,/failed を一括リトライ \(上限 10\)/);
  assert.match(text,/再試行/);
  assert.match(text,/強制再送/);
  assert.match(text,/通知 n1 をキャンセル/);
  assert.match(text,/<option value="x_id">X ID<\/option>/);
});

test("MIG-0734 notifications alerts follow CURRENT precedence; bulk-retry is hidden while leases are unhealthy",()=>{
  const lease=renderNotifications(notificationData({},{unhealthyLease:2}));
  assert.match(lease,/配送リース期限超過・欠損 2 件/);
  assert.doesNotMatch(lease,/一括リトライ/);
  const pending=renderNotifications(notificationData({rows:[row({status:"pending"})]},{failed:0,deadLetter:0,pending:3}));
  assert.match(pending,/fn-alert--warn/);
  assert.match(pending,/配信待ち <strong>3 件<\/strong>/);
  const clear=renderNotifications(notificationData({rows:[row({status:"sent"})]},{failed:0,deadLetter:0}));
  assert.match(clear,/現在、失敗・滞留はありません。/);
  assert.match(clear,/強制再送/);
  assert.doesNotMatch(clear,/>再試行</);
  assert.doesNotMatch(clear,/をキャンセル/);
});

test("MIG-0734 notifications empty state, clear-filters link and error alert match CURRENT",()=>{
  const empty=renderNotifications(notificationData({rows:[]},{failed:0,deadLetter:0}),"status=failed&type=t1&cat=x_id");
  assert.match(empty,/失敗通知はありません/);
  assert.match(empty,/現在、最終失敗状態の通知はありません。/);
  assert.match(empty,/フィルタを解除/);
  assert.match(empty,/最終失敗を見る/);
  assert.match(empty,/管理ダッシュボードへ/);
  assert.match(empty,/詳細条件をクリア/);
  assert.match(empty,/href="\/admin\/notifications\?status=failed"/);
  assert.match(empty,/<input type="hidden" name="status" value="failed"\/>/);
  const none=renderNotifications(notificationData({rows:[]},{failed:0,deadLetter:0}));
  assert.match(none,/通知ログはありません/);
  assert.doesNotMatch(none,/詳細条件をクリア/);
  assert.doesNotMatch(none,/フィルタを解除/);
  const err=renderNotifications(notificationData({error:"query_failed",rows:[]},{failed:0,deadLetter:0}));
  assert.match(err,/role="alert"[^>]*>エラー: 通知ログの取得に失敗しました/);
  assert.doesNotMatch(err,/通知ログはありません/);
});

test("MIG-0734 formatRelative and formatUnix match CURRENT format.ts",()=>{
  const now=1700000000*1000;
  assert.equal(formatRelative(1700000000-30,now),"今");
  assert.equal(formatRelative(1700000000-300,now),"5分前");
  assert.equal(formatRelative(1700000000-7200,now),"2時間前");
  assert.equal(formatRelative(1700000000-86400*3,now),"3日前");
  assert.equal(formatRelative(null,now),"");
  assert.equal(formatUnix(null),"-");
  assert.match(formatUnix(1700000000),/2023\/11\/15 07:13/);
});

test("MIG-0734 router mounts cost-guard and notifications inside the OpsGate-guarded admin frame",()=>{
  const src=read("../src/routes/router.tsx");
  assert.match(src,/<Route path="\/admin" element=\{adminFrame\}>[\s\S]*path="cost-guard"[\s\S]*path="notifications"/);
  const layout=read("../src/routes/admin/AdminLayout.tsx");
  assert.match(layout,/<OpsGate surface="admin"/);
});

test("MIG-0734 screens use the shared D-17-2/3/6 parts instead of private copies",()=>{
  const files=["api/adminCostGuard.ts","api/adminNotifications.ts"];
  for(const f of files)assert.match(read("../src/"+f),/from "\.\/(read|write)\.js"/,f);
  for(const f of ["routes/admin/AdminCostGuard.tsx","routes/admin/AdminNotifications.tsx"])assert.match(read("../src/"+f),/useApiResult/,f);
  const notifications=read("../src/routes/admin/AdminNotifications.tsx");
  for(const part of ["ConsolePageHeader","FnTable","EmptyState","OpsLink"])assert.match(notifications,new RegExp(part),part);
  assert.match(notifications,/submitFilters\(event\.currentTarget\.form\)/);
  assert.doesNotMatch(notifications,/AutoSubmitSelect/);
  const cost=read("../src/routes/admin/AdminCostGuard.tsx");
  for(const part of ["ConsolePageHeader","FnTable","OpsLink"])assert.match(cost,new RegExp(part),part);
  assert.match(read("../src/routes/admin/CostGuardForm.tsx"),/ConfirmDialog/);
  assert.doesNotMatch(read("../src/routes/admin/CostGuardForm.tsx"),/window\.confirm/);
  assert.doesNotMatch(cost,/<a href/);
});


test("MIG-0734 regression: bulk-retry prompt matches the Hono SA-048 batch cap", () => {
  // The API owns D1 atomic-batch size. The Ops UI must not promise more.
  const apiSource = read("../../api/src/routes/admin/notifications.ts");
  const cap = apiSource.match(/export const BULK_RETRY_MAX\s*=\s*(\d+)/);
  assert.ok(cap, "Hono notification bulk limit is not declared");
  const max = Number(cap[1]);
  assert.equal(NOTIFICATION_CONFIRM["bulk-retry"],
    `failed 通知をまとめてリトライしますか? (上限 ${max} 件)`);
  const html = renderToStaticMarkup(h(NotificationActionButton, {
    kind: "bulk-retry", api: createAdminNotificationsApi(async () => response(500, {})),
    onSuccess: () => {},
  }));
  assert.ok(html.includes(`一括リトライ (上限 ${max})`), "rendered button must use the API limit");
});


test("MIG-0734 regression: admin retry messaging matches Hono's no-wake behavior", () => {
  const hono = read("../../api/src/routes/admin/notifications.ts");
  assert.match(hono, /this Worker never wakes/);
  const html = renderNotifications(
    notificationData({ rows: [row({ status: "pending" })] }, { failed: 0, deadLetter: 0, pending: 3 }),
  );
  assert.match(html, /管理者の再試行・強制再送・一括再試行はQueue wakeを送信せず/);
  assert.match(html, /管理者操作はQueue wakeなし/);
  assert.match(html, /毎時 Recovery Cron/);
  assert.doesNotMatch(html, /Queue wake で即時起動/);
});

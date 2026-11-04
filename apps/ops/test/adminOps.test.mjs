import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { JSDOM } from "jsdom";

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {createAdminCostGuardApi} from "../.test-dist/apps/ops/src/api/adminCostGuard.js";
import {createAdminNotificationsApi,notificationQuery,notificationFilterHref} from "../.test-dist/apps/ops/src/api/adminNotifications.js";
import {CostGuardForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardForm.js";
import {AdminCostGuard,AdminCostGuardView,changedCostGuardKeys,MODES} from "../.test-dist/apps/ops/src/routes/admin/AdminCostGuard.js";
import {CostGuardOverrideForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardOverrideForm.js";
import {CostGuardDisabledFeaturesForm} from "../.test-dist/apps/ops/src/routes/admin/CostGuardDisabledFeaturesForm.js";
import {NotificationActionButton,NOTIFICATION_CONFIRM} from "../.test-dist/apps/ops/src/routes/admin/NotificationActionButton.js";
import {NotificationCancelButton} from "../.test-dist/apps/ops/src/routes/admin/NotificationCancelButton.js";
import {NotificationPayloadButton} from "../.test-dist/apps/ops/src/routes/admin/NotificationPayloadButton.js";
import {AdminNotifications,AdminNotificationsView,readNotificationFilters} from "../.test-dist/apps/ops/src/routes/admin/AdminNotifications.js";
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
  const keys=["window","document","Element","HTMLElement","Node","CustomEvent","navigator","KeyboardEvent","CompositionEvent","FormData","ResizeObserver"];
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

test("MIG-0734 T01 stale maintenance confirmation is invalidated on an external settings refresh",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={
      setMode:async()=>({ok:true}),
      setMaintenance:async(enabled,reason)=>{calls.push({enabled,reason});return {ok:true};},
    };
    const initial={...settings,reason:"担当者の確認",updatedAt:100};
    const render=async(next)=>React.act(async()=>root.render(h(CostGuardForm,{
      settings:next,api,onSuccess:()=>{},
    })));
    await render(initial);
    await React.act(async()=>byText(dom,"ONにする").click());
    assert.ok(dom.window.document.querySelector('[role="alertdialog"]'),"confirmation opened");

    // Another administrator changed the mode while our dialog remained open.
    // Neither the previous confirmation nor its reason may authorize that new state.
    await render({...initial,mode:"economy",updatedAt:101});
    assert.equal(dom.window.document.querySelector('[role="alertdialog"]'),null,
      "external state refresh closes the stale dialog");
    assert.deepEqual(calls,[],"no stale maintenance write");
    await React.act(async()=>byText(dom,"ONにする").click());
    const fresh=dom.window.document.querySelector('[role="alertdialog"]');
    assert.ok(fresh,"new operator confirmation is possible after refresh");
    await React.act(async()=>fresh.querySelector(".fn-btn-danger").click());
    assert.deepEqual(calls,[{enabled:true,reason:"担当者の確認"}]);

    // A concurrent maintenance-ON also invalidates a pending ON confirmation.
    await render({...initial,mode:"maintenance",isMaintenance:true,updatedAt:102});
    assert.equal(dom.window.document.querySelector('[role="alertdialog"]'),null);
    assert.equal(byText(dom,"OFFにする").disabled,false);
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

test("MIG-0734 T02 external override refresh invalidates old OVERRIDE and CLEAR intent",async()=>{
  for (const priorToken of ["OVERRIDE","CLEAR"]) {
    await inDom(async(dom,root)=>{
      const calls=[];
      const api={
        setOverride:async(reason,confirm,features)=>{
          calls.push({kind:"set",reason,confirm,features});return {ok:true};
        },
        clearOverride:async(reason,confirm)=>{
          calls.push({kind:"clear",reason,confirm});return {ok:true};
        },
      };
      const render=(until,features)=>h(CostGuardOverrideForm,{
        settings:{...settings,exceptionUntil:until,exceptionFeaturesJson:features},
        api,onSuccess:()=>{},
      });
      await React.act(async()=>root.render(render(4102444800,'["edit_video"]')));
      const reason=dom.window.document.querySelector('[aria-label="override理由"]');
      const confirm=dom.window.document.querySelector('[aria-label="確認文字列"]');
      const checked=dom.window.document.querySelector('input[type="checkbox"]');
      const activate=byText(dom,"15分有効化"),clear=byText(dom,"即時解除");
      await type(dom,reason,"旧設定を変更する理由");
      await type(dom,confirm,priorToken);
      await React.act(async()=>checked.click());
      const oldButton=priorToken==="OVERRIDE"?activate:clear;
      assert.equal(oldButton.disabled,false,priorToken+" old snapshot was confirmed");

      // Another admin has changed both the expiry and protected feature set.
      await React.act(async()=>root.render(render(4102444860,'["like_or_bookmark"]')));
      assert.equal(reason.value,"","old rationale must be invalidated");
      assert.equal(confirm.value,"","old confirmation must be invalidated");
      assert.equal(checked.checked,false,"old feature selection must be invalidated");
      assert.equal(activate.disabled,true);
      assert.equal(clear.disabled,true);
      await React.act(async()=>oldButton.click());
      assert.deepEqual(calls,[],"a stale "+priorToken+" cannot mutate a newly refreshed override");

      // A deliberate confirmation against the *new* snapshot still works.
      await type(dom,reason,"新設定を確認して操作");
      await type(dom,confirm,priorToken);
      if(priorToken==="OVERRIDE"){
        assert.equal(activate.disabled,true,"OVERRIDE needs freshly chosen features");
        await React.act(async()=>checked.click());
      }
      await React.act(async()=>oldButton.click());
      assert.deepEqual(calls,priorToken==="OVERRIDE"?
        [{kind:"set",reason:"新設定を確認して操作",confirm:"OVERRIDE",features:["post_video_unslotted"]}]:
        [{kind:"clear",reason:"新設定を確認して操作",confirm:"CLEAR"}]);
    });
  }
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

test("MIG-0734 T03 external CAS refresh invalidates prior APPLY confirmation and selections",async()=>{
  await inDom(async(dom,root)=>{
    const calls=[];
    const api={setDisabled:async(reason,confirm,features,expected)=>{
      calls.push({reason,confirm,features,expected});return {ok:true};
    }};
    const render=raw=>h(CostGuardDisabledFeaturesForm,{
      settings:{...settings,disabledFeaturesJson:raw},api,onSuccess:()=>{},
    });
    const before='["edit_video"]',after='["like_or_bookmark"]';
    await React.act(async()=>root.render(render(before)));
    const fields=[...dom.window.document.querySelectorAll("input:not([type=checkbox])")];
    const button=byText(dom,"無効化設定を保存");
    await type(dom,fields[0],"前の設定に対する理由");
    await type(dom,fields[1],"APPLY");
    assert.equal(button.disabled,false);
    // An unrelated admin saved new settings and this page silently refreshed.
    // Previously reason+APPLY remained armed with the new CAS token.
    await React.act(async()=>root.render(render(after)));
    assert.equal(fields[0].value,"","previous rationale must not be reused");
    assert.equal(fields[1].value,"","previous APPLY token must not be reused");
    assert.equal(button.disabled,true);
    const checked=[...dom.window.document.querySelectorAll("input[type=checkbox]:checked")];
    assert.equal(checked.length,1);
    assert.equal(checked[0].parentElement.textContent.includes("like_or_bookmark"),true);
    await React.act(async()=>button.click());
    assert.deepEqual(calls,[],"stale confirmation must not submit with the new CAS");
    await type(dom,fields[0],"新しい設定を確認");
    await type(dom,fields[1],"APPLY");
    await React.act(async()=>button.click());
    assert.deepEqual(calls,[{
      reason:"新しい設定を確認",confirm:"APPLY",features:["like_or_bookmark"],expected:after,
    }]);
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

test("MIG-0734 privileged notification actions fail closed for URL dot segments and malformed IDs",async()=>{
  const sent=[];
  const api=createAdminNotificationsApi(async(path,init)=>{sent.push({path,init});return response(200,{ok:true});});
  // encodeURIComponent(".") and encodeURIComponent("..") are unchanged.
  // A Fetch URL would collapse these segments and target an unintended admin route.
  for(const id of [".",".."," . "," .. ","","  ","a".repeat(129),String.fromCharCode(0xD800)]){
    for(const action of [
      ()=>api.retry(id),()=>api.cancel(id,"reason"),()=>api.forceResend(id),
    ]){
      assert.deepEqual(await action(),{ok:false,message:"idが不正です。"});
    }
  }
  assert.equal(sent.length,0,"invalid IDs must not create a privileged network request");

  // A slash in a real identifier is still encoded as a single path segment.
  assert.deepEqual(await api.retry("note/1"),{ok:true});
  assert.deepEqual(await api.cancel("note/1","確認"),{ok:true});
  assert.deepEqual(sent.map(call=>new URL(call.path,"https://example.test").pathname),[
    "/api/admin/notifications/note%2F1/retry",
    "/api/admin/notifications/note%2F1/cancel",
  ]);
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

test("MIG-0734 query_failed partial counts never expose bulk mutation and can retry",async()=>{
  // Hono builds operational counts before formatting rows. If row projection
  // fails after counts have been assigned, it returns query_failed + counts.
  const data=notificationData({error:"query_failed"},{failed:4,deadLetter:3,unhealthyLease:2});
  const html=renderNotifications(data);
  assert.match(html,/通知ログの取得に失敗しました/);
  assert.match(html,/再試行/);
  assert.doesNotMatch(html,/failed を一括リトライ|強制再送|>確定</,
    "partial-query errors must never render privileged mutation buttons");
  assert.doesNotMatch(html,/配送リース期限超過・欠損|失敗 4 件|現在、失敗・滞留はありません/,
    "incomplete counts must not appear as authoritative status banners");
  assert.doesNotMatch(html,/最終失敗 \(7\)/,
    "the failed-status tab must not expose counts from an incomplete read");
  const healthy=renderNotifications(notificationData({rows:[]},{failed:4,deadLetter:3,unhealthyLease:0}));
  assert.match(healthy,/最終失敗 \(7\)/,
    "a successful read must retain the existing status tab counts");

  await inDom(async(dom,root)=>{
    let reads=0;
    const api={
      list:async()=>{
        reads++;
        return {status:"ok",data:reads===1
          ? notificationData({error:"query_failed",rows:[]},{failed:8,deadLetter:2})
          : notificationData({rows:[]},{failed:0,deadLetter:0})};
      },
    };
    await React.act(async()=>root.render(h(MemoryRouter,null,h(AdminNotifications,{api}))));
    assert.equal(reads,1);
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent??"",/query_failed/);
    assert.equal(byText(dom,"failed を一括リトライ (上限 10)"),undefined);
    await React.act(async()=>byText(dom,"再試行").click());
    assert.equal(reads,2,"retry reloads the admin read with a fresh cache identity");
    assert.equal(dom.window.document.querySelector('[role="alert"]'),null);
    assert.match(dom.window.document.body.textContent,/通知ログはありません/);
  });
});

test("MIG-0734 privileged screens hide stale data and writes when a same-page refresh fails",async()=>{
  await inDom(async(dom,root)=>{
    let reads=0,writes=0;
    const costApi={
      read:async()=>{
        reads++;
        return reads===2 ? {status:"unavailable"} : {status:"ok",data:{...settings,reason:"管理者による確認"}};
      },
      setMode:async()=>{writes++;return {ok:true};},
    };
    await React.act(async()=>root.render(h(AdminCostGuard,{api:costApi})));
    assert.ok(byText(dom,"モードを更新"),"initial authoritative read exposes controls");
    await React.act(async()=>byText(dom,"モードを更新").click());
    assert.equal(reads,2,"successful mutation triggers a fresh authoritative read");
    assert.equal(writes,1);
    assert.equal(byText(dom,"モードを更新"),undefined,"failed refresh must unmount stale privileged controls");
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent??" ",/取得できません/);
    await React.act(async()=>byText(dom,"再試行").click());
    assert.equal(reads,3);
    assert.ok(byText(dom,"モードを更新"),"controls return only after a successful new read");
  });
  await inDom(async(dom,root)=>{
    // JSDOM has no ResizeObserver; TableScroll needs only observe/disconnect.
    // inDom saves/restores this global to keep the mock limited to this test.
    globalThis.ResizeObserver=class { observe(){} disconnect(){} };
    let reads=0,writes=0;
    const api={
      list:async()=>{
        reads++;
        return reads===2 ? {status:"unavailable"} : {status:"ok",data:notificationData()};
      },
      retry:async()=>{writes++;return {ok:true};},
    };
    await React.act(async()=>root.render(h(MemoryRouter,null,h(AdminNotifications,{api}))));
    assert.ok(byText(dom,"再試行"),"initial failed notification can be retried");
    assert.ok(dom.window.document.querySelector("pre")===null);
    await React.act(async()=>byText(dom,"再試行").click());
    assert.equal(writes,1);
    assert.equal(reads,2);
    assert.equal(dom.window.document.querySelector("tbody"),null,"failed refresh removes the previous notification rows");
    assert.equal(byText(dom,"強制再送"),undefined,"no stale notification mutations after read failure");
    assert.equal(byText(dom,"payload"),undefined,"private payload is not exposed on failed refresh");
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent??" ",/取得できません/);
    await React.act(async()=>byText(dom,"再試行").click());
    assert.equal(reads,3);
    assert.ok(byText(dom,"強制再送"),"actions return after authoritative data recovers");
  });
});

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

    // Three text inputs must still be searchable by pointer/touch and keyboard.
    // Without a submit button browsers cannot reliably implicitly submit on Enter.
    const form=dom.window.document.querySelector('form[role="search"]');
    const search=form.querySelector('button[type="submit"]');
    assert.ok(search,"search must have an explicit submit button");
    assert.equal(search.textContent,"検索");
    await React.act(async()=>search.click());
    assert.equal(queries.length,2,"clicking search submits the current GET fields through SPA navigation");
    assert.equal(queries[1],queries[0]);
    await React.act(async()=>form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
    assert.equal(queries.length,3,"keyboard form submit uses the same query contract");
    assert.equal(queries[2],queries[0]);
  });
});

test("MIG-0734 D-17-7 q search URL respects CURRENT 100-character backend limit",async()=>{
  await inDom(async(dom,root)=>{
    const queries=[];
    const api=createAdminNotificationsApi(async()=>response(500,{}));
    const data=notificationData({rows:[]},{failed:0,deadLetter:0});
    await React.act(async()=>root.render(h(MemoryRouter,null,h(AdminNotificationsView,{
      data,filters:filtersOf("status=failed&type=video"),api,onSuccess:()=>{},
      onSearch:next=>queries.push(next.toString()),
    }))));
    const form=dom.window.document.querySelector('form[role="search"]');
    const q=form.querySelector('[name="q"]');
    assert.equal(q.maxLength,100,"prevent typing a search term longer than the API limit");
    // Even a programmatically populated/previously pasted overlong input must be
    // normalized before writing SPA history and navigating the search route.
    q.value="  "+("あ".repeat(120))+"  ";
    await React.act(async()=>form.querySelector('button[type="submit"]').click());
    assert.equal(queries.length,1);
    let params=new URLSearchParams(queries[0]);
    assert.equal(params.get("q"),"あ".repeat(100));
    assert.equal(params.get("status"),"failed");
    assert.equal(params.get("type"),"video");
    // Auto-submit category changes must obey the same query contract.
    q.value="  "+("z".repeat(130))+" ";
    const cat=form.querySelector('[name="cat"]');
    await React.act(async()=>{
      cat.value="video";
      cat.dispatchEvent(new dom.window.Event("change",{bubbles:true}));
    });
    assert.equal(queries.length,2);
    params=new URLSearchParams(queries[1]);
    assert.equal(params.get("q"),"z".repeat(100));
    assert.equal(params.get("cat"),"video");
  });
});

test("MIG-0734 D-17-7 auto-filter preserves the real IME composition lifecycle",async()=>{
  await inDom(async(dom,root)=>{
    const queries=[];
    const data=notificationData({rows:[]},{failed:0,deadLetter:0});
    const api=createAdminNotificationsApi(async()=>response(500,{}));
    await React.act(async()=>root.render(h(MemoryRouter,null,h(AdminNotificationsView,{
      data,filters:filtersOf("status=failed&type=draft"),api,onSuccess:()=>{},
      onSearch:next=>queries.push(next.toString()),
    }))));
    const form=dom.window.document.querySelector('form[role="search"]');
    const input=form.querySelector('[name="type"]');
    const category=form.querySelector('[name="cat"]');
    const submit=()=>form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
    const compose=name=>input.dispatchEvent(new dom.window.CompositionEvent(name,{bubbles:true}));
    const searchButton=form.querySelector('button[type="submit"]');
    assert.ok(searchButton);
    await React.act(async()=>compose("compositionstart"));
    assert.equal(form.hasAttribute("data-fn-ime-composing"),true,"real compositionstart marks the form");
    await React.act(async()=>{
      category.value="x_id";
      category.dispatchEvent(new dom.window.Event("change",{bubbles:true}));
      submit();
    });
    await React.act(async()=>searchButton.click());
    assert.deepEqual(queries,[],"category, form submit and the button must not navigate while composing");
    await React.act(async()=>{
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown",{
        key:"Enter",keyCode:229,isComposing:true,bubbles:true,
      }));
    });
    // A 229 keydown during an active conversion must NOT start a removal timer.
    // A premature timer would permit search while composition is still active.
    await React.act(async()=>{await new Promise(resolve=>dom.window.setTimeout(resolve,5));});
    assert.equal(form.hasAttribute("data-fn-ime-composing"),true,"ongoing composition must retain its guard");
    await React.act(async()=>submit());
    assert.deepEqual(queries,[],"same-form submit remains blocked before compositionend");
    await React.act(async()=>{
      compose("compositionend");
      submit(); // same tick as IME commit must still be blocked
    });
    assert.deepEqual(queries,[]);
    await React.act(async()=>{await new Promise(resolve=>dom.window.setTimeout(resolve,5));});
    assert.equal(form.hasAttribute("data-fn-ime-composing"),false);
    await React.act(async()=>{
      category.value="video";
      category.dispatchEvent(new dom.window.Event("change",{bubbles:true}));
    });
    assert.equal(queries.length,1,"category auto-filter resumes after IME commit");
    const next=new URLSearchParams(queries[0]);
    assert.equal(next.get("status"),"failed");
    assert.equal(next.get("type"),"draft");
    assert.equal(next.get("cat"),"video");

    // Windows IME may report 229 without a preceding compositionstart event.
    await React.act(async()=>{
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Enter",keyCode:229,bubbles:true}));
      submit();
    });
    assert.equal(queries.length,1,"keyCode 229 commit Enter cannot search");
    await React.act(async()=>{await new Promise(resolve=>dom.window.setTimeout(resolve,5));});
    await React.act(async()=>submit());
    assert.equal(queries.length,2);

    // Windows IME can emit key="Process" instead of "Enter" for keyCode 229.
    // The fallback must guard the same-tick search button and form submission.
    await React.act(async()=>{
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown",{
        key:"Process",keyCode:229,bubbles:true,
      }));
      searchButton.click();
      submit();
    });
    assert.equal(queries.length,2,"Process/229 cannot submit in the IME commit tick");
    await React.act(async()=>{await new Promise(resolve=>dom.window.setTimeout(resolve,5));});
    await React.act(async()=>searchButton.click());
    assert.equal(queries.length,3,"Process/229 fallback clears for intentional later search");

    // A Process/229 key while composing must not start the one-tick clear timer.
    await React.act(async()=>{
      compose("compositionstart");
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown",{
        key:"Process",keyCode:229,isComposing:true,bubbles:true,
      }));
    });
    await React.act(async()=>{await new Promise(resolve=>dom.window.setTimeout(resolve,5));});
    assert.equal(form.hasAttribute("data-fn-ime-composing"),true);
    await React.act(async()=>submit());
    assert.equal(queries.length,3,"ongoing Process composition remains protected");
    await React.act(async()=>compose("compositionend"));
    await React.act(async()=>{await new Promise(resolve=>dom.window.setTimeout(resolve,5));});
    assert.equal(form.hasAttribute("data-fn-ime-composing"),false);
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
  // Ignore comments referring to the legacy component: only imports and JSX use matter.
  assert.doesNotMatch(notifications,/<AutoSubmitSelect\b/);
  assert.doesNotMatch(notifications,/import\s*\{[^}]*\bAutoSubmitSelect\b[^}]*\}\s*from/);
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

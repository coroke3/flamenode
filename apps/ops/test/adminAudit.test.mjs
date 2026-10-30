import test from "node:test";
import { auditTargetLinks, AuditTargetLink } from "../.test-dist/apps/ops/src/routes/admin/AuditTargetLink.js";
import { parseAuditChanges, AuditDiffGrid } from "../.test-dist/apps/ops/src/routes/admin/AuditDiffGrid.js";
import { AuditDetailContent, AuditDiffDetail } from "../.test-dist/apps/ops/src/routes/admin/AuditDetail.js";
import { AuditRestoreForm } from "../.test-dist/apps/ops/src/routes/admin/AuditRestoreForm.js";
import { AuditRestoreRunsContent } from "../.test-dist/apps/ops/src/routes/admin/AuditRestoreRuns.js";
import { AuditSettingsContent, AuditSettingsForm, retentionShortened, validAuditSettings } from "../.test-dist/apps/ops/src/routes/admin/AuditSettings.js";

import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { parseAuditListQuery, auditListApiPath, auditViewHref } from "../.test-dist/apps/ops/src/lib/auditListQuery.js";
import { createAdminAuditApi } from "../.test-dist/apps/ops/src/api/adminAudit.js";
import { AuditListContent, parseChangedKeys, parseAuditActorSnapshot } from "../.test-dist/apps/ops/src/routes/admin/AuditList.js";

const row = (overrides={}) => ({
  id:"aud-1",table_name:"videos",target_id:"v1",operation:"UPDATE",
  changed_keys_json:'["title"]',actor_user_id:"op1",actor_x_user_id:null,actor_snapshot_json:null,
  reason:null,context:null,retention_class:"default",restore_strategy:"none",
  restore_status:"not_restorable",restore_unavailable_reason_code:null,
  restore_unavailable_message:null,payload_size_bytes:18,expires_at:null,created_at:1735689600,
  payload:{before:8,after:10,inverse:null},...overrides,
});
const sample = { limit:50,truncated:false,rows:[row()],
  operators:[{id:"op1",name:"運営者",active_x_user_id:null,x_name:null}] };

test("MIG-0733 T01/T02: operator alias, limit cap, GET filter and view links", () => {
  const q = parseAuditListQuery("?operator=%20u1%20&limit=500&view=timeline&operation=update&since=2026-10-01");
  assert.equal(q.actor,"u1");
  assert.equal(q.limit,100);
  assert.equal(q.operation,"UPDATE");
  assert.equal(q.view,"timeline");
  const path = new URL(auditListApiPath(q),"https://test.invalid");
  assert.equal(path.pathname,"/api/admin-read/audit");
  assert.equal(path.searchParams.get("actor"),"u1");
  assert.equal(path.searchParams.get("view"),null);
  assert.equal(path.searchParams.get("operator"),null);
  assert.equal(path.searchParams.get("limit"),"100");
  const href = new URL(auditViewHref(q,"cards"),"https://test.invalid");
  assert.equal(href.searchParams.get("view"),"cards");
  assert.equal(href.searchParams.get("actor"),"u1");
  assert.equal(href.searchParams.get("since"),"2026-10-01");
  assert.equal(parseAuditListQuery("?limit=0&view=unknown").limit,50);
  assert.equal(parseAuditListQuery("?actor=modern&operator=legacy").actor,"modern");
  assert.deepEqual(parseChangedKeys('["title",4,null,"description"]'),["title","description"]);
});

test("MIG-0733 U01: list uses same-origin, no-store and validates response (fail closed)", async () => {
  const requests=[];
  const api=createAdminAuditApi(async (url,init)=>{
    requests.push([url,init]);
    return new Response(JSON.stringify(sample),{status:200});
  });
  const result=await api.list(parseAuditListQuery("?actor=u1"));
  assert.equal(result.status,"ok");
  assert.equal(result.data.rows.length,1);
  assert.equal(requests[0][1].credentials,"same-origin");
  assert.equal(requests[0][1].cache,"no-store");
  assert.equal(requests[0][1].method,"GET");
  assert.equal((await createAdminAuditApi(async()=>new Response('{"secret":1}',{status:200}))
    .list(parseAuditListQuery(""))).status,"unavailable");
  assert.equal((await createAdminAuditApi(async()=>new Response(null,{status:401}))
    .list(parseAuditListQuery(""))).status,"anonymous");
});

test("MIG-0733 T03: 30,000 char payload is reconstructed using exactly three bounded GETs", async () => {
  const full="あ".repeat(30000);const urls=[];
  const api=createAdminAuditApi(async(url,init)=>{
    urls.push(url);assert.equal(init.method,"GET");
    const offset=Number(new URL(url,"https://test.invalid").searchParams.get("offset"));
    const chunk=full.slice(offset,offset+12000);
    return new Response(JSON.stringify({field:"before",total:full.length,offset,chunk,
      nextOffset:offset+chunk.length<full.length?offset+chunk.length:null}),{status:200});
  });
  const result=await api.payload("some/id","before");
  assert.equal(result.status,"ok");
  assert.equal(result.data,full);
  assert.equal(urls.length,3);
  assert.match(urls[0],/some%2Fid\/payload\/before/);
  assert.match(urls[2],/offset=24000/);
});

test("MIG-0733 U01: SQLite code-point offsets preserve emoji across chunks", async () => {
  const characters = Array.from("😀".repeat(12005) + "末尾");
  const offsets=[];
  const api=createAdminAuditApi(async url=>{
    const offset=Number(new URL(url,"https://test.invalid").searchParams.get("offset"));
    offsets.push(offset);
    const piece=characters.slice(offset,offset+12000).join("");
    const next=offset+Array.from(piece).length;
    return new Response(JSON.stringify({field:"after",offset,total:characters.length,chunk:piece,
      nextOffset:next<characters.length?next:null}),{status:200});
  });
  const value=await api.payload("a","after");
  assert.equal(value.status,"ok");
  assert.equal(value.data,characters.join(""));
  assert.deepEqual(offsets,[0,12000]);
});

test("MIG-0733 U01: null, repeated nextOffset and abort fail closed", async()=>{
  const noValue=await createAdminAuditApi(async()=>new Response(null,{status:404})).payload("a","after");
  assert.deepEqual(noValue,{status:"ok",data:null});
  let calls=0;
  const malformed=await createAdminAuditApi(async()=>{
    calls++;return new Response(JSON.stringify({field:"before",total:30000,
      offset:0,chunk:"a",nextOffset:0}),{status:200});
  }).payload("a","before");
  assert.equal(malformed.status,"unavailable");assert.equal(calls,1);
  const ac=new AbortController();ac.abort();
  assert.equal((await createAdminAuditApi(async()=>{throw Error("should not fetch");})
    .payload("a","before",ac.signal)).status,"unavailable");
});

test("MIG-0733 U01: all three views retain count, identity and diff affordance; truncated warning",()=>{
  const api={list:async()=>({status:"unavailable"}),payload:async()=>({status:"ok",data:"{}"})};
  for(const view of ["table","timeline","cards"]){
    const html=renderToStaticMarkup(React.createElement(AuditListContent,{
      query:parseAuditListQuery("?view="+view+"&actor=u1"),
      state:{status:"ok",data:{...sample,truncated:true}},api,
    }));
    assert.match(html,/監査ログ/);
    assert.match(html,/運営者/);
    assert.match(html,/aud-1/);
    assert.match(html,/差分/);
    assert.match(html,/結果を省略しました/);
    assert.match(html,/aria-selected="true"/);
    assert.match(html,/name="actor"/);
    assert.match(html,/name="view"/);
    assert.match(html,/href="\/admin\/audit\/aud-1"/);
  }
  const empty=renderToStaticMarkup(React.createElement(AuditListContent,{
    query:parseAuditListQuery(""),state:{status:"ok",data:{...sample,rows:[]}},api,
  }));
  assert.match(empty,/該当する監査ログはありません/);
});

test("MIG-0733 U01: no payload GET before clicking the diff; close aborts in-flight reads",async()=>{
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"https://flamenode.test/admin/audit"});
  const previous={};
  for(const k of ["window","document","navigator","HTMLElement","Node","MouseEvent"]){
    previous[k]=Object.getOwnPropertyDescriptor(globalThis,k);
    Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:dom.window[k]});
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const target=document.createElement("div");document.body.append(target);
  const root=createRoot(target);const pending=[];
  const api={
    list:async()=>({status:"ok",data:sample}),
    payload:async(_id,field,signal)=>new Promise(resolve=>{pending.push({field,signal,resolve});}),
  };
  try{
    await React.act(async()=>root.render(React.createElement(AuditListContent,{
      query:parseAuditListQuery(""),state:{status:"ok",data:sample},api,
    })));
    assert.equal(pending.length,0,"rendering the list never loads full audit payload");
    const button=[...target.querySelectorAll("button")].find(x=>x.textContent==="差分");
    await React.act(async()=>button.click());
    assert.equal(pending.length,2);
    assert.ok(pending.every(x=>!x.signal.aborted));
    const close=[...target.querySelectorAll("button")].find(x=>x.textContent==="閉じる");
    await React.act(async()=>close.click());
    assert.ok(pending.every(x=>x.signal.aborted));
  }finally{
    await React.act(async()=>root.unmount());target.remove();
    for(const k of Object.keys(previous)){
      if(previous[k]===undefined)delete globalThis[k];else Object.defineProperty(globalThis,k,previous[k]);
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});

const settingsFixture={
  normal_retention_days:30,restorable_retention_days:90,long_audit_retention_days:365,
  max_payload_bytes:120000,compact_after_days:7,
};
const detailFixture=(()=>{
  const {payload,...base}=row({restore_status:"restorable"});
  return {row:base,payload,prev:{id:"aud-0",created_at:1735603200},
    next:{id:"aud-2",created_at:1735776000}};
})();
test("MIG-0733 U02/U03: detail, restore run and audit settings endpoints use validated read contracts",async()=>{
  const calls=[];
  const api=createAdminAuditApi(async (url,init)=>{
    calls.push({url,init});
    const body=url==="/api/admin-read/audit/aud-1"?detailFixture
      :url==="/api/admin-read/audit/restore"?{runs:[{id:"run1",audit_log_id:"aud-1",
        status:"success",executed_at:1735776000,executed_by_user_id:"admin",reason:"repair",
        error_message:null,log:{table_name:"videos",target_id:"v1"}}]}
      :url==="/api/admin-read/audit-settings"?{settings:settingsFixture}:null;
    return new Response(JSON.stringify(body),{status:200});
  });
  assert.equal((await api.detail("aud-1")).status,"ok");
  assert.equal((await api.runs()).status,"ok");
  assert.equal((await api.settings()).status,"ok");
  assert.deepEqual(calls.map(x=>x.url),[
    "/api/admin-read/audit/aud-1","/api/admin-read/audit/restore",
    "/api/admin-read/audit-settings"]);
  assert.ok(calls.every(x=>x.init.cache==="no-store"&&x.init.credentials==="same-origin"));
  const invalid=createAdminAuditApi(async()=>new Response(JSON.stringify({rows:[]}),{status:200}));
  assert.equal((await invalid.detail("a")).status,"unavailable");
  assert.equal((await invalid.settings()).status,"unavailable");
});

test("MIG-0733 T04: restore confirmation mismatch never sends a request; exact JSON key parity",async()=>{
  let count=0, last;
  const api=createAdminAuditApi(async(url,init)=>{
    count++;last={url,init};
    return new Response(JSON.stringify({ok:true,restore_run_id:"run1"}),{status:200});
  });
  for(const wrong of ["", "RESTORE other", "RESTORE aud-1 "]) {
    const result=await api.restore("aud-1","fix",wrong,false);
    assert.equal(result.status,"ok");assert.equal(result.data.ok,false);
  }
  assert.equal((await api.restore("aud-1"," ","RESTORE aud-1",false)).data.ok,false);
  assert.equal(count,0);
  const result=await api.restore("aud-1","fix","RESTORE aud-1",true);
  assert.equal(result.status,"ok");assert.equal(result.data.restore_run_id,"run1");
  assert.equal(count,1);assert.equal(last.url,"/api/admin/audit/restore");
  assert.deepEqual(JSON.parse(last.init.body),{
    audit_id:"aud-1",reason:"fix",confirm_text:"RESTORE aud-1",force_overwrite:"1",
  });
  assert.equal(last.init.credentials,"same-origin");
});

test("MIG-0733 U02: dry run body retains exact action field keys and rejects blank reason",async()=>{
  const requests=[];
  const api=createAdminAuditApi(async(url,init)=>{
    requests.push({url,body:JSON.parse(init.body)});
    return new Response(JSON.stringify({ok:true,diff:{current:null,target:null,conflicts:["title"]}}),{status:200});
  });
  assert.equal((await api.dryRun("a"," ")).data.ok,false);
  assert.equal(requests.length,0);
  const result=await api.dryRun("a","reason");
  assert.equal(result.status,"ok");assert.equal(result.data.diff.conflicts[0],"title");
  assert.deepEqual(requests,[{url:"/api/admin/audit/dry-run",body:{audit_id:"a",reason:"reason"}}]);
});

test("MIG-0733 T05: non-restorable log never renders restore inputs or action",()=>{
  const api=createAdminAuditApi(async()=>{throw Error("unexpected fetch")});
  const base={auditId:"aud-1",api,unavailableMessage:null,reasonCode:null};
  const blocked=renderToStaticMarkup(React.createElement(AuditRestoreForm,{
    ...base,restoreStatus:"blocked",
  }));
  assert.match(blocked,/このログは復元できません/);
  assert.doesNotMatch(blocked,/確認テキスト:/);
  assert.doesNotMatch(blocked,/競合チェック実行/);
  const allowed=renderToStaticMarkup(React.createElement(AuditRestoreForm,{
    ...base,restoreStatus:"restorable",
  }));
  assert.match(allowed,/RESTORE aud-1/);
  assert.match(allowed,/disabled=""/);
  assert.match(allowed,/YouTube \/ Discord/);
});

test("MIG-0733 U02: detail page shows neighbor navigation, raw payload and gated restore state",()=>{
  const api=createAdminAuditApi(async()=>{throw Error("unexpected fetch")});
  const html=renderToStaticMarkup(React.createElement(AuditDetailContent,{
    id:"aud-1",api,state:{status:"ok",data:detailFixture},
  }));
  assert.match(html,/href="\/admin\/audit\/aud-0"/);
  assert.match(html,/href="\/admin\/audit\/aud-2"/);
  assert.match(html,/監査ログ aud-1/);
  assert.match(html,/変更履歴を読み込み中/);
  assert.match(html,/変更履歴の読込完了後にリストア操作が利用できます/);
  assert.doesNotMatch(html,/リストア実行/);
  assert.match(html,/同じ target_id を一覧表示/);
  const bad=renderToStaticMarkup(React.createElement(AuditDetailContent,{
    id:"absent",api,state:{status:"notFound"},
  }));
  assert.match(bad,/監査ログが見つかりません/);
  const diff=renderToStaticMarkup(React.createElement(AuditDiffDetail,{
    before:'{"a":1}',after:'{"a":2}',inverse:"{}",changedKeys:["a"],
  }));
  assert.match(diff,/before/);assert.match(diff,/inverse_patch_json/);
});

test("MIG-0733 U03: 50-run history shows status, audit target and error, empty state",()=>{
  const source={status:"ok",data:{runs:[{id:"r1",audit_log_id:"a1",status:"failed",
    executed_at:1735689600,executed_by_user_id:"u1",reason:"reason",error_message:"conflict",
    log:{table_name:"events",target_id:"e1"}}]}};
  const html=renderToStaticMarkup(React.createElement(AuditRestoreRunsContent,{state:source}));
  assert.match(html,/復元履歴/);assert.match(html,/href="\/admin\/audit\/a1"/);
  assert.match(html,/conflict/);assert.match(html,/events/);
  const empty=renderToStaticMarkup(React.createElement(AuditRestoreRunsContent,{
    state:{status:"ok",data:{runs:[]}},
  }));
  assert.match(empty,/復元履歴はまだありません/);
});

test("MIG-0733 T06: shortening retention warns and saving requires five bounded integers",async()=>{
  const initial=settingsFixture;
  assert.equal(retentionShortened(initial,{...initial,normal_retention_days:7}),true);
  assert.equal(retentionShortened(initial,{...initial,max_payload_bytes:1000}),false);
  assert.equal(validAuditSettings(initial),true);
  assert.equal(validAuditSettings({...initial,max_payload_bytes:1}),false);
  assert.equal(validAuditSettings({...initial,normal_retention_days:0.5}),false);
  const api=createAdminAuditApi(async(url,init)=>{
    assert.equal(url,"/api/admin/audit/settings");
    assert.deepEqual(JSON.parse(init.body),initial);
    return new Response(JSON.stringify({ok:true}),{status:200});
  });
  assert.equal((await api.saveSettings(initial)).status,"ok");
  const html=renderToStaticMarkup(React.createElement(AuditSettingsContent,{
    state:{status:"ok",data:{settings:initial}},api,refresh:()=>{},
  }));
  assert.match(html,/normal_retention_days/);
  assert.match(html,/compact_after_days/);
  const form=renderToStaticMarkup(React.createElement(AuditSettingsForm,{
    initial,api,onSaved:()=>{},
  }));
  assert.match(form,/設定を保存/);
  assert.doesNotMatch(form,/保持日数を短くすると/);
});

test("MIG-0733: diff displays field labels, added/removed/changed and malformed JSON",()=>{
  const compared=parseAuditChanges('{"title":"old","role":"admin","deleted":1}', '{"title":"new","role":"admin","created":2}');
  assert.equal(compared.valid,true);
  assert.deepEqual(compared.changes.map(x=>[x.key,x.kind]),[
    ["created","added"],["deleted","removed"],["title","changed"]]);
  assert.equal(compared.changes.at(-1).label,"作品タイトル");
  assert.equal(parseAuditChanges("{bad}","{}").valid,false);
  const html=renderToStaticMarkup(React.createElement(AuditDiffGrid,{
    before:'{"title":"old"}',after:'{"title":"new"}',
  }));
  assert.match(html,/作品タイトル/);assert.match(html,/変更/);
  assert.match(html,/old/);assert.match(html,/new/);
});

test("MIG-0733: CURRENT target links preserve admin/public routes and unknown table fallback",()=>{
  assert.deepEqual(auditTargetLinks("events","a/b"),{
    adminHref:"/manage/events/a%2Fb/edit",publicHref:"/event/a%2Fb",
  });
  assert.deepEqual(auditTargetLinks("x_users","@x"),{
    adminHref:"/admin/users?view=xid&q=%40x",publicHref:"/user/%40x",
  });
  assert.deepEqual(auditTargetLinks("unknown","abc"),{});
  const unknown=renderToStaticMarkup(React.createElement(AuditTargetLink,{
    tableName:"unknown",recordId:"abc",
  }));
  assert.match(unknown,/abc/);
  assert.doesNotMatch(unknown,/href=/);
});

test("MIG-0733: immutable audit-time identity across all three list views", () => {
  const api = {list:async()=>({status:"unavailable"}), payload:async()=>({status:"unavailable"})};
  const historic = {
    ...sample,
    rows: [row({
      actor_snapshot_json: JSON.stringify({
        discord_name:"PAST_DISCORD", x_name:"PAST_X_NAME", x_user_id:"PAST_X_ID",
      }),
      actor_x_user_id:"PAST_X_ID",
    })],
    operators:[{id:"op1",name:"LIVE_DISCORD",x_name:"LIVE_X_NAME",active_x_user_id:"LIVE_X_ID"}],
  };
  for (const view of ["table","timeline","cards"]) {
    const html = renderToStaticMarkup(React.createElement(AuditListContent, {
      query:parseAuditListQuery("?view="+view),
      state:{status:"ok",data:historic},api,
    }));
    assert.match(html,/PAST_X_NAME/);
    assert.match(html,/@PAST_X_ID/);
    assert.doesNotMatch(html,/LIVE_DISCORD|LIVE_X_NAME|LIVE_X_ID/);
  }
});

test("MIG-0733: deleted operator, malformed snapshot and recorded X ID fallback", () => {
  assert.deepEqual(parseAuditActorSnapshot('{"discord_name":"Past","x_user_id":"x1","x_name":"X Past"}'),
    {discord_name:"Past",x_user_id:"x1",x_name:"X Past"});
  for (const malformed of ["{invalid","[]","42",'{"x_name":{"bad":true}}']) {
    const snapshot = parseAuditActorSnapshot(malformed);
    if (malformed.includes("bad")) assert.equal(snapshot?.x_name,null);
    else assert.equal(snapshot,null);
  }
  const api = {list:async()=>({status:"unavailable"}),payload:async()=>({status:"unavailable"})};
  const renderRow = (source,operators) => renderToStaticMarkup(React.createElement(AuditListContent, {
    query:parseAuditListQuery(""),
    state:{status:"ok",data:{...sample,rows:[row(source)],operators}},api,
  }));
  const deleted = renderRow({
    actor_snapshot_json:JSON.stringify({discord_name:"DELETED_DISCORD",x_name:null,x_user_id:"historical"}),
    actor_x_user_id:"historical",
  },[]);
  assert.match(deleted,/DELETED_DISCORD/);
  assert.match(deleted,/@historical/);
  const malformed = renderRow({actor_snapshot_json:"{bad",actor_x_user_id:"recorded"},[
    {id:"op1",name:"LIVE_NAME",x_name:null,active_x_user_id:"new"},
  ]);
  assert.match(malformed,/LIVE_NAME/);
  assert.match(malformed,/@recorded/);
  assert.doesNotMatch(malformed,/@new/);
});

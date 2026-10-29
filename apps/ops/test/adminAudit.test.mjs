import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { parseAuditListQuery, auditListApiPath, auditViewHref } from "../.test-dist/apps/ops/src/lib/auditListQuery.js";
import { createAdminAuditApi } from "../.test-dist/apps/ops/src/api/adminAudit.js";
import { AuditListContent, parseChangedKeys } from "../.test-dist/apps/ops/src/routes/admin/AuditList.js";

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

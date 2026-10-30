import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { dom } from "./helpers.mjs";
const { SetActiveXButton, XIdCompactProfileForm, XIdIconPicker, DeleteXIdForm } =
  await import("../.test-dist/apps/app/src/routes/dashboard/settings/XIdPanelActions.js");

async function render(Component, props) {
  const container = dom.window.document.createElement("div");
  // Attach to document so React 19 delegated form/input events fire as in a browser.
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, {},
    React.createElement(Component, props))));
  const click = async button => act(async () => button.click());
  const flush = async () => { await act(async () => { for (let k=0;k<5;k++) await Promise.resolve(); }); };
  const dispose = () => act(async () => { root.unmount(); container.remove(); });
  return { container, click, flush, dispose };
}
const buttonWith = (c, text) => [...c.querySelectorAll("button")].find(b => b.textContent.includes(text));
const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; };

test("MIG-0708 U03 T01: two synchronous Active X clicks issue exactly one request", async () => {
  const d=deferred(), calls=[];let refreshed=0;
  const m=await render(SetActiveXButton,{api:{setActive:id=>{calls.push(id);return d.promise;}},xUserId:"alpha",approved:true,onRefresh:()=>refreshed++});
  const b=buttonWith(m.container,"アクティブ");
  await act(async ()=>{ b.click(); b.click(); });
  assert.deepEqual(calls,["alpha"]);
  assert.equal(b.disabled,true);
  await act(async ()=>d.resolve({ok:true}));
  await m.flush();
  assert.equal(refreshed,1);
  await m.dispose();
});

test("MIG-0708 U03 T02: pending/rejected and active X never show Active X button", async () => {
  for(const [approved,isActive] of [[false,false],[false,true],[true,true]]){
    const m=await render(SetActiveXButton,{api:{setActive:()=>{throw Error("unreachable");}},xUserId:"x",approved,isActive,onRefresh:()=>{}});
    assert.equal(m.container.querySelector("button"),null);
    await m.dispose();
  }
});

test("MIG-0708 U03 T03: profile reject preserves editable field and displays server message", async () => {
  const calls=[],api={updateProfile:async(id,fields)=>{calls.push({id,fields});return {ok:false,message:"入力を確認してください。"};}};
  const x={id:"alpha",x_name:"Alpha",icon_url:null,profile_text:"About",portfolio_contact:null,youtube_channel_url:null,other_social_links:null};
  const m=await render(XIdCompactProfileForm,{api,x,iconCandidates:[],onRefresh:()=>{throw Error("unexpected refresh");}});
  await act(async () => m.container.querySelector("form").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));
  await m.flush();
  assert.equal(calls.length,1);
  assert.equal(calls[0].id,"alpha");
  assert.equal(calls[0].fields.x_name,"Alpha");
  assert.match(m.container.querySelector('[role="alert"]').textContent,/入力を確認してください/);
  assert.equal(m.container.querySelector('[name="profile_text"]').value,"About");
  await m.dispose();
});

test("MIG-0708 U03 T04: oversize upload is blocked before API, valid file uses file transport", async () => {
  const files=[],api={uploadIcon:async(_id,file)=>{files.push(file);return {ok:true};}};
  const m=await render(XIdIconPicker,{api,xUserId:"foo",currentIconUrl:null,candidates:[],onRefresh:()=>{}});
  await m.click(buttonWith(m.container,"アップロード"));
  const input=m.container.querySelector('input[type="file"]');
  const tooLarge={name:"huge.png",size:8*1024*1024+1,type:"image/png"};
  Object.defineProperty(input,"files",{configurable:true,value:[tooLarge]});
  await act(async()=>input.dispatchEvent(new dom.window.Event("change",{bubbles:true})));
  assert.equal(files.length,0);
  assert.match(m.container.querySelector('[role="alert"]').textContent,/8MB/);
  const valid=new Blob(["hello"],{type:"image/png"});
  Object.defineProperty(input,"files",{configurable:true,value:[valid]});
  await act(async()=>input.dispatchEvent(new dom.window.Event("change",{bubbles:true})));
  await m.flush();
  assert.equal(files.length,1);
  assert.equal(files[0].size,5);
  await m.dispose();
});

test("MIG-0708 U03 T05: unlink cannot execute before exact confirmation",async()=>{
  const calls=[];let refresh=0;
  const m=await render(DeleteXIdForm,{api:{deleteXId:async(...args)=>{calls.push(args);return {ok:true};}},xUserId:"foo",isActive:false,onRefresh:()=>refresh++});
  await m.click(buttonWith(m.container,"連携を解除"));
  const confirm=buttonWith(m.container,"連携を削除する");
  assert.equal(confirm.disabled,true);
  assert.equal(calls.length,0);
  const input=m.container.querySelector("input");
  await act(async()=>{
    const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set;
    setter.call(input,"DELETE bar");
    input.dispatchEvent(new dom.window.Event("input",{bubbles:true}));
  });
  assert.equal(confirm.disabled,true);
  await act(async()=>{
    const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set;
    setter.call(input,"DELETE foo");
    input.dispatchEvent(new dom.window.Event("input",{bubbles:true}));
  });
  assert.equal(confirm.disabled,false);
  await m.click(confirm);
  await m.flush();
  assert.deepEqual(calls,[["foo","DELETE foo"]]);
  assert.equal(refresh,1);
  await m.dispose();
});

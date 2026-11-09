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
  const rerender = nextProps => act(async () => root.render(React.createElement(MemoryRouter, {},
    React.createElement(Component, nextProps))));
  return { container, click, flush, dispose, rerender };
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

test("MIG-0708 U03: overlong next path never navigates after successful Active X switch", async () => {
  const calls = [];
  let refreshed = 0;
  const m = await render(SetActiveXButton, {
    api: { setActive: async (id) => { calls.push(id); return { ok: true }; } },
    xUserId: "alpha", approved: true, next: "/" + "a".repeat(512),
    onRefresh: () => { refreshed += 1; },
  });
  try {
    await m.click(buttonWith(m.container, "アクティブ"));
    await m.flush();
    assert.deepEqual(calls, ["alpha"]);
    assert.equal(refreshed, 1, "invalid next falls back to safe data refresh, not navigation");
  } finally {
    await m.dispose();
  }
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

test("MIG-0708 U03: profile form resets uncontrolled values when X identity changes", async () => {
  const api = {};
  const base = { icon_url: null, portfolio_contact: null, youtube_channel_url: null, other_social_links: null };
  const props = { api, iconCandidates: [], onRefresh: () => {} };
  const m = await render(XIdCompactProfileForm, { ...props, x: { ...base, id: "old-x", x_name: "Old name", profile_text: "Old bio" } });
  try {
    const input = m.container.querySelector('[name="x_name"]');
    assert.equal(input.value, "Old name");
    // Simulate an unsaved change; a new identity must never inherit it.
    input.value = "Unsaved old-x edits";
    await m.rerender({ ...props, x: { ...base, id: "new-x", x_name: "New name", profile_text: "New bio" } });
    assert.equal(m.container.querySelector('[name="x_name"]').value, "New name");
    assert.equal(m.container.querySelector('[name="profile_text"]').value, "New bio");
  } finally { await m.dispose(); }
});

test("MIG-0708 U03: old profile mutation completion cannot refresh or close new X identity", async () => {
  const pending = deferred();
  let refreshed = 0;
  let cancelled = 0;
  const calls = [];
  const api = { updateProfile: (id, fields) => { calls.push({ id, fields }); return pending.promise; } };
  const base = { icon_url: null, profile_text: null, portfolio_contact: null, youtube_channel_url: null, other_social_links: null };
  const props = { api, iconCandidates: [], onRefresh: () => { refreshed++; }, onCancel: () => { cancelled++; } };
  const m = await render(XIdCompactProfileForm, { ...props, x: { ...base, id: "A", x_name: "Account A" } });
  try {
    await act(async () => m.container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "A");
    await m.rerender({ ...props, x: { ...base, id: "B", x_name: "Account B" } });
    await m.rerender({ ...props, x: { ...base, id: "A", x_name: "Account A again" } });
    await act(async () => pending.resolve({ ok: true, message: "stale profile success" }));
    await m.flush();
    assert.equal(refreshed, 0);
    assert.equal(cancelled, 0);
    assert.equal(m.container.textContent.includes("stale profile success"), false);
    assert.equal(m.container.querySelector('[name="x_name"]').value, "Account A again");
  } finally { await m.dispose(); }
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
  const badType={name:"not-an-icon.txt",size:12,type:"text/plain"};
  Object.defineProperty(input,"files",{configurable:true,value:[badType]});
  await act(async()=>input.dispatchEvent(new dom.window.Event("change",{bubbles:true})));
  assert.equal(files.length,0,"the accept attribute alone cannot guarantee MIME validation");
  assert.match(m.container.querySelector('[role="alert"]').textContent,/PNG・JPEG・WebP/);
  const valid=new Blob(["hello"],{type:"image/png"});
  Object.defineProperty(input,"files",{configurable:true,value:[valid]});
  await act(async()=>input.dispatchEvent(new dom.window.Event("change",{bubbles:true})));
  await m.flush();
  assert.equal(files.length,1);
  assert.equal(files[0].size,5);
  await m.dispose();
});

test("MIG-0708 U03: icon selection tracks authoritative icon changes after refresh", async () => {
  const noop = () => {};
  const base = { api: {}, xUserId: "alpha", candidates: ["https://cdn.example/a.png", "https://cdn.example/b.png"], onRefresh: noop };
  const m = await render(XIdIconPicker, { ...base, currentIconUrl: base.candidates[0] });
  try {
    const buttons = [...m.container.querySelectorAll('button[aria-label="候補アイコンを選択"]')];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
    assert.equal(buttons[1].getAttribute("aria-pressed"), "false");
    await m.rerender({ ...base, currentIconUrl: base.candidates[1] });
    assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
    assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
    await m.rerender({ ...base, currentIconUrl: null });
    assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
    assert.equal(buttons[1].getAttribute("aria-pressed"), "false");
  } finally { await m.dispose(); }
});

test("MIG-0708 U03: stale icon response after X account switch cannot overwrite new selection", async () => {
  const pending = deferred();
  const calls = [];
  let refreshed = 0;
  const urls = ["https://cdn.example/old.png", "https://cdn.example/new.png"];
  const api = { setIcon: (id, url) => { calls.push([id, url]); return pending.promise; } };
  const shared = { api, candidates: urls, onRefresh: () => { refreshed++; } };
  const m = await render(XIdIconPicker, { ...shared, xUserId: "old-x", currentIconUrl: urls[0] });
  try {
    let buttons = [...m.container.querySelectorAll('button[aria-label="候補アイコンを選択"]')];
    await act(async () => buttons[1].click());
    assert.deepEqual(calls, [["old-x", urls[1]]]);
    await m.rerender({ ...shared, xUserId: "new-x", currentIconUrl: urls[1] });
    await act(async () => pending.resolve({ ok: true, iconUrl: urls[0], message: "old completed" }));
    await m.flush();
    buttons = [...m.container.querySelectorAll('button[aria-label="候補アイコンを選択"]')];
    assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
    assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
    assert.equal(refreshed, 0, "old account completion must not refresh the new account");
    assert.equal(m.container.textContent.includes("old completed"), false);
  } finally {
    await m.dispose();
  }
});

test("MIG-0708 U03: A-B-A account switch rejects first A mutation completion", async () => {
  const pending = deferred();
  let refreshed = 0;
  const urls = ["https://cdn.example/a.png", "https://cdn.example/b.png"];
  const api = { setIcon: () => pending.promise };
  const common = { api, candidates: urls, onRefresh: () => { refreshed++; } };
  const m = await render(XIdIconPicker, { ...common, xUserId: "A", currentIconUrl: urls[0] });
  try {
    const buttons = [...m.container.querySelectorAll('button[aria-label="候補アイコンを選択"]')];
    await act(async () => buttons[1].click());
    await m.rerender({ ...common, xUserId: "B", currentIconUrl: urls[1] });
    await m.rerender({ ...common, xUserId: "A", currentIconUrl: urls[0] });
    await act(async () => pending.resolve({ ok: true, iconUrl: urls[1], message: "stale A completed" }));
    await m.flush();
    assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
    assert.equal(buttons[1].getAttribute("aria-pressed"), "false");
    assert.equal(refreshed, 0, "a previous generation of the same X ID cannot refresh the new session");
    assert.equal(m.container.textContent.includes("stale A completed"), false);
  } finally { await m.dispose(); }
});

test("MIG-0708 U03: icon notices from previous account are cleared on identity switch", async () => {
  const oldUrl = "https://cdn.example/old.png";
  const newUrl = "https://cdn.example/new.png";
  const api = { setIcon: async () => ({ ok: true, message: "old account saved" }) };
  const onRefresh = () => {};
  const m = await render(XIdIconPicker, {
    api, xUserId: "old-x", currentIconUrl: oldUrl, candidates: [oldUrl, newUrl], onRefresh,
  });
  try {
    const buttons = [...m.container.querySelectorAll('button[aria-label="候補アイコンを選択"]')];
    await m.click(buttons[1]);
    await m.flush();
    assert.match(m.container.textContent, /old account saved/);
    await m.rerender({
      api, xUserId: "new-x", currentIconUrl: newUrl, candidates: [oldUrl, newUrl], onRefresh,
    });
    assert.equal(m.container.textContent.includes("old account saved"), false);
    assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  } finally { await m.dispose(); }
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

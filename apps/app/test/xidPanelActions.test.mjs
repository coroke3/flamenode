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

test("MIG-0708 U03: obsolete A-B-A Active X result cannot refresh the next account", async () => {
  const pending = deferred(), calls = [];
  let refreshed = 0;
  const api = { setActive: id => { calls.push(id); return pending.promise; } };
  const common = { api, approved: true, onRefresh: () => { refreshed++; } };
  const m = await render(SetActiveXButton, { ...common, xUserId: "A" });
  try {
    await act(async () => buttonWith(m.container, "アクティブ").click());
    assert.deepEqual(calls, ["A"]);
    await m.rerender({ ...common, xUserId: "B" });
    await m.rerender({ ...common, xUserId: "A" });
    await act(async () => pending.resolve({ ok: true }));
    await m.flush();
    assert.equal(refreshed, 0, "stale account's Active X result must not refresh the new view");
  } finally { await m.dispose(); }
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

test("MIG-0708 U03: CURRENT profile placeholders and hidden YouTube/SNS picker values reach the update body", async () => {
  const socials = JSON.stringify([{ type: "X", url: "https://x.com/creator" }]);
  const youtube = "https://www.youtube.com/@creator";
  const updates = [];
  let refreshed = 0;
  const api = { updateProfile: async (id, fields) => {
    updates.push({ id, fields });
    return { ok: true, message: "保存しました。" };
  } };
  const x = {
    id: "alpha", x_name: "Alpha", icon_url: null,
    profile_text: "About", portfolio_contact: "Contact",
    youtube_channel_url: youtube, other_social_links: socials,
  };
  const m = await render(XIdCompactProfileForm, {
    api, x, iconCandidates: [], channelCandidates: [youtube],
    onRefresh: () => { refreshed++; },
  });
  try {
    const form = m.container.querySelector("form");
    assert.ok(form.classList.contains("xids-stack"), "CURRENT profile form uses vertical spacing");
    const nameInput = form.querySelector('[name="x_name"]');
    const iconGroup = form.querySelector('[role="group"][aria-label="X IDアイコン"]');
    const aboutInput = form.querySelector('[name="profile_text"]');
    assert.ok(iconGroup, "icon picker is a part of the same CURRENT profile form");
    assert.ok(nameInput.compareDocumentPosition(iconGroup) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(iconGroup.compareDocumentPosition(aboutInput) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      "CURRENT field order: name, icon, About, contact, channel, socials");
    assert.equal(form.querySelector('[name="x_name"]').placeholder, "@alpha");
    assert.equal(form.querySelector('[name="profile_text"]').placeholder,
      "制作スタイル、得意なこと、活動紹介など");
    assert.equal(form.querySelector('[name="portfolio_contact"]').placeholder,
      "依頼・連絡先、メール、フォームURL、DM可否など");
    assert.equal(form.querySelector('[name="youtube_channel_url"]').value, youtube);
    assert.equal(form.querySelector('[name="other_social_links"]').value, socials);
    await act(async () => form.dispatchEvent(new dom.window.Event("submit", {
      bubbles: true, cancelable: true,
    })));
    await m.flush();
    assert.deepEqual(updates, [{ id: "alpha", fields: {
      x_name: "Alpha", profile_text: "About", portfolio_contact: "Contact",
      youtube_channel_url: youtube, other_social_links: socials,
    } }]);
    assert.equal(refreshed, 1, "success must refresh one time");
  } finally { await m.dispose(); }
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

test("MIG-0708 U03 T04: shared square-crop editor blocks invalid input; uploads only after 256x256 confirmation", async () => {
  const savedUrl="/api/media/xicons/foo/saved-icon.webp";
  const files=[],api={uploadIcon:async(id,file)=>{files.push([id,file]);return {ok:true,iconUrl:savedUrl};}};
  const m=await render(XIdIconPicker,{api,xUserId:"foo",currentIconUrl:null,candidates:[],onRefresh:()=>{}});
  const priorBitmap = globalThis.createImageBitmap;
  const oldGetContext = dom.window.HTMLCanvasElement.prototype.getContext;
  const oldToBlob = dom.window.HTMLCanvasElement.prototype.toBlob;
  try {
    await m.click(buttonWith(m.container,"アップロード"));
    const input=m.container.querySelector('input[type="file"]');
    assert.equal(input.getAttribute("aria-label"),"アイコン画像を選ぶ");
    const tooLarge = new File([new Uint8Array(2*1024*1024+1)],"huge.png",{type:"image/png"});
    Object.defineProperty(input,"files",{configurable:true,value:[tooLarge]});
    await act(async()=>input.dispatchEvent(new dom.window.Event("change",{bubbles:true})));
    assert.equal(files.length,0);
    assert.match(m.container.querySelector('[role="alert"]').textContent,/2MB/);
    const invalid = new File(["bad"],"not-an-icon.txt",{type:"text/plain"});
    Object.defineProperty(input,"files",{configurable:true,value:[invalid]});
    await act(async()=>input.dispatchEvent(new dom.window.Event("change",{bubbles:true})));
    assert.equal(files.length,0);
    assert.match(m.container.querySelector('[role="alert"]').textContent,/PNG・JPEG・WEBP/);

    const drawings=[];
    const bitmap={width:640,height:480,close(){}};
    globalThis.createImageBitmap=async()=>bitmap;
    dom.window.HTMLCanvasElement.prototype.getContext=function(){return {
      clearRect(){},drawImage(...args){drawings.push({width:this.canvas?.width??null,args});}
    };};
    let oversizeConvertedFile = true;
    dom.window.HTMLCanvasElement.prototype.toBlob=function(cb,type){
      const bytes = oversizeConvertedFile ? new Uint8Array(2*1024*1024+1) : "encoded-webp";
      oversizeConvertedFile = false;
      cb(new Blob([bytes],{type:type==="image/webp"?"image/webp":"image/png"}));
    };
    const valid=new File(["original"],"icon.png",{type:"image/png"});
    Object.defineProperty(input,"files",{configurable:true,value:[valid]});
    await act(async()=>input.dispatchEvent(new dom.window.Event("change",{bubbles:true})));
    await m.flush();
    assert.equal(files.length,0,"source file must not upload before crop confirmation");
    assert.ok(m.container.querySelector('canvas[width="280"]'),"crop preview is mounted");
    await m.click(buttonWith(m.container,"この画像を使用"));
    await m.flush();
    assert.equal(files.length,0,"a converted icon exceeding 2 MiB must not reach the API");
    assert.match(m.container.querySelector('[role="alert"]').textContent,/変換後の画像サイズが2MBを超えています/);
    assert.ok(m.container.querySelector('canvas[width="280"]'),"failed conversion must preserve editor for retry");
    await m.click(buttonWith(m.container,"この画像を使用"));
    await m.flush();
    assert.equal(files.length,1,"only a valid converted file should be sent");
    assert.equal(files[0][0],"foo");
    assert.equal(files[0][1].type,"image/webp");
    assert.equal(files[0][1].name,"icon.webp");
    assert.equal(files[0][1].size,12);
    assert.equal(files[0][1]===valid,false,"never upload original bytes");
    assert.ok(drawings.length>=2,"preview and 256x256 conversion both draw");
    assert.match(m.container.textContent,/アイコンをアップロードしました/);
    const savedLink = [...m.container.querySelectorAll("a")].find(a => a.textContent.includes("保存済み画像を表示"));
    assert.ok(savedLink, "CURRENT provides a link to inspect the confirmed uploaded icon");
    assert.equal(savedLink.getAttribute("href"), savedUrl);
    await m.rerender({ api, xUserId: "other", currentIconUrl: null, candidates: [], onRefresh: () => {} });
    assert.equal(m.container.querySelector('a.xids-iconHint'), null,
      "the saved URL of the previous X ID must not leak into another account");
  } finally {
    globalThis.createImageBitmap=priorBitmap;
    dom.window.HTMLCanvasElement.prototype.getContext=oldGetContext;
    dom.window.HTMLCanvasElement.prototype.toBlob=oldToBlob;
    await m.dispose();
  }
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
    assert.equal(buttons[0].getAttribute("aria-pressed"), "true",
      "CURRENT visually selects the first eligible candidate if no icon is saved");
    assert.ok(buttons[0].classList.contains("xids-iconButtonActive"));
    assert.ok(buttons[0].querySelector(".xids-iconSelectedMark"),
      "CURRENT selected candidate must include the visible checkmark");
    assert.ok(buttons[0].querySelector(".xids-iconThumb"),
      "CURRENT thumbnail sizing class must be applied");
    assert.equal(buttons[1].getAttribute("aria-pressed"), "false");
    assert.ok(!buttons[1].classList.contains("xids-iconButtonActive"));
    assert.equal(buttons[1].querySelector(".xids-iconSelectedMark"), null);
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


test("MIG-0708 U03: icon candidate fallback follows each X ID, not prior optimistic selection", async () => {
  const fromA = "https://cdn.example/from-a.png";
  const fromB = "https://cdn.example/from-b.png";
  let writes = 0;
  const api = { setIcon: async () => { writes++; return { ok: true, iconUrl: fromA }; } };
  const props = { api, currentIconUrl: null, onRefresh: () => {} };
  const m = await render(XIdIconPicker, { ...props, xUserId: "A", candidates: [fromA] });
  try {
    const aIcon = m.container.querySelector('button[aria-label="候補アイコンを選択"]');
    assert.equal(aIcon.getAttribute("aria-pressed"), "true",
      "CURRENT defaults to first server-scoped candidate without writing to server");
    assert.equal(writes, 0);
    await m.click(aIcon);
    await m.flush();
    assert.equal(writes, 1);
    await m.rerender({ ...props, xUserId: "B", candidates: [fromB] });
    const bIcon = m.container.querySelector('button[aria-label="候補アイコンを選択"]');
    assert.equal(bIcon.getAttribute("aria-pressed"), "true",
      "B must select its own candidate, not A's prior optimistic icon");
    assert.ok(bIcon.querySelector("img").src.includes("from-b.png"));
    assert.ok(!m.container.querySelector('img[src*="from-a.png"]'),
      "B must not render A-only candidate after identity change");
    assert.equal(writes, 1, "candidate fallback must not issue another mutation");
    await m.rerender({ ...props, xUserId: "C", candidates: [] });
    assert.equal(m.container.querySelector('button[aria-label="候補アイコンを選択"]'), null,
      "no eligible candidates should show no selected icon");
  } finally {
    await m.dispose();
  }
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

test("MIG-0708 U03: unlink confirmation resets on X switch and stale delete cannot refresh", async () => {
  const pending = deferred();
  const calls = [];
  let refreshed = 0;
  const api = { deleteXId: (id, confirmation) => {
    calls.push([id, confirmation]);
    return pending.promise;
  } };
  const props = { api, isActive: false, onRefresh: () => { refreshed++; } };
  const m = await render(DeleteXIdForm, { ...props, xUserId: "A" });
  try {
    await m.click(buttonWith(m.container, "連携を解除"));
    const input = m.container.querySelector(".cdlg-confirmation input");
    assert.ok(m.container.querySelector('[role="alertdialog"][aria-modal="true"]'));
    await act(async () => {
      const propKey = Object.keys(input).find(k => k.startsWith("__reactProps$"));
      input[propKey].onChange({ target: { value: "DELETE A" } });
    });
    await m.click(buttonWith(m.container, "連携を削除する"));
    assert.deepEqual(calls, [["A", "DELETE A"]]);
    await m.rerender({ ...props, xUserId: "B" });
    assert.equal(m.container.querySelector("input"), null, "the old confirmation dialog must close for B");
    await m.rerender({ ...props, xUserId: "A" });
    await act(async () => pending.resolve({ ok: true }));
    await m.flush();
    assert.equal(refreshed, 0, "A's obsolete deletion response must not refresh a new generation");
    assert.equal(m.container.querySelector("input"), null);
  } finally { await m.dispose(); }
});

test("MIG-0708 U03 T05: unlink cannot execute before exact confirmation",async()=>{
  const calls=[];let refresh=0;
  const m=await render(DeleteXIdForm,{api:{deleteXId:async(...args)=>{calls.push(args);return {ok:true};}},xUserId:"foo",isActive:false,onRefresh:()=>refresh++});
  await m.click(buttonWith(m.container,"連携を解除"));
  const confirm=buttonWith(m.container,"連携を削除する");
  assert.equal(confirm.disabled,true);
  assert.equal(calls.length,0);
  assert.ok(m.container.querySelector('[role="alertdialog"][aria-modal="true"]'));
  assert.match(m.container.textContent,/X ID自体・過去の作品・履歴は削除されません/);
  assert.match(m.container.textContent,/このDiscordアカウントからは編集できなくなります/);
  const input=m.container.querySelector(".cdlg-confirmation input");
  const key=Object.keys(input).find(k=>k.startsWith("__reactProps$"));
  await act(async()=>input[key].onChange({target:{value:"DELETE bar"}}));
  assert.equal(confirm.disabled,true);
  await act(async()=>input[key].onChange({target:{value:"DELETE foo"}}));
  assert.equal(confirm.disabled,false);
  await m.click(confirm);
  await m.flush();
  assert.deepEqual(calls,[["foo","DELETE foo"]]);
  assert.equal(refresh,1);
  await m.dispose();
});

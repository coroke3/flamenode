import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { dom, flush } from "./helpers.mjs";

const { VideoCollabPermsManager } = await import("../.test-dist/apps/app/src/components/VideoCollabPermsManager.js");

const editor = (overrides = {}) => ({
  x_user_id: "already", user_id: null, display_name: "共同作者", can_edit: 1,
  is_public_member: 1, has_discord_link: false, ...overrides,
});

async function mount(overrides = {}) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  let refreshed = 0;
  await act(async () => {
    root.render(React.createElement(VideoCollabPermsManager, {
      videoId: "vid 1", videoTitle: "投稿@everyone",
      subjects: [editor()], publicMembers: [{
        x_user_id: "second", display_name: "公開メンバー", role: "制作",
        can_edit: 0,
      }],
      editPrivilegeMode: "event",
      onRefresh: () => { refreshed++; },
      ...overrides,
    }));
  });
  return { container, get refreshed() { return refreshed; },
    unmount: async () => act(async () => root.unmount()) };
}
const button = (c, label) => {
  const found = [...c.querySelectorAll("button")].find(x => x.textContent.includes(label));
  assert.ok(found, "expected button: " + label);
  return found;
};
async function press(b) {
  await act(async () => { b.click(); });
  await flush();
}

test("MIG-0715 U03 isolated manager preserves public/hidden editor presentation and link warning", async () => {
  const m = await mount({ subjects: [
    editor({ has_discord_link: false }),
    editor({ x_user_id: "secret", display_name: "非公開作者",
      is_public_member: 0, has_discord_link: true }),
  ] });
  assert.match(m.container.textContent, /X ID連携待ちの編集者が 1 人います/);
  assert.match(m.container.textContent, /非公開編集者/);
  assert.match(m.container.textContent, /非公開作者/);
  assert.match(m.container.textContent, /公開メンバー/);
  assert.match(m.container.textContent, /video.permissions/);
  assert.equal(m.container.querySelectorAll(".vcollab-row").length, 2);
  assert.equal(m.refreshed, 0);
  await m.unmount();
});

test("MIG-0715 U03 grant confirmation preserves notification choice and exact server body", async () => {
  const priorFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return new Response(JSON.stringify({ ok: true, message: "作品編集への参加を付与しました。" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const m = await mount();
    await press(button(m.container, "公開メンバー @second"));
    assert.match(m.container.textContent, /作品編集に参加させますか/);
    assert.match(m.container.textContent, /作品の編集権限が付与されました/);
    // A mention is neutralized in the CURRENT Discord notification preview.
    assert.ok(m.container.textContent.includes("投稿@\u200beveryone"));
    assert.equal(sent.length, 0, "opening the confirmation never writes");
    await press(button(m.container, "付与のみ"));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "/api/videos/vid%201/collaborators/second");
    assert.equal(sent[0].init.method, "PUT");
    assert.deepEqual(JSON.parse(sent[0].init.body), {
      display_name: "公開メンバー", can_edit: true, notify: false,
      edit_privilege_mode: "event",
    });
    assert.equal(m.refreshed, 1);
    assert.match(m.container.textContent, /作品編集への参加を付与しました/);
    await m.unmount();
  } finally { globalThis.fetch = priorFetch; }
});

test("MIG-0715 U03 revoke preserves public membership and passes no notification", async () => {
  const priorFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return new Response(JSON.stringify({ ok: true, message: "反映しました。" }), { status: 200 });
  };
  try {
    const m = await mount();
    await press(button(m.container, "変更"));
    assert.match(m.container.textContent, /公開メンバーとしての表示・役割・コメントは残ります/);
    assert.equal(sent.length, 0);
    await press(button(m.container, "解除する"));
    assert.equal(m.refreshed, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "/api/videos/vid%201/collaborators/batch");
    assert.equal(sent[0].init.method, "POST");
    assert.deepEqual(JSON.parse(sent[0].init.body), {
      edit_privilege_mode: "event", notify: false,
      intents: [{ x_user_id: "already", display_name: "共同作者", intent: "off" }],
    });
    await m.unmount();
  } finally { globalThis.fetch = priorFetch; }
});

test("MIG-0715 U03 rejected permissions show Hono message and never report a refresh", async () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false, message: "権限がありません。",
  }), { status: 403 });
  try {
    const m = await mount();
    await press(button(m.container, "変更"));
    await press(button(m.container, "解除する"));
    assert.match(m.container.textContent, /権限がありません/);
    assert.equal(m.refreshed, 0);
    await m.unmount();
  } finally { globalThis.fetch = priorFetch; }
});

test("MIG-0715 U03 uncertain network result is not retried or reported as a successful grant", async () => {
  const priorFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error("connection reset"); };
  try {
    const m = await mount();
    await press(button(m.container, "公開メンバー @second"));
    await press(button(m.container, "付与のみ"));
    assert.equal(requests, 1, "permission mutations must never be retried automatically");
    assert.equal(m.refreshed, 0);
    assert.match(m.container.textContent, /処理結果を確認できませんでした/);
    await m.unmount();
  } finally { globalThis.fetch = priorFetch; }
});

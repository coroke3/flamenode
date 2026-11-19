// MIG-0708 U03: mounted Personal settings X ID mutations and silent refresh.
import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { fakeApi, flush, mount, ok, settings, settingsX, user } from "./helpers.mjs";

const makeFixture = () => settings({
  user: user({ active_x_user_id: "active" }),
  xIds: [settingsX("active"), settingsX("second")],
  panel: {
    xId: "second",
    iconCandidates: ["https://images.example.test/icon.png"],
    channelCandidates: ["https://www.youtube.com/@sample"],
  },
});

test("MIG-0708 T02: approved nonactive X has switch, unlink and profile form; active X cannot be unlinked", async () => {
  const a = fakeApi({ getSettings: ok(makeFixture()) });
  a.xidProfile = {
    setActive: async () => ({ ok: true }), updateProfile: async () => ({ ok: true }),
    deleteXId: async () => ({ ok: true }), setIcon: async () => ({ ok: true }),
    uploadIcon: async () => ({ ok: true }),
  };
  const m = await mount("/dashboard/settings?x=second", a);
  assert.match(m.container.textContent, /公開プロフィール/);
  assert.ok([...m.container.querySelectorAll("button")].some(b => b.textContent.includes("アクティブに設定")));
  assert.ok([...m.container.querySelectorAll("button")].some(b => b.textContent.includes("連携を解除")));
  assert.ok(m.container.querySelector('input[name="other_social_links"]'), "structured social editor mounted");
  assert.ok(m.container.querySelector('input[name="youtube_channel_url"]'), "channel picker mounted");
  assert.match(m.container.textContent, /アイコン候補（作品サムネから自動取得）/);
  await m.unmount();

  const active = await mount("/dashboard/settings?x=active", a);
  assert.equal([...active.container.querySelectorAll("button")].filter(b => b.textContent.includes("連携を解除")).length, 0);
  assert.equal([...active.container.querySelectorAll("button")].filter(b => b.textContent.includes("アクティブに設定")).length, 0);
  await active.unmount();
});

test("MIG-0708 T06: setActive success rereads settings silently without replacing visible panel with loading", async () => {
  const data = makeFixture();
  let resolveRefresh;
  let readCount = 0;
  const a = fakeApi({ getSettings: () => {
    readCount += 1;
    return readCount === 1 ? ok(data) : new Promise(resolve => { resolveRefresh = resolve; });
  } });
  const writes = [];
  a.xidProfile = {
    setActive: async id => { writes.push(id); return { ok: true }; },
    updateProfile: async () => ({ ok: true }), deleteXId: async () => ({ ok: true }),
    setIcon: async () => ({ ok: true }), uploadIcon: async () => ({ ok: true }),
  };
  const m = await mount("/dashboard/settings?x=second", a);
  const button = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("アクティブに設定"));
  assert.ok(button, "switch button should mount");
  await act(async () => { button.click(); });
  await flush();
  assert.deepEqual(writes, ["second"]);
  assert.equal(readCount, 2);
  assert.ok(m.container.querySelector("#settings-panel-x"), "existing private panel stays visible");
  assert.doesNotMatch(m.container.textContent, /読み込み中\.\.\./);
  await act(async () => { resolveRefresh(ok(data)); });
  await flush();
  assert.ok(m.container.querySelector("#settings-panel-x"));
  await m.unmount();
});

test("MIG-0708: pending X has no edit/switch; mismatched candidate ID never leaks another X's icon", async () => {
  const data = settings({
    xIds: [settingsX("pending", { approval_status: "pending" })],
    panel: { xId: "another-x", iconCandidates: ["https://images.example.test/private.png"], channelCandidates: [] },
  });
  const a = fakeApi({ getSettings: ok(data) });
  a.xidProfile = {
    setActive: async () => { throw Error("unexpected"); }, updateProfile: async () => { throw Error("unexpected"); },
    deleteXId: async () => ({ ok: true }), setIcon: async () => { throw Error("unexpected"); },
    uploadIcon: async () => { throw Error("unexpected"); },
  };
  const m = await mount("/dashboard/settings", a);
  assert.doesNotMatch(m.container.textContent, /公開プロフィール/);
  assert.ok(![...m.container.querySelectorAll("button")].some(b => b.textContent.includes("アクティブに設定")));
  assert.ok(![...m.container.querySelectorAll("img")].some(el => el.src.includes("private.png")));
  await m.unmount();
});

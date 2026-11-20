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
  const activeBtn = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("アクティブに設定"));
  const unlinkBtn = [...m.container.querySelectorAll("button")].find(b => b.textContent.includes("連携を解除"));
  assert.ok(activeBtn?.classList.contains("settings-actionBtnPrimary"), "SetActiveXButton uses CURRENT primary pill styling");
  assert.ok(unlinkBtn?.classList.contains("settings-actionBtnDanger"), "DeleteXIdForm uses CURRENT danger pill styling");
  assert.ok(m.container.querySelector('input[name="other_social_links"]'), "structured social editor mounted");
  assert.ok(m.container.querySelector('input[name="youtube_channel_url"]'), "channel picker mounted");
  assert.match(m.container.textContent, /アイコン候補（作品サムネから自動取得）/);
  await m.unmount();

  const active = await mount("/dashboard/settings?x=active", a);
  assert.equal([...active.container.querySelectorAll("button")].filter(b => b.textContent.includes("連携を解除")).length, 0);
  assert.equal([...active.container.querySelectorAll("button")].filter(b => b.textContent.includes("アクティブに設定")).length, 0);
  await active.unmount();
});

test("MIG-0708 T02 / MIG-0702 T03: manager-only approved X exposes CURRENT switch, profile and unlink controls", async () => {
  // This is the exact SettingsResponse DTO shape verified from a real
  // link_role='manager' D1 row by apps/api/test/personal.parity.test.mjs.
  // SettingsXIdSchema intentionally does not expose link_role to the SPA.
  const managerId = "manager_only_x";
  const data = settings({
    user: user({ active_x_user_id: "active" }),
    xIds: [settingsX("active"), settingsX(managerId)],
    panel: { xId: managerId, iconCandidates: [], channelCandidates: [] },
  });
  const calls = [];
  const a = fakeApi({ getSettings: ok(data) });
  a.xidProfile = {
    setActive: async id => { calls.push(id); return { ok: true }; },
    updateProfile: async () => ({ ok: true }),
    deleteXId: async () => ({ ok: true }),
    setIcon: async () => ({ ok: true }),
    uploadIcon: async () => ({ ok: true }),
  };
  const m = await mount(`/dashboard/settings?x=${managerId}`, a);
  try {
    assert.match(m.container.querySelector("#settings-x-h")?.textContent ?? "", /manager_only_x/);
    const buttons = [...m.container.querySelectorAll("button")];
    const active = buttons.find(b => b.textContent.includes("アクティブに設定"));
    assert.ok(active, "CURRENT allows approved manager X to become Active X");
    assert.ok(buttons.some(b => b.textContent.includes("連携を解除")),
      "nonactive manager X exposes unlink confirmation; backend checks owner dependencies");
    assert.ok(m.container.querySelector('input[name="x_name"]'),
      "approved manager X gets the same profile editor as an owner link");
    await act(async () => active.click());
    await flush();
    assert.deepEqual(calls, [managerId], "Active X request must address the manager-linked X exactly once");
  } finally { await m.unmount(); }

  const denied = settings({
    user: user({ active_x_user_id: "active" }),
    xIds: [settingsX("active"), settingsX(managerId, { approval_status: "pending" })],
    panel: { xId: managerId, iconCandidates: [], channelCandidates: [] },
  });
  const pending = await mount(`/dashboard/settings?x=${managerId}`, fakeApi({
    getSettings: ok(denied), xidProfile: a.xidProfile,
  }));
  try {
    assert.ok(![...pending.container.querySelectorAll("button")].some(b => b.textContent.includes("アクティブに設定")),
      "unapproved manager X cannot switch Active X");
    assert.equal(pending.container.querySelector(".settings-editPanel"), null,
      "unapproved manager X cannot edit a public profile");
  } finally { await pending.unmount(); }
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
  assert.equal(m.container.querySelector(".settings-editPanel"), null, "pending X must have no editable profile");
  assert.ok(![...m.container.querySelectorAll("button")].some(b => b.textContent.includes("アクティブに設定")));
  assert.ok(![...m.container.querySelectorAll("img")].some(el => el.src.includes("private.png")));
  await m.unmount();
});

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://flamenode.test/admin/videos/v1/members",
});
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "FormData"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { AdminVideoMembersForm } = await import(
  "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembersForm.js"
);
const { saveAdminVideoMembers } = await import(
  "../.test-dist/apps/ops/src/api/adminVideoMemberSave.js"
);
const h = React.createElement;

const video = { id: "v1", title: "Test", collaboration_type: "collab" };
function setup(overrides = {}) {
  const target = document.createElement("div");
  document.body.append(target);
  const root = createRoot(target);
  const props = {
    video, initialMembersCount: 1,
    membersField: h("input", { name: "members_json", type: "hidden", value: '[{"name":"Alice"}]' }),
    ...overrides,
  };
  const render = async (nextProps = {}) => React.act(async () => {
    Object.assign(props, nextProps);
    root.render(h(AdminVideoMembersForm, props));
  });
  const submit = async () => React.act(async () => {
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    target.querySelector("form").dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, "JS form prevents browser submission");
  });
  const cleanup = async () => React.act(async () => {
    root.unmount();
    target.remove();
  });
  return { target, render, submit, cleanup };
}
function deferred() {
  let finish;
  return { promise: new Promise(resolve => { finish = resolve; }), finish: value => finish(value) };
}

test("MIG-0730 U02c: no save adapter or member form means no active mutation button", async () => {
  const ui = setup({ membersField: null });
  try {
    await ui.render();
    assert.equal(ui.target.querySelector('button[type="submit"]'), null);
    assert.match(ui.target.textContent, /保存機能は移行中/);
    await ui.submit();
  } finally { await ui.cleanup(); }
});

test("MIG-0730 T01: repeated submit events while save is pending start exactly one write", async () => {
  const wait = deferred();
  const calls = [];
  const ui = setup({ save: async form => {
    calls.push([...form.entries()]);
    return wait.promise;
  } });
  try {
    await ui.render();
    await ui.submit();
    await ui.submit();
    assert.equal(calls.length, 1);
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);
    assert.deepEqual(calls[0].filter(([k]) => k === "is_collab"), [
      ["is_collab", "false"], ["is_collab", "true"],
    ]);
    await React.act(async () => wait.finish({ ok: true }));
    assert.match(ui.target.textContent, /保存しました/);
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 T02: turning collaboration off submits false and an empty members array only", async () => {
  const bodies = [];
  const ui = setup({ save: async data => {
    bodies.push(Object.fromEntries(data.entries()));
    return { ok: true };
  } });
  try {
    await ui.render();
    await React.act(async () => ui.target.querySelector('input[type="checkbox"]').click());
    assert.match(ui.target.textContent, /合作をOFFにすると/);
    await ui.submit();
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].video_id, "v1");
    assert.equal(bodies[0].is_collab, "false");
    assert.equal(bodies[0].members_json, "[]");
  } finally { await ui.cleanup(); }
});

test("MIG-0730 T03: 101 members fail closed without writing any member batch", async () => {
  let count = 0;
  const members = Array.from({ length: 101 }, (_, i) => ({ name: "Member " + i }));
  const ui = setup({
    membersField: h("input", { type: "hidden", name: "members_json", value: JSON.stringify(members) }),
    save: async () => { count++; return { ok: true }; },
  });
  try {
    await ui.render();
    await ui.submit();
    assert.equal(count, 0);
    assert.match(ui.target.querySelector('[role="alert"]').textContent, /100人/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02c: invalid member JSON and hidden edit-only member fail closed", async () => {
  for (const payload of ["{", '[{"name":"hidden","is_public_member":0}]']) {
    let called = false;
    const ui = setup({
      membersField: h("input", { type: "hidden", name: "members_json", value: payload }),
      save: async () => { called = true; return { ok: true }; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(called, false);
      assert.ok(ui.target.querySelector('[role="alert"]'));
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0730 U02c: failed or rejected save never triggers refresh callback", async () => {
  for (const adapter of [
    async () => ({ ok: false, message: "not authorized" }),
    async () => { throw new Error("network unavailable"); },
  ]) {
    let refreshed = 0;
    const ui = setup({ save: adapter, onSaved: () => { refreshed++; } });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(refreshed, 0);
      assert.ok(ui.target.querySelector('[role="alert"]'));
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0730 U02c: A save resolving after navigation to B never refreshes B or displays A success", async () => {
  const wait = deferred();
  let aSaved = 0, bSaved = 0, bWrites = 0;
  const ui = setup({
    save: async () => wait.promise,
    onSaved: () => { aSaved++; },
  });
  try {
    await ui.render();
    await ui.submit();
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);
    await ui.render({
      video: { id: "v2", title: "Video B", collaboration_type: null },
      initialMembersCount: 0,
      onSaved: () => { bSaved++; },
      save: async () => { bWrites++; return { ok: true }; },
    });
    assert.equal(ui.target.querySelector('input[name="video_id"]').value, "v2");
    assert.equal(ui.target.querySelector('input[type="checkbox"]').checked, false,
      "B collab state must not inherit A");
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false,
      "B submit must not inherit A in-flight latch");
    await React.act(async () => wait.finish({ ok: true, message: "A saved" }));
    assert.equal(aSaved, 0, "A's retired form cannot trigger refresh");
    assert.equal(bSaved, 0);
    assert.doesNotMatch(ui.target.textContent, /A saved/);
    await ui.submit();
    assert.equal(bWrites, 1);
    assert.equal(bSaved, 1);
    assert.match(ui.target.textContent, /保存しました/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02c: A rejected save after B navigation cannot produce an error in B", async () => {
  const wait = deferred();
  const ui = setup({ save: async () => wait.promise });
  try {
    await ui.render();
    await ui.submit();
    await ui.render({
      video: { id: "v2", title: "Video B", collaboration_type: null },
      initialMembersCount: 0,
      save: undefined,
    });
    await React.act(async () => wait.finish(Promise.reject(new Error("old video error"))));
    assert.doesNotMatch(ui.target.textContent, /保存中にエラー|保存に失敗しました/);
    assert.match(ui.target.textContent, /保存機能は移行中/);
  } finally { await ui.cleanup(); }
});


test("MIG-0730 U02k: unmounted Ops form -> SA-085 candidate sends exact ON JSON and verified save callback", async () => {
  const requests = [];
  let saved = 0;
  const ui = setup({
    save: formData => saveAdminVideoMembers("v1", formData, async (path, init) => {
      requests.push({ path, init });
      return new Response(JSON.stringify({ ok: true, videoId: "v1" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }),
    onSaved: () => { saved++; },
  });
  try {
    await ui.render();
    await ui.submit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "/api/videos/v1/members");
    assert.equal(requests[0].init.method, "PUT");
    assert.equal(requests[0].init.credentials, "same-origin");
    assert.equal(requests[0].init.cache, "no-store");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      is_collab: ["false", "true"],
      members_json: '[{"name":"Alice"}]',
    });
    assert.equal(saved, 1);
    assert.match(ui.target.querySelector('[role="status"]').textContent, /保存しました/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02k: unmounted form -> candidate collaboration OFF submits [] and no stale members", async () => {
  const requests = [];
  let saved = 0;
  const ui = setup({
    save: formData => saveAdminVideoMembers("v1", formData, async (path, init) => {
      requests.push({ path, init });
      return new Response(JSON.stringify({ ok: true, videoId: "v1" }), { status: 200 });
    }),
    onSaved: () => { saved++; },
  });
  try {
    await ui.render();
    await React.act(async () => ui.target.querySelector('input[name="is_collab"][type="checkbox"]').click());
    assert.deepEqual([...new FormData(ui.target.querySelector("form")).getAll("is_collab")], ["false"]);
    await ui.submit();
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      is_collab: ["false"], members_json: "[]",
    });
    assert.equal(saved, 1);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02k: unmounted form -> candidate lost write response never retries or refreshes", async () => {
  const wait = deferred();
  let called = 0, refreshed = 0;
  const ui = setup({
    save: data => saveAdminVideoMembers("v1", data, async () => {
      called++;
      return wait.promise;
    }),
    onSaved: () => { refreshed++; },
  });
  try {
    await ui.render();
    await ui.submit();
    await ui.submit();
    assert.equal(called, 1, "even duplicate submit events cannot double-write");
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);
    await React.act(async () => wait.finish(Promise.reject(new Error("reply lost after commit"))));
    assert.equal(called, 1, "a possibly committed write must not auto-retry");
    assert.equal(refreshed, 0, "no false success callback");
    assert.match(ui.target.querySelector('[role="alert"]').textContent, /保存結果を確認できませんでした/);
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
  } finally { await ui.cleanup(); }
});

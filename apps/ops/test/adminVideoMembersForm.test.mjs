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

test("MIG-0730 U02r: same-video write capability revocation/regrant ignores obsolete async results", async () => {
  for (const outcome of ["success", "failure"]) {
    const wait = deferred();
    let staleRefreshes = 0;
    let newRefreshes = 0;
    let oldWrites = 0;
    const ui = setup({
      save: async () => { oldWrites++; return wait.promise; },
      onSaved: () => { staleRefreshes++; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(oldWrites, 1);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

      // Keep the SAME video and form instance: only the injected save capability
      // changes. A previous request may already have committed on the server.
      await ui.render({ save: undefined, onSaved: undefined });
      assert.equal(ui.target.querySelector('button[type="submit"]'), null);
      await ui.render({
        save: async () => ({ ok: true }),
        onSaved: () => { newRefreshes++; },
      });
      // Keep the latch until the old request settles: do not allow two writes.
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

      const reply = outcome === "success"
        ? { ok: true, message: "OBSOLETE SAVE SUCCEEDED" }
        : Promise.reject(new Error("OBSOLETE SAVE FAILED"));
      await React.act(async () => wait.finish(reply));
      assert.equal(staleRefreshes, 0, "revoked adapter must not refresh");
      assert.equal(newRefreshes, 0, "regranted adapter must not receive stale success");
      assert.doesNotMatch(ui.target.textContent, /OBSOLETE SAVE|保存中にエラー/);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
      await ui.submit();
      assert.equal(newRefreshes, 1, "only a fresh authorized save refreshes");
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0730 U02s: losing required member field retires a pending save even if the adapter remains", async () => {
  const pendingSave = deferred();
  let writes = 0;
  let refreshes = 0;
  const field = h("input", {
    type: "hidden", name: "members_json", value: '[{"name":"Alice"}]',
  });
  const ui = setup({
    membersField: field,
    save: async () => { writes++; return pendingSave.promise; },
    onSaved: () => { refreshes++; },
  });
  try {
    await ui.render();
    await ui.submit();
    assert.equal(writes, 1);
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

    // A parent can withdraw the member editor without withdrawing the save
    // function. The old request cannot be safely treated as authorized UI state.
    await ui.render({ membersField: null });
    assert.equal(ui.target.querySelector('button[type="submit"]'), null);
    await ui.render({ membersField: field });
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

    await React.act(async () => pendingSave.finish({
      ok: true, message: "OBSOLETE MEMBER SAVE",
    }));
    assert.equal(refreshes, 0, "obsolete write must not refresh after field revocation");
    assert.doesNotMatch(ui.target.textContent, /OBSOLETE MEMBER SAVE/);
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
    assert.equal(writes, 1, "no automatic retry of the possibly committed request");
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02u: refresh callback failure never disguises a successful save or retries", async () => {
  for (const kind of ["synchronous", "asynchronous"]) {
    let writes = 0, refreshes = 0;
    const ui = setup({
      save: async () => { writes++; return { ok: true, message: "保存しました" }; },
      onSaved: () => {
        refreshes++;
        if (kind === "synchronous") throw new Error("refresh failed");
        return Promise.reject(new Error("refresh rejected"));
      },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(writes, 1, "a committed save must not be retried");
      assert.equal(refreshes, 1);
      assert.equal(ui.target.querySelector('[role="alert"]'), null,
        "a failed refresh is not a failed mutation");
      assert.match(ui.target.querySelector('[role="status"]').textContent,
        /保存は完了しましたが、表示の更新に失敗しました/);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0730 U02y: swapping same-video save adapter retires its old async success or failure", async () => {
  for (const outcome of ["success", "failure"]) {
    const pending = deferred();
    let oldWrites = 0, nextWrites = 0, oldRefreshes = 0, nextRefreshes = 0;
    const oldSave = async () => { oldWrites++; return pending.promise; };
    const nextSave = async () => { nextWrites++; return { ok: true, message: "NEW SAVE" }; };
    const ui = setup({
      save: oldSave,
      onSaved: () => { oldRefreshes++; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(oldWrites, 1);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

      // The capability remains truthy while a caller swaps its scoped
      // authorization adapter. The old request may already have committed.
      await ui.render({ save: nextSave, onSaved: () => { nextRefreshes++; } });
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true,
        "do not overlap an unknown write with a new adapter request");

      const late = outcome === "success"
        ? { ok: true, message: "OBSOLETE ADAPTER SUCCESS" }
        : Promise.reject(new Error("obsolete adapter request failed"));
      await React.act(async () => pending.finish(late));
      assert.equal(oldRefreshes, 0);
      assert.equal(nextRefreshes, 0);
      assert.doesNotMatch(ui.target.textContent, /OBSOLETE ADAPTER|保存中にエラー/);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
      assert.equal(nextWrites, 0, "no automatic replay after the old settlement");

      await ui.submit();
      assert.equal(nextWrites, 1);
      assert.equal(nextRefreshes, 1);
      assert.match(ui.target.textContent, /NEW SAVE/);
    } finally { await ui.cleanup(); }
  }
});


test("MIG-0730 U02ah: absent member editor cannot activate a destructive OFF save", async () => {
  for (const missing of [null, false, undefined]) {
    let writes = 0;
    const ui = setup({
      membersField: missing,
      save: async () => { writes++; return { ok: true }; },
    });
    try {
      await ui.render();
      let checkbox = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      assert.equal(checkbox.checked, true);
      assert.equal(checkbox.disabled, true,
        "when a member editor is missing, the collaboration toggle must be read-only");
      assert.equal(ui.target.querySelector('button[type="submit"]'), null);
      await React.act(async () => checkbox.click());
      assert.equal(checkbox.checked, true, "a disabled checkbox cannot switch the form into OFF mode");
      assert.equal(ui.target.querySelector('button[type="submit"]'), null);
      await ui.submit();
      assert.equal(writes, 0, "a forged submit must not write without the canonical member editor");

      // An individual video without the editor must also remain read-only:
      // otherwise a synthetic [] payload could delete existing data.
      await ui.render({
        video: { id: "v2", title: "Individual", collaboration_type: null },
        initialMembersCount: 0,
      });
      checkbox = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      assert.equal(checkbox.checked, false);
      assert.equal(checkbox.disabled, true);
      assert.equal(ui.target.querySelector('button[type="submit"]'), null);
      await ui.submit();
      assert.equal(writes, 0);

      // Restoring a real field explicitly enables a fresh authorized submit.
      await ui.render({
        membersField: h("input", {
          type: "hidden", name: "members_json",
          value: '[{"name":"Bob","x_user_id":"bob"}]',
        }),
      });
      assert.equal(ui.target.querySelector('input[name="is_collab"][type="checkbox"]').disabled, false);
      assert.ok(ui.target.querySelector('button[type="submit"]'));
      await ui.submit();
      assert.equal(writes, 1, "a complete authorized form can submit exactly once");
    } finally {
      await ui.cleanup();
    }
  }
});

test("MIG-0730 U02ah: a supplied editor without save port retains only local checkbox draft", async () => {
  const ui = setup();
  try {
    await ui.render();
    const checkbox = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
    assert.equal(checkbox.disabled, false,
      "a complete editor may prepare a local collaboration draft without a save adapter");
    assert.equal(ui.target.querySelector("fieldset").disabled, true,
      "member fields remain read-only while the save authorization is absent");
    assert.equal(ui.target.querySelector('button[type="submit"]'), null);
    await React.act(async () => checkbox.click());
    assert.equal(ui.target.querySelector('input[name="is_collab"][type="checkbox"]').checked, false);
    assert.equal(new FormData(ui.target.querySelector("form")).get("members_json"), "[]",
      "draft OFF is local only and must not activate a save control");
    assert.equal(ui.target.querySelector('button[type="submit"]'), null);
    await ui.submit();
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0730 U02ak: form must never pass collaborator can_edit in members_json", async () => {
  for (const flag of [1, 0, true, false, null]) {
    let writes = 0;
    const ui = setup({
      membersField: h("input", {
        type: "hidden",
        name: "members_json",
        value: JSON.stringify([{ name: "Alice", can_edit: flag }]),
      }),
      save: async () => { writes++; return { ok: true }; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(writes, 0, "can_edit " + String(flag) + " must not reach the save adapter");
      assert.match(ui.target.querySelector('[role="alert"]')?.textContent ?? "", /入力を確認|100人/);
      assert.ok(ui.target.querySelector('button[type="submit"]'),
        "a rejected payload must not permanently disable the form");
    } finally {
      await ui.cleanup();
    }
  }
});

test("MIG-0730 U02ap/U02aq: only canonical shared field or exact hidden input authorizes writes", async () => {
  // Native placeholders and opaque React composites must not grant write
  // capability. Fragment/func components are truthy React elements but can
  // render zero real membership inputs.
  const MissingMemberField = () => null;
  const ForgedMemberField = () => h("input", {
    type: "hidden", name: "members_json", value: "[]",
  });
  const invalidEditors = [
    h("div", null, "not a member editor"),
    h("span", null, "placeholder"),
    h("input", { type: "hidden", name: "different_json", value: "[]" }),
    h("input", { type: "text", name: "members_json", value: "[]" }),
    h(React.Fragment, null),
    h(React.Fragment, null, h("input", {
      type: "hidden", name: "members_json", value: "[]",
    })),
    h(MissingMemberField),
    h(ForgedMemberField),
  ];
  for (const editor of invalidEditors) {
    let writes = 0;
    const ui = setup({
      membersField: editor,
      save: async () => { writes++; return { ok: true }; },
    });
    try {
      await ui.render();
      let toggle = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      assert.equal(toggle.disabled, true, "invalid editor must not grant a collaboration toggle");
      assert.equal(ui.target.querySelector('button[type="submit"]'), null);
      await React.act(async () => toggle.click());
      assert.equal(toggle.checked, true);
      await ui.submit();
      assert.equal(writes, 0, "invalid native member field cannot submit");

      // An initially individual video already has members_json=[] in its OFF
      // branch. A native placeholder must still never authorize deleting data.
      await ui.render({
        video: { id: "v2", title: "Individual", collaboration_type: null },
        initialMembersCount: 0,
      });
      toggle = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      assert.equal(toggle.checked, false);
      assert.equal(toggle.disabled, true);
      assert.equal(ui.target.querySelector('button[type="submit"]'), null);
      await ui.submit();
      assert.equal(writes, 0);
    } finally {
      await ui.cleanup();
    }
  }

  // A valid directly injected hidden member input remains supported; the
  // production VideoMembersField composite also stays eligible.
  let writes = 0;
  const ui = setup({
    membersField: h("input", {
      type: "hidden", name: "members_json", value: '[{"name":"Alice"}]',
    }),
    save: async () => { writes++; return { ok: true }; },
  });
  try {
    await ui.render();
    assert.equal(ui.target.querySelector('input[name="is_collab"][type="checkbox"]').disabled, false);
    await ui.submit();
    assert.equal(writes, 1);
  } finally {
    await ui.cleanup();
  }
});

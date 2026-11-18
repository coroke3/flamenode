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
const { MemoryRouter } = await import("react-router-dom");
const { AdminVideoMembersForm } = await import(
  "../.test-dist/apps/ops/src/routes/admin/AdminVideoMembersForm.js"
);
const { saveAdminVideoMembers } = await import(
  "../.test-dist/apps/ops/src/api/adminVideoMemberSave.js"
);
const { VideoMembersField } = await import("@flamenode/ui");
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
    root.render(h(MemoryRouter, null, h(AdminVideoMembersForm, props)));
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

test("MIG-0730 U02ci: editable member footer preserves CURRENT navigation and safe public fallbacks", async () => {
  const youtube = "dQw4w9WgXcQ";
  const cases = [
    { id: "v1", youtubeId: youtube, expected: "/" + youtube },
    { id: "v1", youtubeId: "https://youtu.be/" + youtube + "?t=30", expected: "/" + youtube },
    { id: "v1", youtubeId: "https://www.youtube.com/watch?v=" + youtube, expected: "/" + youtube },
    { id: "v1", youtubeId: "https://youtube.com/shorts/" + youtube, expected: "/" + youtube },
    { id: "v1", youtubeId: "https://youtube.com/embed/" + youtube, expected: "/" + youtube },
    { id: "v1", youtubeId: "https://youtube.com.evil.test/watch?v=" + youtube, expected: "/v1" },
    { id: "v1", youtubeId: "//malicious.test/video", expected: "/v1" },
    { id: "v1", youtubeId: null, expected: "/v1" },
    // Standalone previews may receive malformed, unvalidated legacy metadata.
    // Neither an unexpected type nor a hostile .trim method may crash render.
    { id: "v1", youtubeId: 123, expected: "/v1" },
    { id: "v1", youtubeId: { trim() { throw new Error("do not call malformed .trim"); } }, expected: "/v1" },
    { id: 42, youtubeId: null, expected: "/list", detail: "/admin/videos" },
    { id: "id with space", youtubeId: "invalid-id", expected: "/list" },
    { id: "bad/path", youtubeId: null, expected: "/list", detail: "/admin/videos" },
    { id: String.fromCharCode(0xD800), youtubeId: null, expected: "/list", detail: "/admin/videos" },
  ];
  for (const entry of cases) {
    const ui = setup({ video: { ...video, id: entry.id, youtube_video_id: entry.youtubeId } });
    try {
      await ui.render();
      const links = Array.from(ui.target.querySelectorAll("a"));
      const detail = links.find(link => link.textContent.trim() === "詳細へ戻る");
      const publicLink = links.find(link => link.textContent.trim() === "公開ページ");
      assert.ok(detail, "CURRENT detail footer is present without a save adapter");
      assert.equal(detail.getAttribute("href"), entry.detail ??
        "/admin/videos/" + encodeURIComponent(entry.id));
      assert.ok(publicLink, "CURRENT public footer is present");
      assert.equal(publicLink.getAttribute("href"), entry.expected);
      assert.equal(publicLink.getAttribute("target"), "_blank");
      assert.equal(publicLink.getAttribute("rel"), "noopener noreferrer");
      assert.equal(ui.target.querySelector('button[type="submit"]'), null,
        "navigation never activates an unapproved SA-085 adapter");
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0730 U02bz: unsafe video IDs in standalone Form cannot enable an injected write", async () => {
  for (const id of ["", ".", "..", " v1", "v1 ", "v/1", "v\\1", "v\n1", "\uD800", "x".repeat(65)]) {
    let writes = 0, refreshes = 0;
    const ui = setup({
      video: { ...video, id },
      save: async () => { writes++; return { ok: true }; },
      onSaved: () => { refreshes++; },
    });
    try {
      await ui.render();
      assert.equal(ui.target.querySelector('button[type="submit"]'), null,
        "invalid video identity never enables save: " + JSON.stringify(id));
      await ui.submit();
      assert.equal(writes, 0, "no write on invalid ID");
      assert.equal(refreshes, 0, "no onSaved on invalid ID");
    } finally { await ui.cleanup(); }
  }
  for (const id of ["valid-123", "x".repeat(64)]) {
    let writes = 0;
    const ui = setup({video: { ...video, id }, save: async data => {
      writes++;
      assert.equal(data.get("video_id"), id);
      return { ok: true };
    }});
    try {
      await ui.render();
      assert.ok(ui.target.querySelector('button[type="submit"]'));
      await ui.submit();
      assert.equal(writes, 1, "valid video ID still permits canonical save");
    } finally { await ui.cleanup(); }
  }
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

test("MIG-0730 U02by: direct form rejects forged transport fields before injected save", async () => {
  const cases = [
    { label: "duplicate video target", name: "video_id", value: "other" },
    { label: "duplicate member JSON", name: "members_json", value: "[]" },
    { label: "duplicate collab flag", name: "is_collab", value: "true" },
    { label: "privilege ON", name: "can_edit", value: "true" },
    { label: "privilege OFF", name: "can_edit", value: "true", off: true },
    { label: "unknown OFF", name: "unexpected_field", value: "1", off: true },
  ];
  for (const scenario of cases) {
    let saves = 0, refreshes = 0;
    const ui = setup({
      save: async () => { saves++; return { ok: true }; },
      onSaved: () => { refreshes++; },
    });
    try {
      await ui.render();
      if (scenario.off) {
        await React.act(async () => ui.target.querySelector('input[type="checkbox"]').click());
      }
      const extra = document.createElement("input");
      extra.type = "hidden";
      extra.name = scenario.name;
      extra.value = scenario.value;
      ui.target.querySelector("form").append(extra);
      await ui.submit();
      assert.equal(saves, 0, scenario.label + " did not call injected save");
      assert.equal(refreshes, 0, scenario.label + " cannot confirm a forged write");
      assert.equal(ui.target.querySelector('[role="alert"]')?.textContent,
        "参加者設定の入力を確認してください。", scenario.label);
      extra.remove();
      await ui.submit();
      assert.equal(saves, 1, scenario.label + " canonical ON/OFF still saves");
      assert.equal(refreshes, 1, scenario.label + " only real success refreshes");
    } finally { await ui.cleanup(); }
  }
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

test("MIG-0730 U02c/U02bb: malformed native member data cannot become a destructive OFF save", async () => {
  for (const payload of [
    "{", "null", '{"members":[]}',
    '[{"name":"hidden","is_public_member":0}]',
    '[{"name":"hidden","can_edit":true}]',
  ]) {
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
      const toggle = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      await React.act(async () => toggle.click());
      assert.equal(toggle.checked, false);
      assert.deepEqual(new FormData(ui.target.querySelector("form")).getAll("members_json"), ["[]"],
        "the synthetic OFF field alone must not validate a broken original editor");
      await ui.submit();
      assert.equal(called, false, "malformed or privileged native member rows cannot trigger a destructive OFF write");
      assert.match(ui.target.querySelector('[role="alert"]').textContent, /形式が正しくありません/);
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


test("MIG-0730 U02cg: rotating same-video onSaved authority retires old save completion", async () => {
  for (const outcome of ["success", "failure"]) {
    const pending = deferred();
    let writes = 0, previousRefreshes = 0, currentRefreshes = 0;
    const save = async () => {
      writes++;
      return writes === 1
        ? pending.promise
        : { ok: true, message: "CURRENT AUTHORIZED SAVE" };
    };
    const ui = setup({
      save,
      onSaved: () => { previousRefreshes++; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(writes, 1);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

      // The video ID and save adapter stay stable. The caller's post-save
      // refresh authority alone is replaced while the PUT remains unresolved.
      await ui.render({ onSaved: () => { currentRefreshes++; } });
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true,
        "new callback must not start a second write before old PUT settles");

      const settled = outcome === "success"
        ? { ok: true, message: "STALE CALLBACK SAVE", pendingPublicReflection: true }
        : Promise.reject(new Error("old save completion may have already mutated D1"));
      await React.act(async () => pending.finish(settled));
      assert.equal(previousRefreshes, 0, "retired callback must not refetch old authority");
      assert.equal(currentRefreshes, 0, "old write must not refresh the new authority");
      assert.doesNotMatch(ui.target.textContent, /STALE CALLBACK SAVE|公開ページへの反映は/,
        "obsolete success and public reflection notice must not appear");
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
      assert.equal(writes, 1, "never replay an unknown server mutation automatically");

      await ui.submit();
      assert.equal(writes, 2);
      assert.equal(currentRefreshes, 1);
      assert.equal(previousRefreshes, 0);
      assert.match(ui.target.textContent, /CURRENT AUTHORIZED SAVE/);
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
    // A disabled or value-less hidden input cannot grant destructive OFF writes.
    h("input", { type: "hidden", name: "members_json", value: "[]", disabled: true }),
    h("input", { type: "hidden", name: "members_json", value: "[]", disabled: "true" }),
    h("input", { type: "hidden", name: "members_json", disabled: false }),
    h("input", { type: "hidden", name: "members_json", defaultValue: "[]" }),
    h("input", { type: "hidden", name: "members_json", value: 5 }),
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

test("MIG-0730 U02ar: canonical shared member field must match video and have live write adapters", async () => {
  const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null, hint: null });
  const applyPermissionBatch = async () => ({ ok: true });
  const baseline = {
    initialMembers: [{ name: "Alice", x_user_id: "alice", role: "",
      comment: "", chapters: [] }],
    searchXUsers,
    applyPermissionBatch,
    permissionTargetVideoId: "v1",
  };
  const invalid = [
    { disabled: true },
    { disabled: "true" },
    { hiddenName: "other_json" },
    { permissionTargetVideoId: "v2" },
    { permissionTargetVideoId: null },
    { searchXUsers: undefined },
    { applyPermissionBatch: undefined },
  ];
  for (const props of invalid) {
    let writes = 0;
    const ui = setup({
      membersField: h(VideoMembersField, { ...baseline, ...props }),
      save: async () => { writes++; return { ok: true }; },
    });
    try {
      await ui.render();
      let toggle = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      assert.equal(toggle.disabled, false,
        "recognized canonical editor may retain a local collaboration draft without write privilege");
      assert.equal(ui.target.querySelector('button[type="submit"]'), null,
        "read-only or wrong-target canonical editor cannot grant writes");
      await ui.submit();
      assert.equal(writes, 0, "no write from unprivileged ON editor");
      await React.act(async () => toggle.click());
      assert.equal(toggle.checked, false, "unauthorized local OFF draft is still possible");
      assert.equal(ui.target.querySelector('button[type="submit"]'), null);
      await ui.submit();
      assert.equal(writes, 0, "local OFF draft must never authorize a destructive save");

      await ui.render({
        video: { id: "v2", title: "Individual", collaboration_type: null },
        initialMembersCount: 0,
      });
      toggle = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      assert.equal(toggle.checked, false);
      // For wrong-target fixture v2, the video now matches; it must be tested
      // separately, so only assert this second state for the other variants.
      if (props.permissionTargetVideoId !== "v2") {
        assert.equal(toggle.disabled, false,
          "a recognized editor remains locally draftable while write capability is absent");
        assert.equal(ui.target.querySelector('button[type="submit"]'), null);
        await ui.submit();
        assert.equal(writes, 0, "read-only/mismatched OFF editor cannot delete members");
      }
    } finally {
      await ui.cleanup();
    }
  }

  // The real Ops editor composition with matching video and both adapters
  // remains writable; it still serializes the standard public-member payload.
  let writes = 0, payload;
  const ui = setup({
    membersField: h(VideoMembersField, baseline),
    save: async data => {
      writes++;
      payload = data.get("members_json");
      return { ok: true };
    },
  });
  try {
    await ui.render();
    assert.equal(ui.target.querySelector('input[name="is_collab"][type="checkbox"]').disabled, false);
    assert.ok(ui.target.querySelector('button[type="submit"]'));
    await ui.submit();
    assert.equal(writes, 1);
    assert.deepEqual(JSON.parse(payload).map(row => row.name), ["Alice"]);
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0730 U02at: rotating either member privilege adapter retires pending save receipts", async () => {
  for (const rotated of ["searchXUsers", "applyPermissionBatch"]) {
    for (const outcome of ["success", "failure"]) {
      const pending = deferred();
      let writes = 0, refreshes = 0;
      const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null, hint: null });
      const applyPermissionBatch = async () => ({ ok: true });
      const base = {
        initialMembers: [{ name: "Alice", x_user_id: "alice", role: "", comment: "", chapters: [] }],
        permissionTargetVideoId: "v1",
        searchXUsers,
        applyPermissionBatch,
      };
      const save = async () => {
        writes++;
        return writes === 1 ? pending.promise : { ok: true, message: "FRESH SAVE" };
      };
      const ui = setup({
        membersField: h(VideoMembersField, base),
        save,
        onSaved: () => { refreshes++; },
      });
      try {
        await ui.render();
        await ui.submit();
        assert.equal(writes, 1);
        assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

        // Both ports remain callable, the video ID stays the same and the
        // save callback is unchanged. A new adapter is still a new authority.
        const replacement = rotated === "searchXUsers"
          ? async () => ({ items: [], hasMore: false, nextOffset: null, hint: null })
          : async () => ({ ok: true });
        await ui.render({
          membersField: h(VideoMembersField, { ...base, [rotated]: replacement }),
        });
        assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true,
          "the unsettled write latch cannot be bypassed after a port swap");

        const response = outcome === "success"
          ? { ok: true, message: "STALE PRIVILEGE CONTEXT" }
          : Promise.reject(new Error("stale privilege context rejected"));
        await React.act(async () => pending.finish(response));
        assert.equal(refreshes, 0, "stale completion must not refresh a new authority");
        assert.doesNotMatch(ui.target.textContent, /STALE PRIVILEGE CONTEXT|保存中にエラー/);
        assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
        assert.equal(writes, 1, "a possibly committed write must not be replayed automatically");

        await ui.submit();
        assert.equal(writes, 2);
        assert.equal(refreshes, 1, "only an explicit save under the new ports can refresh");
        assert.match(ui.target.textContent, /FRESH SAVE/);
      } finally { await ui.cleanup(); }
    }
  }
});

test("MIG-0730 U02az: local OFF/ON preserves canonical editor draft without submitting private rows while OFF", async () => {
  const searchXUsers = async () => ({ items: [], hasMore: false, nextOffset: null, hint: null });
  const applyPermissionBatch = async () => ({ ok: true });
  const requests = [];
  const ui = setup({
    membersField: h(VideoMembersField, {
      initialMembers: [{
        name: "Alice", x_user_id: "alice", role: "", comment: "", chapters: [],
      }],
      searchXUsers, applyPermissionBatch, permissionTargetVideoId: "v1",
    }),
    save: async form => {
      requests.push([...form.entries()]);
      return { ok: true, message: "保存しました" };
    },
  });
  try {
    await ui.render();
    const form = ui.target.querySelector("form");
    const fieldset = form.querySelector("fieldset");
    const toggle = form.querySelector('input[name="is_collab"][type="checkbox"]');
    const tableButton = [...form.querySelectorAll("button")].find(b => b.textContent.trim() === "表");
    assert.ok(tableButton, "real shared VideoMembersField is mounted");
    await React.act(async () => tableButton.click());
    assert.equal(tableButton.getAttribute("aria-pressed"), "true");
    assert.equal(form.querySelectorAll('input[placeholder="表示名"]').length, 1);

    const addRow = [...form.querySelectorAll("button")].find(b => /行を追加/.test(b.textContent));
    assert.ok(addRow);
    await React.act(async () => addRow.click());
    assert.equal(form.querySelectorAll('input[placeholder="表示名"]').length, 2,
      "unsaved additional member row exists in local editor draft");
    const hidden = fieldset.querySelector('input[name="members_json"]');
    assert.ok(hidden);
    await React.act(async () => toggle.click());
    assert.equal(toggle.checked, false);
    assert.equal(fieldset.disabled, true);
    assert.equal(fieldset.style.display, "none");
    assert.equal(fieldset.querySelector('input[name="members_json"]'), hidden,
      "temporary OFF must not unmount the editor or discard its local state");
    assert.deepEqual(new FormData(form).getAll("members_json"), ["[]"],
      "OFF must exclude the disabled editor and submit only literal empty members");

    await React.act(async () => toggle.click());
    assert.equal(toggle.checked, true);
    assert.equal(fieldset.disabled, false);
    assert.equal(fieldset.querySelector('input[name="members_json"]'), hidden);
    assert.equal(tableButton.getAttribute("aria-pressed"), "true");
    assert.equal(form.querySelectorAll('input[placeholder="表示名"]').length, 2,
      "existing local table mode and newly added unsaved row must survive OFF/ON");
    assert.deepEqual(JSON.parse(new FormData(form).get("members_json")).map(r => r.name), ["Alice"]);

    await ui.submit();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].filter(([key]) => key === "members_json").length, 1);
    assert.deepEqual(JSON.parse(requests[0].find(([key]) => key === "members_json")[1])
      .map(r => r.name), ["Alice"]);

    await React.act(async () => toggle.click());
    await ui.submit();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].filter(([key]) => key === "members_json"), [["members_json", "[]"]],
      "explicit OFF save remains destructive only when submitted");
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0730 U02bf: collaboration OFF retires shared permission confirmation and pending results without losing rows", async () => {
  for (const phase of ["confirmation", "in-flight"]) {
    const late = deferred();
    let permissionWrites = 0;
    const ui = setup({
      membersField: h(VideoMembersField, {
        initialMembers: [{ name: "Alice", x_user_id: "alice", role: "", comment: "", chapters: [] }],
        searchXUsers: async () => ({ items: [], hasMore: false, nextOffset: null }),
        applyPermissionBatch: async () => { permissionWrites++; return late.promise; },
        permissionTargetVideoId: "v1",
      }),
      save: async () => ({ ok: true, message: "saved" }),
    });
    const byText = text => {
      const button = [...ui.target.querySelectorAll("button")].find(
        item => item.textContent.trim() === text,
      );
      assert.ok(button, "expected button " + text);
      return button;
    };
    try {
      await ui.render();
      const toggle = ui.target.querySelector('input[name="is_collab"][type="checkbox"]');
      const form = ui.target.querySelector("form");
      const fieldset = form.querySelector("fieldset");
      const textarea = fieldset.querySelector("#members-tsv-input");
      assert.ok(textarea);
      await React.act(async () => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set;
        assert.ok(setter);
        setter.call(textarea, ["Bob", "bob", "", "", "", "ON"].join(String.fromCharCode(9)));
        textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await React.act(async () => byText("内容を確認").click());
      assert.match(ui.target.textContent, /確認（1行）/);
      await React.act(async () => byText("追加").click());
      assert.ok(fieldset.querySelector('[role="alertdialog"]'),
        "a privileged confirmation exists before the parent is switched OFF");
      if (phase === "in-flight") {
        await React.act(async () => byText("変更を反映").click());
        assert.equal(permissionWrites, 1);
        assert.equal(byText("反映中...").disabled, true);
      }
      const editorPayload = fieldset.querySelector('input[name="members_json"]');
      assert.ok(editorPayload);
      await React.act(async () => toggle.click());
      assert.equal(toggle.checked, false);
      assert.equal(fieldset.disabled, true);
      assert.equal(fieldset.querySelector('[role="alertdialog"]'), null,
        "parent OFF must close the child permission dialog, not just CSS-hide it");
      assert.deepEqual(new FormData(form).getAll("members_json"), ["[]"]);

      await React.act(async () => toggle.click());
      assert.equal(toggle.checked, true);
      assert.equal(fieldset.disabled, false);
      assert.equal(fieldset.querySelector('[role="alertdialog"]'), null,
        "previous permission confirmation cannot resume after OFF/ON");
      assert.equal(fieldset.querySelector('input[name="members_json"]'), editorPayload);
      assert.deepEqual(JSON.parse(editorPayload.value).map(row => row.name), ["Alice"],
        "unsaved member data remains mounted but no unconfirmed bulk intent applies");
      if (phase === "in-flight") {
        await React.act(async () => late.finish({ ok: true, message: "STALE PERMISSION RECEIPT" }));
        assert.doesNotMatch(ui.target.textContent, /STALE PERMISSION RECEIPT/);
        assert.deepEqual(JSON.parse(editorPayload.value).map(row => row.name), ["Alice"],
          "an already dispatched permission reply may not rewrite the resumed editor");
      } else {
        assert.equal(permissionWrites, 0,
          "an abandoned confirmation cannot dispatch any privilege mutation");
      }
      assert.equal(permissionWrites, phase === "in-flight" ? 1 : 0,
        "OFF/ON must never retry or replay a permission write");
    } finally {
      await ui.cleanup();
    }
  }
});

test("MIG-0730 U02bf: missing save port disables child permission and TSV UI", async () => {
  let permissionWrites = 0;
  let searches = 0;
  const ui = setup({
    membersField: h(VideoMembersField, {
      initialMembers: [{ name: "Alice", x_user_id: "alice", role: "", comment: "", chapters: [] }],
      searchXUsers: async () => { searches++; return { items: [], hasMore: false }; },
      applyPermissionBatch: async () => { permissionWrites++; return { ok: true }; },
      permissionTargetVideoId: "v1",
    }),
    save: undefined,
  });
  try {
    await ui.render();
    const form = ui.target.querySelector("form");
    assert.equal(form.querySelector('button[type="submit"]'), null);
    assert.equal(form.querySelector("fieldset").disabled, true);
    const textarea = form.querySelector("#members-tsv-input");
    assert.ok(textarea);
    assert.equal(textarea.disabled, true,
      "a read-only parent must not merely disable its fieldset: child adapters must be revoked");
    const confirm = [...form.querySelectorAll("button")].find(b => b.textContent.trim() === "内容を確認");
    assert.ok(confirm);
    assert.equal(confirm.disabled, true);
    const toggle = form.querySelector('input[name="is_collab"][type="checkbox"]');
    await React.act(async () => toggle.click());
    assert.deepEqual(new FormData(form).getAll("members_json"), ["[]"]);
    await React.act(async () => toggle.click());
    assert.equal(form.querySelector("#members-tsv-input").disabled, true);
    assert.equal(permissionWrites, 0);
    assert.equal(searches, 0);
    assert.deepEqual(JSON.parse(form.querySelector('fieldset input[name="members_json"]').value)
      .map(row => row.name), ["Alice"]);
  } finally {
    await ui.cleanup();
  }
});

test("MIG-0730 U02bc: replacing same-video native member data retires stale save responses", async () => {
  for (const outcome of ["success", "failure"]) {
    const pending = deferred();
    const entries = [];
    let priorRefreshes = 0, currentRefreshes = 0;
    const save = async form => {
      entries.push(form.get("members_json"));
      return entries.length === 1 ? pending.promise : { ok: true, message: "CURRENT MEMBER SAVE" };
    };
    const native = name => h("input", {
      type: "hidden", name: "members_json", value: JSON.stringify([{ name }]),
    });
    const ui = setup({
      membersField: native("Alice"),
      save,
      onSaved: () => { priorRefreshes++; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(entries.length, 1);
      assert.deepEqual(JSON.parse(entries[0]).map(row => row.name), ["Alice"]);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

      // A same-video server snapshot can replace the native source even when
      // the save callback and authorized editor presence are unchanged.
      await ui.render({
        membersField: native("Bob"),
        onSaved: () => { currentRefreshes++; },
      });
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true,
        "do not overlap a potentially committed mutation");
      // A pending mutation disables the entire fieldset, so FormData omits
      // its hidden members_json. Inspect the new DOM source value directly
      // while the previous request remains unsettled.
      const currentInput = ui.target.querySelector('fieldset input[name="members_json"]');
      assert.ok(currentInput);
      assert.deepEqual(JSON.parse(currentInput.value).map(row => row.name), ["Bob"]);

      const late = outcome === "success"
        ? { ok: true, message: "OBSOLETE ALICE SAVE" }
        : Promise.reject(new Error("obsolete Alice response"));
      await React.act(async () => pending.finish(late));
      assert.equal(priorRefreshes, 0);
      assert.equal(currentRefreshes, 0);
      assert.equal(entries.length, 1, "never auto-replay an ambiguous write");
      assert.doesNotMatch(ui.target.textContent, /OBSOLETE ALICE SAVE|保存中にエラー/);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);

      await ui.submit();
      assert.equal(entries.length, 2);
      assert.deepEqual(JSON.parse(entries[1]).map(row => row.name), ["Bob"]);
      assert.equal(currentRefreshes, 1, "only the current explicit save refreshes the new snapshot");
      assert.match(ui.target.textContent, /CURRENT MEMBER SAVE/);
    } finally {
      await ui.cleanup();
    }
  }
});

test("MIG-0730 U02bn: a rejected injected save does not imply rollback or invite a blind retry", async () => {
  const pending = deferred();
  let calls = 0, refreshes = 0;
  const ui = setup({
    save: async () => {
      calls++;
      return pending.promise;
    },
    onSaved: () => { refreshes++; },
  });
  try {
    await ui.render();
    await ui.submit();
    await ui.submit();
    assert.equal(calls, 1, "a pending mutation must not issue a second write");
    assert.equal(ui.target.querySelector('button[type="submit"]').disabled, true);

    // The write may have committed before an injected adapter lost its reply.
    await React.act(async () => pending.finish(Promise.reject(new Error("PRIVATE NETWORK TOKEN after DB commit"))));
    assert.equal(calls, 1, "rejected save must not be automatically replayed");
    assert.equal(refreshes, 0, "an unverified write must never trigger saved refresh");

    const alert = ui.target.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.equal(alert.textContent, "保存結果を確認できませんでした。最新状態を再取得してください。");
    assert.doesNotMatch(alert.textContent, /再試行|再度保存|もう一度|PRIVATE|TOKEN/,
      "unknown outcome must instruct server re-fetch and hide internal exception data");
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02bo: malformed injected save receipts cannot fake success or refresh a private view", async () => {
  const broken = [
    null,
    undefined,
    {},
    [],
    { ok: "true", message: "PRIVATE-RECEIPT" },
    { ok: 1, message: "PRIVATE-RECEIPT" },
    { ok: true, message: 42 },
    { ok: true, message: "x".repeat(301) },
    { ok: true, pendingPublicReflection: "true" },
    { ok: false, message: { secret: "PRIVATE-RECEIPT" } },
  ];
  for (const invalid of broken) {
    let writes = 0, refreshes = 0;
    const ui = setup({
      save: async () => { writes++; return invalid; },
      onSaved: () => { refreshes++; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(writes, 1, "one malformed receipt must not cause another write");
      assert.equal(refreshes, 0, "unverified write must not trigger onSaved");
      const alert = ui.target.querySelector('[role="alert"]');
      assert.ok(alert);
      assert.equal(alert.textContent,
        "保存結果を確認できませんでした。最新状態を再取得してください。");
      assert.doesNotMatch(ui.target.textContent, /PRIVATE-RECEIPT|\bPRIVATE\b|\bsecret\b/);
      assert.equal(ui.target.querySelector('button[type="submit"]').disabled, false);
    } finally { await ui.cleanup(); }
  }

  // A syntactically valid boolean failure should still preserve its safe
  // user-facing message, while a verified success may run the refresh callback.
  let refreshes = 0;
  const ui = setup({
    save: async () => ({ ok: true, message: "保存しました", pendingPublicReflection: true }),
    onSaved: () => { refreshes++; },
  });
  try {
    await ui.render();
    await ui.submit();
    assert.equal(refreshes, 1);
    assert.match(ui.target.textContent, /保存しました/);
    assert.match(ui.target.querySelector('[role="status"]')?.textContent ?? "",
      /公開ページへの反映は、静的データの再生成が完了するまで/,
      "confirmed delayed public reflection must display CURRENT notice");
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02cf: only successful pending public reflection shows delay notice", async () => {
  const scenarios = [
    { response: { ok: true, message: "保存しました", pendingPublicReflection: false }, delayed: false },
    { response: { ok: false, message: "保存できません", pendingPublicReflection: true }, delayed: false },
    { response: { ok: true, message: "保存しました", pendingPublicReflection: true }, delayed: true },
  ];
  for (const { response, delayed } of scenarios) {
    let refreshes = 0;
    const ui = setup({
      save: async () => response,
      onSaved: () => { refreshes++; },
    });
    try {
      await ui.render();
      await ui.submit();
      const notice = "公開ページへの反映は、静的データの再生成が完了するまで";
      assert.equal(ui.target.textContent.includes(notice), delayed,
        "only verified successful writes with pendingPublicReflection=true show the shared delay notice");
      assert.equal(refreshes, response.ok ? 1 : 0);
      if (!response.ok) {
        assert.match(ui.target.querySelector('[role="alert"]')?.textContent ?? "", /保存できません/);
        assert.equal(ui.target.querySelector('[role="status"]'), null);
      }
    } finally { await ui.cleanup(); }
  }
});

test("MIG-0730 U02cw: injected save receipt getters are validated once before refresh", async () => {
  const reads = { ok: 0, message: 0, pending: 0 };
  const receipt = {};
  Object.defineProperties(receipt, {
    ok: {
      get() { reads.ok++; return reads.ok === 1 ? false : true; },
    },
    message: {
      get() {
        reads.message++;
        return reads.message === 1 ? "保存できませんでした" : "PRIVATE_PROVIDER_TOKEN";
      },
    },
    pendingPublicReflection: {
      get() { reads.pending++; return reads.pending === 1 ? false : true; },
    },
  });
  let writes = 0, refreshes = 0;
  const ui = setup({
    save: async () => { writes++; return receipt; },
    onSaved: () => { refreshes++; },
  });
  try {
    await ui.render();
    await ui.submit();
    assert.equal(writes, 1, "the ambiguous mutation must never be retried");
    assert.deepEqual(reads, { ok: 1, message: 1, pending: 1 },
      "the validated properties must be the exact returned properties");
    assert.equal(refreshes, 0, "a validated failure cannot become success via getter mutation");
    assert.match(ui.target.querySelector('[role="alert"]')?.textContent ?? "",
      /保存できませんでした/);
    assert.doesNotMatch(ui.target.textContent,
      /PRIVATE_PROVIDER_TOKEN|公開ページへの反映は/);
  } finally { await ui.cleanup(); }
});

test("MIG-0730 U02cw: forged save accessors fail closed; ordinary success remains valid", async () => {
  const hostile = {};
  Object.defineProperty(hostile, "ok", { get() { throw Error("PRIVATE_RECEIPT"); } });
  const revoked = Proxy.revocable({ ok: true }, {});
  revoked.revoke();
  for (const forged of [hostile, revoked.proxy]) {
    let refreshes = 0;
    const ui = setup({
      save: async () => forged,
      onSaved: () => { refreshes++; },
    });
    try {
      await ui.render();
      await ui.submit();
      assert.equal(refreshes, 0);
      assert.equal(ui.target.querySelector('[role="alert"]')?.textContent,
        "保存結果を確認できませんでした。最新状態を再取得してください。");
      assert.doesNotMatch(ui.target.textContent, /PRIVATE_RECEIPT/);
    } finally { await ui.cleanup(); }
  }
  let refreshes = 0;
  const normal = setup({
    save: async () => ({ ok: true, message: "保存しました", pendingPublicReflection: true }),
    onSaved: () => { refreshes++; },
  });
  try {
    await normal.render();
    await normal.submit();
    assert.equal(refreshes, 1);
    assert.match(normal.target.textContent, /保存しました/);
    assert.match(normal.target.textContent, /公開ページへの反映は/);
  } finally { await normal.cleanup(); }
});

test("MIG-0730 U02da: standalone Form rejects a truthy non-callable save port", async () => {
  for (const malformed of [{ configured: true }, "configured", true]) {
    let refreshes = 0;
    const ui = setup({ save: malformed, onSaved: () => { refreshes++; } });
    try {
      await ui.render();
      assert.equal(ui.target.querySelector('button[type="submit"]'), null,
        "only callable save ports may enable the member form");
      assert.match(ui.target.textContent, /保存機能は移行中/);
      await ui.submit();
      assert.equal(refreshes, 0);
    } finally {
      await ui.cleanup();
    }
  }
});

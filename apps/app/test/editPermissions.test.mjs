import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { dom, flush, ok } from "./helpers.mjs";

const { getEditPermissions } = await import("../.test-dist/apps/app/src/api/videoCollaborators.js");
const { Permissions } = await import("../.test-dist/apps/app/src/routes/dashboard/edit/Permissions.js");
const { ACTIVE_X_CHANGED_EVENT } = await import("../.test-dist/apps/app/src/lib/activeXSwitchEvents.js");

const res = (status, body = null) => ({ status, json: async () => body });

async function mountPermissions(path, load, reload = () => {}) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [path] },
      React.createElement(Routes, null,
        React.createElement(Route, {
          path: "/dashboard/edit/:id/permissions",
          element: React.createElement(Permissions, { load, reload }),
        }))));
  });
  await flush();
  return { container, unmount: () => act(async () => root.unmount()) };
}

test("GET preserves repeated, explicit and unknown privilege values for server-side authorization", async () => {
  const seen = [];
  const got = await getEditPermissions({
    videoId: "video A/1",
    privilegeModes: ["admin", "unknown", "admin"],
    fetchFn: async (url, init) => {
      seen.push({ url, init });
      return res(200, { kind: "no_access", privilegeMode: "normal" });
    },
  });
  assert.deepEqual(got, ok({ kind: "no_access", privilegeMode: "normal" }));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/api/personal/edit/video%20A%2F1/permissions?privileged=admin&privileged=unknown&privileged=admin");
  assert.equal(seen[0].init.method, "GET");
  assert.equal(seen[0].init.credentials, "same-origin");
  assert.equal(seen[0].init.cache, "no-store");
  assert.deepEqual(seen[0].init.headers, { accept: "application/json" });
});

test("GET keeps 401/403/404/5xx/network/invalid DTO distinct", async () => {
  for (const [http, expected] of [[401, "anonymous"], [403, "banned"], [404, "not_found"], [503, "unavailable"]]) {
    const got = await getEditPermissions({ videoId: "id", privilegeModes: [], fetchFn: async () => res(http) });
    assert.equal(got.status, expected);
  }
  const invalid = await getEditPermissions({
    videoId: "id", privilegeModes: [], fetchFn: async () => res(200, { kind: "ok", subjects: [] }),
  });
  assert.equal(invalid.status, "unavailable");
  const malformed = await getEditPermissions({
    videoId: "id", privilegeModes: [], fetchFn: async () => ({ status: 200, json: async () => { throw Error("bad json"); } }),
  });
  assert.equal(malformed.status, "unavailable");
  const offline = await getEditPermissions({
    videoId: "id", privilegeModes: [], fetchFn: async () => { throw Error("network"); },
  });
  assert.equal(offline.status, "unavailable");
});

test("permission denial preserves CURRENT copy and privilege-scoped return link", async () => {
  const calls = [];
  const m = await mountPermissions("/dashboard/edit/video-1/permissions?privileged=admin", async (options) => {
    calls.push(options);
    return ok({ kind: "no_access", privilegeMode: "admin" });
  });
  assert.deepEqual(calls.map((x) => [x.videoId, x.privilegeModes]), [["video-1", ["admin"]]]);
  assert.match(m.container.textContent, /編集権限がありません/);
  assert.match(m.container.textContent, /video.permissions を持つ運営・管理者のみ設定できます/);
  assert.equal(m.container.querySelector("a")?.getAttribute("href"), "/dashboard/edit/video-1?privileged=admin");
  await m.unmount();
});

test("individual post read-only state and HTTP guard states", async () => {
  const view = await mountPermissions("/dashboard/edit/id/permissions", async () => ok({
    kind: "ok", privilegeMode: "normal",
    video: { id: "id", title: "Video", youtube_video_id: null, collaboration_type: "solo" },
    showCollabSection: false, subjects: [], publicMembers: [], truncated: false,
  }));
  assert.match(view.container.textContent, /作品「Video」/);
  assert.match(view.container.textContent, /この作品は個人投稿のため/);
  assert.equal(view.container.querySelectorAll("button,form").length, 0);
  await view.unmount();

  for (const [status, expected] of [
    ["anonymous", /ログインが必要です/],
    ["banned", /利用が停止されています/],
    ["unavailable", /画面の表示中に問題が発生しました/],
    ["not_found", /ページが見つかりません/],
  ]) {
    const m = await mountPermissions("/dashboard/edit/id/permissions", async () => ({ status }));
    assert.match(m.container.textContent, expected);
    await m.unmount();
  }
});

test("truncated collaborator data shows a warning and never provides write controls", async () => {
  const m = await mountPermissions("/dashboard/edit/id/permissions", async () => ok({
    kind: "ok", privilegeMode: "normal",
    video: { id: "id", title: "Video", youtube_video_id: null, collaboration_type: "collab" },
    showCollabSection: true, subjects: [{
      x_user_id: "coauthor", user_id: null, display_name: "共同作者", can_edit: 1,
      is_public_member: 1, has_discord_link: false, can_notify: false,
    }], publicMembers: [], truncated: true,
  }));
  assert.match(m.container.textContent, /共同作者/);
  assert.match(m.container.textContent, /一部省略されています/);
  assert.equal(m.container.querySelectorAll("button,form").length, 0);
  await m.unmount();
});


const {
  upsertVideoCollaborator,
  applyVideoCollaboratorPermissionsBatch,
} = await import("../.test-dist/apps/app/src/api/videoCollaborators.js");

const writeResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

test("MIG-0715 U02 SA-082 grant sends the canonical X ID and CURRENT-equivalent PUT fields", async () => {
  const requests = [];
  const result = await upsertVideoCollaborator({
    videoId: "video A/1", xUserId: "@Mixed_Case", displayName: "共同作者",
    canEdit: true, notify: false, editPrivilegeMode: "admin",
  }, async (url, init) => {
    requests.push({ url, init });
    return writeResponse(200, { ok: true, message: "作品編集への参加を付与しました。" });
  });
  assert.deepEqual(result, { status: "ok", data: { ok: true, message: "作品編集への参加を付与しました。" } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/videos/video%20A%2F1/collaborators/mixed_case");
  assert.deepEqual({
    method: requests[0].init.method,
    credentials: requests[0].init.credentials,
    cache: requests[0].init.cache,
    headers: requests[0].init.headers,
  }, {
    method: "PUT", credentials: "same-origin", cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
  });
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    display_name: "共同作者",
    can_edit: true,
    notify: false,
    edit_privilege_mode: "admin",
  });
});

test("MIG-0715 U02 SA-084 revoke sends one atomic intent and no implicit notification", async () => {
  const requests = [];
  const result = await applyVideoCollaboratorPermissionsBatch({
    videoId: "v-id",
    notify: false,
    editPrivilegeMode: "event",
    intents: [{ x_user_id: "Person", display_name: "共同作者", intent: "off" }],
  }, async (url, init) => {
    requests.push({ url, init });
    return writeResponse(200, { ok: true, revoked: ["person"], unchanged: 0 });
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.data, { ok: true, revoked: ["person"], unchanged: 0 });
  assert.equal(requests[0].url, "/api/videos/v-id/collaborators/batch");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    edit_privilege_mode: "event",
    notify: false,
    intents: [{ x_user_id: "person", display_name: "共同作者", intent: "off" }],
  });
});

test("MIG-0715 U02 normal privilege is omitted; the server alone resolves fallback", async () => {
  const requests = [];
  await upsertVideoCollaborator({
    videoId: "v", xUserId: "someone", displayName: "A",
    canEdit: false, notify: true, editPrivilegeMode: "normal",
  }, async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return writeResponse(409, { ok: false, message: "変更できません。" });
  });
  assert.deepEqual(requests, [{ display_name: "A", can_edit: false, notify: true }]);
});

test("MIG-0715 U02 fail-closed invalid X IDs and empty batches never reach HTTP", async () => {
  let called = 0;
  const fetchFn = async () => { called++; throw Error("must not call"); };
  for (const xUserId of ["", "invalid/name", "a".repeat(21), "http://evil.example/u"]) {
    const result = await upsertVideoCollaborator({
      videoId: "v", xUserId, displayName: "A", canEdit: true, notify: false,
    }, fetchFn);
    assert.equal(result.status, "invalid", xUserId);
    assert.match(result.message, /X ID/);
  }
  const empty = await applyVideoCollaboratorPermissionsBatch({
    videoId: "v", notify: false, intents: [],
  }, fetchFn);
  assert.equal(empty.status, "invalid");
  const partialInvalid = await applyVideoCollaboratorPermissionsBatch({
    videoId: "v", notify: true,
    intents: [{ x_user_id: "valid", display_name: "A", intent: "on" }, { x_user_id: "invalid/", display_name: "B", intent: "off" }],
  }, fetchFn);
  assert.equal(partialInvalid.status, "invalid");
  assert.equal(called, 0);
});

test("MIG-0715 U02 preserves explicit 409/403 denial and distinguishes network/auth/invalid JSON", async () => {
  const payload = {
    videoId: "v", xUserId: "valid", displayName: "A",
    canEdit: true, notify: false,
  };
  for (const [status, data] of [
    [409, { ok: false, message: "競合しています。" }],
    [403, { ok: false, message: "権限がありません。" }],
  ]) {
    assert.deepEqual(await upsertVideoCollaborator(payload, async () => writeResponse(status, data)),
      { status: "ok", data }, "valid API denials remain visible");
  }
  assert.equal((await upsertVideoCollaborator(payload, async () => writeResponse(401, { ok: true }))).status, "anonymous");
  assert.equal((await upsertVideoCollaborator(payload, async () => writeResponse(500, { ok: true }))).status, "unavailable");
  assert.equal((await upsertVideoCollaborator(payload, async () => writeResponse(200, { ok: "true" }))).status, "unavailable");
  assert.equal((await upsertVideoCollaborator(payload, async () => writeResponse(200, { ok: true, granted: [1] }))).status, "unavailable");
  let count = 0;
  const disconnected = await upsertVideoCollaborator(payload, async () => { count++; throw Error("connection reset"); });
  assert.equal(disconnected.status, "unavailable", "unknown commit outcome is not success");
  assert.equal(count, 1, "do not retry a permission-changing POST/PUT implicitly");
});

const permissionReceipt = (id, title) => ({
  kind: "ok", privilegeMode: "normal",
  video: { id, title, youtube_video_id: null, collaboration_type: "collab" },
  showCollabSection: true, subjects: [{
    x_user_id: "coauthor", user_id: null, display_name: "private-" + title, can_edit: 1,
    is_public_member: 0, has_discord_link: false, can_notify: false,
  }], publicMembers: [], truncated: false,
});

test("MIG-0715 U01: GET refuses a schema-valid receipt for a different video", async () => {
  for (const [returned, expected] of [["A", "ok"], ["B", "unavailable"]]) {
    const result = await getEditPermissions({
      videoId: "A", privilegeModes: ["admin"],
      fetchFn: async () => res(200, permissionReceipt(returned, "private-title")),
    });
    assert.equal(result.status, expected);
    if (expected === "unavailable") assert.deepEqual(result, { status: "unavailable" });
  }
  // Server fallback and denial carry their original privilege mode.
  assert.deepEqual(await getEditPermissions({
    videoId: "A", privilegeModes: ["admin"],
    fetchFn: async () => res(200, { kind: "no_access", privilegeMode: "normal" }),
  }), ok({ kind: "no_access", privilegeMode: "normal" }));
});

test("MIG-0715 U01: injected wrong-video receipt never renders private subjects", async () => {
  const m = await mountPermissions("/dashboard/edit/A/permissions",
    async () => ok(permissionReceipt("B", "wrong-video")));
  try {
    assert.match(m.container.textContent, /画面の表示中に問題が発生しました/);
    assert.doesNotMatch(m.container.textContent, /wrong-video|共同編集者/);
    assert.equal(m.container.querySelectorAll("form").length, 0);
    // AuthUnavailable deliberately preserves CURRENT's safe reload control.
    // Permit exactly that button, never permission-changing controls.
    assert.deepEqual([...m.container.querySelectorAll("button")].map(b => b.textContent.trim()), ["再読み込み"]);
  } finally {
    await m.unmount();
  }
});

test("MIG-0715 U01: resource and exact privilege tuple own the committed read view", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const requests = [];
  const snapshots = [];
  let navigate;
  const load = options => new Promise(resolve => requests.push({ ...options, resolve }));
  function Probe() {
    navigate = useNavigate();
    const location = useLocation();
    // Observe committed DOM before passive effects can replace a stale view.
    React.useLayoutEffect(() => {
      snapshots.push({ path: location.pathname + location.search, text: container.textContent });
    }, [location.key]);
    return null;
  }
  const path = id => "/dashboard/edit/" + id + "/permissions";
  const go = async to => {
    await act(async () => { navigate(to); });
    await flush();
  };
  const complete = async (i, id, title) => {
    await act(async () => { requests[i].resolve(ok(permissionReceipt(id, title))); });
    await flush();
  };
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: [path("A")] },
        React.createElement(React.Fragment, null,
          React.createElement(Routes, null, React.createElement(Route, {
            path: "/dashboard/edit/:id/permissions",
            element: React.createElement(Permissions, { load }),
          })),
          React.createElement(Probe))));
    });
    await flush();
    assert.equal(requests.length, 1);
    await complete(0, "A", "old-A");
    assert.match(container.textContent, /private-old-A/);
    await go(path("B"));
    assert.equal(requests[0].signal.aborted, true);
    assert.doesNotMatch(snapshots.at(-1).text, /old-A/);
    assert.doesNotMatch(container.textContent, /old-A/);
    await go(path("A"));
    assert.equal(requests[1].signal.aborted, true);
    assert.equal(requests.length, 3);
    await complete(1, "B", "late-B");
    assert.doesNotMatch(container.textContent, /late-B|old-A/);
    await complete(2, "A", "new-A");
    assert.match(container.textContent, /private-new-A/);

    await go(path("A") + "?privileged=admin&privileged=event");
    assert.deepEqual(requests[3].privilegeModes, ["admin", "event"]);
    assert.doesNotMatch(snapshots.at(-1).text, /new-A/);
    await complete(3, "A", "duplicate-mode");
    assert.match(container.textContent, /private-duplicate-mode/);
    await go(path("A") + "?privileged=admin%00event");
    assert.equal(requests[3].signal.aborted, true);
    assert.deepEqual(requests[4].privilegeModes, ["admin\u0000event"]);
    assert.doesNotMatch(snapshots.at(-1).text, /duplicate-mode/);
    assert.doesNotMatch(container.textContent, /duplicate-mode/);
    await complete(4, "A", "server-fallback");
    assert.match(container.textContent, /private-server-fallback/);
    assert.equal(container.querySelectorAll("button,form").length, 0);
  } finally {
    await act(async () => root.unmount());
  }
});

test("MIG-0715 U03: authorized admin receipt renders CURRENT six management tabs with safe hrefs", async () => {
  const cases = [
    ["video-1", "https://youtu.be/abcdefghijk", "/abcdefghijk"],
    ["video-1", "//outside.example", "/video-1"],
    ["video A&1", null, "/list"],
  ];
  for (const [id, youtubeId, publicHref] of cases) {
    const encoded = encodeURIComponent(id);
    const receipt = permissionReceipt(id, "admin-video");
    receipt.privilegeMode = "admin";
    receipt.video.youtube_video_id = youtubeId;
    const calls = [];
    const m = await mountPermissions("/dashboard/edit/" + encoded + "/permissions", async options => {
      calls.push(options);
      return ok(receipt);
    });
    try {
      const nav = m.container.querySelector('nav[aria-label="作品管理メニュー"]');
      assert.ok(nav, "server-approved admin fallback also shows the menu");
      assert.ok(nav.classList.contains("fn-console-resource-tabs"));
      const links = [...nav.querySelectorAll("a")];
      assert.deepEqual(links.map(a => [a.textContent.trim(), a.getAttribute("href")]), [
        ["管理詳細", "/admin/videos/" + encoded],
        ["メンバー", "/admin/videos/" + encoded + "/members"],
        ["内容編集", "/dashboard/edit/" + encoded + "?privileged=admin"],
        ["編集権限", "/dashboard/edit/" + encoded + "/permissions?privileged=admin"],
        ["公開ページ", publicHref],
        ["監査ログ", "/admin/audit?table=videos&record=" + encoded],
      ]);
      assert.deepEqual(links.map(a => a.getAttribute("aria-current")), [null, null, null, "page", null, null]);
      assert.ok(links[3].classList.contains("fn-btn-primary"));
      assert.ok(links.filter((_, i) => i !== 3).every(a => a.classList.contains("fn-btn-ghost")));
      assert.ok(links.every(a => a.querySelector('svg[aria-hidden="true"]')));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].privilegeModes, []);
      assert.equal(m.container.querySelectorAll("button,input,form").length, 0);
    } finally { await m.unmount(); }
  }
});

test("MIG-0715 U03: admin query does not grant menu access and denied receipts never show it", async () => {
  for (const data of [
    { ...permissionReceipt("video-1", "normal"), privilegeMode: "normal" },
    { ...permissionReceipt("video-1", "event"), privilegeMode: "event" },
    { kind: "no_access", privilegeMode: "admin" },
  ]) {
    const m = await mountPermissions("/dashboard/edit/video-1/permissions?privileged=admin", async () => ok(data));
    try {
      assert.equal(m.container.querySelector('nav[aria-label="作品管理メニュー"]'), null);
      assert.equal(m.container.querySelector('a[href^="/admin/"]'), null);
      assert.equal(m.container.querySelectorAll("button,input,form").length, 0);
    } finally { await m.unmount(); }
  }
});

test("MIG-0715 U03: admin menu retires before passive effects on resource and mode changes", async () => {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const requests = [];
  const commits = [];
  let navigate;
  const load = options => new Promise(resolve => requests.push({ ...options, resolve }));
  const menu = () => container.querySelector('nav[aria-label="作品管理メニュー"]');
  const path = (id, mode = "") => "/dashboard/edit/" + id + "/permissions" + mode;
  function Probe() {
    navigate = useNavigate();
    const location = useLocation();
    React.useLayoutEffect(() => {
      commits.push({ menu: Boolean(menu()), text: container.textContent });
    }, [location.key]);
    return null;
  }
  const go = async target => {
    await act(async () => { navigate(target); });
    await flush();
    assert.equal(commits.at(-1).menu, false, "no old admin menu in committed DOM");
    assert.doesNotMatch(commits.at(-1).text, /private-first-A|private-new-A/);
    assert.equal(menu(), null);
  };
  const admin = (id, title) => ({ ...permissionReceipt(id, title), privilegeMode: "admin" });
  const complete = async (i, data) => {
    await act(async () => { requests[i].resolve(ok(data)); });
    await flush();
  };
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path("A")] },
      React.createElement(React.Fragment, null,
        React.createElement(Routes, null, React.createElement(Route, {
          path: "/dashboard/edit/:id/permissions",
          element: React.createElement(Permissions, { load }),
        })),
        React.createElement(Probe)))));
    await flush();
    await complete(0, admin("A", "first-A"));
    assert.equal(menu()?.querySelector("a")?.getAttribute("href"), "/admin/videos/A");
    await go(path("B"));
    assert.equal(requests[0].signal.aborted, true);
    await go(path("A"));
    assert.equal(requests[1].signal.aborted, true);
    assert.equal(requests.length, 3);
    await complete(1, admin("B", "retired-B"));
    assert.equal(menu(), null, "obsolete successful admin receipt cannot restore menu");
    assert.doesNotMatch(container.textContent, /retired-B/);
    await complete(2, admin("A", "new-A"));
    assert.ok(menu());
    await go(path("A", "?privileged=event"));
    assert.equal(requests[2].signal.aborted, true);
    assert.deepEqual(requests[3].privilegeModes, ["event"]);
    await complete(3, { ...permissionReceipt("A", "event-A"), privilegeMode: "event" });
    assert.equal(menu(), null);
    assert.match(container.textContent, /private-event-A/);
    await go(path("A", "?privileged=admin"));
    await complete(4, { kind: "no_access", privilegeMode: "admin" });
    assert.equal(menu(), null);
    assert.match(container.textContent, /編集権限がありません/);
    assert.equal(container.querySelectorAll("button,input,form").length, 0);
  } finally { await act(async () => root.unmount()); }
});

test("MIG-0715 U03: CURRENT audit footnote retains decorative info icon on authorized views", async () => {
  for (const showCollabSection of [true, false]) {
    const receipt = { ...permissionReceipt("A", "video"), privilegeMode: "admin", showCollabSection };
    if (!showCollabSection) receipt.subjects = [];
    const m = await mountPermissions("/dashboard/edit/A/permissions", async () => ok(receipt));
    try {
      const footnote = m.container.querySelector(".fn-page-footnote");
      assert.ok(footnote);
      assert.match(footnote.textContent, /監査ログは管理者向け画面で確認できます/);
      const icon = footnote.querySelector('svg[aria-hidden="true"]');
      assert.ok(icon);
      assert.equal(icon.getAttribute("width"), "12");
      assert.equal(icon.getAttribute("height"), "12");
      assert.equal(footnote.querySelector("a")?.getAttribute("href"), "/dashboard/edit/A?privileged=admin");
      assert.equal(m.container.querySelector('nav[aria-label="作品管理メニュー"]')?.querySelectorAll("a").length, 6);
      assert.equal(m.container.querySelectorAll("button,input,form").length, 0);
    } finally { await m.unmount(); }
  }
});

test("MIG-0715 U03b: Active X change and BFCache restore hard-remount the permission view", async () => {
  const reloads = [];
  const m = await mountPermissions(
    "/dashboard/edit/A/permissions",
    async () => ok(permissionReceipt("A", "video")),
    () => reloads.push("reload"),
  );
  try {
    dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    assert.deepEqual(reloads, ["reload"]);

    const ordinaryPageShow = new dom.window.Event("pageshow");
    Object.defineProperty(ordinaryPageShow, "persisted", { value: false });
    dom.window.dispatchEvent(ordinaryPageShow);
    assert.deepEqual(reloads, ["reload"], "ordinary pageshow is not an authority transition");

    const restoredPageShow = new dom.window.Event("pageshow");
    Object.defineProperty(restoredPageShow, "persisted", { value: true });
    dom.window.dispatchEvent(restoredPageShow);
    assert.deepEqual(reloads, ["reload", "reload"], "BFCache restore retires the old document");
  } finally {
    await m.unmount();
  }

  dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
  assert.deepEqual(reloads, ["reload", "reload"], "unmounted route removes its invalidation listeners");
});

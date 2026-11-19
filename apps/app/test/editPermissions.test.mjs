import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { dom, flush, ok } from "./helpers.mjs";

const { getEditPermissions } = await import("../.test-dist/apps/app/src/api/videoCollaborators.js");
const { Permissions } = await import("../.test-dist/apps/app/src/routes/dashboard/edit/Permissions.js");

const res = (status, body = null) => ({ status, json: async () => body });

async function mountPermissions(path, load) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: [path] },
      React.createElement(Routes, null,
        React.createElement(Route, {
          path: "/dashboard/edit/:id/permissions",
          element: React.createElement(Permissions, { load }),
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

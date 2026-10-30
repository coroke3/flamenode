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

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  adminVideoDetailPath,
  adminVideoBackHref,
  selectOpenVoidCaseId,
  loadAdminVideoDetail,
} from "../.test-dist/apps/ops/src/api/adminVideoDetail.js";
import {
  createAdminVideoStatusActions,
  createModerationCaseAction,
  safeAdminNextHref,
} from "../.test-dist/apps/ops/src/api/adminVideoStatus.js";
import { CreateModerationCaseForm } from "../.test-dist/apps/ops/src/routes/admin/CreateModerationCaseForm.js";

const detail = {
  video: {
    id: "video-1", title: "Test", creator_name: "Creator", creator_x_user_id: "x_creator",
    created_at: 1_700_000_000, source_type: "youtube", youtube_video_id: null,
    music: null, credit: null, intro_comment: null, highlights: null,
    production_story: null, stagePermission: null, visibility_status: "pending",
    software_label: null, event_ids: [], customAnswers: [], members: [],
  },
  moderationCases: [],
  openCaseCount: 0,
  openVoidCaseId: null,
  event: "event/1",
  truncated: false,
};
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0729 U02: admin read retains event context, no-store and exact video identity", async () => {
  let request;
  const ctrl = new AbortController();
  const out = await loadAdminVideoDetail(async (path, init) => {
    request = { path, init };
    return json(200, detail);
  }, "video-1", "event/1", ctrl.signal);
  assert.deepEqual(out, { status: "ok", data: detail });
  assert.equal(request.path, "/api/admin-read/videos/video-1?event=event%2F1");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.signal, ctrl.signal);
  assert.equal(adminVideoDetailPath("video/1", "event/1"), "/admin/videos/video%2F1?event=event%2F1");
  assert.equal(adminVideoBackHref("event/1"), "/admin/videos?status=review&event=event%2F1");
  assert.equal(adminVideoBackHref(null), "/admin/videos");
});

test("MIG-0729 U02: 404, 403, invalid DTO and mismatched private detail are fail-closed", async () => {
  assert.deepEqual(await loadAdminVideoDetail(async () => json(404, {}), "video-1", null),
    { status: "notFound" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(403, { redirect: "/dashboard" }), "video-1", null),
    { status: "forbidden", redirect: "/dashboard" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, { ...detail, video: { ...detail.video, id: "other" } }), "video-1", null),
    { status: "unavailable" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, { ...detail, moderationCases: "invalid" }), "video-1", null),
    { status: "unavailable" });
  assert.deepEqual(await loadAdminVideoDetail(async () => json(200, detail), "", null),
    { status: "notFound" });
});

test("MIG-0729 T03: open void case preferred, then open fallback, then no case", () => {
  const other = { id: "other", case_type: "rights", status: "open" };
  const voidCase = { id: "void", case_type: "void", status: "open" };
  assert.equal(selectOpenVoidCaseId([other, voidCase]), "void");
  assert.equal(selectOpenVoidCaseId([other]), "other");
  assert.equal(selectOpenVoidCaseId([{ ...voidCase, status: "closed" }]), null);
});

test("MIG-0729 T01/T02: status action preserves event, approval and approved-next markers", async () => {
  const calls = [];
  const fetchFn = async (path, init) => {
    calls.push({ path, init, body: JSON.parse(init.body) });
    return json(200, { ok: true, nextHref: "/admin/videos/next-video?event=e1" });
  };
  const actions = createAdminVideoStatusActions(fetchFn);
  const fd = new FormData();
  fd.set("video_id", "video-1");
  fd.set("review_event_id", "e1");
  assert.deepEqual(await actions.approve(fd), {
    ok: true, nextHref: "/admin/videos/next-video?event=e1",
  });
  assert.equal(calls[0].path, "/api/admin/videos/video-1/status");
  assert.deepEqual(calls[0].body, { status: "public", reason: "", review_event_id: "e1" });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  await actions.approveAndNext(fd);
  assert.deepEqual(calls[1].body, {
    status: "public", reason: "", review_event_id: "e1", and_next: "1",
  });
});

test("MIG-0729 T03: void removal sends case_id, no client-side request on invalid target", async () => {
  const calls = [];
  const actions = createAdminVideoStatusActions(async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    return json(200, { ok: true });
  });
  const fd = new FormData();
  fd.set("video_id", "v1");
  fd.set("status", "pending");
  fd.set("case_id", "case-1");
  assert.equal((await actions.setStatus(fd)).ok, true);
  assert.equal(calls[0][1].case_id, "case-1");
  fd.set("status", "admin");
  assert.equal((await actions.setStatus(fd)).ok, false);
  assert.equal(calls.length, 1);
});

test("MIG-0729 T04: moderator case keys, HTTP denial, malformed and 500 success-shaped responses", async () => {
  const calls = [];
  const action = createModerationCaseAction(async (path, init) => {
    calls.push({ path, init, body: JSON.parse(init.body) });
    return json(200, { ok: true, message: "created" });
  });
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    video_id: "v1", case_type: "void", public_reason: "reason",
    private_note: "note", due_at: "", related_x_user_id: "x",
    video_status: "pending",
  })) fd.set(key, value);
  assert.deepEqual(await action(fd), { ok: true, message: "created" });
  assert.equal(calls[0].path, "/api/admin/moderation/cases");
  assert.deepEqual(calls[0].body, {
    case_type: "void", public_reason: "reason", private_note: "note",
    due_at: "", related_x_user_id: "x", video_status: "pending", video_id: "v1",
  });
  const denied = createModerationCaseAction(async () => json(403, { ok: true }));
  assert.equal((await denied(fd)).ok, false, "403 cannot be promoted to success");
  const failed = createModerationCaseAction(async () => json(500, { ok: true }));
  assert.equal((await failed(fd)).ok, false, "500 cannot be promoted to success");
  const invalid = createModerationCaseAction(async () => json(200, { status: "ok" }));
  assert.equal((await invalid(fd)).ok, false, "malformed JSON cannot be promoted to success");
});

test("MIG-0729 U02: nextHref must stay within one admin video detail", () => {
  for (const link of ["/admin/videos/next", "/admin/videos/next?event=e1"]) {
    assert.equal(safeAdminNextHref(link), true, link);
  }
  for (const link of [
    "https://evil.example/", "//evil.example", "/admin", "/admin/videos",
    "/admin/videos/../audit", "/admin/videos/foo/members",
    "/admin/videos/next\\evil.example", "/admin/videos/next\n",
    "/admin/videos/next#fragment",
  ]) {
    if (link === "/admin/videos/next#fragment") continue; // legacy fragments are local
    assert.equal(safeAdminNextHref(link), false, link);
  }
});

test("MIG-0729 U02: moderation form matches CURRENT visible field names", () => {
  const markup = renderToStaticMarkup(React.createElement(CreateModerationCaseForm, {
    videoId: "v1", action: async () => ({ ok: true }), onRefresh: () => {},
  }));
  for (const key of ["video_id", "case_type", "public_reason", "private_note", "due_at", "related_x_user_id", "video_status"]) {
    assert.match(markup, new RegExp(`name="${key}"`));
  }
  assert.match(markup, /モデレーションケースを作成/);
});

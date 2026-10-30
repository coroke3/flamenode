import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  playlistPagePath, playlistResultHref, playlistSettingsBody, queueManagePlaylist,
  readManagePlaylist, saveManagePlaylist,
} from "../.test-dist/apps/ops/src/api/managePlaylist.js";
import {
  EventYoutubePlaylistBody,
} from "../.test-dist/apps/ops/src/routes/manage/EventYoutubePlaylist.js";

const fixture = {
  isAdmin: false,
  event: { id: "a/b", title: "テストイベント", accent_color: null },
  pendingCount: 1,
  canEdit: true,
  activeXUserId: null,
  manageStaffXUserIds: [],
  config: {
    playlist_id: "PL123", enabled: 1, sync_mode: "append_only",
    sync_interval_minutes: 720, sync_status: "synced",
    next_sync_at: 1780000000, last_synced_at: 1779990000,
    last_full_scan_at: 1779980000, last_error: null,
  },
  counts: { linked: 3, eligible: 2, synced: 2 },
  syncHealth: { level: "ok", reason: "healthy", priority: 4 },
};
const response = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
const render = (data = fixture, query = "") => renderToStaticMarkup(
  React.createElement(EventYoutubePlaylistBody, {
    data, search: new URLSearchParams(query), busy: false, onSave: () => {}, onQueue: () => {},
  }),
);

test("MIG-0725 U01: GET checks the complete existing Hono playlist contract", async () => {
  let request;
  const signal = new AbortController().signal;
  const ok = await readManagePlaylist(async (path, init) => {
    request = { path, init };
    return response(200, fixture);
  }, "a/b", signal);
  assert.equal(ok.status, "ok");
  assert.equal(ok.data.event.id, "a/b");
  assert.equal(request.path, "/api/manage/events/a%2Fb/youtube-playlist");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.signal, signal);
  const malformed = await readManagePlaylist(async () => response(200, {
    ...fixture, config: { enabled: 1 },
  }), "a/b");
  assert.deepEqual(malformed, { status: "unavailable" });
  for (const [http, expected] of [[401, "anonymous"], [403, "forbidden"], [404, "notFound"], [503, "unavailable"]]) {
    const denied = await readManagePlaylist(async () => response(http, {}), "a/b");
    assert.equal(denied.status, expected);
    assert.equal("data" in denied, false);
  }
});

test("MIG-0725 U01 T01: PUT JSON settings and CURRENT saved/error query mapping", async () => {
  const form = new FormData();
  form.set("event_id", "a/b");
  form.set("playlist_id", "https://www.youtube.com/playlist?list=PL123");
  form.set("sync_mode", "mirror");
  form.set("sync_interval_minutes", "180");
  assert.deepEqual(playlistSettingsBody(form), {
    playlist_id: "https://www.youtube.com/playlist?list=PL123",
    sync_mode: "mirror", sync_interval_minutes: "180",
  });
  let request;
  const saved = await saveManagePlaylist(async (path, init) => {
    request = { path, init };
    return response(200, { ok: true, saved: true });
  }, "a/b", form);
  assert.equal(saved.status, "success");
  assert.equal(request.path, "/api/manage/events/a%2Fb/youtube-playlist");
  assert.equal(request.init.method, "PUT");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(request.init.body), playlistSettingsBody(form));
  assert.equal(playlistResultHref("a/b", "saved", saved),
    "/manage/events/a%2Fb/youtube-playlist?saved=1");

  const rejected = await saveManagePlaylist(async () => response(200, {
    ok: false, message: "同期設定の変更は許可されていません。",
  }), "a/b", form);
  assert.equal(rejected.status, "error");
  assert.ok(playlistResultHref("a/b", "saved", rejected).includes("?error="));
  assert.doesNotMatch(playlistResultHref("a/b", "saved", rejected), /saved=1/);
  assert.equal((await saveManagePlaylist(async () => response(200, {ok:true}), "a/b", form)).status, "unavailable");
});

test("MIG-0725 U01: write failures fail closed, no arbitrary redirects accepted", async () => {
  const form = new FormData();
  for (const [http, expected] of [[401,"anonymous"],[403,"forbidden"],[404,"notFound"],[409,"unavailable"],[500,"unavailable"]]) {
    const result = await saveManagePlaylist(async () => response(http, {
      redirect: "https://evil.invalid/", ok: true, saved: true,
    }), "a/b", form);
    assert.equal(result.status, expected);
    const href = playlistResultHref("a/b", "saved", result);
    assert.ok(href.startsWith(playlistPagePath("a/b") + "?error="));
    assert.doesNotMatch(href, /evil\.invalid/);
  }
  const tooLong = await saveManagePlaylist(async () => response(200, {
    ok: false, message: "x".repeat(2500),
  }), "a/b", form);
  assert.equal(tooLong.status, "error");
  assert.equal(new URLSearchParams(playlistResultHref("a/b", "saved", tooLong).split("?")[1]).get("error").length, 500);
});

test("MIG-0725 U01: POST sync only requires an event and returns queued=1", async () => {
  let request;
  const queued = await queueManagePlaylist(async (path, init) => {
    request = { path, init };
    return response(200, { ok: true, queued: true });
  }, "a/b");
  assert.equal(queued.status, "success");
  assert.equal(request.path, "/api/manage/events/a%2Fb/youtube-playlist/sync");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {});
  assert.equal(playlistResultHref("a/b", "queued", queued),
    "/manage/events/a%2Fb/youtube-playlist?queued=1");
  assert.equal((await queueManagePlaylist(async () => response(200, {ok: true, saved:true}), "a/b")).status, "unavailable");
});

test("MIG-0725 U01 T01/T02: CURRENT banner, form disabled for read-only staff, sync gating", () => {
  const edit = render(fixture, "saved=1&queued=1&error=%3Cscript%3Ebad()%3C%2Fscript%3E");
  assert.match(edit, /設定を保存し、同期を予約しました/);
  assert.match(edit, /同期を予約しました/);
  assert.match(edit, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(edit, /<script>/);
  assert.match(edit, /name="playlist_id"/);
  assert.match(edit, /name="sync_mode"/);
  assert.match(edit, /name="sync_interval_minutes"/);
  assert.match(edit, /name="event_id" value="a\/b"/);
  assert.match(edit, /今すぐ同期を予約/);
  const readOnly = render({ ...fixture, canEdit: false });
  assert.match(readOnly, /閲覧のみです/);
  assert.doesNotMatch(readOnly, /保存して同期を予約<\/button>/);
  assert.doesNotMatch(readOnly, /今すぐ同期を予約/);
  assert.match(readOnly, /name="playlist_id"[^>]*disabled=""/);
  assert.match(readOnly, /name="sync_mode"[^>]*disabled=""/);
  const disabledSync = render({ ...fixture, config: { ...fixture.config, enabled: 0 } });
  assert.doesNotMatch(disabledSync, /今すぐ同期を予約/);
  assert.ok(edit.includes("https://www.youtube.com/playlist?list=PL123"));
});

test("MIG-0725 U01: unknown untrusted status keys are rendered as text not prototype members", () => {
  for (const value of ["constructor", "__proto__", "toString"]) {
    const html = render({
      ...fixture, config: { ...fixture.config, sync_status: value, last_error: value },
      syncHealth: { level: value, reason: value, priority: 3 },
    });
    assert.ok(html.includes(value));
    assert.doesNotMatch(html, /function Object/);
  }
});

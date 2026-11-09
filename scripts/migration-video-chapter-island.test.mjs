// MIG-0518 U02: independent Hono SA-012..015 contract and write-control tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  createChapter, createChaptersBulk, updateChapter, deleteChapter,
} from "../apps/site/src/lib/chapterWrite.ts";
import {
  VideoChapterIsland, videoChapterDraftIsDirty,
} from "../apps/site/src/components/VideoChapterIsland.ts";

const VALID = {
  chapter_time: "1:05",
  chapter_label: "サビ",
  note: "補足",
  visibility: "public",
};

function fakeFetch(status = 200, payload = { ok: true, chapterId: "ch1" }) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return { ok: status >= 200 && status < 300, status, json: async () => payload };
    },
  };
}
function assertWrite(call, url, method, body) {
  assert.equal(call.url, url);
  assert.equal(call.init.method, method);
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.headers.Accept, "application/json");
  if (body === undefined) {
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers["Content-Type"], undefined);
  } else {
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), body);
  }
}

test("SA-012 sends exact JSON field keys and Active X snapshot in request body", async () => {
  const f = fakeFetch(200, { ok: true, chapterId: "ch1", pendingPublicReflection: true });
  const result = await createChapter("vid?#", { ...VALID, active_x_snapshot: "owner" }, f.fetcher);
  assert.equal(result.pendingPublicReflection, true);
  assertWrite(f.calls[0], "/api/videos/vid%3F%23/chapters", "POST", {
    ...VALID, active_x_snapshot: "owner",
  });
  assert.equal(f.calls.length, 1);
});

test("SA-012 without optional snapshot does not inject the property", async () => {
  const f = fakeFetch();
  await createChapter("v", VALID, f.fetcher);
  assertWrite(f.calls[0], "/api/videos/v/chapters", "POST", VALID);
});

test("SA-015 sends raw CSV + snapshot, and preserves inserted/skipped/error messages", async () => {
  const f = fakeFetch(200, {
    ok: true, message: "2 件追加 / 1 件スキップ",
    inserted: 2, skipped: 1, errors: ["行 3: 空欄"], pendingPublicReflection: true,
  });
  const result = await createChaptersBulk("v", { csv: "time,label\n1:05,A", active_x_snapshot: "owner" }, f.fetcher);
  assert.equal(result.inserted, 2);
  assert.deepEqual(result.errors, ["行 3: 空欄"]);
  assertWrite(f.calls[0], "/api/videos/v/chapters/bulk", "POST", {
    csv: "time,label\n1:05,A", active_x_snapshot: "owner",
  });
});

test("SA-013 uses chapter_id in URL and never passes video_id", async () => {
  const f = fakeFetch();
  await updateChapter("ch?#", { ...VALID, visibility: "private" }, f.fetcher);
  assertWrite(f.calls[0], "/api/videos/chapters/ch%3F%23", "PUT", {
    ...VALID, visibility: "private",
  });
});

test("SA-014 DELETE is idempotent and does not emit JSON body", async () => {
  const f = fakeFetch(200, { ok: true, message: "既に削除されています。" });
  assert.equal((await deleteChapter("ch", f.fetcher)).message, "既に削除されています。");
  assertWrite(f.calls[0], "/api/videos/chapters/ch", "DELETE", undefined);
});

test("400/403/404/409/413 remain visible API denials rather than network errors", async () => {
  for (const status of [400, 403, 404, 409, 413]) {
    const f = fakeFetch(status, { ok: false, message: `denied ${status}` });
    const result = await createChapter("v", VALID, f.fetcher);
    assert.deepEqual(result, { ok: false, message: `denied ${status}` });
    assert.equal(f.calls.length, 1);
  }
});

test("Malformed payload, unknown ok type and 503 success-looking response fail closed", async () => {
  for (const payload of [null, [], {}, { ok: "true" }, { ok: 1 }]) {
    const f = fakeFetch(200, payload);
    await assert.rejects(createChapter("v", VALID, f.fetcher));
  }
  await assert.rejects(deleteChapter("ch", fakeFetch(503, { ok: true }).fetcher), TypeError);
});

test("Client rejects invalid Zod inputs before issuing network requests", async () => {
  const f = fakeFetch();
  await assert.rejects(createChapter("v", { ...VALID, chapter_time: "" }, f.fetcher));
  await assert.rejects(createChapter("v", { ...VALID, chapter_label: "a".repeat(121) }, f.fetcher));
  await assert.rejects(createChapter("v", { ...VALID, visibility: "hidden" }, f.fetcher));
  await assert.rejects(createChaptersBulk("v", { csv: "a".repeat(65_537) }, f.fetcher));
  assert.equal(f.calls.length, 0);
});

test("Network rejection propagates (UI's communication-error path handles it)", async () => {
  await assert.rejects(
    createChapter("v", VALID, async () => { throw new Error("offline"); }),
    /offline/,
  );
});

test("JS-disabled SSR contains no authenticated form or clickable controls", () => {
  const html = renderToString(React.createElement(VideoChapterIsland, {
    videoId: "v",
    activeXId: "owner",
    canPost: true,
    canBulk: true,
  }));
  assert.equal(html, "");
  assert.equal(renderToString(React.createElement(VideoChapterIsland, {
    videoId: "v", activeXId: null, canPost: false,
  })), "");
});

test("Draft dirty guard keeps untouched state and blocks text/csv loss", () => {
  assert.equal(videoChapterDraftIsDirty("", "", "", ""), false);
  assert.equal(videoChapterDraftIsDirty("  ", "", "", ""), false);
  assert.equal(videoChapterDraftIsDirty("1:05", "", "", ""), true);
  assert.equal(videoChapterDraftIsDirty("", "サビ", "", ""), true);
  assert.equal(videoChapterDraftIsDirty("", "", "補足", ""), true);
  assert.equal(videoChapterDraftIsDirty("", "", "", "csv"), true);
});

test("CURRENT chapter time validation does not round an invalid time down to zero", async () => {
  const { validateChapterTime } = await import("../packages/domain/src/video/chapterTime.ts");
  assert.equal(validateChapterTime("1:65").ok, false);
  assert.equal(validateChapterTime("-4").ok, false);
  assert.deepEqual(validateChapterTime("1:05"), { ok: true, seconds: 65 });
});

test("U03 playlist query rejects duplicate keys, trims singleton and retains it on navigation", async () => {
  const { resolvePlaylistQuery, playlistItemHref } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  assert.equal(resolvePlaylistQuery("?playlist=first&playlist=second"), "", "ambiguous duplicate keys fail closed");
  assert.equal(resolvePlaylistQuery("?playlist=%20event-1%20"), "event-1");
  assert.equal(resolvePlaylistQuery("?other=1"), "");
  assert.equal(resolvePlaylistQuery("?playlist=" + "x".repeat(200)).length, 128);
  assert.equal(resolvePlaylistQuery("?playlist=" + encodeURIComponent("x".repeat(127) + "😀")), "x".repeat(127),
    "128 UTF-16-unit cutoff must not leave a broken high surrogate");
  assert.equal(resolvePlaylistQuery("?playlist=" + encodeURIComponent("x".repeat(126) + "😀")), "x".repeat(126) + "😀",
    "a complete surrogate pair at the limit must remain intact");
  assert.equal(playlistItemHref({ id: "vid", youtube_video_id: "abc-123" }, "event-1"),
    "/abc-123?playlist=event-1");
  assert.equal(playlistItemHref({ id: "vid", youtube_video_id: null }, ""),
    "/vid");
  assert.equal(playlistItemHref({ id: "video / ?" }, "event&1"), "/video%20%2F%20%3F?playlist=event%261");
});

test("U03 Hono viewer overlay gates chapter writes on auth, X approval, terms and network state", async () => {
  const { canPostVideoChapter } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const data = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    isTosAccepted: true, termsReacceptRequired: false, activeXId: "x",
    likeActive: false, bookmarkActive: false, viewerXApproved: true,
    privateChapters: [], playlistLabel: "再生リスト", playlistItems: [],
  };
  assert.equal(canPostVideoChapter(data, false), true);
  assert.equal(canPostVideoChapter(data, true), false);
  for (const patch of [
    { loggedIn: false }, { authUnavailable: true }, { isBanned: true },
    { isTosAccepted: false }, { termsReacceptRequired: true },
    { activeXId: null }, { viewerXApproved: false },
  ]) {
    assert.equal(canPostVideoChapter({ ...data, ...patch }, false), false);
  }
});

test("U03 private chapter merge preserves public SSR chapters and prevents duplicate ids", async () => {
  const { chapterRowsForViewer } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const overlay = {
    privateChapters: [
      { id: "private", chapter_time: 15, chapter_label: "private", author_name: "owner",
        visibility: "private", note: null, author_icon: null },
      { id: "public", chapter_time: 90, chapter_label: "duplicate", author_name: "owner",
        visibility: "private", note: null, author_icon: null },
    ],
  };
  const rows = chapterRowsForViewer([
    { id: "public", timeLabel: "1:30", label: "public" },
    { id: "first", timeLabel: "0:05", label: "first" },
  ], overlay);
  assert.deepEqual(rows.map((r) => r.id), ["first", "private", "public"]);
  assert.equal(rows[2].label, "public");
});

test("U03 malformed public chapter times sort after valid rows without dropping SSR data", async () => {
  const { chapterRowsForViewer } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const overlay = { privateChapters: [
    { id: "private-1", chapter_time: 5, chapter_label: "private", author_name: "author" },
  ] };
  const rows = chapterRowsForViewer([
    { id: "malformed", timeLabel: "??", label: "keep visible" },
    { id: "invalid-sec", timeLabel: "1:61", label: "keep invalid seconds visible" },
    { id: "invalid-huge", timeLabel: "99999999999999999999:00", label: "keep overflow visible" },
    { id: "valid-hour", timeLabel: "1:00:00", label: "one hour" },
    { id: "valid", timeLabel: "0:03", label: "three seconds" },
  ], overlay);
  assert.deepEqual(rows.map((row) => row.id),
    ["valid", "private-1", "valid-hour", "malformed", "invalid-sec", "invalid-huge"]);
  assert.equal(rows[3].label, "keep visible");
  assert.equal(rows[4].label, "keep invalid seconds visible");
});

test("U03 chapter seek times reject malformed and out-of-range labels", async () => {
  const { safeChapterSeekSeconds } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  assert.equal(safeChapterSeekSeconds("0:03"), 3);
  assert.equal(safeChapterSeekSeconds("1:00:00"), 3600);
  assert.equal(safeChapterSeekSeconds("24:00:00"), 86400);
  for (const bad of ["??", "", "1:61", "1:60:00", "-1:00", "1.5:00",
    "99999999999999999999:00", "24:00:01", "1:2:3:4", "NaN:00"]) {
    assert.equal(safeChapterSeekSeconds(bad), null, "unsafe chapter must not seek: " + bad);
  }
});

test("U03 chapter sorter and seek parser share the 24-hour validation boundary", async () => {
  const { chapterRowsForViewer, safeChapterSeekSeconds } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const hours = ["23:59:59", "24:00:00", "24:00:01", "0:01"];
  const rows = chapterRowsForViewer(hours.map((timeLabel, i) => ({
    id: String(i), timeLabel, label: timeLabel,
  })), { privateChapters: [] });
  assert.deepEqual(rows.map((row) => row.timeLabel),
    ["0:01", "23:59:59", "24:00:00", "24:00:01"]);
  assert.equal(safeChapterSeekSeconds("24:00:00"), 86400);
  assert.equal(safeChapterSeekSeconds("24:00:01"), null);
});

test("U03 invalid public chapter seek buttons are visibly disabled", async () => {
  const { JSDOM } = await import("jsdom");
  const { VideoUtilityDockIsland } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://flamenode.net/v" });
  dom.window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "CustomEvent", "localStorage"];
  const prior = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value: dom.window[key],
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // First react-dom/client import in this test module: initialize the React
  // event plugin only AFTER installing JSDOM's document. Importing it before
  // the document existed disabled the textarea's delegated change events in
  // later chapter tests even though its native .value property had changed.
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(VideoUtilityDockIsland, {
      videoId: "v", currentId: "v", loading: false,
      publicChapters: [
        { id: "ok", timeLabel: "1:02", label: "valid" },
        { id: "bad", timeLabel: "1:61", label: "invalid" },
      ],
      overlay: {
        loggedIn: false, authUnavailable: false, isBanned: false, isTosAccepted: false,
        termsReacceptRequired: false, activeXId: null, viewerXApproved: false,
        privateChapters: [], playlistItems: [], playlistLabel: null,
        likeActive: false, bookmarkActive: false,
      },
    })));
    const buttons = [...dom.window.document.querySelectorAll("#video-utility-chapters li button")];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].disabled, false, "valid chapter stays seekable");
    assert.equal(buttons[1].disabled, true, "invalid chapter remains visible but not interactive");
    assert.equal(buttons[1].textContent, "1:61");
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct;
    dom.window.close();
  }
});

test("U03 private playlist and chapters are excluded entirely from JS-disabled HTML", async () => {
  const { VideoUtilityDockIsland } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const html = renderToString(React.createElement(VideoUtilityDockIsland, {
    videoId: "v", currentId: "v", publicChapters: [{ id: "pub", timeLabel: "0:03", label: "public" }],
    loading: false, overlay: {
      loggedIn: true, authUnavailable: false, isBanned: false, isTosAccepted: true,
      termsReacceptRequired: false, activeXId: "x", likeActive: false,
      bookmarkActive: false, viewerXApproved: true,
      privateChapters: [{ id: "priv", chapter_time: 5, chapter_label: "SECRET",
        author_name: "PRIVATE", author_icon: null, note: null, visibility: "private" }],
      playlistLabel: "PRIVATE PLAYLIST", playlistItems: [{ id: "vv", title: "SECRET TITLE",
        youtube_video_id: null, display_name: "PRIVATE" }],
    },
  }));
  assert.equal(html, "");
});

const skipVideoPageRender = fs.existsSync("packages/ui/dist/index.js")
  ? false
  : process.env.REQUIRE_BUILT ? false : "requires built @flamenode/ui";

test("U01/U03 VideoPageIsland keeps static public chapters without client JavaScript", { skip: skipVideoPageRender }, async () => {
  const { VideoPageIsland } = await import("../apps/site/src/components/VideoPageIsland.ts");
  const video = {
    id: "video", title: "Video", creator: { name: "Creator" }, hasYoutube: false,
    chapters: [{ id: "public", timeLabel: "0:14", label: "PUBLIC_CHAPTER" }],
    related: [],
  };
  const html = renderToString(React.createElement(VideoPageIsland, {
    video, youtubeId: null, primaryEventId: null, gaEnabled: false,
  }));
  assert.match(html, /PUBLIC_CHAPTER/);
  assert.doesNotMatch(html, /CSV で一括登録|チャプターコメント投稿|ログイン状態を確認中/);
});

test("U03 play seek event dispatch retains the same CURRENT bridge event contract", async () => {
  const { seekToTime } = await import("../src/components/video/playerBridge.ts");
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("", { url: "https://flamenode.net/video" });
  const former = globalThis.window;
  const formerCustomEvent = globalThis.CustomEvent;
  globalThis.window = dom.window;
  globalThis.CustomEvent = dom.window.CustomEvent;
  let target = null;
  dom.window.addEventListener("flamenode:seek", (event) => {
    target = event.detail.time;
  });
  try {
    seekToTime(65.9);
    assert.equal(target, 65);
  } finally {
    globalThis.window = former;
    globalThis.CustomEvent = formerCustomEvent;
    dom.window.close();
  }
});

test("U03 chapter post guards show actionable login/terms/approved-X destinations", async () => {
  const { chapterPostPolicy } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const okay = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    isTosAccepted: true, termsReacceptRequired: false, activeXId: "owner",
    viewerXApproved: true, likeActive: false, bookmarkActive: false,
    privateChapters: [], playlistLabel: "", playlistItems: [],
  };
  assert.equal(chapterPostPolicy(okay, false, "/v").canPost, true);
  const pending = chapterPostPolicy(okay, true, "/v");
  assert.equal(pending.canPost, false);
  assert.equal(pending.href, null);
  const offline = chapterPostPolicy({ ...okay, authUnavailable: true }, false, "/v");
  assert.equal(offline.href, null);
  const loggedOut = chapterPostPolicy({ ...okay, loggedIn: false }, false, "/v?playlist=p");
  assert.equal(loggedOut.href, "/entry?next=%2Fv%3Fplaylist%3Dp");
  const tos = chapterPostPolicy({ ...okay, termsReacceptRequired: true }, false, "/v");
  assert.equal(tos.href, "/rules?next=%2Fv");
  const banned = chapterPostPolicy({ ...okay, isBanned: true }, false, "/v");
  assert.equal(banned.href, null);
  assert.equal(chapterPostPolicy({ ...okay, viewerXApproved: false }, false, "/v").href,
    "/dashboard/settings?next=%2Fv");
});

test("U03 mobile drawer uses synthetic Back history, Escape and shared body-scroll lock", async () => {
  const { JSDOM } = await import("jsdom");
  const { VideoUtilityDockIsland } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.net/AAAAAAAAAAA?playlist=p",
  });
  dom.window.matchMedia = () => ({
    matches: true, addEventListener() {}, removeEventListener() {},
  });
  dom.window.scrollTo = () => {};
  dom.window.requestAnimationFrame = (cb) => dom.window.setTimeout(cb, 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "CustomEvent"];
  const prior = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true, value: dom.window[key],
    });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  const overlay = {
    loggedIn: false, authUnavailable: false, isBanned: false,
    isTosAccepted: false, termsReacceptRequired: false, activeXId: null,
    likeActive: false, bookmarkActive: false, viewerXApproved: false,
    privateChapters: [], playlistLabel: "再生リスト",
    playlistItems: [{ id: "vid", title: "Title", youtube_video_id: null, display_name: "Creator" }],
  };
  try {
    await React.act(async () => root.render(React.createElement(VideoUtilityDockIsland, {
      videoId: "vid", currentId: "vid", publicChapters: [],
      overlay, loading: false,
    })));
    await React.act(async () => {
      dom.window.document.querySelector('[aria-controls="video-utility-playlist"]').click();
    });
    assert.equal(dom.window.history.state["fn-video-utility-dock"], true);
    assert.equal(dom.window.document.body.style.position, "fixed");
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(dom.window.document.querySelector('[aria-controls="video-utility-playlist"]').getAttribute("aria-expanded"), "false");
    assert.notEqual(dom.window.document.body.style.position, "fixed");
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    dom.window.close();
  }
});

test("U03 switching ?playlist= never overwrites another playlist's persisted order", async () => {
  const { JSDOM } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const { VideoUtilityDockIsland } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.net/a?playlist=A",
  });
  dom.window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });
  dom.window.localStorage.setItem("fn-playlist-order:A", JSON.stringify(["a2", "a1"]));
  dom.window.localStorage.setItem("fn-playlist-order:B", JSON.stringify(["b2", "b1"]));
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "CustomEvent", "localStorage"];
  const prior = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  const base = {
    loggedIn: false, authUnavailable: false, isBanned: false, isTosAccepted: false,
    termsReacceptRequired: false, activeXId: null, likeActive: false,
    bookmarkActive: false, viewerXApproved: false, privateChapters: [], playlistLabel: "Queue",
  };
  const make = (prefix) => React.createElement(VideoUtilityDockIsland, {
    videoId: "video-" + prefix, currentId: prefix.toLowerCase() + "1", publicChapters: [],
    loading: false, overlay: { ...base, playlistItems: [1,2].map(n => ({
      id: prefix.toLowerCase() + n, title: prefix + n, youtube_video_id: null, display_name: "Creator",
    })) },
  });
  try {
    await React.act(async () => root.render(make("A")));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("fn-playlist-order:A")), ["a2", "a1"]);
    dom.window.history.replaceState(null, "", "/b?playlist=B");
    await React.act(async () => root.render(make("B")));
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("fn-playlist-order:A")), ["a2", "a1"]);
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("fn-playlist-order:B")), ["b2", "b1"]);
    const links = [...dom.window.document.querySelectorAll("#video-utility-playlist ol a")];
    assert.equal(links[0]?.textContent, "B2");
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct;
    dom.window.close();
  }
});

test("U03 same-mounted video navigation re-reads playlist URL without an unrelated storage write", async () => {
  const { JSDOM } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const { VideoUtilityDockIsland } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.net/a?playlist=A",
  });
  dom.window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });
  dom.window.localStorage.setItem("fn-playlist-order:A", JSON.stringify(["a2", "a1"]));
  dom.window.localStorage.setItem("fn-playlist-order:B", JSON.stringify(["b2", "b1"]));
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "CustomEvent", "localStorage"];
  const prior = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  const base = {
    loggedIn: false, authUnavailable: false, isBanned: false, isTosAccepted: false,
    termsReacceptRequired: false, activeXId: null, likeActive: false,
    bookmarkActive: false, viewerXApproved: false, privateChapters: [], playlistLabel: "Queue",
  };
  const make = (prefix, videoId) => React.createElement(VideoUtilityDockIsland, {
    videoId, currentId: prefix.toLowerCase() + "1", publicChapters: [],
    loading: false, overlay: { ...base, playlistItems: [1,2].map(n => ({
      id: prefix.toLowerCase() + n, title: prefix + n, youtube_video_id: null, display_name: "Creator",
    })) },
  });
  try {
    await React.act(async () => root.render(make("A", "video-a")));
    let links = [...dom.window.document.querySelectorAll("#video-utility-playlist ol a")];
    assert.equal(links[0]?.textContent, "A2");
    dom.window.history.replaceState(null, "", "/b?playlist=B");
    await React.act(async () => root.render(make("B", "video-b")));
    links = [...dom.window.document.querySelectorAll("#video-utility-playlist ol a")];
    assert.equal(links[0]?.textContent, "B2", "video navigation picks B's saved order");
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("fn-playlist-order:A")), ["a2", "a1"]);
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("fn-playlist-order:B")), ["b2", "b1"]);
    dom.window.history.replaceState(null, "", "/a?playlist=A");
    await React.act(async () => root.render(make("A", "video-a-return")));
    links = [...dom.window.document.querySelectorAll("#video-utility-playlist ol a")];
    assert.equal(links[0]?.textContent, "A2", "returning to A restores A's saved order");
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct;
    dom.window.close();
  }
});

test("U03 video identity remains sole URL-to-playlist synchronization trigger", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../apps/site/src/components/VideoUtilityDockIsland.ts", import.meta.url), "utf8");
  assert.match(source, /setPlaylist\(resolvePlaylistQuery\(window\.location\.search\)\);\s*\}, \[mounted, videoId, currentId\]\)/);
  assert.equal((source.match(/setPlaylist\(resolvePlaylistQuery\(window\.location\.search\)\)/g) || []).length, 1,
    "avoid duplicate URL effects that can replay stale browser state");
  assert.doesNotMatch(source, /\[mounted, ready, videoId, currentId, playlist\]/);
});

test("U02 dirty guard compares against editor/player prefill instead of false prompting", async () => {
  const { videoChapterDraftIsDirty } = await import("../apps/site/src/components/VideoChapterIsland.ts");
  const baseline = { time: "1:01:02", label: "サビ", note: "補足", csv: "" };
  assert.equal(videoChapterDraftIsDirty("1:01:02", "サビ", "補足", "", baseline), false);
  assert.equal(videoChapterDraftIsDirty("1:01:03", "サビ", "補足", "", baseline), true);
  assert.equal(videoChapterDraftIsDirty("1:01:02", "変更", "補足", "", baseline), true);
  assert.equal(videoChapterDraftIsDirty("1:01:02", "サビ", "補足", "csv", baseline), true);
});

test("U02 CURRENT time formatting supports hh:mm:ss, invalid and end-of-hour boundaries", async () => {
  const { formatChapterDraftTime } = await import("../apps/site/src/components/VideoChapterIsland.ts");
  assert.equal(formatChapterDraftTime(0), "0:00");
  assert.equal(formatChapterDraftTime(65.9), "1:05");
  assert.equal(formatChapterDraftTime(3599), "59:59");
  assert.equal(formatChapterDraftTime(3600), "1:00:00");
  assert.equal(formatChapterDraftTime(3662.8), "1:01:02");
  assert.equal(formatChapterDraftTime(-2), "0:00");
  assert.equal(formatChapterDraftTime(Number.NaN), "0:00");
});

test("U02 composer opens only on action, prefills the current player time and can cancel", async () => {
  const { JSDOM } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const { VideoChapterIsland } = await import("../apps/site/src/components/VideoChapterIsland.ts");
  const { publishPlayerTime } = await import("../src/components/video/playerBridge.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.net/abc",
  });
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "CustomEvent"];
  const original = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const key of keys) Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value: dom.window[key],
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true,
    })));
    const doc = dom.window.document;
    assert.equal(doc.querySelector("form"), null);
    await React.act(async () => publishPlayerTime(3662.8));
    await React.act(async () => {
      [...doc.querySelectorAll("button")].find((button) => button.textContent === "現在位置にコメントする").click();
    });
    assert.equal(doc.querySelector("form input[placeholder='mm:ss']").value, "1:01:02");
    let prompts = 0;
    dom.window.confirm = () => { prompts += 1; return false; };
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent("flamenode:before-active-x-switch", {
        cancelable: true, detail: { fromXId: "approved", toXId: "another" },
      }));
    });
    assert.equal(prompts, 0, "An untouched player-time prefill is not a dirty draft");
    await React.act(async () => {
      [...doc.querySelectorAll("button")].find((button) => button.textContent === "キャンセル").click();
    });
    assert.equal(doc.querySelector("form"), null);
    assert.ok([...doc.querySelectorAll("button")].some((button) => button.textContent === "現在位置にコメントする"));
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    dom.window.close();
  }
});

// P2 (PR #468 review): a previous private edit must never leak into the next new-post form.
async function withChapterDom(run) {
  const { JSDOM } = await import("jsdom");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://flamenode.net/abc" });
  const keys = ["window", "document", "Element", "HTMLElement", "Node", "CustomEvent"];
  const original = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const oldFetch = globalThis.fetch;
  for (const key of keys) Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value: dom.window[key],
  });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, chapterId: "ch1" }) });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await run(dom.window.document, root);
  } finally {
    await React.act(async () => root.unmount());
    globalThis.fetch = oldFetch;
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    dom.window.close();
  }
}
const clickButton = (doc, text) => React.act(async () => {
  [...doc.querySelectorAll("button")].find((button) => button.textContent === text).click();
});
const PRIVATE_CHAPTER = {
  id: "c1", chapter_time: "0:10", chapter_label: "秘密", note: "", visibility: "private", canManage: true,
};

test("P2 new-post form starts public after edit(private) -> cancel", async () => {
  await withChapterDom(async (doc, root) => {
    await React.act(async () => root.render(React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, chapters: [PRIVATE_CHAPTER],
    })));
    await clickButton(doc, "編集");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, false, "edit shows the chapter's private state");
    await clickButton(doc, "キャンセル");
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, true, "new post defaults to public");
  });
});

test("P2 new-post form starts public after edit(private) -> save", async () => {
  await withChapterDom(async (doc, root) => {
    await React.act(async () => root.render(React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, chapters: [PRIVATE_CHAPTER],
    })));
    await clickButton(doc, "編集");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, false);
    await React.act(async () => {
      doc.querySelector("form").dispatchEvent(new doc.defaultView.Event("submit", { bubbles: true, cancelable: true }));
    });
    assert.equal(doc.querySelector("form"), null, "composer closes after a successful update");
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, true, "new post defaults to public");
  });
});

test("P2 Active X switch resets a private edit to the public default", async () => {
  await withChapterDom(async (doc, root) => {
    await React.act(async () => root.render(React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, chapters: [PRIVATE_CHAPTER],
    })));
    await clickButton(doc, "編集");
    await React.act(async () => {
      doc.defaultView.dispatchEvent(new doc.defaultView.CustomEvent("flamenode:active-x-changed"));
    });
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, true);
  });
});


test("MIG-0518 chapter management stays disabled without the trusted RH-031 claim", async () => {
  const { chapterManagementForOverlay } = await import("../apps/site/src/components/VideoUtilityDockConnected.ts");
  const overlay = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    isTosAccepted: true, termsReacceptRequired: false,
    viewerXApproved: true, activeXId: "x-approved", privateChapters: [
      { id: "private-1", chapter_time: 65, chapter_label: "非公開", note: "必ず残す", visibility: "private" },
    ],
  };
  const denied = chapterManagementForOverlay([], overlay, false);
  assert.deepEqual(denied, { canBulk: false, editableChapters: [] });
  for (const bad of [
    { viewerCanEditChapters: false },
    { viewerCanEditChapters: true, authUnavailable: true },
    { viewerCanEditChapters: true, isBanned: true },
    { viewerCanEditChapters: true, termsReacceptRequired: true },
    { viewerCanEditChapters: true, isTosAccepted: false },
    { viewerCanEditChapters: true, viewerXApproved: false },
    { viewerCanEditChapters: true, activeXId: null },
  ]) {
    const result = chapterManagementForOverlay([], { ...overlay, ...bad }, false);
    assert.deepEqual(result, { canBulk: false, editableChapters: [] }, JSON.stringify(bad));
  }
  assert.deepEqual(chapterManagementForOverlay([], { ...overlay, viewerCanEditChapters: true }, true),
    { canBulk: false, editableChapters: [] }, "loading must not expose management");
});

test("MIG-0518 RH-031 manager claim does not bypass CURRENT write requirement for active X", async () => {
  const { chapterManagementForOverlay } = await import("../apps/site/src/components/VideoUtilityDockConnected.ts");
  const manager = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    isTosAccepted: true, termsReacceptRequired: false,
    viewerCanEditChapters: true, viewerXApproved: false, activeXId: null,
    privateChapters: [{ id: "p1", chapter_time: 15, chapter_label: "管理", note: null,
      visibility: "private", viewerCanManage: true }],
  };
  assert.deepEqual(chapterManagementForOverlay([], manager, false),
    { canBulk: false, editableChapters: [] },
    "Hono SA-012..015 requires approved active X even when RH-031 reports manager");
  const backend = fs.readFileSync(new URL("../apps/api/src/routes/videos/chapters.ts", import.meta.url), "utf8");
  assert.match(backend, /if \(!activeX\) return bulkFail\(403, SELECT_ACTIVE_X_MESSAGE\)/);
  assert.match(backend, /if \(!activeX\) return fail\(c, 403, SELECT_ACTIVE_X_MESSAGE\)/);
});

test("MIG-0518 authorized manager edits only complete private chapter DTOs", async () => {
  const { chapterManagementForOverlay } = await import("../apps/site/src/components/VideoUtilityDockConnected.ts");
  const overlay = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    isTosAccepted: true, termsReacceptRequired: false,
    viewerXApproved: true, activeXId: "x-approved",
    viewerCanEditChapters: true,
    privateChapters: [
      { id: "private-1", chapter_time: 65, chapter_label: "秘密", note: "保存済み本文", visibility: "private", viewerCanManage: true },
      { id: "public-duplicate", chapter_time: 10, chapter_label: "重複", note: "本文", visibility: "private", viewerCanManage: true },
    ],
  };
  const publicChapters = [
    { id: "public-1", timeLabel: "00:12", label: "公開コメント", kind: "comment" },
    { id: "public-duplicate", timeLabel: "00:10", label: "公開側が優先", kind: "comment" },
  ];
  const result = chapterManagementForOverlay(publicChapters, overlay, false);
  assert.equal(result.canBulk, true);
  assert.deepEqual(result.editableChapters, [{
    id: "private-1", chapter_time: "1:05", chapter_label: "秘密",
    note: "保存済み本文", visibility: "private", canManage: true,
  }], "public chapters must not be edited with a missing note field");
});


test("MIG-0518 chapter owner edits own private chapter without admin/bulk access", async () => {
  const { chapterManagementForOverlay } = await import("../apps/site/src/components/VideoUtilityDockConnected.ts");
  const base = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    isTosAccepted: true, termsReacceptRequired: false,
    viewerXApproved: true, activeXId: "owner-x",
    viewerCanEditChapters: false,
    privateChapters: [
      { id: "own", chapter_time: 70, chapter_label: "自分の章", note: "本文保持", visibility: "private", viewerCanManage: true },
      { id: "foreign", chapter_time: 90, chapter_label: "他人の章", note: "他人の本文", visibility: "private", viewerCanManage: false },
      { id: "unknown", chapter_time: 30, chapter_label: "不明", note: "本文", visibility: "private" },
    ],
  };
  const result = chapterManagementForOverlay([], base, false);
  assert.equal(result.canBulk, false, "normal owners cannot bulk-create");
  assert.deepEqual(result.editableChapters, [{
    id: "own", chapter_time: "1:10", chapter_label: "自分の章",
    note: "本文保持", visibility: "private", canManage: true,
  }], "only explicit per-chapter ownership can show edit/delete");
  for (const denied of [
    { isTosAccepted: false }, { isBanned: true },
    { authUnavailable: true }, { activeXId: null },
    { viewerXApproved: false }, { loggedIn: false },
  ]) {
    assert.deepEqual(chapterManagementForOverlay([], { ...base, ...denied }, false),
      { canBulk: false, editableChapters: [] }, JSON.stringify(denied));
  }
});

test("MIG-0518 bulk chapter UI does not claim video-owner-only access", () => {
  const source = fs.readFileSync(new URL("../apps/site/src/components/VideoChapterIsland.ts", import.meta.url), "utf8");
  assert.match(source, /CSV で一括登録（チャプター管理権限が必要）/);
  assert.doesNotMatch(source, /CSV で一括登録 \(動画オーナーのみ\)/);
});


test("P2 overlay auth revocation resets an open chapter editor without an Active X window event", async () => {
  await withChapterDom(async (doc, root) => {
    const render = (props) => React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true,
      chapters: [PRIVATE_CHAPTER], ...props,
    });
    await React.act(async () => root.render(render({})));
    await clickButton(doc, "編集");
    assert.ok(doc.querySelector("form"), "editor should be opened before revocation");
    await React.act(async () => root.render(render({ canPost: false })));
    assert.equal(doc.querySelector("form"), null, "permission loss must hide and reset editor");
    await React.act(async () => root.render(render({ canPost: true })));
    assert.equal(doc.querySelector("form"), null, "regrant must not restore another viewer's draft");
  });
});

test("P2 changing Active X prop clears unsent chapter edits without window events", async () => {
  await withChapterDom(async (doc, root) => {
    const render = (activeXId) => React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId, canPost: true, chapters: [PRIVATE_CHAPTER],
    });
    await React.act(async () => root.render(render("approved")));
    await clickButton(doc, "編集");
    assert.ok(doc.querySelector("form"));
    await React.act(async () => root.render(render("another-approved")));
    assert.equal(doc.querySelector("form"), null);
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, true, "new identity starts with public visibility");
  });
});


test("P2 per-chapter permission revocation closes edit while general posting stays allowed", async () => {
  await withChapterDom(async (doc, root) => {
    let writes = 0;
    globalThis.fetch = async () => {
      writes += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, chapterId: "c1" }) };
    };
    const render = (chapters) => React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, chapters,
    });
    await React.act(async () => root.render(render([PRIVATE_CHAPTER])));
    await clickButton(doc, "編集");
    assert.ok(doc.querySelector("form"), "edit begins while row capability is true");
    await React.act(async () => root.render(render([{ ...PRIVATE_CHAPTER, canManage: false }])));
    assert.equal(doc.querySelector("form"), null, "revoked row must close its existing editor");
    assert.equal([...doc.querySelectorAll("button")].some((button) => button.textContent === "編集"), false);
    assert.equal(writes, 0, "permission loss must not dispatch an update");
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("form input[placeholder='mm:ss']") !== null, true,
      "general new chapter posting remains available");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, true,
      "the revoked private draft must not carry over to a new post");
  });
});

test("P2 removal of an edited chapter invalidates its editor before any update", async () => {
  await withChapterDom(async (doc, root) => {
    const render = (chapters) => React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, chapters,
    });
    await React.act(async () => root.render(render([PRIVATE_CHAPTER])));
    await clickButton(doc, "編集");
    await React.act(async () => root.render(render([])));
    assert.equal(doc.querySelector("form"), null, "removed row must not remain editable");
  });
});


test("P2 revoking bulk capability clears its pending CSV without revoking normal chapter posting", async () => {
  await withChapterDom(async (doc, root) => {
    const render = (canBulk) => React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, canBulk,
    });
    await React.act(async () => root.render(render(true)));
    const textarea = doc.querySelector("details textarea");
    assert.ok(textarea, "bulk CSV editor is initially available");
    const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLTextAreaElement.prototype, "value").set;
    await React.act(async () => {
      setter.call(textarea, "0:10,secret");
      textarea.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
    });
    assert.equal(doc.querySelector("details textarea").value, "0:10,secret");
    await React.act(async () => root.render(render(false)));
    assert.equal(doc.querySelector("details textarea"), null, "revoked bulk editor is hidden");
    assert.ok([...doc.querySelectorAll("button")].some((button) =>
      button.textContent === "現在位置にコメントする"), "ordinary posting stays available");
    await React.act(async () => root.render(render(true)));
    assert.equal(doc.querySelector("details textarea").value, "", "prior CSV must not survive a permission loss");
  });
});


test("P2 changing videoId invalidates the previous video's editor while retaining new-post access", async () => {
  await withChapterDom(async (doc, root) => {
    let writes = 0;
    globalThis.fetch = async () => {
      writes += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, chapterId: "ch1" }) };
    };
    const render = (videoId) => React.createElement(VideoChapterIsland, {
      videoId, activeXId: "approved", canPost: true, chapters: [PRIVATE_CHAPTER],
    });
    await React.act(async () => root.render(render("video-a")));
    await clickButton(doc, "編集");
    assert.ok(doc.querySelector("form"), "first video opens an editor");
    await React.act(async () => root.render(render("video-b")));
    assert.equal(doc.querySelector("form"), null, "video transition clears old edit state");
    assert.equal(writes, 0, "no stale write is issued for a previous video's chapter");
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("input[type=checkbox]").checked, true,
      "a new video starts with the public new-post default");
  });
});


test("P2 changing only public/private visibility is an unsaved chapter edit", async () => {
  const { videoChapterDraftIsDirty } = await import("../apps/site/src/components/VideoChapterIsland.ts");
  const base = { time: "1:05", label: "chapter", note: "", csv: "", visibility: "private" };
  assert.equal(videoChapterDraftIsDirty("1:05", "chapter", "", "", base, "private"), false);
  assert.equal(videoChapterDraftIsDirty("1:05", "chapter", "", "", base, "public"), true);
  assert.equal(videoChapterDraftIsDirty("1:05", "chapter", "", "", { ...base, visibility: "public" }, "private"), true);
});

test("P2 visibility-only change warns before Active X switch and can cancel", async () => {
  await withChapterDom(async (doc, root) => {
    await React.act(async () => root.render(React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, chapters: [PRIVATE_CHAPTER],
    })));
    await clickButton(doc, "編集");
    const checkbox = doc.querySelector("form input[type=checkbox]");
    assert.equal(checkbox.checked, false);
    let prompts = 0;
    doc.defaultView.confirm = () => { prompts += 1; return false; };
    await React.act(async () => {
      checkbox.click();
    });
    assert.equal(doc.querySelector("form input[type=checkbox]").checked, true);
    const event = new doc.defaultView.CustomEvent("flamenode:before-active-x-switch", {
      cancelable: true,
      detail: { fromXId: "approved", toXId: "other" },
    });
    await React.act(async () => doc.defaultView.dispatchEvent(event));
    assert.equal(prompts, 1, "visibility-only modification must be recognized as dirty");
    assert.equal(event.defaultPrevented, true, "cancelled switch must preserve the editor");
    assert.ok(doc.querySelector("form"));
  });
});


test("P2 late chapter-create response cannot display success or refresh the next video", async () => {
  await withChapterDom(async (doc, root) => {
    let resolveResponse;
    let requests = 0;
    let refreshes = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return await new Promise((resolve) => { resolveResponse = resolve; });
    };
    const render = (videoId) => React.createElement(VideoChapterIsland, {
      videoId, activeXId: "approved", canPost: true,
      onChanged: () => { refreshes += 1; },
    });
    await React.act(async () => root.render(render("video-a")));
    await clickButton(doc, "現在位置にコメントする");
    const label = doc.querySelector("form input[maxlength='120']");
    const time = doc.querySelector("form input[placeholder='mm:ss']");
    assert.ok(label && time, "new post composer must be available");
    // React DOM is imported before JSDOM globals in this Node test file.
    // Focus + keyup also exercises its legacy input-change fallback path.
    const setInput = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, "value").set;
    await React.act(async () => {
      for (const [field, value] of [[label, "Pending chapter"], [time, "0:10"]]) {
        field.focus();
        setInput.call(field, value);
        field.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
        field.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
        field.dispatchEvent(new doc.defaultView.KeyboardEvent("keyup", { bubbles: true, key: "0" }));
      }
    });
    await React.act(async () => {
      doc.querySelector("form").dispatchEvent(new doc.defaultView.Event("submit", {
        bubbles: true, cancelable: true,
      }));
    });
    assert.equal(requests, 1, "a chapter create request must be pending");
    await React.act(async () => root.render(render("video-b")));
    assert.equal(doc.querySelector("form"), null, "new video starts without the old draft");
    await React.act(async () => {
      resolveResponse({ ok: true, status: 200, json: async () => ({
        ok: true, chapterId: "old-video-chapter",
      }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(refreshes, 0, "the previous video's response must not refresh the new video");
    assert.equal(doc.querySelector('[role="status"]'), null,
      "the previous video's success message must not be shown");
  });
});


test("P2 late bulk CSV response after permission revocation cannot show success or refresh", async () => {
  await withChapterDom(async (doc, root) => {
    let resolveResponse;
    let requests = 0;
    let refreshes = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return await new Promise((resolve) => { resolveResponse = resolve; });
    };
    const render = (canBulk) => React.createElement(VideoChapterIsland, {
      videoId: "abc", activeXId: "approved", canPost: true, canBulk,
      onChanged: () => { refreshes += 1; },
    });
    await React.act(async () => root.render(render(true)));
    const details = doc.querySelector("details");
    const textarea = details?.querySelector("textarea");
    assert.ok(textarea, "CSV editor must exist before revocation");
    // JSDOM keeps the closed <details> subtree hidden from keyboard interaction.
    // Open it as a user would before typing or submitting; the test must trigger
    // an actual React onChange rather than only changing the raw DOM value.
    await React.act(async () => {
      details.querySelector("summary").click();
    });
    // The React DOM event plugin was loaded before JSDOM was installed in this
    // Node test. Dispatch native events through the owning document's textarea
    // element, and verify that controlled state accepted the input below.
    const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLTextAreaElement.prototype, "value").set;
    await React.act(async () => {
      textarea.focus();
      setter.call(textarea, "0:10,Pending");
      textarea.dispatchEvent(new doc.defaultView.InputEvent("input", {
        bubbles: true, inputType: "insertText", data: "0:10,Pending",
      }));
      textarea.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
      textarea.dispatchEvent(new doc.defaultView.KeyboardEvent("keyup", { bubbles: true, key: "g" }));
    });
    assert.equal(textarea.value, "0:10,Pending");
    // React's controlled textarea must have accepted the synthetic input,
    // not merely the untracked DOM .value property. A nonempty CSV enables
    // the submit control; detect input-change wiring failure before dispatch.
    const bulkSubmit = details.querySelector('button[type="submit"]');
    assert.ok(bulkSubmit, "bulk submit must exist");
    assert.equal(bulkSubmit.disabled, false, "React state must contain the CSV before submission");
    await React.act(async () => {
      bulkSubmit.click();
    });
    assert.equal(requests, 1, "bulk request must be pending");
    await React.act(async () => root.render(render(false)));
    assert.equal(doc.querySelector("details"), null, "permission loss immediately hides CSV controls");
    await React.act(async () => {
      resolveResponse({ ok: true, status: 200, json: async () => ({
        ok: true, inserted: 1, skipped: 0, message: "追加しました",
      }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(refreshes, 0, "revoked bulk result must not refresh the overlay");
    assert.equal(doc.querySelector('[role="status"]'), null,
      "revoked bulk result must not display a stale success");
    await React.act(async () => root.render(render(true)));
    assert.equal(doc.querySelector("details textarea").value, "",
      "a new grant must not restore the old CSV draft");
  });
});


test("MIG-0518 whitespace-only Active X fails closed in policy and action guards", async () => {
  const { canPostVideoChapter, chapterPostPolicy } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const overlay = {
    loggedIn: true, viewerXApproved: true, activeXId: " \t ",
    isBanned: false, isTosAccepted: true, termsReacceptRequired: false,
    authUnavailable: false,
  };
  assert.equal(canPostVideoChapter(overlay, false), false);
  const policy = chapterPostPolicy(overlay, false, "/video");
  assert.equal(policy.canPost, false);
  assert.equal(policy.href, "/dashboard/settings?next=%2Fvideo");
  assert.equal(canPostVideoChapter({ ...overlay, activeXId: " x-valid " }, false), true);
  assert.equal(chapterPostPolicy({ ...overlay, activeXId: " x-valid " }, false, "/video").canPost, true);
});

test("MIG-0518 video switch clears prior player-time before the next player reports", async () => {
  await withChapterDom(async (doc, root) => {
    const render = (videoId) => React.createElement(VideoChapterIsland, {
      videoId, activeXId: "approved", canPost: true,
    });
    await React.act(async () => root.render(render("video-a")));
    await React.act(async () => {
      doc.defaultView.dispatchEvent(new doc.defaultView.CustomEvent("flamenode:player-time", {
        detail: { time: 3661 },
      }));
    });
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("input[placeholder='mm:ss']").value, "1:01:01");
    await React.act(async () => root.render(render("video-b")));
    assert.equal(doc.querySelector("form"), null, "switching videos must close the old draft");
    await clickButton(doc, "現在位置にコメントする");
    assert.equal(doc.querySelector("input[placeholder='mm:ss']").value, "0:00",
      "video B must not inherit video A's playback time");
    await React.act(async () => {
      doc.defaultView.dispatchEvent(new doc.defaultView.CustomEvent("flamenode:player-time", {
        detail: { time: 12 },
      }));
    });
    await React.act(async () => {
      [...doc.querySelectorAll("button")].find((button) => button.textContent === "現在位置").click();
    });
    assert.equal(doc.querySelector("input[placeholder='mm:ss']").value, "0:12",
      "new player updates remain accepted");
  });
});

test("MIG-0518 duplicate playlist URL keys do not select an ambiguous playlist", async () => {
  const { resolvePlaylistQuery } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  assert.equal(resolvePlaylistQuery("?playlist=A&playlist=B"), "");
  assert.equal(resolvePlaylistQuery("?playlist=A&playlist=A"), "",
    "even identical duplicate URL keys are ambiguous");
  assert.equal(resolvePlaylistQuery("?playlist=A"), "A");
  assert.equal(resolvePlaylistQuery("?other=1&playlist=%20A%20"), "A");
  assert.equal(resolvePlaylistQuery("?playlist="), "");
  assert.equal(resolvePlaylistQuery("?playlist=" + "x".repeat(129)), "x".repeat(128));
  assert.equal(resolvePlaylistQuery("?playlist=" + "x".repeat(127) + encodeURIComponent("😀")), "x".repeat(127));
});

test("MIG-0518 auto-next ignores missing, malformed and unrelated ended-video IDs", async () => {
  const { shouldAdvancePlaylistOnEnded } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  for (const bad of [undefined, null, "", 0, false, {}, "other-video"]) {
    assert.equal(shouldAdvancePlaylistOnEnded(bad, "video-a", undefined), false,
      "missing playlist YouTube ID must not match malformed ended event: " + String(bad));
    assert.equal(shouldAdvancePlaylistOnEnded(bad, "video-a", null), false);
  }
  assert.equal(shouldAdvancePlaylistOnEnded("video-a", "video-a", null), true,
    "the active video ID remains a legitimate ended event");
  assert.equal(shouldAdvancePlaylistOnEnded("youtube-a", "video-a", "youtube-a"), true,
    "the active video's YouTube ID also matches");
  assert.equal(shouldAdvancePlaylistOnEnded("youtube-b", "video-a", "youtube-a"), false,
    "a different player's ended event must not advance this playlist");
});

test("MIG-0518 stored playlist order is bounded, deduplicated and fails closed", async () => {
  const { parseStoredPlaylistOrder } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const data = ["v2", "v1", "v2", null, 4, "", "x".repeat(129), "v3"];
  assert.deepEqual(parseStoredPlaylistOrder(JSON.stringify(data)), ["v2", "v1", "v3"]);
  for (const bad of [null, "", "null", "{}", "[", "x".repeat(100_001)]) {
    assert.deepEqual(parseStoredPlaylistOrder(bad), [], "reject invalid or oversized saved payload");
  }
  const many = Array.from({ length: 9000 }, (_, i) => "v" + i);
  const restored = parseStoredPlaylistOrder(JSON.stringify(many));
  assert.equal(restored.length, 500, "untrusted JSON arrays must not create unbounded reorder work");
  assert.equal(restored[0], "v0");
  assert.equal(restored[499], "v499");
  assert.equal(parseStoredPlaylistOrder(JSON.stringify(["video-1"]))[0], "video-1");
});

test("MIG-0518 duplicate playlist entries preserve first occurrence and original order", async () => {
  const { uniquePlaylistItems } = await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  const items = [
    { id: "a", title: "first a" },
    { id: "b", title: "first b" },
    { id: "a", title: "later a" },
    { id: "c", title: "first c" },
    { id: "b", title: "later b" },
  ];
  const filtered = uniquePlaylistItems(items);
  assert.deepEqual(filtered.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(filtered[0], items[0], "the first server row wins without cloning it");
  assert.equal(filtered[1], items[1]);
  const many = Array.from({ length: 500 }, (_, i) => ({ id: "v" + (i % 50), title: "entry " + i }));
  assert.equal(uniquePlaylistItems(many).length, 50);
  assert.equal(uniquePlaylistItems([]).length, 0);
});

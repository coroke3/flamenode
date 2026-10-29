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

test("U03 playlist query uses first value only, trims it and retains it on navigation", async () => {
  const { resolvePlaylistQuery, playlistItemHref } =
    await import("../apps/site/src/components/VideoUtilityDockIsland.ts");
  assert.equal(resolvePlaylistQuery("?playlist=first&playlist=second"), "first");
  assert.equal(resolvePlaylistQuery("?playlist=%20event-1%20"), "event-1");
  assert.equal(resolvePlaylistQuery("?other=1"), "");
  assert.equal(resolvePlaylistQuery("?playlist=" + "x".repeat(200)).length, 128);
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

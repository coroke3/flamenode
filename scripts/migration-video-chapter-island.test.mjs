// MIG-0518 U02: independent Hono SA-012..015 contract and write-control tests.
import assert from "node:assert/strict";
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

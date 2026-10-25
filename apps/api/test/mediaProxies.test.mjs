// MIG-0605 U03 (part): RH-016 / RH-033 media proxies + T02 SSRF.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "../src/app.ts";

const realFetch = globalThis.fetch;
let fetched = [];
function mockFetch(handler) {
  fetched = [];
  globalThis.fetch = async (url, init) => {
    fetched.push(String(url));
    return handler(String(url), init);
  };
}
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const png = () =>
  new Response(new Uint8Array([1, 2, 3, 4]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

test("T02 SSRF: external URL / traversal as id -> 404 and no upstream fetch", async () => {
  mockFetch(png);
  const bad = [
    "/api/google-drive-image/" + encodeURIComponent("http://169.254.169.254/latest"),
    "/api/google-drive-image/..%2f..%2fsecret",
    "/api/google-drive-image/abc",
    "/api/google-drive-image/ab%20cdefgh",
    "/api/youtube-thumbnail/" + encodeURIComponent("http://evil.example/x") + "/hqdefault",
    "/api/youtube-thumbnail/dQw4w9WgXcQ/not-a-size",
    "/api/youtube-thumbnail/short/hqdefault",
    "/api/youtube-thumbnail/dQw4w9WgXcQ/" + encodeURIComponent("../../x"),
  ];
  for (const path of bad) {
    const res = await app.request("http://localhost" + path);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), "Not found", path);
  }
  assert.deepEqual(fetched, []);
});

test("Drive proxy fetches only the fixed host with the validated id", async () => {
  mockFetch(png);
  const res = await app.request("http://localhost/api/google-drive-image/driveid_123");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual(fetched, ["https://lh3.googleusercontent.com/d/driveid_123"]);
  // second request is served from the isolate cache
  const again = await app.request("http://localhost/api/google-drive-image/driveid_123");
  assert.equal(again.status, 200);
  assert.equal(fetched.length, 1);
});

test("Drive proxy: upstream failure -> SVG fallback (CURRENT shape)", async () => {
  mockFetch(() => new Response("no", { status: 500 }));
  const res = await app.request("http://localhost/api/google-drive-image/failid_123");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^image\/svg\+xml/);
  assert.equal(res.headers.get("x-fn-media-cache"), "fallback");
  assert.match(await res.text(), /Image unavailable/);
});

test("YouTube proxy: size with .jpg suffix, fixed ytimg host, size-bounded body", async () => {
  mockFetch(png);
  const res = await app.request("http://localhost/api/youtube-thumbnail/dQw4w9WgXcQ/mqdefault.jpg");
  assert.equal(res.status, 200);
  assert.deepEqual(fetched, ["https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"]);

  // 'default' tier is capped at 96KiB: a larger body falls back, never buffered whole.
  mockFetch(() => new Response(new Uint8Array(200 * 1024), { status: 200, headers: { "content-type": "image/jpeg" } }));
  const big = await app.request("http://localhost/api/youtube-thumbnail/AAAAAAAAAAA/default");
  assert.match(big.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await big.text(), /サムネイルを取得できません/);
});

test("only GET is routed", async () => {
  const res = await app.request("http://localhost/api/google-drive-image/driveid_123", { method: "POST" });
  assert.equal(res.status, 404);
});

test("externalImageProxy.ts is CURRENT's file (only parse export dropped); sizes/limits pinned", () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const current = read("../../../src/lib/media/externalImageProxy.ts");
  const ported = read("../src/routes/media/externalImageProxy.ts");
  assert.equal(
    ported,
    current.replace("export function parseExternalRetryAfterMs", "function parseExternalRetryAfterMs"),
  );
  const id = read("../../../src/lib/youtube/id.ts");
  const m = id.match(/YOUTUBE_THUMB_SIZES = \[([^\]]*)\]/);
  const sizes = [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  const mine = read("../src/routes/media/proxies.ts").match(/YOUTUBE_THUMB_SIZES = \[([^\]]*)\]/);
  assert.deepEqual([...mine[1].matchAll(/"(\w+)"/g)].map((x) => x[1]), sizes);
  const drive = read("../../../app/api/google-drive-image/[id]/route.ts");
  const yt = read("../../../app/api/youtube-thumbnail/[id]/[size]/route.ts");
  const proxies = read("../src/routes/media/proxies.ts");
  for (const re of [/GOOGLE_DRIVE_ID_RE = [^\n]+/, /MAX_OBJECT_BYTES = [^\n]+/, /FALLBACK_SVG = [^\n]+/]) {
    const cur = drive.match(re)[0].replace("MAX_OBJECT_BYTES", "DRIVE_MAX_OBJECT_BYTES").replace("FALLBACK_SVG", "DRIVE_FALLBACK_SVG");
    assert.ok(proxies.includes(cur), String(re));
  }
  assert.ok(proxies.includes(yt.match(/YOUTUBE_ID_RE = [^\n]+/)[0]));
  assert.ok(proxies.includes(yt.match(/FALLBACK_SVG = [^\n]+/)[0].replace("FALLBACK_SVG", "YOUTUBE_FALLBACK_SVG")));
  assert.ok(proxies.includes(yt.match(/MAX_OBJECT_BYTES_BY_SIZE[^]*?\n\};/)[0]));
});

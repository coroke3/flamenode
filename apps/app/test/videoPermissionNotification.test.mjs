import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoEditPermissionGrantedNotification as build } from "../.test-dist/apps/app/src/lib/videoPermissionNotification.js";

const production = { NEXT_PUBLIC_SITE_URL: "https://canonical.example", NODE_ENV: "production" };
const args = { videoId: "v1", videoTitle: "作品" };

test("MIG-0715 U03 notification template keeps exact CURRENT copy and metadata", () => {
  const url = "https://canonical.example/dashboard/edit/v1";
  assert.deepEqual(build(args, production), {
    content: [
      "【FlameNode】作品の編集権限が付与されました",
      "作品「作品」を共同編集できるようになりました。\nタイトル・紹介文・メンバー情報など、許可された範囲を編集できます。",
      "■ 次に行うこと",
      `編集画面を開き、担当範囲の修正を行ってください。\n編集画面を開く\n${url}`,
    ].join("\n\n"),
    video_id: "v1", url,
  });
});

test("MIG-0715 U03 uses supplied canonical origin, not browser or process origin", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://preview.example" } } });
    const result = build(args, { ...production, NEXT_PUBLIC_SITE_URL: " https://CANONICAL.example:443/ " });
    assert.equal(result.url, "https://canonical.example/dashboard/edit/v1");
    assert.ok(result.content.endsWith(result.url));
    assert.doesNotMatch(result.content, /preview\.example/);
    assert.throws(() => build(args, { NODE_ENV: "production" }), /NEXT_PUBLIC_SITE_URL_MISSING/);
  } finally {
    if (before) Object.defineProperty(globalThis, "window", before);
    else delete globalThis.window;
  }
});

test("MIG-0715 U03 neutralizes mentions and preserves CURRENT URL path semantics", () => {
  const title = "@everyone <@123> @here";
  for (const [videoId, expected] of [["vid 1", "vid%201"], ["a/b", "a/b"], ["a%2Fb", "a%2Fb"], ["", ""]]) {
    const result = build({ videoId, videoTitle: title }, production);
    assert.equal(result.url, `https://canonical.example/dashboard/edit/${expected}`);
    assert.ok(result.content.endsWith(result.url));
    assert.ok(result.content.includes("@\u200beveryone \\<@\u200b123\\> @\u200bhere"));
    if (videoId) assert.equal(result.video_id, videoId);
    else assert.equal(Object.hasOwn(result, "video_id"), false);
  }
});

test("MIG-0715 U03 rejects missing, malformed, credential-bearing and non-origin configuration", () => {
  for (const origin of [undefined, "", "  "]) {
    assert.throws(() => build(args, { ...production, NEXT_PUBLIC_SITE_URL: origin }), { message: "NEXT_PUBLIC_SITE_URL_MISSING" });
  }
  for (const origin of ["not a URL", "//canonical.example", "ftp://canonical.example", "https://user:pass@canonical.example", "https://canonical.example/base", "https://canonical.example/?a=1", "https://canonical.example/#fragment"]) {
    assert.throws(() => build(args, { ...production, NEXT_PUBLIC_SITE_URL: origin }), { message: "NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN" });
  }
});

test("MIG-0715 U03 forbids production loopback and permits CURRENT development origin", () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    assert.throws(() => build(args, { ...production, NEXT_PUBLIC_SITE_URL: origin }), { message: "NEXT_PUBLIC_SITE_URL_LOCALHOST_FORBIDDEN" });
    assert.equal(build(args, { NEXT_PUBLIC_SITE_URL: origin, NODE_ENV: "development" }).url, `${origin}/dashboard/edit/v1`);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteCanonicalR2Key } from "./rewriteCanonicalR2Key.ts";

test("YouTube alias の video JSON key を canonical へ書き換える", () => {
  assert.equal(
    rewriteCanonicalR2Key("videos/dQw4w9wgGc.json", "dQw4w9wgGc", "vid_canonical"),
    "videos/vid_canonical.json",
  );
});

test("user 配下の page key も id セグメントだけ差し替える", () => {
  assert.equal(
    rewriteCanonicalR2Key(
      "users/alice/works/p2.json",
      "alice",
      "alice_canonical",
    ),
    "users/alice_canonical/works/p2.json",
  );
});

test("同一 id や一致しない key は書き換えない", () => {
  assert.equal(
    rewriteCanonicalR2Key("videos/vid.json", "vid", "vid"),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("top.json", "vid", "other"),
    null,
  );
});

test("不正 ID（パス区切り・..・制御文字）は書き換えない", () => {
  assert.equal(
    rewriteCanonicalR2Key("videos/foo.json", "foo/bar", "canonical"),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("videos/foo.json", "foo", "a/../secret"),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("videos/foo.json", "a\\b", "canonical"),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("videos/foo.json", "foo", ".."),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("videos/foo.json", "   ", "canonical"),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("videos/foo.json", "foo\u0000bar", "canonical"),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("videos/../foo.json", "foo", "canonical"),
    null,
  );
  assert.equal(
    rewriteCanonicalR2Key("/videos/foo.json", "foo", "canonical"),
    null,
  );
});

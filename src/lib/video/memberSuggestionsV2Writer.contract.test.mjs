import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [writer, postings] = await Promise.all([
  readFile(
    new URL(
      "../../../workers/json-generator/memberSuggestionsV2Artifacts.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("./memberSuggestionsPostingsV2.ts", import.meta.url), "utf8"),
]);

test("16 bucket postingsを実質無効化しないbounded publish budgetを持つ", () => {
  assert.match(
    writer,
    /MEMBER_SUGGESTIONS_V2_MAX_PUBLISH_OBJECTS = 256/,
  );
});

test("2文字未満の到達不能postingをbuilder段階から生成しない", () => {
  assert.match(postings, /MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH = 2/);
  assert.match(
    postings,
    /minGramLength: MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH/,
  );
  assert.doesNotMatch(postings, /removeUnqueriedShortGrams/);
});

test("partial publish失敗時はmanifest撤去成功後だけgeneration objectを削除する", () => {
  assert.match(
    writer,
    /const manifestRemoved = await deleteManifestBestEffort\(bucket\)/,
  );
  assert.match(
    writer,
    /if \(manifestRemoved\) \{\s*await deleteKeysBestEffort\(bucket, writtenKeys\)/s,
  );
});

test("旧generation manifestはsize上限超過ならJSON parseしない", () => {
  // size guard と parse の順序は readBoundedR2Json の実行 test（src/lib/r2Body.test.mjs）が検査する。
  assert.match(
    writer,
    /readBoundedR2Json\(\s*bucket,\s*MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,\s*MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES,/,
  );
});

test("旧generation cleanupは1000 objectで明示的にboundedされる", () => {
  assert.match(
    writer,
    /MEMBER_SUGGESTIONS_V2_CLEANUP_LIST_LIMIT = 1000/,
  );
  assert.match(writer, /listed\.truncated/);
});

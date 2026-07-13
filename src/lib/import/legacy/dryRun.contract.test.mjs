import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./dryRun.ts", import.meta.url), "utf8");

test("既存IDとimport済みIDの独立取得を並列化する", () => {
  assert.match(
    source,
    /const \[existingEventIds, existingVideoIds, existingXIds\] = await Promise\.all/,
  );
  assert.match(
    source,
    /\[importedEventIds, importedVideoIds\] = await Promise\.all/,
  );
});

test("eventとvideoのloop内で全配列filter/findを繰り返さない", () => {
  const eventLoop = source.slice(
    source.indexOf("// events"),
    source.indexOf("// videos"),
  );
  const videoLoop = source.slice(
    source.indexOf("// videos"),
    source.indexOf("// x users"),
  );
  assert.doesNotMatch(eventLoop, /plan\.(?:warnings|eventStaff)\.filter/);
  assert.doesNotMatch(videoLoop, /plan\.(?:warnings|videoMembers)\.filter/);
  assert.doesNotMatch(videoLoop, /plan\.videoNormExtras\.find/);
  assert.match(source, /warningMessages\.get\(`event:/);
  assert.match(source, /warningMessages\.get\(`video:/);
  assert.match(source, /memberCountByVideo\.get/);
  assert.match(source, /firstExtraByVideo\.get/);
});

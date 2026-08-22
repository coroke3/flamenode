import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./restore.ts", import.meta.url)),
  "utf8",
);

test("audit video restore applies the public YouTube eligibility guard", () => {
  assert.match(source, /validateVideoPublicEligibility/);
  assert.match(source, /nextStatus/);
  assert.match(source, /if \(!publicEligibility\.ok\)/);
});

test("audit restore preserves an explicit null YouTube ID from the snapshot", () => {
  assert.match(source, /hasOwnProperty\.call\(\s*target,\s*["']youtube_video_id["']/);
  assert.match(source, /restoredYoutubeVideoId/);
});

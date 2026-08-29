import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./updateVideo.ts", import.meta.url), "utf8");

test("updateVideo reuses the request-local D1 and exposes an action error boundary", () => {
  assert.doesNotMatch(source, /getDatabase\(\)/);
  assert.match(source, /const db = guard\.db/);
  assert.match(source, /const targetYoutubeVideoId = target\.youtube_video_id\?\.trim\(\) \|\| null/);
  assert.match(source, /youtubeId = targetYoutubeVideoId/);
  assert.match(
    source,
    /const youtubeChanged =\s*sections\.youtube &&\s*\(youtubeId \?\? null\) !== \(target\.youtube_video_id \?\? null\)/,
  );
  assert.match(source, /async function updateVideoCore/);
  assert.match(source, /export async function updateVideo\(/);
  assert.match(source, /UPDATE_VIDEO_UNEXPECTED_ERROR_MESSAGE/);
  assert.match(source, /console\.warn\("\[updateVideo\] preflight rejected"/);
});

test("updateVideo は privilegeMode に応じてイベント必須項目を検証する", () => {
  assert.match(source, /loadUnionRequiredVideoFields/);
  assert.match(source, /firstMissingRequiredVideoField/);
  assert.match(source, /missingRequiredVideoFieldMessage/);
  assert.match(
    source,
    /firstMissingRequiredVideoField\([\s\S]*?loadUnionRequiredVideoFields\(db, requiredEventIds\)[\s\S]*?privilegeMode === "normal" \? generalFields : undefined/,
  );
  assert.match(
    source,
    /if \(missingRequired\) \{[\s\S]*?return \{ ok: false, message: missingRequiredVideoFieldMessage\(missingRequired\) \}/,
  );
});

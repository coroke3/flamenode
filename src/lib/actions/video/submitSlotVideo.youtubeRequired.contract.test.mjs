import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./submitSlotVideo.ts", import.meta.url), "utf8");

test("新規の枠投稿は YouTube ID なしでも保存でき、後から追加できる", () => {
  const existingVideoCheck = source.indexOf("const existingVideo = slotRow.video_id");
  const missingExistingVideoCheck = source.indexOf("if (slotRow.video_id && !existingVideo)");
  const videoInsert = source.indexOf("const videoAfter: typeof videos.$inferSelect =");
  const youtubeAssignment = source.indexOf("youtube_video_id: submittedYoutubeId");

  assert.ok(existingVideoCheck >= 0);
  assert.ok(missingExistingVideoCheck > existingVideoCheck);
  assert.ok(videoInsert > missingExistingVideoCheck);
  assert.ok(youtubeAssignment > videoInsert);
  assert.match(source, /parseVideoForm\(Object\.fromEntries\(formData\), \{ youtubeRequired: false \}\)/);
  assert.doesNotMatch(source, /新規投稿にはYouTube URLが必要です。/);
});

test("既存枠の再投稿では YouTube URL の明示クリア経路を維持する", () => {
  assert.match(source, /else if \(existingVideo && youtubeFieldPresent\) \{[\s\S]*buildVideoMetadataClearPlan/);
});

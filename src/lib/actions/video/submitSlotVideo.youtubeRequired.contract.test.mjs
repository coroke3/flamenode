import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./submitSlotVideo.ts", import.meta.url), "utf8");

test("新規の枠投稿は YouTube ID がない場合に fail-closed する", () => {
  const existingVideoCheck = source.indexOf("const existingVideo = slotRow.video_id");
  const missingExistingVideoCheck = source.indexOf("if (slotRow.video_id && !existingVideo)");
  const youtubeRequiredCheck = source.indexOf("if (!existingVideo && !submittedYoutubeId)");
  const videoInsert = source.indexOf("const videoAfter: typeof videos.$inferSelect =");

  assert.ok(existingVideoCheck >= 0);
  assert.ok(missingExistingVideoCheck > existingVideoCheck);
  assert.ok(youtubeRequiredCheck > missingExistingVideoCheck);
  assert.ok(youtubeRequiredCheck < videoInsert);
  assert.match(
    source.slice(youtubeRequiredCheck, videoInsert),
    /新規投稿にはYouTube URLが必要です。/,
  );
});

test("既存枠の再投稿では YouTube URL の明示クリア経路を維持する", () => {
  assert.match(source, /else if \(existingVideo && youtubeFieldPresent\) \{[\s\S]*buildVideoMetadataClearPlan/);
});

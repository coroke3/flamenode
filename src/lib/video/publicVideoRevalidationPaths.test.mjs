import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { publicVideoRevalidationPaths } from "./publicVideoRevalidationPaths.ts";

test("public visibility updates invalidate the internal ID and YouTube detail alias", () => {
  assert.deepEqual(publicVideoRevalidationPaths("vid_123", "dQw4w9WgXcQ"),
    ["/vid_123", "/dQw4w9WgXcQ"]);
  assert.deepEqual(publicVideoRevalidationPaths("vid_123", " https://youtu.be/dQw4w9WgXcQ?t=42 "),
    ["/vid_123", "/dQw4w9WgXcQ"]);
  assert.deepEqual(publicVideoRevalidationPaths("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ["/dQw4w9WgXcQ"], "same ID should not trigger duplicate revalidation");
  assert.deepEqual(publicVideoRevalidationPaths("vid_123", null), ["/vid_123"]);
});

test("invalid stored IDs never invalidate a foreign host or unrelated root", () => {
  const origin = "https://flamenode.net";
  const malformed = [
    "//outside.example", "/outside.example", "https://outside.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)", "short", "ABCDEFGHIJKL", "../private", "https://youtu.be/short",
  ];
  for (const youtubeId of malformed) {
    assert.deepEqual(publicVideoRevalidationPaths("vid_123", youtubeId), ["/vid_123"],
      `unexpected additional route from ${youtubeId}`);
  }
  assert.deepEqual(publicVideoRevalidationPaths("//outside.example", null), []);
  assert.deepEqual(publicVideoRevalidationPaths("../private", "dQw4w9WgXcQ"),
    ["/dQw4w9WgXcQ"]);
  for (const path of publicVideoRevalidationPaths("vid_123", "dQw4w9WgXcQ")) {
    assert.equal(new URL(path, origin).origin, origin);
    assert.match(path, /^\/[A-Za-z0-9_-]+$/);
  }
});

test("all CURRENT visibility write paths invalidate both public aliases", () => {
  const actions = [
    ["src/lib/actions/admin.ts", "publicVideoRevalidationPaths(videoId, youtubeVideoId)"],
    ["src/lib/actions/manage-video.ts", "publicVideoRevalidationPaths(videoId, youtubeVideoId)"],
    ["src/lib/actions/moderation-admin.ts", "publicVideoRevalidationPaths(video.id, video.youtube_video_id)"],
  ];
  for (const [path, call] of actions) {
    const source = fs.readFileSync(path, "utf8");
    assert.ok(source.includes(call), `${path}: missing dual-alias invalidation`);
    assert.ok(source.includes("revalidatePath(publicPath)"), `${path}: missing revalidatePath call`);
  }
});

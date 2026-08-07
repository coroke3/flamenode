import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./manage-video.ts", import.meta.url), "utf8");

test("manage video status uses the manage-specific CostGuard feature", () => {
  assert.match(source, /writeGuard\(\{ feature: "manage_video_status" \}\)/);
  assert.doesNotMatch(source, /admin_video_status/);
});

test("manage video status exports approve helpers", () => {
  assert.match(source, /export async function approveManageVideoPublic/);
  assert.match(source, /export async function approveManageVideoPublicAndNext/);
});

test("manage video status caller query count excludes static rebuild prefetch", () => {
  assert.match(source, /STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT/);
  assert.match(source, /MANAGE_VIDEO_STATUS_CALLER_QUERY_COUNT\s*=/);
});

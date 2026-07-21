import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./manage-video.ts", import.meta.url), "utf8");

test("manage video status uses the manage-specific CostGuard feature", () => {
  assert.match(source, /writeGuard\(\{ feature: "manage_video_status" \}\)/);
  assert.doesNotMatch(source, /admin_video_status/);
});

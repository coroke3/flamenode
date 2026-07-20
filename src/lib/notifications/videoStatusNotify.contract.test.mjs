import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./videoStatusNotify.ts", import.meta.url), "utf8");

test("limited, private and archived visibility changes never enqueue Discord DM", () => {
  assert.match(
    source,
    /SILENT_VISIBILITY_STATUSES = new Set\(\["limited", "private", "archived"\]\)/,
  );
  assert.match(source, /SILENT_VISIBILITY_STATUSES\.has\(status\)/);

  const silentGuard = source.indexOf("SILENT_VISIBILITY_STATUSES.has(status)");
  const forceFallback = source.indexOf('force ? "video_status_changed" : null');
  assert.ok(silentGuard >= 0 && forceFallback >= 0 && silentGuard < forceFallback);

  assert.doesNotMatch(source, /limited:\s*"video_limited"/);
  assert.doesNotMatch(source, /private:\s*"video_private"/);
  assert.doesNotMatch(source, /archived:\s*"video_archived"/);
});

test("public approval and voided warning notifications remain enabled", () => {
  assert.match(source, /voided:\s*"video_voided"/);
  assert.match(source, /status === "public"/);
  assert.match(source, /type:\s*"video_approved"/);
});

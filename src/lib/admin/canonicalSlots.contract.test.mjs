import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [integrityChecks, healthChecks] = await Promise.all([
  readFile(new URL("./integrityChecks.ts", import.meta.url), "utf8"),
  readFile(new URL("./healthChecks.ts", import.meta.url), "utf8"),
]);

test("管理ヘルスチェックは廃止済みのslots.slot_kindを参照しない", () => {
  assert.doesNotMatch(integrityChecks, /\bslot_kind\b/);
  assert.doesNotMatch(healthChecks, /\bslot_kind\b/);
  assert.match(integrityChecks, /start_time IS NOT NULL\s+AND EXISTS/);
});

test("整合性検査は0043後の正本列のみを参照する", () => {
  assert.doesNotMatch(integrityChecks, /video_youtube_metadata.*youtube_video_id/);
  assert.doesNotMatch(integrityChecks, /video_members.*\buser_id\b/);
  assert.match(
    integrityChecks,
    /can_edit = 1 AND \(x_user_id IS NULL OR trim\(x_user_id\) = ''\)/,
  );
  assert.match(
    integrityChecks,
    /INSERT INTO video_youtube_metadata \(video_id, sync_status, updated_at\)/,
  );
});

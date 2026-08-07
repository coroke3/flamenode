import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function monotonicVideoUpdatedAt(videoUpdatedAt, nowSec = Math.floor(Date.now() / 1000)) {
  return Math.max(nowSec, videoUpdatedAt + 1);
}

function mergeVideoRebuildEventIds(primaryEventId, linkedEventIds) {
  return Array.from(
    new Set(
      [primaryEventId, ...linkedEventIds].filter((id) => Boolean(id)),
    ),
  );
}

test("monotonicVideoUpdatedAt advances past stored updated_at", () => {
  assert.equal(monotonicVideoUpdatedAt(1_700_000_000, 1_700_000_000), 1_700_000_001);
  assert.equal(monotonicVideoUpdatedAt(1_700_000_000, 1_700_000_010), 1_700_000_010);
});

test("mergeVideoRebuildEventIds deduplicates primary and linked events", () => {
  assert.deepEqual(
    mergeVideoRebuildEventIds("event-a", ["event-a", "event-b"]),
    ["event-a", "event-b"],
  );
});

test("same-status message is shared across admin and manage", async () => {
  const core = await readFile(
    new URL("./videoVisibilityStatusCore.ts", import.meta.url),
    "utf8",
  );
  assert.match(core, /すでに同じ状態へ更新されています。/);
});

test("admin setVideoStatus uses shared mutation helper and merged event ids", async () => {
  const source = await readFile(new URL("../actions/admin.ts", import.meta.url), "utf8");
  assert.match(source, /loadVideoRebuildEventIds/);
  assert.match(source, /executeVideoVisibilityStatusMutation/);
  assert.match(source, /SAME_VIDEO_STATUS_MESSAGE/);
  assert.match(source, /attachApproveAndNextHref/);
  assert.match(source, /review_event_id/);
  assert.match(source, /adminEventFilter/);
  assert.match(source, /unstable_rethrow\(error\)/);
});

test("manage setManageVideoStatus attaches nextHref on same-status approve-and-next", async () => {
  const source = await readFile(
    new URL("../actions/manage-video.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /executeVideoVisibilityStatusMutation/);
  assert.match(source, /monotonicVideoUpdatedAt/);
  assert.match(source, /SAME_VIDEO_STATUS_MESSAGE/);
  assert.match(source, /attachApproveAndNextHref/);
  assert.match(source, /catch \(error\) \{[\s\S]*unstable_rethrow\(error\)/);
  assert.doesNotMatch(source, /変更先のステータスを選択してください/);
});

test("shared mutation helper performs CAS re-read once", async () => {
  const source = await readFile(
    new URL("./videoVisibilityStatusAction.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /AuditMutationError/);
  assert.match(source, /reread\?\.visibility_status === requestedStatus/);
  assert.match(source, /visibility_precommit_failed/);
  assert.match(source, /mutateWithAudit\(/);
});

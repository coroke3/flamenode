import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path) {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("submitted slot operator authorization is derived from the stored slot event", () => {
  const source = readRepoFile("src/lib/actions/slot-admin-danger.ts");
  assert.match(source, /select\(\)\.from\(slots\)\.where\(eq\(slots\.id, slotId\)\)/);
  assert.match(source, /assertCanEditEvent\([\s\S]*row\.event_id[\s\S]*"event\.slots"/);
  assert.doesNotMatch(source, /formData\.get\("event_id"\)/);
});

test("作品のみ解放は予約情報を維持し、グループをCAS付きでreservedへ戻す", () => {
  const source = readRepoFile("src/lib/actions/slot-admin-danger.ts");
  assert.match(source, /releaseSubmittedVideoKeepReservation/);
  assert.match(source, /resolveSlotReservationSubject\(targetRows\)/);
  assert.match(source, /reserved_x_id_snapshot !== row\.reserved_x_id_snapshot/);
  assert.match(source, /status: "reserved"/);
  assert.match(source, /video_id: null/);
  assert.match(source, /versionedSlotWhere\(row\.event_id, targetRows, "submitted"\)/);
  assert.match(source, /context: "slot-admin:release-submitted-video"/);
  assert.match(source, /type: "slot_submission_released"/);
});

test("強制解放は既存の予約情報クリアと動画保持を維持する", () => {
  const source = readRepoFile("src/lib/actions/slot-admin-danger.ts");
  for (const field of [
    "reserved_by_user_id: null",
    "x_user_id: null",
    "reserved_x_id_snapshot: null",
    "display_name: null",
    "reservation_group_id: null",
    "video_id: null",
  ]) {
    assert.match(source, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /delete\(videos\)/);
  assert.doesNotMatch(source, /visibility_status:\s*"voided"/);
  assert.match(source, /context: "slot-admin:force-release-submitted"/);
});

test("提出解除と強制解放は別通知・別監査経路を持つ", () => {
  const source = readRepoFile("src/lib/actions/slot-admin-danger.ts");
  assert.match(source, /slot_submission_released/);
  assert.match(source, /slot_force_released/);
  assert.match(source, /slot-admin:release-submitted-video/);
  assert.match(source, /slot-admin:force-release-submitted/);
  assert.match(source, /videoBefore\.scheduling_type === "slotted"/);
});

test("force release uses the stored reservation group value", () => {
  const source = readRepoFile("src/lib/actions/slot-admin-danger.ts");
  const forceStart = source.indexOf("export async function forceReleaseSubmittedSlot");
  const detachStart = source.indexOf("export async function releaseSubmittedVideoKeepReservation");
  const forceSource = source.slice(forceStart, detachStart);
  assert.match(forceSource, /const groupValue = row\.reservation_group_id;/);
  assert.match(forceSource, /eq\(slots\.reservation_group_id, groupValue!\)/);
});

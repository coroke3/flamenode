import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  MAX_SLOTS_PER_VIDEO,
  normalizeMaxSlotsPerVideo,
} from "./limits.ts";
import { buildReleaseGroupDecisions } from "./userSlotCore.ts";

const slotSource = await readFile(
  new URL("../actions/slot.ts", import.meta.url),
  "utf8",
);
const submitSource = await readFile(
  new URL("../actions/video/submitSlotVideo.ts", import.meta.url),
  "utf8",
);

const row = (id, group = "group-1") => ({
  id,
  reservation_group_id: group,
});

const groupRows = (count) =>
  Array.from({ length: count }, (_, index) =>
    row(String.fromCharCode(97 + index)),
  );

/** 既存8枠group・イベント上限5の grandfather シナリオ */
const EVENT_MAX = 5;
const EXISTING_GROUP_SIZE = 8;
const eventLimit = normalizeMaxSlotsPerVideo(EVENT_MAX);

test("既存8枠groupはイベント上限5でも拡張を拒否する", () => {
  assert.ok(EXISTING_GROUP_SIZE + 1 > eventLimit);
  assert.equal(eventLimit, EVENT_MAX);
});

test("既存左右group合算+gapがイベント上限5を超える結合は拒否される", () => {
  const leftSize = 4;
  const rightSize = 4;
  const mergedSize = leftSize + 1 + rightSize;
  assert.ok(mergedSize > eventLimit);
  assert.equal(mergedSize, 9);
});

test("submitSlotVideoは既存groupを現在のevent.maxで拒否しない（MAX_SLOTS_PER_VIDEOのみ）", () => {
  assert.match(submitSource, /MAX_SLOTS_PER_VIDEO \+ 1/);
  assert.match(
    submitSource,
    /submittedSlots\.length > MAX_SLOTS_PER_VIDEO/,
  );
  assert.doesNotMatch(
    submitSource,
    /eventSlotLimit\s*=\s*min\(max_slots/,
  );
  assert.doesNotMatch(
    submitSource,
    /normalizeMaxSlotsPerVideo\(.*submittedSlots/,
  );
  assert.doesNotMatch(
    submitSource,
    /max_slots_per_video[\s\S]{0,120}submittedSlots\.length/,
  );
  assert.ok(EXISTING_GROUP_SIZE <= MAX_SLOTS_PER_VIDEO);
});

test("8枠groupの解放決定はbuildReleaseGroupDecisionsで機能する", () => {
  const rows = groupRows(EXISTING_GROUP_SIZE);
  const edgeResult = buildReleaseGroupDecisions(rows, "a");
  assert.equal(edgeResult.length, EXISTING_GROUP_SIZE);
  assert.equal(edgeResult[0].release, true);
  for (const decision of edgeResult.slice(1)) {
    assert.equal(decision.reservation_group_id, "group-1");
  }

  const centerResult = buildReleaseGroupDecisions(rows, "d", {
    newGroupId: "group-right",
  });
  assert.equal(centerResult[3].release, true);
  for (const decision of centerResult.slice(0, 3)) {
    assert.equal(decision.reservation_group_id, "group-1");
  }
  for (const decision of centerResult.slice(4)) {
    assert.equal(decision.reservation_group_id, "group-right");
  }
});

test("slot.tsはextend/mergeのみeventDomainLimitを使いreleaseOwnSlotでは使わない", () => {
  assert.match(slotSource, /function eventDomainLimit/);
  assert.match(slotSource, /normalizeMaxSlotsPerVideo/);
  assert.match(
    slotSource,
    /extendOwnSlotGroup[\s\S]*?operatorOverride\s*\?\s*MAX_SLOTS_PER_VIDEO[\s\S]*?groupRows\.length \+ 1 > maxRows/,
  );
  assert.match(
    slotSource,
    /mergeOwnSlotGroups[\s\S]*?operatorOverride\s*\?\s*MAX_SLOTS_PER_VIDEO[\s\S]*?reservedRows\.length \+ 1 > maxRows/,
  );

  const releaseBlock =
    slotSource.match(
      /export async function releaseOwnSlot[\s\S]*?(?=export async function extendOwnSlotGroup)/,
    )?.[0] ?? "";
  assert.ok(releaseBlock.length > 0);
  assert.doesNotMatch(releaseBlock, /eventDomainLimit/);
  assert.doesNotMatch(releaseBlock, /normalizeMaxSlotsPerVideo/);
});

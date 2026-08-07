import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MAX_SLOTS_PER_VIDEO } from "../event/eventLimits.ts";
import { MAX_ATOMIC_SLOT_ROWS } from "../slots/atomicLimits.ts";
import { MAX_ATOMIC_SUBMITTED_SLOTS } from "../video/atomicLimits.ts";

const slotSource = await readFile(
  new URL("../actions/slot.ts", import.meta.url),
  "utf8",
);
const submitSource = await readFile(
  new URL("../actions/video/submitSlotVideo.ts", import.meta.url),
  "utf8",
);
const eventFormSource = await readFile(
  new URL("../../components/admin/EventForm.tsx", import.meta.url),
  "utf8",
);
const eventFormSchema = await readFile(
  new URL("../event/eventForm.ts", import.meta.url),
  "utf8",
);

test("atomic slot limitsはMAX_SLOTS_PER_VIDEOと一致", () => {
  assert.equal(MAX_ATOMIC_SLOT_ROWS, MAX_SLOTS_PER_VIDEO);
  assert.equal(MAX_ATOMIC_SUBMITTED_SLOTS, MAX_SLOTS_PER_VIDEO);
  assert.equal(MAX_SLOTS_PER_VIDEO, 3);
});

test("extend/mergeはgroup subjectを候補枠へ継承しactive Xへ置換しない", () => {
  assert.match(slotSource, /resolveSlotReservationSubject\(groupRows\)/);
  assert.match(slotSource, /subjectsEqual\(leftSubjectResult\.subject, rightSubjectResult\.subject\)/);
  assert.match(slotSource, /reserved_by_user_id: subject\.reservedByUserId/);
  assert.match(slotSource, /x_user_id: subject\.xUserId/);
  assert.doesNotMatch(
    slotSource.match(/export async function extendOwnSlotGroup[\s\S]*?export async function mergeOwnSlotGroups/)?.[0] ?? "",
    /x_user_id:\s*slotXUserId/,
  );
  assert.doesNotMatch(
    slotSource.match(/export async function mergeOwnSlotGroups[\s\S]*$/)?.[0] ?? "",
    /x_user_id:\s*slotXUserId/,
  );
});

test("submitSlotVideoのgroup loadはx_user_idで絞らない", () => {
  assert.match(submitSource, /resolveSlotReservationSubject\(groupRows\)/);
  const groupBlock =
    submitSource.match(
      /if \(slotRow\.reservation_group_id\)[\s\S]*?submittedSlots = groupRows/,
    )?.[0] ?? "";
  assert.match(groupBlock, /eq\(slots\.reservation_group_id/);
  assert.match(groupBlock, /eq\(slots\.event_id/);
  assert.doesNotMatch(groupBlock, /eq\(slots\.x_user_id/);
  assert.doesNotMatch(groupBlock, /isNull\(slots\.x_user_id\)/);
});

test("EventFormはmax_slots 3とstage質問4件上限を反映", () => {
  assert.match(eventFormSource, /max=\{MAX_SLOTS_PER_VIDEO\}/);
  assert.match(eventFormSource, /MAX_STAGE_PERMISSION_QUESTIONS/);
  assert.match(
    eventFormSource,
    /ステージ・権利確認質問は最大\{MAX_STAGE_PERMISSION_QUESTIONS\}件です/,
  );
  assert.match(eventFormSchema, /max\(MAX_SLOTS_PER_VIDEO\)/);
});

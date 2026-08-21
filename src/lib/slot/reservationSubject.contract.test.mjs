import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MAX_SLOTS_PER_VIDEO } from "../slots/limits.ts";
import { MAX_STAGE_PERMISSION_QUESTIONS } from "../event/eventLimits.ts";
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

test("atomic slot limitsは内部chunkと業務上限を分離", () => {
  assert.equal(MAX_ATOMIC_SLOT_ROWS, 3);
  assert.equal(MAX_ATOMIC_SUBMITTED_SLOTS, 3);
  assert.equal(MAX_SLOTS_PER_VIDEO, 20);
});

test("extend/mergeはsubject検証とActive X identityで候補枠を更新する", () => {
  assert.match(slotSource, /resolveSlotReservationSubject\(groupRows\)/);
  assert.match(slotSource, /subjectsEqual\(leftSubjectResult\.subject, rightSubjectResult\.subject\)/);
  assert.match(slotSource, /identity\.targetXId/);
  assert.match(slotSource, /buildRegroupMutations/);
});

test("legacy group ID はtrim後の値ではなく保存値で取得する", () => {
  const groupBlock =
    slotSource.match(
      /async function loadBoundedGroupStructure[\s\S]*?async function loadBoundedGroup\(/,
    )?.[0] ?? "";
  assert.match(
    groupBlock,
    /const groupId = anchor\.reservation_group_id\?\.trim\(\)[\s\S]*?anchor\.reservation_group_id/,
  );
  assert.match(groupBlock, /\.where\(reservationGroupScope\(groupId, anchor\.event_id\)\)/);
  assert.match(
    slotSource,
    /function reservationGroupScope[\s\S]*?eq\(slots\.reservation_group_id, groupId\)/,
  );
});

test("mergeOwnSlotGroupsはgap含む全枠へ同一display_nameを適用する", () => {
  const mergeBlock =
    slotSource.match(/export async function mergeOwnSlotGroups[\s\S]*$/)?.[0] ?? "";
  const displayNameMatches = [...mergeBlock.matchAll(/display_name: parsed\.data\.display_name/g)];
  assert.ok(displayNameMatches.length >= 2, "reserved rows and gap must use parsed.data.display_name");
  assert.doesNotMatch(mergeBlock, /display_name: subject\.displayName/);
});

test("submitSlotVideoのgroup loadはx_user_idで絞らない", () => {
  assert.match(submitSource, /resolveSlotReservationSubject\(groupRows\)/);
  const groupBlock =
    submitSource.match(
      /if \(slotRow\.reservation_group_id\)[\s\S]*?submittedSlots = groupRows/,
    )?.[0] ?? "";
  assert.match(groupBlock, /eq\(slots\.reservation_group_id/);
  assert.match(groupBlock, /eq\(slots\.event_id/);
  assert.match(groupBlock, /sortSlotsChronologically/);
  assert.match(groupBlock, /groupRows\.length > MAX_SLOTS_PER_VIDEO/);
  assert.match(groupBlock, /groupRows\.some\(\(row\) => row\.id === slotRow\.id\)/);
  assert.doesNotMatch(groupBlock, /eq\(slots\.x_user_id/);
  assert.doesNotMatch(groupBlock, /isNull\(slots\.x_user_id\)/);
});

test("submitSlotVideoは新規提出時にatomic batchへ通知をenqueueする", () => {
  assert.match(submitSource, /notificationWakeSource/);
  assert.match(submitSource, /buildNotificationOutboxStatement/);
  assert.doesNotMatch(submitSource, /await enqueueSlotSubmitNotificationsPostCommit/);
});

test("EventFormはmax_slots 1-20とstage質問4件上限を反映", () => {
  assert.match(eventFormSource, /min=\{MIN_SLOTS_PER_VIDEO\}/);
  assert.match(eventFormSource, /max=\{MAX_SLOTS_PER_VIDEO\}/);
  assert.match(eventFormSource, /MAX_STAGE_PERMISSION_QUESTIONS/);
  assert.match(
    eventFormSource,
    /ステージ・権利確認質問は最大\{MAX_STAGE_PERMISSION_QUESTIONS\}件です/,
  );
  assert.match(eventFormSchema, /min\(MIN_SLOTS_PER_VIDEO\)/);
  assert.match(eventFormSchema, /max\(MAX_SLOTS_PER_VIDEO\)/);
});

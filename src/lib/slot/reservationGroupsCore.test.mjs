import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSlotReservationGroupCandidates,
  collectSlotReservationAmbiguities,
  resolveSlotReservationSubject,
  subjectsEqual,
} from "./reservationGroupsCore.ts";

test("collectSlotReservationAmbiguities: groupなしreservedを報告", () => {
  const issues = collectSlotReservationAmbiguities([
    {
      id: "slot-1",
      event_id: "evt-1",
      reservation_group_id: null,
      reserved_by_user_id: "user-1",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.kind, "reserved_without_group");
});

test("buildSlotReservationGroupCandidates: 曖昧行は候補に含めない", () => {
  const { candidates, ambiguities } = buildSlotReservationGroupCandidates([
    {
      id: "slot-a",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
    {
      id: "slot-b",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-2",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
  ]);
  assert.equal(ambiguities.length, 1);
  assert.equal(ambiguities[0]?.kind, "mixed_auth_user");
  assert.equal(candidates.length, 0);
});

test("buildSlotReservationGroupCandidates: 一貫したgroupは候補化", () => {
  const { candidates, ambiguities } = buildSlotReservationGroupCandidates([
    {
      id: "slot-a",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
    {
      id: "slot-b",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
  ]);
  assert.equal(ambiguities.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.groupId, "grp-1");
  assert.deepEqual(candidates[0]?.slotIds, ["slot-a", "slot-b"]);
});

test("collectSlotReservationAmbiguities: nullと非null X混在を報告", () => {
  const issues = collectSlotReservationAmbiguities([
    {
      id: "slot-a",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: null,
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
    {
      id: "slot-b",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.kind, "inconsistent_x_user");
  assert.deepEqual(issues[0]?.slotIds, ["slot-a", "slot-b"]);
});

test("collectSlotReservationAmbiguities: 異なる非null Xはmixed_x_user", () => {
  const issues = collectSlotReservationAmbiguities([
    {
      id: "slot-a",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
    {
      id: "slot-b",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: "x-2",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.kind, "mixed_x_user");
});

test("buildSlotReservationGroupCandidates: null+X混在はbackfill候補に含めない", () => {
  const { candidates, ambiguities } = buildSlotReservationGroupCandidates([
    {
      id: "slot-a",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: null,
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
    {
      id: "slot-b",
      event_id: "evt-1",
      reservation_group_id: "grp-1",
      reserved_by_user_id: "user-1",
      x_user_id: "x-1",
      display_name: "A",
      status: "reserved",
      video_id: null,
    },
  ]);
  assert.equal(ambiguities.length, 1);
  assert.equal(ambiguities[0]?.kind, "inconsistent_x_user");
  assert.equal(candidates.length, 0);
});

const baseRow = {
  event_id: "evt-1",
  reservation_group_id: "grp-1",
  reserved_by_user_id: "user-1",
  x_user_id: "x-1",
  display_name: "A",
  status: "reserved",
  video_id: null,
};

test("resolveSlotReservationSubject: 一貫したgroupからsubjectを返す", () => {
  const result = resolveSlotReservationSubject([
    { id: "slot-a", ...baseRow },
    { id: "slot-b", ...baseRow },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.subject, {
    reservedByUserId: "user-1",
    xUserId: "x-1",
    displayName: "A",
  });
});

test("resolveSlotReservationSubject: mixed_x_userを検出", () => {
  const result = resolveSlotReservationSubject([
    { id: "slot-a", ...baseRow },
    { id: "slot-b", ...baseRow, x_user_id: "x-2" },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "mixed_x_user");
});

test("resolveSlotReservationSubject: 空行は拒否", () => {
  const result = resolveSlotReservationSubject([]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "empty_rows");
});

test("subjectsEqual: null xUserIdはnon-nullと不等", () => {
  const subject = {
    reservedByUserId: "user-1",
    xUserId: "x-1",
    displayName: "A",
  };
  assert.equal(
    subjectsEqual(subject, { ...subject, xUserId: null }),
    false,
  );
});

test("subjectsEqual: displayNameはtrimして比較", () => {
  const a = {
    reservedByUserId: "user-1",
    xUserId: "x-1",
    displayName: " A ",
  };
  const b = {
    reservedByUserId: "user-1",
    xUserId: "x-1",
    displayName: "A",
  };
  assert.equal(subjectsEqual(a, b), true);
});

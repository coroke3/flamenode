import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LAST_OWNER_ERROR,
  assertEventWillRetainOwner,
  assertOwnershipTransferInput,
  assertSelfChangeConfirmation,
  isActorTargetingSelf,
  planXIdMergeEventStaffOwnerProtection,
  syncLegacyRoleFromPreset,
} from "./eventOwnershipCore.ts";

const owner = {
  id: "staff-owner",
  event_id: "event-1",
  user_id: "user-owner",
  x_user_id: "owner_x",
  permission_preset: "owner",
  role: "representative",
};

test("last owner cannot be deleted or demoted", () => {
  assert.throws(
    () => assertEventWillRetainOwner({ owners: [owner], target: owner, nextPreset: null }),
    new RegExp(LAST_OWNER_ERROR),
  );
  assert.throws(
    () => assertEventWillRetainOwner({ owners: [owner], target: owner, nextPreset: "manager" }),
    new RegExp(LAST_OWNER_ERROR),
  );
});

test("owner protection allows a change while another owner remains", () => {
  assert.doesNotThrow(() =>
    assertEventWillRetainOwner({
      owners: [owner, { ...owner, id: "staff-owner-2" }],
      target: owner,
      nextPreset: "manager",
    }),
  );
});

test("role is a display mirror of permission_preset", () => {
  assert.equal(syncLegacyRoleFromPreset("owner"), "representative");
  assert.equal(syncLegacyRoleFromPreset("manager"), "editor");
  assert.equal(syncLegacyRoleFromPreset("reviewer"), "staff");
});

test("self mutation and transfer confirmation are required", () => {
  assert.equal(isActorTargetingSelf({ actorUserId: "user-owner", target: owner, approvedXIds: [] }), true);
  assert.equal(isActorTargetingSelf({ actorUserId: "other", target: owner, approvedXIds: ["owner_x"] }), true);
  assert.throws(() => assertSelfChangeConfirmation({
    eventId: "event-1",
    isSelfTarget: true,
    removesMembership: true,
    losesMemberPermission: true,
    confirmText: "SELF CHANGE event-1",
    reason: "test",
  }));
  assert.throws(() => assertOwnershipTransferInput({
    eventId: "event-1",
    from: owner,
    to: { ...owner, id: "staff-to", user_id: "user-to", permission_preset: "manager" },
    confirmText: "wrong",
    reason: "test",
  }));
});

test("X ID merge promotes the target before deleting a collided owner", () => {
  const plan = planXIdMergeEventStaffOwnerProtection({
    rows: [
      { ...owner, x_user_id: "from_x" },
      {
        ...owner,
        id: "staff-target",
        user_id: "user-target",
        x_user_id: "to_x",
        permission_preset: "manager",
        role: "editor",
      },
      {
        ...owner,
        id: "other-event-owner",
        event_id: "event-2",
        x_user_id: "from_x",
      },
    ],
    fromXUserId: "from_x",
    toXUserId: "to_x",
  });

  assert.deepEqual(plan.collidedSourceStaffIds, ["staff-owner"]);
  assert.deepEqual(plan.promotedTargetStaffIds, ["staff-target"]);
});

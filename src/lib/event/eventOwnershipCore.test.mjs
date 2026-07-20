import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LAST_OWNER_ERROR,
  assertEventWillRetainOwner,
  assertOwnershipTransferInput,
  assertSelfChangeConfirmation,
  isActorTargetingSelf,
  planXIdMergeEventStaffOwnerProtection,
} from "./eventOwnershipCore.ts";

const owner = {
  id: "staff-owner",
  event_id: "event-1",
  x_user_id: "owner_x",
  permission_preset: "owner",
};

test("最後のownerは削除・降格できない", () => {
  assert.throws(
    () =>
      assertEventWillRetainOwner({
        owners: [owner],
        target: owner,
        nextPreset: null,
      }),
    new RegExp(LAST_OWNER_ERROR),
  );
  assert.throws(
    () =>
      assertEventWillRetainOwner({
        owners: [owner],
        target: owner,
        nextPreset: "manager",
      }),
    new RegExp(LAST_OWNER_ERROR),
  );
});

test("別のownerが残る場合だけ降格を許可する", () => {
  assert.doesNotThrow(() =>
    assertEventWillRetainOwner({
      owners: [
        owner,
        { ...owner, id: "staff-owner-2", x_user_id: "owner_2" },
      ],
      target: owner,
      nextPreset: "manager",
    }),
  );
});

test("本人判定はx_user_account_linksから得たX名義だけで行う", () => {
  assert.equal(
    isActorTargetingSelf({ target: owner, linkedXIds: ["owner_x"] }),
    true,
  );
  assert.equal(
    isActorTargetingSelf({ target: owner, linkedXIds: ["other_x"] }),
    false,
  );
});

test("本人操作とowner移譲には確認文字列が必要", () => {
  assert.throws(() =>
    assertSelfChangeConfirmation({
      eventId: "event-1",
      isSelfTarget: true,
      removesMembership: true,
      losesMemberPermission: true,
      confirmText: "SELF CHANGE event-1",
      reason: "test",
    }),
  );
  assert.throws(() =>
    assertOwnershipTransferInput({
      eventId: "event-1",
      from: owner,
      to: {
        ...owner,
        id: "staff-to",
        x_user_id: "to_x",
        permission_preset: "manager",
      },
      confirmText: "wrong",
      reason: "test",
    }),
  );
  assert.doesNotThrow(() =>
    assertOwnershipTransferInput({
      eventId: "event-1",
      from: owner,
      to: {
        ...owner,
        id: "staff-to",
        x_user_id: "to_x",
        permission_preset: "manager",
      },
      confirmText: "TRANSFER event-1",
      reason: "test",
    }),
  );
});

test("X ID統合で衝突するowner権限を統合先へ引き継ぐ", () => {
  const plan = planXIdMergeEventStaffOwnerProtection({
    rows: [
      { ...owner, x_user_id: "from_x" },
      {
        ...owner,
        id: "staff-target",
        x_user_id: "to_x",
        permission_preset: "manager",
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

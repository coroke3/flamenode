import assert from "node:assert/strict";
import test from "node:test";
import {
  isEventOwner,
  validateEventStaffSubject,
  validateEventStaffUniqueness,
  assertEventWillRetainOwner,
  planXIdMergeEventStaffOwnerProtection,
  isActorTargetingSelf,
  assertSelfChangeConfirmation,
  assertOwnershipTransferInput,
  isCanonicalXId,
  LAST_OWNER_ERROR,
} from "@flamenode/domain/event";

test("isCanonicalXId validates X handle formats", () => {
  assert.equal(isCanonicalXId("valid_user_123"), true);
  assert.equal(isCanonicalXId(""), false);
  assert.equal(isCanonicalXId("user-with-hyphen"), false);
  assert.equal(isCanonicalXId("toolong_username_more_than_20_chars"), false);
  assert.equal(isCanonicalXId(null), false);
});

test("isEventOwner correctly detects owner preset", () => {
  assert.equal(isEventOwner({ permission_preset: "owner" }), true);
  assert.equal(isEventOwner({ permission_preset: "manager" }), false);
  assert.equal(isEventOwner({ permission_preset: null }), false);
});

test("validateEventStaffSubject accepts valid X ID and rejects invalid", () => {
  assert.doesNotThrow(() => validateEventStaffSubject({ xUserId: "valid_staff" }));
  assert.throws(
    () => validateEventStaffSubject({ xUserId: "" }),
    /イベントスタッフには X ID が必要です。/,
  );
  assert.throws(
    () => validateEventStaffSubject({ xUserId: null }),
    /イベントスタッフには X ID が必要です。/,
  );
});

test("validateEventStaffUniqueness detects duplicate staff rows in same event", () => {
  const existingRows = [
    { id: "staff-1", event_id: "ev-1", x_user_id: "user_a", permission_preset: "owner" },
    { id: "staff-2", event_id: "ev-1", x_user_id: "user_b", permission_preset: "manager" },
  ];

  // Same event, same X ID -> throws
  assert.throws(
    () =>
      validateEventStaffUniqueness({
        rows: existingRows,
        candidate: { id: "staff-new", event_id: "ev-1", x_user_id: "user_a" },
      }),
    /同じ X ID のスタッフが既に登録されています/,
  );

  // Updating same row -> does not throw
  assert.doesNotThrow(() =>
    validateEventStaffUniqueness({
      rows: existingRows,
      candidate: { id: "staff-1", event_id: "ev-1", x_user_id: "user_a" },
    }),
  );

  // Different event -> does not throw
  assert.doesNotThrow(() =>
    validateEventStaffUniqueness({
      rows: existingRows,
      candidate: { id: "staff-3", event_id: "ev-2", x_user_id: "user_a" },
    }),
  );
});

test("assertEventWillRetainOwner prevents removing the sole owner (FN-X-001)", () => {
  const soleOwner = {
    id: "staff-1",
    event_id: "ev-1",
    x_user_id: "user_a",
    permission_preset: "owner",
  };

  assert.throws(
    () =>
      assertEventWillRetainOwner({
        owners: [soleOwner],
        target: soleOwner,
        nextPreset: "manager",
      }),
    new RegExp(LAST_OWNER_ERROR),
  );

  // When multiple owners exist, demoting is allowed
  const secondOwner = {
    id: "staff-2",
    event_id: "ev-1",
    x_user_id: "user_b",
    permission_preset: "owner",
  };
  assert.doesNotThrow(() =>
    assertEventWillRetainOwner({
      owners: [soleOwner, secondOwner],
      target: soleOwner,
      nextPreset: "manager",
    }),
  );
});

test("planXIdMergeEventStaffOwnerProtection preserves owner rights on merge", () => {
  const rows = [
    { id: "s1", event_id: "ev-1", x_user_id: "source_x", permission_preset: "owner" },
    { id: "s2", event_id: "ev-1", x_user_id: "target_x", permission_preset: "reviewer" },
  ];

  const plan = planXIdMergeEventStaffOwnerProtection({
    rows,
    fromXUserId: "source_x",
    toXUserId: "target_x",
  });

  assert.deepEqual(plan.collidedSourceStaffIds, ["s1"]);
  assert.deepEqual(plan.promotedTargetStaffIds, ["s2"]);
});

test("assertOwnershipTransferInput validates transfer preconditions and confirmation", () => {
  const owner = { id: "s1", event_id: "ev-1", x_user_id: "u1", permission_preset: "owner" };
  const target = { id: "s2", event_id: "ev-1", x_user_id: "u2", permission_preset: "manager" };

  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: owner,
        to: target,
        confirmText: "WRONG",
        reason: "Succession",
      }),
    /確認のため「TRANSFER ev-1」と入力してください/,
  );

  assert.doesNotThrow(() =>
    assertOwnershipTransferInput({
      eventId: "ev-1",
      from: owner,
      to: target,
      confirmText: "TRANSFER ev-1",
      reason: "Succession plan",
    }),
  );
});

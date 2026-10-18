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
  LAST_OWNER_ERROR,
} from "@flamenode/domain/event";
import { isCanonicalXId } from "@flamenode/domain/xid";

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

test("assertOwnershipTransferInput edge cases and fail-closed validation", () => {
  const owner = { id: "s1", event_id: "ev-1", x_user_id: "u1", permission_preset: "owner" };
  const nonOwner = { id: "s2", event_id: "ev-1", x_user_id: "u2", permission_preset: "manager" };
  const differentEventTarget = { id: "s3", event_id: "ev-2", x_user_id: "u3", permission_preset: "manager" };

  // Missing or whitespace-only reason
  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: owner,
        to: nonOwner,
        confirmText: "TRANSFER ev-1",
        reason: "",
      }),
    /代表権限の移譲理由を入力してください。/,
  );
  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: owner,
        to: nonOwner,
        confirmText: "TRANSFER ev-1",
        reason: "   ",
      }),
    /代表権限の移譲理由を入力してください。/,
  );

  // From is null or non-owner
  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: null,
        to: nonOwner,
        confirmText: "TRANSFER ev-1",
        reason: "Reason",
      }),
    /移譲元は現在の代表者である必要があります。/,
  );
  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: nonOwner,
        to: nonOwner,
        confirmText: "TRANSFER ev-1",
        reason: "Reason",
      }),
    /移譲元は現在の代表者である必要があります。/,
  );

  // To is null or different event
  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: owner,
        to: null,
        confirmText: "TRANSFER ev-1",
        reason: "Reason",
      }),
    /移譲先は同じイベントに登録済みのスタッフを選択してください。/,
  );
  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: owner,
        to: differentEventTarget,
        confirmText: "TRANSFER ev-1",
        reason: "Reason",
      }),
    /移譲先は同じイベントに登録済みのスタッフを選択してください。/,
  );

  // Self transfer (from.id === to.id)
  assert.throws(
    () =>
      assertOwnershipTransferInput({
        eventId: "ev-1",
        from: owner,
        to: owner,
        confirmText: "TRANSFER ev-1",
        reason: "Reason",
      }),
    /移譲元と移譲先に同じスタッフは指定できません。/,
  );
});

test("assertSelfChangeConfirmation edge cases and confirmation formats", () => {
  // Not targeting self -> noop
  assert.doesNotThrow(() =>
    assertSelfChangeConfirmation({
      eventId: "ev-1",
      isSelfTarget: false,
      removesMembership: true,
      losesMemberPermission: true,
      confirmText: null,
      reason: null,
    }),
  );

  // Self target without reason
  assert.throws(
    () =>
      assertSelfChangeConfirmation({
        eventId: "ev-1",
        isSelfTarget: true,
        removesMembership: false,
        losesMemberPermission: false,
        confirmText: "SELF CHANGE ev-1",
        reason: "   ",
      }),
    /自分の権限を変更する理由を入力してください。/,
  );

  // Self target removing membership requires REMOVE SELF
  assert.throws(
    () =>
      assertSelfChangeConfirmation({
        eventId: "ev-1",
        isSelfTarget: true,
        removesMembership: true,
        losesMemberPermission: true,
        confirmText: "SELF CHANGE ev-1",
        reason: "Departing",
      }),
    /確認のため「REMOVE SELF ev-1」と入力してください。/,
  );

  assert.doesNotThrow(() =>
    assertSelfChangeConfirmation({
      eventId: "ev-1",
      isSelfTarget: true,
      removesMembership: true,
      losesMemberPermission: true,
      confirmText: "REMOVE SELF ev-1",
      reason: "Departing team",
    }),
  );
});

test("isActorTargetingSelf detects presence in linked X IDs", () => {
  const staff = { x_user_id: "staff_x" };
  assert.equal(isActorTargetingSelf({ target: staff, linkedXIds: ["staff_x", "other_x"] }), true);
  assert.equal(isActorTargetingSelf({ target: staff, linkedXIds: ["other_x"] }), false);
  assert.equal(isActorTargetingSelf({ target: staff, linkedXIds: [] }), false);
});


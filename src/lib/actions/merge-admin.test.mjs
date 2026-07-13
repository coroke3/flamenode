import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEventStaffMergeAudits } from "./merge-adminCore.ts";

function staff(overrides = {}) {
  return {
    id: "staff-1",
    event_id: "event-1",
    x_user_id: "old-id",
    user_id: "user-1",
    display_name: "Operator",
    role: "staff",
    permission_preset: "public_staff",
    custom_permission_keys_json: null,
    is_public: 0,
    public_role_label: null,
    internal_note: null,
    approved_by_user_id: null,
    approved_at: null,
    created_at: 100,
    updated_at: 100,
    ...overrides,
  };
}

test("X ID変更は復元可能なUPDATE監査になる", () => {
  const before = staff();
  const after = staff({
    x_user_id: "new-id",
    updated_at: 200,
  });

  const audits = buildEventStaffMergeAudits({
    beforeRows: [before],
    afterRows: [after],
    actorUserId: "admin-1",
    fromXId: "old-id",
    toXId: "new-id",
  });

  assert.equal(audits.length, 1);
  assert.equal(audits[0].operation, "UPDATE");
  assert.equal(audits[0].restore_strategy, "update_before");
  assert.deepEqual(audits[0].before, before);
  assert.deepEqual(audits[0].after, after);
});

test("重複削除は復元可能なDELETE監査になる", () => {
  const before = staff();

  const audits = buildEventStaffMergeAudits({
    beforeRows: [before],
    afterRows: [],
    actorUserId: "admin-1",
    fromXId: "old-id",
    toXId: "new-id",
  });

  assert.equal(audits.length, 1);
  assert.equal(audits[0].operation, "DELETE");
  assert.equal(audits[0].restore_strategy, "recreate_deleted");
  assert.deepEqual(audits[0].before, before);
  assert.equal(audits[0].after, null);
});

test("変更されていない行には不要な監査を作らない", () => {
  const row = staff();

  const audits = buildEventStaffMergeAudits({
    beforeRows: [row],
    afterRows: [{ ...row }],
    actorUserId: "admin-1",
    fromXId: "old-id",
    toXId: "new-id",
  });

  assert.equal(audits.length, 0);
});

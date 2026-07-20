import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEventStaffMergeAudits } from "./mergeAudits.ts";

function staff(overrides = {}) {
  return {
    id: "staff-1",
    event_id: "event-1",
    x_user_id: "old-id",
    display_name: "Operator",
    permission_preset: "public_staff",
    custom_permission_keys_json: null,
    is_public: 0,
    public_role_label: null,
    approved_by_auth_user_id: null,
    approved_at: null,
    created_at: 100,
    updated_at: 100,
    ...overrides,
  };
}

test("X ID変更は復元可能なUPDATE監査になる", () => {
  const before = staff();
  const after = staff({ x_user_id: "new-id", updated_at: 200 });
  const [audit] = buildEventStaffMergeAudits({
    beforeRows: [before],
    afterRows: [after],
    actorUserId: "admin-1",
    fromXId: "old-id",
    toXId: "new-id",
  });
  assert.equal(audit.operation, "UPDATE");
  assert.equal(audit.restore_strategy, "update_before");
  assert.deepEqual(audit.before, before);
  assert.deepEqual(audit.after, after);
});

test("重複削除は復元可能なDELETE監査になる", () => {
  const before = staff();
  const [audit] = buildEventStaffMergeAudits({
    beforeRows: [before],
    afterRows: [],
    actorUserId: "admin-1",
    fromXId: "old-id",
    toXId: "new-id",
  });
  assert.equal(audit.operation, "DELETE");
  assert.equal(audit.restore_strategy, "recreate_deleted");
  assert.deepEqual(audit.before, before);
  assert.equal(audit.after, null);
});

test("変更されていない行には監査を作らない", () => {
  const row = staff();
  const audits = buildEventStaffMergeAudits({
    beforeRows: [row],
    afterRows: [{ ...row }],
    actorUserId: "admin-1",
    fromXId: "old-id",
    toXId: "new-id",
  });
  assert.deepEqual(audits, []);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";

const action = await readFile(new URL("./broadcast-admin.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../../components/admin/AnnouncementBroadcastButton.tsx", import.meta.url), "utf8");

test("announcement broadcast uses the dedicated guarded atomic path", () => {
  assert.match(action, /requireAdminWrite\("admin_announcement_broadcast"\)/);
  assert.match(action, /buildKnownRecipientNotificationBatch/);
  assert.match(action, /mutateWithAudit\(db/);
  assert.match(action, /expectedRowCondition/);
  assert.match(action, /planD1AuditMutationBudget/);
  assert.doesNotMatch(action, /auditAction\(|enqueueNotification\(|auth\(\)/);
});

test("all audiences use bounded internal user ID keyset pagination", () => {
  assert.match(action, /BROADCAST_BATCH_SIZE = 30/);
  assert.match(action, /gt\(users\.id, cursor\)/);
  assert.ok((action.match(/\.limit\(BROADCAST_BATCH_SIZE \+ 1\)/g) ?? []).length >= 3);
  assert.doesNotMatch(action, /\.offset\(/);
  assert.match(action, /eq\(users\.is_notification_enabled, 1\)/);
  assert.match(action, /selectDistinct\(\{ user_id: users\.id \}\)/);
  assert.match(action, /dedupeKey: `announcement_broadcast:\$\{announcementId\}:\$\{userId\}`/);
  assert.match(ui, /useState\(""\)/);
  assert.match(ui, /30件 enqueue/);
  assert.doesNotMatch(ui, /type="number"|OFFSET|50 件/);
});

test("audit metadata contains the complete bounded batch identity", () => {
  for (const key of ["audience", "cursor", "next_cursor", "target_user_ids", "target_count", "enqueued_count", "has_more"]) {
    assert.match(action, new RegExp(`${key}:`));
  }
  assert.match(action, /before: snapshot\(before\)/);
  assert.match(action, /after: snapshot\(after\)/);
});

test("30 notifications plus announcement CAS and strict audit stay within D1 50 queries", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 31,
    mutationAssertionCount: 1,
    auditEntryCount: 1,
    distinctActorCount: 1,
  });
  assert.equal(budget.totalQueryCount, 46);
  assert.equal(budget.withinLimit, true);
});

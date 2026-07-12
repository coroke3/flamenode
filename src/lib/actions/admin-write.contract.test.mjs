import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const files = ["user-admin.ts", "rules.ts", "moderation-admin.ts"];
const sources = Object.fromEntries(await Promise.all(files.map(async (file) => [
  file,
  await readFile(new URL(`./${file}`, import.meta.url), "utf8"),
])));
const all = Object.values(sources).join("\n");

test("all admin mutation entry points use required feature guards", () => {
  const features = [
    "admin_user_role", "admin_user_ban", "admin_user_notifications",
    "admin_user_event_create", "admin_x_icon_refresh", "admin_terms_create",
    "admin_terms_update", "admin_terms_publish", "admin_terms_broadcast",
    "admin_terms_archive", "admin_moderation_create", "admin_moderation_update",
  ];
  for (const feature of features) {
    assert.match(all, new RegExp(`requireAdminWrite\\(\\"${feature}\\"\\)`));
  }
  assert.equal((all.match(/requireAdminWrite\(/g) ?? []).length, features.length);
});

test("admin writes have CAS, full audit batches, and non-swallowing builders", () => {
  for (const source of Object.values(sources)) {
    assert.match(source, /mutateWithAudit\(/);
    assert.match(source, /expectedRowCondition\(/);
    assert.doesNotMatch(source, /auditAction\(/);
    assert.doesNotMatch(source, /enqueueNotification\(/);
    assert.match(source, /before: snapshot\(/);
    assert.match(source, /after: snapshot\(/);
  }
  assert.match(sources["rules.ts"], /buildKnownRecipientNotificationBatch/);
  assert.match(sources["moderation-admin.ts"], /buildNotificationOutboxStatement/);
  assert.match(sources["moderation-admin.ts"], /buildStaticRebuildQueueBatch/);
  assert.match(sources["user-admin.ts"], /buildStaticRebuildQueueBatch/);
});

test("broadcast is bounded and shares the canonical D1 budget planner", () => {
  assert.match(sources["rules.ts"], /TERMS_REACCEPT_BATCH_SIZE = 30/);
  assert.match(sources["rules.ts"], /gt\(users\.id, cursor\)/);
  assert.match(sources["rules.ts"], /\.limit\(TERMS_REACCEPT_BATCH_SIZE \+ 1\)/);
  assert.match(sources["rules.ts"], /planD1AuditMutationBudget/);
  assert.doesNotMatch(sources["rules.ts"], /\.offset\(/);
});

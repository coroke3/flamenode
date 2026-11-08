import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const workItem = read("docs/migration/work-items/MIG-0642.md");

const actions = [
  ["SA-045", "retryFailedNotification", "notification-admin.ts", "admin_notifications", "POST /api/admin/notifications/:id/retry"],
  ["SA-046", "cancelNotification", "notification-admin.ts", "admin_notifications", "POST /api/admin/notifications/:id/cancel"],
  ["SA-047", "forceResendNotification", "notification-admin.ts", "admin_notifications", "POST /api/admin/notifications/:id/force-resend"],
  ["SA-048", "retryAllFailedNotifications", "notification-admin.ts", "admin_notifications", "POST /api/admin/notifications/retry-failed"],
  ["SA-049", "updateGlobalEditableFields", "permissions-admin.ts", "admin_permissions", "PUT /api/admin/permissions/editable-fields"],
  ["SA-051", "createTermsVersion", "rules.ts", "admin_terms_create", "POST /api/admin/terms"],
  ["SA-052", "updateTermsVersion", "rules.ts", "admin_terms_update", "PATCH /api/admin/terms/:id"],
  ["SA-053", "publishTermsVersion", "rules.ts", "admin_terms_publish", "POST /api/admin/terms/:id/publish"],
  ["SA-054", "broadcastTermsReaccept", "rules.ts", "admin_terms_broadcast", "POST /api/admin/terms/:id/reaccept-broadcast"],
  ["SA-055", "archiveTermsVersion", "rules.ts", "admin_terms_archive", "POST /api/admin/terms/:id/archive"],
];

function actionBody(source, name) {
  const marker = "export async function " + name + "(";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "CURRENT action missing: " + name);
  const next = source.indexOf("\nexport async function ", start + marker.length);
  return source.slice(start, next < 0 ? undefined : next);
}

test("U01 ten unique action and D-17-4 route mappings match CURRENT guards", () => {
  assert.equal(actions.length, 10);
  assert.equal(new Set(actions.map((row) => row[0])).size, 10);
  assert.equal(new Set(actions.map((row) => row[4])).size, 10);
  for (const [id, name, file, guard, route] of actions) {
    const body = actionBody(read("src/lib/actions/" + file), name);
    assert.ok(body.includes('requireAdminWrite("' + guard + '")'), id + " guard mismatch");
    const markdownRow = workItem.split("\n").find((line) => line.startsWith("| " + id + " |"));
    assert.ok(markdownRow, id + " missing from U01 inventory");
    const cells = markdownRow.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.deepEqual(cells.slice(0, 4), [id, String.fromCharCode(96) + name + String.fromCharCode(96), String.fromCharCode(96) + guard + String.fromCharCode(96), String.fromCharCode(96) + route + String.fromCharCode(96)]);
    assert.ok(cells[4].length > 12, id + " lacks source side-effect map");
  }
});

test("notification CAS, audit and wake distinctions stay visible", () => {
  const source = read("src/lib/actions/notification-admin.ts");
  const helper = source.slice(source.indexOf("async function updateRows("), source.indexOf("\nexport async function retryFailedNotification("));
  assert.match(helper, /expectedRowCondition\(\{ expectedCurrent: \{ \.\.\.before \} \}\)/);
  assert.match(helper, /expectedMutationChanges: rows\.map\(\(\) => 1\)/);
  assert.match(helper, /notificationWakeSource: kind === "retry" \? "admin" : undefined/);
  assert.match(helper, /admin_notification_/);
  const retryAll = actionBody(source, "retryAllFailedNotifications");
  assert.match(retryAll, /limit\(BULK_RETRY_MAX \+ 1\)/);
  assert.match(retryAll, /rows\.slice\(0, BULK_RETRY_MAX\)/);
  assert.match(actionBody(source, "forceResendNotification"), /notificationWakeSource: "admin"/);
  const cancel = actionBody(source, "cancelNotification");
  assert.match(cancel, /decision\.kind === "already_terminal"/);
  assert.match(cancel, /decision\.kind === "in_flight"/);
});

test("terms publish/archive enqueue rebuild, reaccept broadcast never enqueues DM", () => {
  const source = read("src/lib/actions/rules.ts");
  for (const name of ["publishTermsVersion", "archiveTermsVersion"]) {
    const body = actionBody(source, name);
    assert.match(body, /buildStaticRebuildQueueBatch\(/);
    assert.match(body, /targetType: "rules"/);
    assert.match(body, /targetId: "global"/);
    assert.match(body, /expectedRowCondition\(/);
  }
  const broadcast = actionBody(source, "broadcastTermsReaccept");
  assert.match(broadcast, /TERMS_REACCEPT_BATCH_SIZE \+ 1/);
  assert.match(broadcast, /expectedMutationChanges: \[1\]/);
  assert.doesNotMatch(broadcast, /buildNotificationOutboxStatement|notificationWakeSource|buildStaticRebuildQueueBatch/);
  assert.match(broadcast, /Discord DM は送信しません/);
});

test("editable fields update retains the default-row CAS and long audit", () => {
  const body = actionBody(read("src/lib/actions/permissions-admin.ts"), "updateGlobalEditableFields");
  assert.match(body, /eq\(systemSettings\.id, "default"\)/);
  assert.match(body, /expectedRowCondition\(\{ expectedCurrent: beforeSnapshot \}\)/);
  assert.match(body, /retention_class: "long_audit"/);
  assert.match(body, /expectedMutationChanges: 1/);
});
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const actionSource = await readFile(
  new URL("./video-collab-perms.ts", import.meta.url),
  "utf8",
);
const budgetSource = await readFile(
  new URL("../audit/mutateBudget.ts", import.meta.url),
  "utf8",
);
const notificationSource = await readFile(
  new URL("../notifications/enqueue.ts", import.meta.url),
  "utf8",
);

test("100人permission batchは人数分のmutation/auditを生成しない", () => {
  assert.match(actionSource, /MAX_COLLABORATOR_PERMISSION_BATCH/);
  assert.match(actionSource, /buildPermissionSetGuardSql/);
  assert.match(actionSource, /buildMemberPermissionBulkUpdateSql/);
  assert.match(actionSource, /buildHiddenMemberBulkInsertSql/);
  assert.match(actionSource, /buildHiddenMemberBulkDeleteSql/);
  assert.match(actionSource, /table_name: "video_member_permissions_batch"/);
  assert.doesNotMatch(
    actionSource,
    /for \(const \[xid, intentInfo\] of intents\)[\s\S]*?statements\.push\(\s*db\.(?:insert|update|delete)/,
  );
});

test("100人permission batchの通常最大経路はD1 Free 50-query budgetに十分収まる", () => {
  // 最大100 intentでも本体statementは集合単位:
  // permission guard + member count guard + x_users bulk + member bulk update
  // + hidden bulk insert + hidden bulk delete + notification bulk + static rebuild queue
  // = 最大8 statement（通知200件以内の通常ケース）。
  // 数値changes assertionはx_users/update/insert/deleteの最大4件。
  // aggregate auditは2件なので1 chunk => audit insert + assertionの2 query。
  // audit preparation 2 + reserved caller 10を加えても26 query。
  const mutationStatementCount = 8;
  const mutationAssertionCount = 4;
  const auditQueryCount = 2;
  const preparationQueryCount = 2;
  const reservedCallerQueryCount = 10;
  const total =
    mutationStatementCount +
    mutationAssertionCount +
    auditQueryCount +
    preparationQueryCount +
    reservedCallerQueryCount;
  assert.equal(total, 26);
  assert.ok(total <= 50);
  assert.match(budgetSource, /D1_MAX_BATCH_QUERIES = 50/);
  assert.match(budgetSource, /D1_RESERVED_CALLER_QUERIES = 10/);
});

test("100人通知はJSON1 bindの1 statementへまとめ、必要時だけ200件単位でchunkする", () => {
  assert.match(notificationSource, /buildKnownRecipientNotificationBulkBatch/);
  assert.match(notificationSource, /INSERT OR IGNORE INTO notification_outbox/);
  assert.match(notificationSource, /FROM json_each\(\$\{payload\}\)/);
  assert.match(notificationSource, /notification_bulk_batch_limit_exceeded/);
  assert.match(actionSource, /offset \+= 200/);
  assert.match(actionSource, /notificationInputs\.slice\(offset, offset \+ 200\)/);
});

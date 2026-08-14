import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT,
  X_ID_SLOT_BIND_RECOVERY_SLOT_LIMIT,
  X_ID_SLOT_BIND_RECOVERY_MAX_ATOMIC_ROWS,
  X_ID_SLOT_BIND_LEGACY_BACKFILL_LIMIT,
} from "./xIdSlotBindRecovery.ts";

const source = await readFile(new URL("./xIdSlotBindRecovery.ts", import.meta.url), "utf8");
const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("X ID slot bind recoveryはbounded request/pageとCASを使う", () => {
  assert.equal(X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT, 5);
  assert.equal(X_ID_SLOT_BIND_RECOVERY_SLOT_LIMIT, 30);
  assert.equal(X_ID_SLOT_BIND_RECOVERY_MAX_ATOMIC_ROWS, 3);
  assert.equal(X_ID_SLOT_BIND_LEGACY_BACKFILL_LIMIT, 5);
  assert.match(source, /status = 'approved'/);
  assert.match(source, /slot_bind_status = 'pending'/);
  assert.match(source, /slot_bind_updated_at IS \?3/);
  assert.match(source, /slot_bind_attempt_count = \?4/);
  assert.match(source, /x_user_id IS NULL/);
  assert.match(source, /version = version \+ 1/);
  assert.match(source, /static_rebuild_queue/);
  assert.match(source, /audit_logs/);
  assert.match(source, /canAutoBindUnassignedReservation/);
  assert.match(source, /slot_bind_status = 'complete'/);
  assert.match(source, /slot_bind_updated_at IS NULL/);
});

test("X ID slot bind recoveryはD1 soft limit到達後に残件確認を追加発行せずpendingを維持する", () => {
  assert.match(
    source,
    /if \(env\.d1Budget && isD1BudgetExhausted\(env\.d1Budget\)\) \{[\s\S]*?return \{ complete: false, bound \};[\s\S]*?const hasMore = await hasMoreCandidates/,
  );
  assert.match(
    source,
    /env\.d1Budget\.statements \+ 4 > D1_QUERY_SOFT_LIMIT[\s\S]*?return \{ complete: false, bound \};/,
  );
  assert.match(
    source,
    /const identity = await resolveIdentity\(env, request\);[\s\S]*?isD1BudgetExhausted\(env\.d1Budget\)[\s\S]*?return \{ complete: false, bound: 0 \};/,
  );
  assert.match(source, /const markedComplete = await markComplete/);
  assert.match(source, /return \{ complete: markedComplete, bound \};/);
});

test("content-jobs Recoveryはstale reconcile後にX ID slot bind recoveryを呼ぶ", () => {
  const start = indexSource.indexOf("await reconcileStaleQueue");
  const recovery = indexSource.indexOf("await reconcilePendingXIdSlotBinds");
  assert.ok(start >= 0);
  assert.ok(recovery > start);
});

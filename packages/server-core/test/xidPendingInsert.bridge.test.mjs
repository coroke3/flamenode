// MIG-0659 U01: executable compatibility and atomic SQL-shape regression.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  buildPendingXIdRequestInsert as coreInsert,
  buildPendingXIdMergeRevertInsert as coreRevert,
} from "../src/xid/pendingInsert.ts";
import {
  buildPendingXIdRequestInsert as legacyInsert,
  buildPendingXIdMergeRevertInsert as legacyRevert,
} from "../../../src/lib/actions/xidPendingInsert.ts";

const dialect = new SQLiteSyncDialect();
const request = (id = "new-request") => ({
  id,
  request_type: "new_link",
  requested_by_auth_user_id: "auth-user-1",
  requested_x_id: "x-user-1",
  source_x_user_id: null,
  target_x_user_id: null,
  parent_request_id: null,
  restore_snapshot_json: null,
  revert_deadline_at: null,
  status: "pending",
  requested_at: 100,
  updated_at: 100,
});

test("Next compatibility bridge exports the exact Hono SQL builders", () => {
  assert.strictEqual(legacyInsert, coreInsert);
  assert.strictEqual(legacyRevert, coreRevert);
});

test("request insert retains atomic deduplication and pending limit", () => {
  const compiled = dialect.sqlToQuery(coreInsert(request()));
  assert.match(compiled.sql, /WHERE NOT EXISTS/i);
  assert.match(compiled.sql, /request_type IN/i);
  assert.match(compiled.sql, /COUNT\(\*\)/i);
  assert.match(compiled.sql, /status = 'pending'/i);
  assert.match(compiled.sql, /< 5\b/);
});

test("merge revert insert guards parent CAS and active-child uniqueness without snapshot copy", () => {
  const row = {
    ...request("revert-1"),
    request_type: "revert_merge",
    requested_x_id: null,
    parent_request_id: "merge-parent",
    restore_snapshot_json: null,
    revert_deadline_at: 500,
  };
  const compiled = dialect.sqlToQuery(coreRevert({ row, parentUpdatedAt: 123 }));
  assert.match(compiled.sql, /parent\.updated_at/);
  assert.match(compiled.sql, /parent\.restore_snapshot_json IS NOT NULL/);
  assert.match(compiled.sql, /existing\.status IN \('pending', 'approved', 'done'\)/);
  assert.match(compiled.sql, /COUNT\(\*\)/);
});

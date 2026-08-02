import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildXIdentityDecisionFields } from "./xIdentityRequestCore.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("buildXIdentityDecisionFields は判断メタデータを返す", () => {
  const fields = buildXIdentityDecisionFields({
    decidedByAuthUserId: "user-1",
    decisionReason: "approved by operator",
    decidedAt: 1_700_000_000,
  });
  assert.equal(fields.decided_by_auth_user_id, "user-1");
  assert.equal(fields.decision_reason, "approved by operator");
  assert.equal(fields.decided_at, 1_700_000_000);
});

test("migration 0050 は decision 列と actor_x_user_id を追加する", () => {
  const sql = read("migrations/0050_x_identity_request_decisions.sql");
  assert.match(sql, /decision_reason/);
  assert.match(sql, /decided_by_auth_user_id/);
  assert.match(sql, /decided_at/);
  assert.match(sql, /actor_x_user_id/);
});

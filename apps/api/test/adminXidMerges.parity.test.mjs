// MIG-0644 U01: transport and inventory contract only.
// This file does NOT claim Hono/D1 mutation parity; U02 will add real handler tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AdminXIdMergeCreateBodySchema,
  AdminXIdMergeDecisionBodySchema,
  AdminXIdMergeConfirmBodySchema,
  AdminXIdMergeResultSchema,
} from "../../../packages/contracts/src/admin/xidMerges.ts";

test("U01: create schema uses the two CURRENT FormData keys", () => {
  assert.deepEqual(
    AdminXIdMergeCreateBodySchema.parse({
      from_x_user_id: "@source",
      to_x_user_id: "@target",
    }),
    { from_x_user_id: "@source", to_x_user_id: "@target" },
  );
  // CURRENT handles missing/null values in the domain validator rather than
  // turning them into an unrelated transport error.
  assert.deepEqual(AdminXIdMergeCreateBodySchema.parse({}), {});
  assert.deepEqual(
    AdminXIdMergeCreateBodySchema.parse({
      from_x_user_id: null,
      to_x_user_id: 123,
    }),
    { from_x_user_id: null, to_x_user_id: 123 },
  );
  assert.equal(
    AdminXIdMergeCreateBodySchema.safeParse({
      from_x_user_id: { unexpected: "object" },
      to_x_user_id: "target",
    }).success,
    false,
  );
});

test("U01: IDs are path params, not JSON body fields", () => {
  assert.deepEqual(
    AdminXIdMergeDecisionBodySchema.parse({ id: "malicious-body-id" }),
    {},
  );
  assert.deepEqual(
    AdminXIdMergeConfirmBodySchema.parse({
      id: "body-id",
      confirm: "MERGE",
    }),
    { confirm: "MERGE" },
  );
  // Preserve CURRENT's domain-level missing/incorrect confirm messages.
  assert.deepEqual(AdminXIdMergeConfirmBodySchema.parse({}), {});
  assert.deepEqual(
    AdminXIdMergeConfirmBodySchema.parse({ confirm: "WRONG" }),
    { confirm: "WRONG" },
  );
});

test("U01: result contract keeps CURRENT success and failure shapes", () => {
  assert.deepEqual(
    AdminXIdMergeResultSchema.parse({
      ok: true,
      id: "xmerge-1",
      message: "created",
    }),
    { ok: true, id: "xmerge-1", message: "created" },
  );
  assert.deepEqual(
    AdminXIdMergeResultSchema.parse({ ok: false, message: "denied" }),
    { ok: false, message: "denied" },
  );
  assert.equal(AdminXIdMergeResultSchema.safeParse({ id: "no-ok" }).success, false);
});

test("U01: all six CURRENT actions and SA-110 dispatcher are present", () => {
  const source = readFileSync(
    new URL("../../../src/lib/actions/xid-merge-admin.ts", import.meta.url),
    "utf8",
  );
  for (const action of [
    "createXIdMergeRequest",
    "approveXIdMergeRequest",
    "rejectXIdMergeRequest",
    "rejectXIdMergeRevert",
    "executeXIdMergeRequest",
    "approveXIdMergeRevert",
  ]) {
    assert.match(source, new RegExp(`export async function ${action}\\(formData: FormData\\)`));
  }
  assert.match(source, /requireAdminWrite\("xid_links"\)/);
  const page = readFileSync(
    new URL("../../../app/(admin)/admin/x-id-merges/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /async function run\(action:/);
  assert.match(page, /await action\(formData\)/);
});

test("U01: documented D-17-4 method/URL agreement remains unchanged", () => {
  const decisions = readFileSync(
    new URL("../../../docs/migration/OPEN_DECISIONS.md", import.meta.url),
    "utf8",
  );
  const contractLine = decisions.split("\n").find((line) =>
    line.includes("- MIG-0644: SA-092"),
  );
  assert.ok(contractLine, "MIG-0644 D-17-4 path agreement must exist");
  for (const path of [
    "POST /api/admin/x-id-merges`",
    "POST /api/admin/x-id-merges/:id/approve",
    "POST /api/admin/x-id-merges/:id/reject",
    "POST /api/admin/x-id-merges/:id/execute",
    "POST /api/admin/x-id-merges/reverts/:id/approve",
    "POST /api/admin/x-id-merges/reverts/:id/reject",
  ]) {
    assert.ok(contractLine.includes(path), `Missing agreed endpoint: ${path}`);
  }
});

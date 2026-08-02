import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const actionsRoot = path.resolve(import.meta.dirname, "../actions");

test("Server Actions do not downgrade auth failures to anonymous users", async () => {
  const files = (await readdir(actionsRoot, { recursive: true }))
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const violations = [];
  for (const name of files) {
    const source = await readFile(path.join(actionsRoot, name), "utf8");
    if (/auth\(\)\.catch\(\(\) => null\)/.test(source)) violations.push(name);
  }
  assert.deepEqual(violations, []);
});

test("security-sensitive Server Actions use the common write guard", async () => {
  const guardedActions = [
    "announcement.ts",
    "audit-admin.ts",
    "event-group-admin.ts",
    "event-staff-admin.ts",
    "event-template-admin.ts",
    "manage-video.ts",
    "xid-admin.ts",
    "xid-merge-admin.ts",
    "xid.ts",
  ];
  for (const name of guardedActions) {
    const source = await readFile(path.join(actionsRoot, name), "utf8");
    assert.match(source, /(?:writeGuard|requireAdminWrite)\(/, name);
    assert.doesNotMatch(source, /from "@\/lib\/auth"/, name);
  }
});

test("permission ownership accepts only approved linked X IDs", async () => {
  const ownership = await readFile(
    path.resolve(import.meta.dirname, "ownership.ts"),
    "utf8",
  );
  const approvedX = await readFile(
    path.resolve(import.meta.dirname, "approvedX.ts"),
    "utf8",
  );
  assert.match(ownership, /from "\.\/approvedX"/);
  assert.match(ownership, /getApprovedLinkedXUserIds|getApprovedXIds/);
  assert.match(approvedX, /\.innerJoin\(xUsers, eq\(xUsers\.id, xUserAccountLinks\.x_user_id\)\)/);
  assert.match(approvedX, /eq\(xUsers\.approval_status, "approved"\)/);
  assert.doesNotMatch(approvedX, /approval_status,\s*"imported"/);
});

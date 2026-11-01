import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { findAuditActorXViolations, withoutComments } from "./check-audit-actor-x.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("check:audit-actor-x recognizes the bulk strict actor X validation", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "check-audit-actor-x.mjs")],
    {
      cwd: root,
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  assert.match(result.stdout, /actor X audit wiring present/);
});

const baseline = new Map([
  ["packages/server-core/src/audit/types.ts", "actor_x_user_id?: string | null;"],
  ["packages/server-core/src/audit/logger.ts", `
    const pairs = await loadApprovedActorXPairs(db, activeInputs);
    if (!linked && input.strict) {
      throw new Error("actor_x_user_id is not linked to actor_user_id");
    }
  `],
  ["packages/server-core/src/audit/mutate.ts", "const record = { actor_x_user_id };"],
  ["src/lib/actions/xid.ts", "const audit = { actor_x_user_id: xId }; xLinkDeletionAllowedSql(userId, xId);"],
  ["src/lib/actions/xid-admin.ts", "buildXIdentityDecisionFields(input);"],
]);

const inspect = (files) => findAuditActorXViolations((file) => files.get(file));

test("valid actor X contract markers remain visible", () => {
  assert.deepEqual(inspect(baseline), []);
});

test("commented-out audit contracts cannot satisfy the checker", () => {
  for (const filename of baseline.keys()) {
    const files = new Map(baseline);
    files.set(filename, `/* ${baseline.get(filename)} */`);
    const violations = inspect(files);
    assert.ok(violations.some((issue) => issue.startsWith(`${filename}:`)), filename);
  }
});

test("line comments cannot fake a missing audit field", () => {
  const files = new Map(baseline);
  files.set(
    "packages/server-core/src/audit/types.ts",
    "// actor_x_user_id?: string | null;\nexport interface Audit {}",
  );
  assert.match(inspect(files).join("\n"), /WriteAuditLogInput must expose/);
});

test("comment-looking text within strings remains unchanged", () => {
  const code = 'const url = "https://example.com/a/* literal */"; // absent\nconst active = true;';
  const filtered = withoutComments(code);
  assert.ok(filtered.includes("https://example.com/a/* literal */"));
  assert.match(filtered, /const active = true/);
  assert.doesNotMatch(filtered, /absent/);
});

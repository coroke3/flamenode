import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveVoidModerationCaseType } from "./voidCaseType.ts";

const adminSource = readFileSync(
  fileURLToPath(new URL("../actions/admin.ts", import.meta.url)),
  "utf8",
);
const moderationAdminSource = readFileSync(
  fileURLToPath(new URL("../actions/moderation-admin.ts", import.meta.url)),
  "utf8",
);

test("resolveVoidModerationCaseType maps categories", () => {
  assert.equal(resolveVoidModerationCaseType("duplicate"), "duplicate");
  assert.equal(resolveVoidModerationCaseType("x_id_invalid"), "x_reapply");
  assert.equal(resolveVoidModerationCaseType("operator_decision"), "void");
});

test("moderation case creation rejects duplicate open video/type atomically", () => {
  assert.match(moderationAdminSource, /WHERE NOT EXISTS\s*\([\s\S]*video_moderation_cases/);
  assert.match(moderationAdminSource, /case_type = \$\{caseType\}/);
  assert.match(moderationAdminSource, /status = 'open'/);
  assert.match(moderationAdminSource, /expected:\s*\(number \| null\)\[\] = \[1\]/);
});

test("admin void restore requires case_id and reuses open case", () => {
  assert.match(adminSource, /voided解除には case_id が必要です/);
  assert.match(adminSource, /planVoidModerationCaseResolve/);
  assert.match(adminSource, /planVoidModerationCaseOpen/);
  assert.match(adminSource, /openCase\.case_type\s*!==\s*"void"/);
  assert.doesNotMatch(
    adminSource,
    /status === "voided" \? null : guard\.user\.id[\s\S]*INSERT/,
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";

const source = readFileSync(
  fileURLToPath(new URL("./event-staff-admin.ts", import.meta.url)),
  "utf8",
);

test("staff CSV uses the canonical X parser and reports row-level validation", () => {
  assert.match(source, /parseCanonicalXId/);
  assert.match(source, /csvValidationMessage/);
  assert.match(source, /\$\{lineNumber\}行目: X IDが不正です/);
  assert.match(source, /rows: z\.array\(csvImportRowSchema\)\.min\(1\)\.max\(100\)/);
  assert.doesNotMatch(source, /normalizeXId\(/);
});

test("staff CSV preflights the complete atomic mutation before calling the writer", () => {
  const budgetIndex = source.indexOf("const budget = planD1AuditMutationBudget");
  const writerIndex = source.indexOf("await bulkUpsertEventStaffWithProtection");
  const guardIndex = source.indexOf("if (!budget.withinLimit)");
  assert.ok(budgetIndex >= 0);
  assert.ok(guardIndex > budgetIndex);
  assert.ok(writerIndex > guardIndex);
  assert.match(source, /mutationStatementCount: upserts\.length \+ newXRows\.length/);
  assert.match(source, /mutationAssertionCount: upserts\.length \+ newXRows\.length/);
  assert.match(source, /auditEntryCount: upserts\.length \+ newXRows\.length/);

  const existingRows = planD1AuditMutationBudget({
    mutationStatementCount: 15,
    mutationAssertionCount: 15,
    auditEntryCount: 15,
    distinctActorCount: 1,
  });
  const newRows = planD1AuditMutationBudget({
    mutationStatementCount: 14,
    mutationAssertionCount: 14,
    auditEntryCount: 14,
    distinctActorCount: 1,
  });
  assert.equal(existingRows.withinLimit, true);
  assert.equal(newRows.withinLimit, true);
  assert.equal(
    planD1AuditMutationBudget({
      mutationStatementCount: 16,
      mutationAssertionCount: 16,
      auditEntryCount: 16,
      distinctActorCount: 1,
    }).withinLimit,
    false,
  );
});

test("staff preparation reads fail closed instead of leaking a D1 exception", () => {
  assert.match(source, /function staffPreparationError\(error: unknown\)/);
  assert.match(source, /existing = data\.staff_id[\s\S]*atomicExtras = await prepareXUserExtras/);
  assert.match(source, /\[existingStaffRows, knownXRows\] = await Promise\.all/);
  assert.match(source, /return staffPreparationError\(error\);/);
  const removeStart = source.indexOf("export async function removeEventStaffMember");
  const transferStart = source.indexOf("export async function transferEventOwnershipAction");
  assert.ok(removeStart >= 0 && transferStart > removeStart);
  const removeSource = source.slice(removeStart, transferStart);
  assert.match(removeSource, /existing = await findStaffById/);
  assert.match(removeSource, /return staffPreparationError\(error\);/);
});

test("staff CSV matches legacy X spellings without rewriting stored rows", () => {
  assert.match(source, /const requestedXIdSet = new Set\(requestedXIds\)/);
  assert.match(source, /const normalized = parseCanonicalXId\(row\.x_user_id\)/);
  assert.match(source, /if \(!normalized \|\| !requestedXIdSet\.has\(normalized\)\) continue/);
  assert.match(source, /if \(existingByX\.has\(normalized\)\)/);
  assert.match(source, /existingByX\.get\(row\.xUserId\) \?\? null/);
  const helperStart = source.indexOf("async function findStaffByXUserId");
  const helperEnd = source.indexOf("async function findStaffById", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /if \(exact\) return exact/);
  assert.match(helper, /parseCanonicalXId\(row\.x_user_id\) === xUserId/);
  assert.match(helper, /matches\.length > 1/);
});

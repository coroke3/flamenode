import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
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
    mutationStatementCount: 12,
    mutationAssertionCount: 12,
    auditEntryCount: 12,
    distinctActorCount: 1,
  });
  const newRows = planD1AuditMutationBudget({
    mutationStatementCount: 12,
    mutationAssertionCount: 12,
    auditEntryCount: 12,
    distinctActorCount: 1,
  });
  assert.equal(existingRows.withinLimit, true);
  assert.equal(newRows.withinLimit, true);
  assert.equal(
    planD1AuditMutationBudget({
      mutationStatementCount: 13,
      mutationAssertionCount: 13,
      auditEntryCount: 13,
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

test("新規X IDを伴うスタッフ変更はusers_indexを再生成する", () => {
  assert.match(source, /includeUsersIndex\?: boolean/);
  assert.match(source, /targetType: "users_index"/);
  assert.match(source, /includeUsersIndex: atomicExtras != null/);
  assert.match(source, /includeUsersIndex: newXRows\.length > 0/);
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

test("SEC-800: preparation read failure logs fixed code without inspecting provider error", () => {
  // Exercise the exact production function body while replacing only its
  // TypeScript signature and Next.js-only navigation rethrow dependency.
  const start = source.indexOf("function staffPreparationError(error: unknown): StaffActionResult");
  const end = source.indexOf("\nasync function ensureEventManager", start);
  assert.ok(start >= 0 && end > start, "isolate the real CURRENT failure handler");
  const declaration = source.slice(start, end).replace(
    "function staffPreparationError(error: unknown): StaffActionResult",
    "function staffPreparationError(error)",
  );
  const execute = (log, rethrow = () => {}) => runInNewContext(
    declaration + "\nstaffPreparationError",
    { console: { error: log }, unstable_rethrow: rethrow },
  );

  const secret = "SEC800_PRIVATE_PROVIDER_QUERY_AND_PARAMS";
  const hostileError = new Proxy(new Error(secret), {
    get(target, key) {
      if (["message", "name", "stack", "cause"].includes(String(key))) {
        throw new Error("provider error getter must not run");
      }
      return Reflect.get(target, key);
    },
  });
  const diagnostics = [];
  const result = execute((...args) => { diagnostics.push(args); })(hostileError);
  assert.equal(result.ok, false);
  assert.equal(result.message,
    "スタッフ情報の取得に失敗しました。再読み込みして、もう一度お試しください。");
  assert.deepEqual(diagnostics, [["[event-staff] PREPARATION_READ_FAILED"]]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /SEC800_PRIVATE|params|provider error getter/);

  let attempted = 0;
  const brokenLogger = execute(() => { attempted += 1; throw new Error(secret); });
  const preserved = brokenLogger(hostileError);
  assert.equal(attempted, 1, "a failed diagnostic sink must not be retried");
  assert.equal(preserved.ok, false);
  assert.equal(preserved.message, result.message,
    "broken logger must not replace the normal sanitized action failure");

  const navigationSentinel = { digest: "NEXT_REDIRECT" };
  let loggedAfterRethrow = false;
  const redirected = execute(
    () => { loggedAfterRethrow = true; },
    () => { throw navigationSentinel; },
  );
  assert.throws(() => redirected(navigationSentinel), (error) => error === navigationSentinel,
    "Next.js navigation control flow must still propagate before diagnostics");
  assert.equal(loggedAfterRethrow, false);
});

test("SEC-800: only fixed domain messages and matching user-owned confirmations reach staff actions", () => {
  const start = source.indexOf("const STAFF_SAFE_ACTION_MESSAGES = new Set");
  const end = source.indexOf("\nfunction staffPreparationError", start);
  assert.ok(start >= 0 && end > start, "extract the production whitelist without transcribing it");
  const functionSignature = /function staffSafeActionMessage\(\s*error: unknown,\s*fallback: string,\s*eventId\?: string,\s*explicitAllowed\?: readonly string\[],\s*\): string \{/;
  const policySource = source.slice(start, end)
    .replace(
      functionSignature,
      "function staffSafeActionMessage(error, fallback, eventId, explicitAllowed) {",
    )
    .replace("let message: unknown;", "let message;");
  assert.doesNotMatch(policySource, functionSignature, "signature was made executable in node:vm");
  const { policy, makeError } = runInNewContext(
    policySource + "\n({ policy: staffSafeActionMessage, makeError: (message) => new Error(message) })",
  );
  const fallback = "スタッフを保存できません。";
  const publicDomainMessages = [
    "このイベントには同じ X ID のスタッフが既に登録されています。",
    "イベントには最低1人の代表者が必要です。先に別のスタッフへ代表権限を移譲してください。",
    "代表権限を付与できるのはイベント代表者または管理者だけです。",
    "X ID確認権限は site admin 専用です。",
    "自分自身のスタッフ権限は一括更新できません。個別の確認付き操作を使用してください。",
  ];
  for (const allowed of publicDomainMessages) {
    assert.equal(policy(makeError(allowed), fallback), allowed,
      "existing intended domain UX is preserved");
  }

  const canary = "SEC800_SQL_PARAMS_secret_user_id_abc123";
  for (const unsafe of [
    "Failed query: UPDATE event_staff; params: " + canary,
    canary,
    publicDomainMessages[0] + " " + canary,
    "SQLITE_CONSTRAINT " + canary,
    "A".repeat(260),
  ]) {
    assert.equal(policy(makeError(unsafe), fallback), fallback,
      "unrecognized provider error body must never reach the response");
  }
  assert.equal(policy({ message: canary }, fallback), fallback);
  const getterTrap = makeError(canary);
  Object.defineProperty(getterTrap, "message", { get() { throw Error(canary); } });
  assert.equal(policy(getterTrap, fallback), fallback,
    "poisoned Error.message must not replace the user-visible failure");
  const protoTrap = new Proxy(makeError(canary), {
    getPrototypeOf() { throw Error(canary); },
  });
  assert.equal(policy(protoTrap, fallback), fallback,
    "poisoned instanceof checks must also fail closed");

  for (const action of ["SELF CHANGE", "REMOVE SELF", "TRANSFER"]) {
    const expected = `確認のため「${action} event_123」と入力してください。`;
    assert.equal(policy(makeError(expected), fallback, "event_123"), expected);
    assert.equal(policy(makeError(expected), fallback, "event_456"), fallback);
    assert.equal(policy(makeError(expected + canary), fallback, "event_123"), fallback);
  }
  const csv = "17行目: X IDが不正です";
  assert.equal(policy(makeError(csv), "CSV入力エラーです。", undefined, [csv]), csv);
  assert.equal(policy(makeError(csv), "CSV入力エラーです。", undefined, []), "CSV入力エラーです。");
  assert.equal(policy(makeError("some failure " + canary), fallback, "event_123"), fallback);
});

test("SEC-800: all staff catch paths use the bounded allowlist, never raw provider message", () => {
  assert.doesNotMatch(source, /message:\s*error instanceof Error\s*\?\s*error\.message/,
    "no action may directly reflect untrusted Error.message to staff results");
  const invocationCount = (source.match(/message: staffSafeActionMessage\(error,/g) ?? []).length;
  assert.equal(invocationCount, 8,
    "manager permission, assignment, owner grant, write, CSV input/write, remove, transfer");
  assert.match(source, /data\.rows\.flatMap\(\(row\) => \[/,
    "CSV row-specific errors must be compared against validated source line numbers");
  assert.match(source, /staffSafeActionMessage\(error, "代表者を移譲できません。", data\.event_id\)/,
    "event-confirmation copy remains available only for the matching event");
});

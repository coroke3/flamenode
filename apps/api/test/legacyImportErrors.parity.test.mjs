import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  legacyImportPreviewFailure,
  legacyImportWriteGuardStatus,
  legacyImportCommittedProgressPending,
} from "../src/routes/admin/legacyImportErrors.ts";

test("RH-002 U02c: preview error codes preserve status, retry and repreview contract", () => {
  const cases = [
    ["bucket_unavailable", 503, true, false],
    ["already_claimed", 423, true, false],
    ["claim_conflict", 409, true, false],
    ["not_found", 409, false, true],
    ["expired", 409, false, true],
    ["owner_mismatch", 409, false, true],
    ["hash_mismatch", 409, false, true],
    ["invalid_record", 409, false, true],
    ["invalid_token", 409, false, true],
    ["plan_too_large", 409, false, false],
  ];
  for (const [code, status, retryable, requiresRepreview] of cases) {
    assert.deepEqual(legacyImportPreviewFailure({
      kind: "preview_error", code, message: "denied",
    }), {
      status, body: {
        ok: false, message: "denied", preview_error_code: code,
        retryable, requires_repreview: requiresRepreview,
      },
    }, code);
  }
});

test("RH-002 U02c: bindings unavailable and transient DB failures fail closed", () => {
  assert.deepEqual(legacyImportPreviewFailure({ kind: "bindings_unavailable" }), {
    status: 503, body: { ok: false, message: "runtime_bindings_unavailable",
      retryable: true, requires_repreview: false },
  });
  assert.deepEqual(legacyImportPreviewFailure({ kind: "other", transientDb: true }), {
    status: 503, body: { ok: false, message: "CloudflareまたはR2が一時的に応答できませんでした。",
      retryable: true, requires_repreview: false },
  });
  assert.deepEqual(legacyImportPreviewFailure({ kind: "other", transientDb: false }), {
    status: 409, body: { ok: false, message: "preview planを確認できませんでした。再度プレビューしてください。",
      retryable: false, requires_repreview: true },
  });
});

test("RH-002 U02c: CURRENT admin guard HTTP status mapping", () => {
  assert.equal(legacyImportWriteGuardStatus("unauthenticated"), 401);
  for (const reason of ["db_unavailable", "maintenance_mode", "cost_guard_blocked"]) {
    assert.equal(legacyImportWriteGuardStatus(reason), 503);
  }
  for (const reason of ["forbidden", "banned", "insufficient_permissions"]) {
    assert.equal(legacyImportWriteGuardStatus(reason), 403);
  }
});

test("RH-002 U02c: D1 committed plus R2 CAS failure never claims rollback", () => {
  const progress = { stage: "events", index: 3, completed: 7, total: 10 };
  const result = { complete: false, createdEvents: 3 };
  for (const retryable of [false, true]) {
    const outcome = legacyImportCommittedProgressPending({
      retryable, planHash: "sha", attempt: 2, progress, result,
    });
    assert.equal(outcome.status, retryable ? 503 : 409);
    assert.deepEqual(outcome.body, {
      ok: false,
      message: "このステップは保存済み。進捗復旧中",
      committed: true, kind: "committed_progress_pending",
      retryable: true, requires_repreview: false, plan_hash: "sha",
      attempt: 2, progress, result,
    });
  }
});

test("RH-002 U02c: CURRENT source enforces origin, auth and committed-progress HTTP mapping", async () => {
  const current = await readFile(new URL("../../../app/api/admin/import/legacy/route.ts", import.meta.url), "utf8");
  const origin = current.indexOf("await requireSameOriginWrite(request)");
  const guard = current.indexOf('await requireAdminWrite("admin_legacy_import")');
  const formData = current.indexOf("await request.formData()");
  assert.ok(origin >= 0 && guard > origin && formData > guard);
  assert.match(current, /committed: true,\s*kind: "committed_progress_pending",\s*retryable: true,\s*requires_repreview: false/);
});

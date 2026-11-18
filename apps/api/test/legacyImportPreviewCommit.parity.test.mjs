import assert from "node:assert/strict";
import { test } from "node:test";
import { readLegacyImportPreviewFiles } from "../src/routes/admin/legacyImportFiles.ts";
import { prepareLegacyImportPreview } from "../src/routes/admin/legacyImportPreview.ts";
import {
  persistLegacyImportPreview,
  LEGACY_IMPORT_MAX_STORED_PLAN_BYTES,
  LEGACY_IMPORT_PLAN_WARN_BYTES,
} from "../src/routes/admin/legacyImportPreviewCommit.ts";

async function fixture() {
  const formData = new FormData();
  formData.set("strategy", "skip_existing");
  const files = await readLegacyImportPreviewFiles({
    formData,
    files: [{ name: "events.csv", size: 50, text: async () =>
      "eventid,eventname\nevent-a,Event A\n" }],
  });
  assert.equal(files.ok, true);
  const prepared = prepareLegacyImportPreview({ formData, files, now: 1700000000 });
  assert.equal(prepared.ok, true);
  return prepared;
}

function adapters(prepared, { size = 0, preflightError, storeError } = {}) {
  const calls = [];
  const args = {
    authUserId: "operator-1",
    prepared,
    estimateStoredBytes: (input) => {
      calls.push("estimate");
      assert.equal(input.authUserId, "operator-1");
      return size;
    },
    preflight: async (_plan, strategy) => {
      calls.push("preflight");
      assert.equal(strategy, "skip_existing");
      if (preflightError) throw preflightError;
      return { existingEventIds: ["event-a"], existingVideoIds: ["video-x"] };
    },
    createPreview: async (input) => {
      calls.push("store");
      assert.equal(input.authUserId, "operator-1");
      assert.deepEqual(input.skipExistingEventIds, ["event-a"]);
      assert.deepEqual(input.skipExistingVideoIds, ["video-x"]);
      if (storeError) throw storeError;
      return { previewToken: "token", planHash: "hash", expiresAt: 1700000900 };
    },
    mapStoreError: (cause) => {
      calls.push("map-error");
      assert.equal(cause, storeError);
      return { status: 503, body: { ok: false, message: "R2 unavailable", retryable: true } };
    },
  };
  return { args, calls };
}

test("RH-002 U02 preview persist: only preflight then R2 store after valid size", async () => {
  const prepared = await fixture();
  const a = adapters(prepared);
  const result = await persistLegacyImportPreview(a.args);
  assert.equal(result.status, 200);
  assert.deepEqual(a.calls, ["estimate", "preflight", "store"]);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.preview_token, "token");
  assert.equal(result.body.plan_hash, "hash");
  assert.equal(result.body.expires_at, 1700000900);
  assert.equal(result.body.strategy, "skip_existing");
  assert.equal(result.body.preview.events[0].id, "event-a");
  assert.deepEqual(result.body.file_ranges, prepared.fileRanges);
});

test("RH-002 U02 preview persist: exact 512 KiB passes; one byte over fails before DB or R2", async () => {
  const prepared = await fixture();
  const equal = adapters(prepared, { size: LEGACY_IMPORT_MAX_STORED_PLAN_BYTES });
  assert.equal((await persistLegacyImportPreview(equal.args)).status, 200);
  assert.deepEqual(equal.calls, ["estimate", "preflight", "store"]);
  const over = adapters(prepared, { size: LEGACY_IMPORT_MAX_STORED_PLAN_BYTES + 1 });
  const rejected = await persistLegacyImportPreview(over.args);
  assert.equal(rejected.status, 413);
  assert.deepEqual(over.calls, ["estimate"]);
  assert.match(rejected.body.message, /512KB/);
  assert.equal(rejected.body.mode, "preview");
});

test("RH-002 U02 preview persist: warning threshold strictly greater than 80% and no mutation of plan", async () => {
  const prepared = await fixture();
  const original = structuredClone(prepared.plan.warnings);
  const exact = adapters(prepared, { size: LEGACY_IMPORT_PLAN_WARN_BYTES });
  const exactResult = await persistLegacyImportPreview(exact.args);
  assert.equal(exactResult.status, 200);
  assert.equal(exactResult.body.warnings.some((x) => x.includes("80%")), false);
  const over = adapters(prepared, { size: LEGACY_IMPORT_PLAN_WARN_BYTES + 1 });
  const result = await persistLegacyImportPreview(over.args);
  assert.equal(result.status, 200);
  assert.match(result.body.warnings[0], /80%/);
  assert.deepEqual(prepared.plan.warnings, original);
});

test("RH-002 U02 preview persist: D1 preflight failure cannot create a preview token", async () => {
  const prepared = await fixture();
  const a = adapters(prepared, { preflightError: new Error("current DB conflict") });
  const result = await persistLegacyImportPreview(a.args);
  assert.deepEqual(a.calls, ["estimate", "preflight"]);
  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.requires_repreview, false);
  assert.equal(result.body.message, "current DB conflict");
  assert.equal(result.body.preview_token, undefined);
});

test("RH-002 U02 preview persist: R2 storage error maps to fail-closed response", async () => {
  const prepared = await fixture();
  const a = adapters(prepared, { storeError: new Error("R2 failed") });
  const result = await persistLegacyImportPreview(a.args);
  assert.deepEqual(a.calls, ["estimate", "preflight", "store", "map-error"]);
  assert.deepEqual(result, {
    status: 503,
    body: { ok: false, message: "R2 unavailable", retryable: true },
  });
});

test("RH-002 U02 preview persist: create_only does not reuse existing rows", async () => {
  const prepared = await fixture();
  const a = adapters({ ...prepared, strategy: "create_only" });
  a.args.preflight = async () => {
    a.calls.push("preflight");
    return { existingEventIds: ["event-a"], existingVideoIds: ["video-x"] };
  };
  a.args.createPreview = async ({ skipExistingEventIds, skipExistingVideoIds }) => {
    a.calls.push("store");
    assert.deepEqual(skipExistingEventIds, []);
    assert.deepEqual(skipExistingVideoIds, []);
    return { previewToken: "token", planHash: "hash", expiresAt: 1 };
  };
  assert.equal((await persistLegacyImportPreview(a.args)).status, 200);
  assert.deepEqual(a.calls, ["estimate", "preflight", "store"]);
});

test("RH-002 preview estimator: canonical v4 envelope uses UTF-8 bytes, not JSON code units", async () => {
  const { estimateLegacyImportStoredPlanBytes, LEGACY_IMPORT_PREVIEW_RECORD_VERSION } =
    await import("@flamenode/server-core/legacyImport/previewEstimate");
  assert.equal(LEGACY_IMPORT_PREVIEW_RECORD_VERSION, 4);
  const prepared = await fixture();
  const input = { authUserId: "日本語-管理者", strategy: prepared.strategy, plan: prepared.plan };
  const one = estimateLegacyImportStoredPlanBytes(input);
  const record = {
    version: 4, previewToken: "0".repeat(32),
    authUserId: input.authUserId, strategy: input.strategy,
    planHash: "0".repeat(64), plan: input.plan,
    createdAt: 0, expiresAt: 0, status: "ready", attempt: 0,
    progress: {
      stage: "system_user", index: 0,
      counts: {
        createdEvents: 0, replacedEvents: 0, skippedEvents: 0,
        createdVideos: 0, replacedVideos: 0, skippedVideos: 0,
        createdXUsers: 0, createdAuthUsers: 0, createdSoftwares: 0,
        createdCustomQuestions: 0, reusedCustomQuestions: 0,
      },
      skipExistingEventIds: [], skipExistingVideoIds: [],
    },
  };
  assert.equal(one, Buffer.byteLength(JSON.stringify(record), "utf8"));
  assert.ok(one > JSON.stringify(record).length);
  assert.ok(one > Buffer.byteLength(JSON.stringify(prepared.plan), "utf8"),
    "the stored envelope, not only plan JSON, counts against 512 KiB");
});

test("RH-002 preview persistence: missing test estimator defaults to canonical shared R2 record", async () => {
  const prepared = await fixture();
  const a = adapters(prepared);
  delete a.args.estimateStoredBytes;
  const response = await persistLegacyImportPreview(a.args);
  assert.equal(response.status, 200);
  assert.deepEqual(a.calls, ["preflight", "store"]);
  const { estimateLegacyImportStoredPlanBytes } =
    await import("@flamenode/server-core/legacyImport/previewEstimate");
  const fullBytes = estimateLegacyImportStoredPlanBytes({
    authUserId: a.args.authUserId,
    strategy: prepared.strategy,
    plan: prepared.plan,
  });
  assert.ok(fullBytes > 0 && fullBytes < LEGACY_IMPORT_PLAN_WARN_BYTES);
});

test("RH-002 CURRENT estimator is a compatibility re-export of the canonical byte calculator", async () => {
  const { readFile } = await import("node:fs/promises");
  const current = await readFile(new URL("../../../src/lib/import/legacy/previewStore.ts", import.meta.url), "utf8");
  assert.match(current, /export \{ estimateLegacyImportStoredPlanBytes \} from "@flamenode\/server-core\/legacyImport\/previewEstimate"/);
});

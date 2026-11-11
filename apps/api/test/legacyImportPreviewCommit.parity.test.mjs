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

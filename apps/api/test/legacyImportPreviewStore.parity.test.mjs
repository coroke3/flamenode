import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLegacyFiles } from "@flamenode/server-core/legacyImport/normalize";
import {
  createLegacyImportPreview,
  claimLegacyImportPreview,
  LegacyImportPreviewError,
} from "@flamenode/server-core/legacyImport/previewStore";

function bucketFixture() {
  const records = new Map();
  const calls = [];
  let version = 0;
  const bucket = {
    async get(key) {
      calls.push(["get", key]);
      const snapshot = records.get(key);
      if (!snapshot) return null;
      return {
        etag: snapshot.etag,
        size: Buffer.byteLength(snapshot.data),
        text: async () => snapshot.data,
      };
    },
    async put(key, value, options = {}) {
      const expected = options.onlyIf?.etagMatches;
      const current = records.get(key);
      calls.push(["put", key, expected ?? null]);
      if (expected && current?.etag !== expected) return null;
      const data = String(value);
      const etag = String(++version);
      records.set(key, { data, etag });
      return { etag };
    },
    async delete(key) {
      calls.push(["delete", key]);
      records.delete(key);
    },
  };
  return { bucket, records, calls };
}

function previewInput() {
  const plan = normalizeLegacyFiles([], {
    eventVisibility: "private",
    videoVisibility: "private",
    now: 1700000000,
  });
  assert.deepEqual(plan.errors, []);
  return { authUserId: "owner-a", strategy: "create_only", plan };
}

const TOKEN = "a".repeat(32);
const CLAIM = "b".repeat(32);

test("RH-002 shared R2 preview: create v4 and owner-bound claim with CAS, then release", async () => {
  const { bucket, records, calls } = bucketFixture();
  const input = previewInput();
  const credential = await createLegacyImportPreview(bucket, input, {
    now: 1700000000, previewToken: TOKEN,
  });
  assert.equal(credential.previewToken, TOKEN);
  assert.match(credential.planHash, /^[0-9a-f]{64}$/);
  assert.equal(credential.expiresAt, 1700000900);
  assert.equal(records.size, 1);
  const stored = JSON.parse([...records.values()][0].data);
  assert.equal(stored.version, 4);
  assert.equal(stored.status, "ready");
  assert.equal(stored.authUserId, "owner-a");

  const claimed = await claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN,
    planHash: credential.planHash,
  }, { now: 1700000001, claimId: CLAIM });
  assert.equal(claimed.completed, false);
  assert.equal(claimed.attempt, 1);
  assert.equal(JSON.parse([...records.values()][0].data).status, "claimed");
  assert.equal(calls.filter(([method]) => method === "put").length, 2);
  assert.ok(calls.some(([method, , etag]) => method === "put" && etag === "1"),
    "claim must conditionally put against original R2 etag");
  await claimed.release();
  assert.equal(JSON.parse([...records.values()][0].data).status, "ready");
  const reclaimed = await claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN,
    planHash: credential.planHash,
  }, { now: 1700000002, claimId: "c".repeat(32) });
  assert.equal(reclaimed.attempt, 2);
});

test("RH-002 shared R2 preview: missing or under-reported object size cannot bypass 512 KiB JSON cap", async () => {
  for (const reportedSize of [undefined, 64]) {
    const { bucket, records, calls } = bucketFixture();
    const credential = await createLegacyImportPreview(bucket, previewInput(), {
      now: 1700000000, previewToken: TOKEN,
    });
    const [key, stored] = [...records.entries()][0];
    const oversized = stored.data + " ".repeat(512 * 1024);
    records.set(key, { ...stored, data: oversized });
    const actualGet = bucket.get;
    bucket.get = async (lookup) => {
      const object = await actualGet(lookup);
      return object && { ...object, size: reportedSize };
    };
    await assert.rejects(
      claimLegacyImportPreview(bucket, {
        authUserId: "owner-a", previewToken: TOKEN, planHash: credential.planHash,
      }, { now: 1700000001, claimId: CLAIM }),
      (error) => error instanceof LegacyImportPreviewError && error.code === "plan_too_large",
    );
    assert.equal(calls.filter(([method]) => method === "put").length, 1,
      "oversized JSON must fail before claim CAS");
    assert.equal(JSON.parse(records.get(key).data).status, "ready");
  }
});

test("RH-002 shared R2 preview: streamed body rejects oversized chunks before text() allocation", async () => {
  const { bucket, records, calls } = bucketFixture();
  const credential = await createLegacyImportPreview(bucket, previewInput(), {
    now: 1700000000, previewToken: TOKEN,
  });
  const [key, entry] = [...records.entries()][0];
  let cancelled = false;
  const originalGet = bucket.get;
  bucket.get = async (lookup) => {
    const object = await originalGet(lookup);
    if (!object) return null;
    const initial = new TextEncoder().encode(entry.data);
    return {
      ...object,
      size: 1, // Invalidly small metadata must not bypass the byte cap.
      text: async () => { throw new Error("streaming R2 must never call text()"); },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(initial);
          controller.enqueue(new Uint8Array(512 * 1024));
        },
        cancel() { cancelled = true; },
      }),
    };
  };
  await assert.rejects(claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN, planHash: credential.planHash,
  }, { now: 1700000001, claimId: CLAIM }),
  (error) => error instanceof LegacyImportPreviewError && error.code === "plan_too_large");
  assert.equal(cancelled, true, "oversized streamed body must be cancelled");
  assert.equal(calls.filter(([method]) => method === "put").length, 1,
    "oversized body must not acquire R2 CAS claim");
  assert.equal(JSON.parse(records.get(key).data).status, "ready");
});

test("RH-002 shared R2 preview: bounded streamed valid body can still claim and release", async () => {
  const { bucket } = bucketFixture();
  const credential = await createLegacyImportPreview(bucket, previewInput(), {
    now: 1700000000, previewToken: TOKEN,
  });
  const originalGet = bucket.get;
  bucket.get = async (lookup) => {
    const object = await originalGet(lookup);
    if (!object) return null;
    const bytes = new TextEncoder().encode(await object.text());
    return {
      ...object,
      size: undefined,
      text: async () => { throw new Error("streaming R2 must not use text()"); },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 17));
          controller.enqueue(bytes.subarray(17));
          controller.close();
        },
      }),
    };
  };
  const claimed = await claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN, planHash: credential.planHash,
  }, { now: 1700000001, claimId: CLAIM });
  assert.equal(claimed.attempt, 1);
  await claimed.release();
});

test("RH-002 shared R2 preview: wrong owner cannot claim another owner's token", async () => {
  const { bucket, records } = bucketFixture();
  const input = previewInput();
  const credential = await createLegacyImportPreview(bucket, input, {
    now: 1700000000, previewToken: TOKEN,
  });
  await assert.rejects(claimLegacyImportPreview(bucket, {
    authUserId: "owner-b", previewToken: TOKEN,
    planHash: credential.planHash,
  }, { now: 1700000001 }), (err) =>
    err instanceof LegacyImportPreviewError && err.code === "not_found");
  assert.equal(JSON.parse([...records.values()][0].data).status, "ready");
});

test("RH-002 shared R2 preview: malformed hash and tampering do not acquire a claim", async () => {
  const { bucket, records, calls } = bucketFixture();
  const input = previewInput();
  const credential = await createLegacyImportPreview(bucket, input, {
    now: 1700000000, previewToken: TOKEN,
  });
  await assert.rejects(claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN, planHash: "bad",
  }, { now: 1700000001 }), (err) =>
    err instanceof LegacyImportPreviewError && err.code === "invalid_token");
  await assert.rejects(claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN, planHash: "f".repeat(64),
  }, { now: 1700000001 }), (err) =>
    err instanceof LegacyImportPreviewError && err.code === "hash_mismatch");
  assert.equal(JSON.parse([...records.values()][0].data).status, "ready");
  assert.equal(calls.filter(([method]) => method === "put").length, 1);
  assert.equal(records.size, 1);
});

test("RH-002 shared R2 preview: active claim blocks duplicate request and expires in 60 seconds", async () => {
  const { bucket } = bucketFixture();
  const input = previewInput();
  const credential = await createLegacyImportPreview(bucket, input, {
    now: 1700000000, previewToken: TOKEN,
  });
  await claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN, planHash: credential.planHash,
  }, { now: 1700000001, claimId: CLAIM });
  await assert.rejects(claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN, planHash: credential.planHash,
  }, { now: 1700000010 }), (err) =>
    err instanceof LegacyImportPreviewError && err.code === "already_claimed");
  const reclaimed = await claimLegacyImportPreview(bucket, {
    authUserId: "owner-a", previewToken: TOKEN, planHash: credential.planHash,
  }, { now: 1700000062, claimId: "c".repeat(32) });
  assert.equal(reclaimed.attempt, 2);
});


test("RH-002 Hono adapter: real R2 token and claim bind to the authenticated owner", async () => {
  const { legacyImportR2Adapter } = await import("../src/routes/admin/legacyImportR2Adapter.ts");
  const { bucket, calls } = bucketFixture();
  const adapter = legacyImportR2Adapter(bucket);
  const owner = previewInput();
  const credential = await adapter.createPreview(owner);
  assert.match(credential.previewToken, /^[a-f0-9]{32}$/);
  assert.match(credential.planHash, /^[a-f0-9]{64}$/);
  const claimed = await adapter.claimPreview({
    authUserId: owner.authUserId,
    previewToken: credential.previewToken,
    planHash: credential.planHash,
  });
  assert.equal(claimed.completed, false);
  assert.equal(claimed.attempt, 1);
  assert.ok(calls.some(([method, , etag]) => method === "put" && etag !== null));
  await claimed.release();
});

test("RH-002 Hono adapter: invalid credential maps to 409 re-preview; missing bucket to 503", async () => {
  const { legacyImportR2Adapter } = await import("../src/routes/admin/legacyImportR2Adapter.ts");
  const adapter = legacyImportR2Adapter(bucketFixture().bucket);
  try {
    await adapter.claimPreview({
      authUserId: "owner-a",
      previewToken: "not-hex",
      planHash: "wrong",
    });
    assert.fail("invalid credential must not be claimed");
  } catch (cause) {
    const mapped = adapter.mapPreviewError(cause);
    assert.equal(mapped.status, 409);
    assert.equal(mapped.body.requires_repreview, true);
    assert.equal(mapped.body.preview_error_code, "invalid_token");
  }
  const offline = legacyImportR2Adapter(null);
  const mapped = offline.mapPreviewError(new Error("R2 unavailable"));
  assert.deepEqual(mapped, { status: 503, body: {
    ok: false, message: "runtime_bindings_unavailable",
    retryable: true, requires_repreview: false,
  } });
});


test("RH-002 Hono R2 adapter: preview store failure maps without leaking credentials", async () => {
  const { legacyImportR2Adapter } = await import("../src/routes/admin/legacyImportR2Adapter.ts");
  const { bucket } = bucketFixture();
  bucket.put = async () => null;
  const adapter = legacyImportR2Adapter(bucket);
  let failure;
  await assert.rejects(async () => {
    try {
      await adapter.createPreview(previewInput());
    } catch (err) {
      failure = err;
      throw err;
    }
  }, (err) => err instanceof LegacyImportPreviewError && err.code === "claim_conflict");
  const result = adapter.mapStoreError(failure);
  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.preview_error_code, "claim_conflict");
  assert.equal(result.body.retryable, true);
  assert.equal(result.body.preview_token, undefined);
});


test("RH-002 Hono preview pipeline: real CSV and real R2 claim, injected read-only D1 preflight", async () => {
  const { legacyImportR2Adapter } = await import("../src/routes/admin/legacyImportR2Adapter.ts");
  const { runLegacyImportPreviewPipeline } =
    await import("../src/routes/admin/legacyImportPreviewPipeline.ts");
  const { bucket, calls } = bucketFixture();
  const adapter = legacyImportR2Adapter(bucket);
  const formData = new FormData();
  formData.set("strategy", "create_only");
  const response = await runLegacyImportPreviewPipeline({
    formData,
    files: [{
      name: "events.csv",
      size: 45,
      text: async () => "eventid,eventname\nexample-event,Example\n",
    }],
    authUserId: "owner-a",
    preflight: async (plan) => {
      assert.equal(plan.events.length, 1);
      assert.equal(plan.events[0].id, "example-event");
      return { existingEventIds: [], existingVideoIds: [] };
    },
    createPreview: adapter.createPreview,
    mapStoreError: adapter.mapStoreError,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.match(response.body.preview_token, /^[a-f0-9]{32}$/);
  assert.match(response.body.plan_hash, /^[a-f0-9]{64}$/);
  assert.equal(response.body.preview.events[0].id, "example-event");
  const claim = await adapter.claimPreview({
    authUserId: "owner-a",
    previewToken: response.body.preview_token,
    planHash: response.body.plan_hash,
  });
  assert.equal(claim.plan.events[0].id, "example-event");
  assert.equal(claim.progress.stage, "system_user");
  assert.equal(claim.attempt, 1);
  await claim.release();
  assert.ok(calls.filter(([method]) => method === "put").length >= 3,
    "R2 create, claim and release must be separate conditional steps");
});


test("RH-002 Hono apply pipeline: actual R2 owner claim and monotonic ETag advance after one injected D1 step", async () => {
  const { legacyImportR2Adapter } = await import("../src/routes/admin/legacyImportR2Adapter.ts");
  const { runLegacyImportApplyPipeline } =
    await import("../src/routes/admin/legacyImportApplyPipeline.ts");
  const { bucket, records, calls } = bucketFixture();
  const adapter = legacyImportR2Adapter(bucket);
  const input = previewInput();
  const credential = await adapter.createPreview(input);
  const formData = new FormData();
  formData.set("preview_token", credential.previewToken);
  formData.set("plan_hash", credential.planHash);
  let atomicD1Steps = 0;
  const response = await runLegacyImportApplyPipeline({
    formData,
    authUserId: input.authUserId,
    claimPreview: adapter.claimPreview,
    mapPreviewError: adapter.mapPreviewError,
    isTransientApplyFailure: () => false,
    applyStep: async ({ progress, actorAuthUserId }) => {
      atomicD1Steps++;
      assert.equal(actorAuthUserId, "owner-a");
      assert.equal(progress.stage, "system_user");
      return {
        complete: false,
        progress: { ...progress, stage: "x_users", index: 0 },
      };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.continuation_required, true);
  assert.equal(response.body.progress.stage, "x_users");
  assert.equal(response.body.progress.completed, 1);
  assert.equal(atomicD1Steps, 1, "one HTTP request commits only one D1 step");
  assert.equal(JSON.parse([...records.values()][0].data).status, "ready");
  assert.ok(calls.filter(([method]) => method === "put").length >= 3);
  assert.equal(calls.filter(([method, , conditional]) =>
    method === "put" && conditional !== null).length, 2,
    "claim and advance both require distinct R2 ETag CAS writes");
});


test("RH-002 Hono R2 adapter: transient storage/claim failures preserve CURRENT 503 retryability", async () => {
  const { legacyImportR2Adapter } = await import("../src/routes/admin/legacyImportR2Adapter.ts");
  const adapter = legacyImportR2Adapter(bucketFixture().bucket);
  for (const method of ["mapStoreError", "mapPreviewError"]) {
    const outcome = adapter[method](new Error("SQLITE_BUSY: database is locked"));
    assert.equal(outcome.status, 503, method);
    assert.equal(outcome.body.retryable, true, method);
    assert.equal(outcome.body.requires_repreview, false, method);
    const permanent = adapter[method](new Error("invalid record"));
    assert.equal(permanent.status, 409);
    assert.equal(permanent.body.retryable, false);
    assert.equal(permanent.body.requires_repreview, true);
  }
});

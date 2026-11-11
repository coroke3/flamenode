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

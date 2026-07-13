import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreviewToken,
  verifyPreviewToken,
} from "./previewToken.ts";

const secret = "test-preview-secret-that-is-long-enough-for-hmac";
const payload = {
  batchId: "lib_1",
  nonce: "lip_1",
  fileHash: "file-hash",
  planHash: "plan-hash",
  strategy: "skip_existing",
  importMode: "archive",
  enqueueStaticRebuild: true,
  userId: "user_1",
  anchorNow: 1_700_000_000,
  expiresAt: 1_700_000_900,
};

test("legacy import preview token is HMAC signed and round-trips its claims", async () => {
  const token = await buildPreviewToken(payload, secret);
  const claims = await verifyPreviewToken(token, secret);
  assert.ok(claims);
  assert.equal(claims.batchId, payload.batchId);
  assert.equal(claims.planHash, payload.planHash);
  assert.equal(claims.enqueueStaticRebuild, true);
  assert.equal(claims.anchorNow, payload.anchorNow);
});

test("legacy import preview token binds expiry, anchor, file hash, and plan hash", async () => {
  const token = await buildPreviewToken(payload, secret);
  const claims = await verifyPreviewToken(token, secret);
  assert.deepEqual(
    {
      expiresAt: claims?.expiresAt,
      anchorNow: claims?.anchorNow,
      fileHash: claims?.fileHash,
      planHash: claims?.planHash,
    },
    {
      expiresAt: payload.expiresAt,
      anchorNow: payload.anchorNow,
      fileHash: payload.fileHash,
      planHash: payload.planHash,
    },
  );
});

test("legacy import preview token rejects a changed payload or signing secret", async () => {
  const token = await buildPreviewToken(payload, secret);
  const [claims, signature] = token.split(".");
  assert.equal(await verifyPreviewToken(`${claims}x.${signature}`, secret), null);
  assert.equal(await verifyPreviewToken(token, `${secret}-other`), null);
});

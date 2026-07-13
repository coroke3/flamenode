import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpreadsheetImportPreviewBinding,
  issueSpreadsheetImportPreviewToken,
  requireSpreadsheetImportPreviewSecret,
  verifySpreadsheetImportPreviewToken,
} from "./importPreviewToken.ts";

const secret = "spreadsheet-preview-test-secret-32-bytes-minimum";
const now = 1_700_000_000;

async function binding(overrides = {}) {
  return buildSpreadsheetImportPreviewBinding({
    operatorUserId: "user-1",
    table: "events",
    mode: "upsert",
    columns: ["id", "title"],
    primaryKeys: ["id"],
    schemaColumns: [
      { name: "id", type: "TEXT", notNull: true, pk: 1 },
      { name: "title", type: "TEXT", notNull: true, pk: 0 },
    ],
    rows: [{ id: "event-1", title: "Event 1" }],
    ...overrides,
  });
}

test("spreadsheet preview is versioned HMAC and round-trips bound claims", async () => {
  const expected = await binding();
  const issued = await issueSpreadsheetImportPreviewToken(expected, secret, { now });
  assert.match(issued.token, /^fn-spreadsheet-preview\.v1\./);
  assert.match(issued.claims.nonce, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(
    await verifySpreadsheetImportPreviewToken(issued.token, secret, expected, { now }),
    issued.claims,
  );
});

test("spreadsheet preview fails closed without a dedicated strong secret", () => {
  assert.throws(() => requireSpreadsheetImportPreviewSecret(undefined), /preview_unavailable/);
  assert.throws(() => requireSpreadsheetImportPreviewSecret("short"), /preview_unavailable/);
  assert.equal(requireSpreadsheetImportPreviewSecret(secret), secret);
});

test("spreadsheet preview rejects tampering, another secret and expiry", async () => {
  const expected = await binding();
  const issued = await issueSpreadsheetImportPreviewToken(expected, secret, { now });
  const parts = issued.token.split(".");
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]}x.${parts[3]}`;
  assert.equal(await verifySpreadsheetImportPreviewToken(tampered, secret, expected, { now }), null);
  assert.equal(
    await verifySpreadsheetImportPreviewToken(issued.token, `${secret}-other`, expected, { now }),
    null,
  );
  assert.equal(
    await verifySpreadsheetImportPreviewToken(issued.token, secret, expected, { now: issued.claims.expiresAt }),
    null,
  );
});

test("spreadsheet preview binds operator, table, mode, payload and schema", async () => {
  const expected = await binding();
  const issued = await issueSpreadsheetImportPreviewToken(expected, secret, { now });
  for (const changed of [
    await binding({ operatorUserId: "user-2" }),
    await binding({ table: "videos" }),
    await binding({ mode: "insert" }),
    await binding({ rows: [{ id: "event-1", title: "Changed" }] }),
    await binding({ schemaColumns: [{ name: "id", type: "TEXT", notNull: true, pk: 1 }] }),
  ]) {
    assert.equal(
      await verifySpreadsheetImportPreviewToken(issued.token, secret, changed, { now }),
      null,
    );
  }
});

test("canonical payload hash is stable across row object key order", async () => {
  const a = await binding();
  const b = await binding({ rows: [{ title: "Event 1", id: "event-1" }] });
  assert.equal(a.payloadHash, b.payloadHash);
  assert.equal(a.schemaFingerprint, b.schemaFingerprint);
});

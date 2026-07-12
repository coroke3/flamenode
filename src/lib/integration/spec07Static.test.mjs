import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

test("legacy dry-run keeps the preview row cap and source hash bindings", () => {
  const dryRun = fs.readFileSync(path.join(root, "src/lib/import/legacy/dryRun.ts"), "utf8");
  const route = fs.readFileSync(path.join(root, "app/api/admin/import/legacy/route.ts"), "utf8");
  assert.match(dryRun, /previewRows\.length\s*<\s*MAX_PREVIEW_ROWS/);
  assert.match(route, /claims\.fileHash\s*!==\s*fileHash/);
  assert.match(route, /claims\.planHash\s*!==\s*planHash/);
  assert.match(route, /claims\.expiresAt\s*<\s*now/);
});

test("deprecated identifiers remain covered by the legacy static checker", () => {
  const checker = fs.readFileSync(path.join(root, "scripts/check-db-legacy.mjs"), "utf8");
  const identifiers = [
    "api" + "Endpoints",
    "api_" + "endpoints",
    "syncLegacy" + "EventVisibilityFlags",
    "@/lib/" + "legacy",
  ];
  for (const identifier of identifiers) {
    assert.match(checker, new RegExp(identifier.replace(/[\\/]/g, "\\$&")));
  }
});

test("audit restore source contains payload, stale-snapshot, and atomic failure guards", () => {
  const capability = fs.readFileSync(path.join(root, "src/lib/audit/capability.ts"), "utf8");
  const restore = fs.readFileSync(path.join(root, "src/lib/audit/restore.ts"), "utf8");
  const mutate = fs.readFileSync(path.join(root, "src/lib/audit/mutate.ts"), "utf8");
  assert.match(capability, /payloadExceeded/);
  assert.match(capability, /snapshotRedacted/);
  assert.match(restore, /computeChangedKeys\(after, current\)/);
  assert.match(mutate, /changes\(\) =/);
  assert.match(mutate, /json_extract\('not-valid-json'/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Unmounted U01 source contract; runtime React rendering is covered during
// subsequent Ops router integration once admin-only data gates are available.
const source = readFileSync(new URL("../src/routes/admin/AdminSpreadsheetDisabled.tsx", import.meta.url), "utf8");
test("disabled view preserves the CURRENT flag and restart instructions", () => {
  assert.match(source, /ADMIN_SPREADSHEET_ENABLED=true/);
  assert.match(source, /ADMIN_SPREADSHEET_ENABLED="true"/);
  assert.match(source, /\.dev\.vars/);
  assert.match(source, /npm run dev/);
  assert.match(source, /aria-labelledby/);
});
test("disabled view does not handle feature flags or attempt API writes", () => {
  assert.doesNotMatch(source, /fetch\s*\(|localStorage|process\.env|import\.meta\.env/);
});

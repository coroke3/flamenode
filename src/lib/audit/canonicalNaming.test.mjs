import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ACTIVE_AUDIT_SURFACES = [
  "app/(admin)/admin/health/integrity/page.tsx",
  "app/(admin)/admin/spreadsheet/page.tsx",
  "app/(admin)/admin/x-link-requests/page.tsx",
  "app/(manage)/manage/events/[id]/page.tsx",
  "docs/audit-restore-design.md",
  "docs/merge-flow-design.md",
  "LOCAL.md",
];

test("active audit surfaces use the audit_logs canonical name", async () => {
  for (const file of ACTIVE_AUDIT_SURFACES) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\bhistory_logs\b/, file);
    assert.match(source, /\baudit_logs\b/, file);
  }
});

test("X link request UI labels its internal user_id without calling it a Discord ID", async () => {
  const source = await readFile(
    "app/(admin)/admin/x-link-requests/page.tsx",
    "utf8",
  );

  assert.match(source, /<th>申請者ユーザー ID<\/th>/);
  assert.doesNotMatch(source, /<th>申請者 Discord<\/th>/);
});

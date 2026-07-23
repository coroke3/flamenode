import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(
  new URL("../../../app/(public)/user/[id]/page.tsx", import.meta.url),
  "utf8",
);

test("user profile page records public request metrics on static path", () => {
  assert.match(page, /runWithPublicRequestMetrics/);
  assert.match(page, /logPublicRequestMetrics/);
  assert.match(page, /recordPublicD1Fallback/);
  assert.match(page, /loadStaticUserWorksPage/);
  assert.match(page, /loadStaticUserCollabsPage/);
});

test("user profile DB fallback only loads listable X users", () => {
  assert.match(page, /publicListableXApprovalWhere/);
  assert.equal(
    (page.match(/publicListableXApprovalWhere\(\)/g) ?? []).length,
    2,
  );
});

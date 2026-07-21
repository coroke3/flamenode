import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(
  new URL("../../../app/(public)/user/[id]/page.tsx", import.meta.url),
  "utf8",
);

test("user profile DB fallback only loads listable X users", () => {
  assert.match(page, /publicListableXApprovalWhere/);
  assert.equal(
    (page.match(/publicListableXApprovalWhere\(\)/g) ?? []).length,
    2,
  );
});

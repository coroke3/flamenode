import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(
  new URL("../../../app/(public)/user/[id]/page.tsx", import.meta.url),
  "utf8",
);

test("user profile page records public request metrics on static path", () => {
  assert.doesNotMatch(page, /runWithPublicRequestMetrics/);
  assert.match(page, /logPublicRequestMetrics/);
  assert.match(page, /loadStaticUserWorksPage/);
  assert.match(page, /loadStaticUserCollabsPage/);
});

test("user profile returns notFound when paged static JSON is missing", () => {
  assert.match(page, /missingPagedSection/);
  assert.match(page, /beyondStaticPages/);
  assert.match(page, /STATIC_USER_MAX_PAGES/);
});

test("user profile metadata avoids full D1 when static is unavailable", () => {
  assert.match(page, /loadStaticUserProfile/);
  assert.doesNotMatch(page, /withDatabase/);
});

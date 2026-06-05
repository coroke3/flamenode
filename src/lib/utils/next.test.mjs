import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSafeRelativePath,
  sanitizeNextPath,
} from "./next.ts";

test("isSafeRelativePath accepts normal app paths", () => {
  assert.equal(isSafeRelativePath("/dashboard/post?slot=abc"), true);
  assert.equal(isSafeRelativePath("/event/pvsf2025s/slots"), true);
});

test("isSafeRelativePath rejects open-redirect patterns", () => {
  assert.equal(isSafeRelativePath("//evil.example"), false);
  assert.equal(isSafeRelativePath("https://evil.example"), false);
  assert.equal(isSafeRelativePath("/\\evil"), false);
  assert.equal(isSafeRelativePath("/foo://bar"), false);
  assert.equal(isSafeRelativePath("/path\ninjection"), false);
});

test("sanitizeNextPath falls back for unsafe values", () => {
  assert.equal(sanitizeNextPath(null, "/dashboard"), "/dashboard");
  assert.equal(sanitizeNextPath("//evil", "/"), "/");
  assert.equal(
    sanitizeNextPath("/dashboard/post", "/dashboard"),
    "/dashboard/post",
  );
});

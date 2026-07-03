import test from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyImportPreviewStatus } from "./importPreviewStatus.ts";

test("resolveLegacyImportPreviewStatus creates new rows regardless of strategy", () => {
  assert.equal(resolveLegacyImportPreviewStatus(false, "skip"), "create");
  assert.equal(resolveLegacyImportPreviewStatus(false, "update"), "create");
  assert.equal(resolveLegacyImportPreviewStatus(false, "merge"), "create");
});

test("resolveLegacyImportPreviewStatus follows conflict strategy for existing rows", () => {
  assert.equal(resolveLegacyImportPreviewStatus(true, "skip"), "skip");
  assert.equal(resolveLegacyImportPreviewStatus(true, "update"), "update");
  assert.equal(resolveLegacyImportPreviewStatus(true, "merge"), "merge");
});

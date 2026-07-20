import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPublicVideoDirect,
  isPublicVideoListable,
  normalizePublicEventVisibility,
} from "./visibility.ts";

test("FlameNode public visibility accepts public only", () => {
  assert.equal(isPublicVideoListable("public"), true);
  assert.equal(isPublicVideoDirect("public"), true);
  assert.equal(isPublicVideoDirect("limited"), false);
  assert.equal(isPublicVideoDirect("private"), false);
});

test("event public data accepts public only", () => {
  assert.equal(normalizePublicEventVisibility("public"), "public");
  assert.equal(normalizePublicEventVisibility("archived"), null);
  assert.equal(normalizePublicEventVisibility("draft"), null);
  assert.equal(normalizePublicEventVisibility("private"), null);
});

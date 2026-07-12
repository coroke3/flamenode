import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPublicVideoDirect,
  isPublicVideoListable,
  normalizePublicEventVisibility,
} from "./visibility.ts";

test("public visibility keeps list and direct scopes distinct", () => {
  assert.equal(isPublicVideoListable("public"), true);
  assert.equal(isPublicVideoListable("limited"), false);
  assert.equal(isPublicVideoDirect("limited"), true);
  assert.equal(isPublicVideoDirect("private"), false);
});

test("public event visibility rejects unlisted states", () => {
  assert.equal(normalizePublicEventVisibility("public"), "public");
  assert.equal(normalizePublicEventVisibility("archived"), "archived");
  assert.equal(normalizePublicEventVisibility("private"), null);
});

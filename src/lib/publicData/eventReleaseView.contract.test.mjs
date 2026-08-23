import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../../app/(public)/event/[id]/release/ReleaseView.tsx", import.meta.url),
  "utf8",
);

test("Release view keeps list/grid/creator modes synchronized with the URL hash", () => {
  assert.match(source, /type ViewMode = "list" \| "grid" \| "creator"/);
  assert.match(source, /window\.location\.hash/);
  assert.match(source, /window\.history\.replaceState/);
  assert.match(source, /value === "list"/);
  assert.match(source, /value === "grid"/);
  assert.match(source, /"クリエイター"/);
});

test("Release view exposes the public creator and member fields without private DTOs", () => {
  assert.match(source, /creator_x_user_id/);
  assert.match(source, /members\.map/);
  assert.match(source, /member\.role/);
  assert.match(source, /member\.comment/);
  assert.doesNotMatch(source, /submitted_by_user_id|auth_user_id|can_edit/);
});

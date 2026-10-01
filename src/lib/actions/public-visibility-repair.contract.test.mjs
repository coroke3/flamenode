import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./public-visibility-repair.ts", import.meta.url),
  "utf8",
);

test("dangling visibility repair is admin-only and refuses only a live or token-mismatched D1 fence", () => {
  assert.match(source, /requireAdminWrite\("admin_static_rebuild"\)/);
  assert.match(source, /currentFence\.state !== "released"/);
  assert.match(source, /currentFence\.fence_token !== target\.fenceToken/);
  assert.match(source, /releaseBlockedEntityInManifest/);
  assert.match(source, /mutateOnConflict/);
  assert.match(source, /public_visibility_repair_token_conflict/);
  assert.match(source, /released_dangling_manifest_entry/);
});

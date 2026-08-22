import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./submitSlotVideo.ts", import.meta.url),
  "utf8",
);

test("slot投稿はwriteGuardのrequest-local D1を再利用する", () => {
  assert.match(source, /const db = guard\.db/);
  assert.doesNotMatch(source, /const db = getDatabase\(\)/);
});

test("slot投稿のpreflight例外はServer Action結果へ収束する", () => {
  assert.match(
    source,
    /export async function submitSlotVideo\([\s\S]*?try\s*\{[\s\S]*?submitSlotVideoCore\(formData\)[\s\S]*?catch \(error\)[\s\S]*?SLOT_SUBMIT_UNEXPECTED_ERROR_MESSAGE/,
  );
});

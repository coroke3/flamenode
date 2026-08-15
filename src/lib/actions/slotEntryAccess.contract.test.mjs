import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readPage = (path) =>
  readFile(new URL(`../../../app/(auth)/${path}`, import.meta.url), "utf8");

test("auth slot pages always scope active-X rows to the reservation owner", async () => {
  const pages = [
    ["entry/slotted/page.tsx", "user.id", "slotOwnerWhere"],
    ["entry/page.tsx", "sessionUser.id", "ownerWhere"],
    ["dashboard/page.tsx", "user.id", "slotOwnerWhere"],
  ];
  for (const [path, ownerId, variable] of pages) {
    const source = await readPage(path);
    const ownerWhere =
      source.match(new RegExp(`const ${variable} = [\\s\\S]*?;\\s*\\n`))?.[0] ??
      "";
    assert.ok(ownerWhere.length > 0, `${path}: owner predicate should be present`);
    const activeBranch = ownerWhere.match(/\? and\(([\s\S]*?)\)!\s*:\s*[^;]+;/)?.[1] ?? "";
    assert.match(activeBranch, new RegExp(`eq\\(slotsTable\\.reserved_by_user_id, ${ownerId}\\)`));
    assert.match(activeBranch, /eq\(slotsTable\.x_user_id, (?:activeXId|activeX)\)/);
    assert.match(activeBranch, /isNull\(slotsTable\.x_user_id\)/);
  }
});

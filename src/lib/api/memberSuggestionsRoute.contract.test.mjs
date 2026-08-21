import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const routeSource = await readFile(
  new URL("../../../app/api/internal/x-users/search/route.ts", import.meta.url),
  "utf8",
);

test("候補検索APIは既存のid/x_name DTOを維持する", () => {
  assert.match(routeSource, /items:\s*result\.items\.map\(\(item\)\s*=>/);
  assert.match(routeSource, /id:\s*item\.x_user_id/);
  assert.match(routeSource, /x_name:\s*item\.name/);
  assert.doesNotMatch(routeSource, /items:\s*result\.items\s*,/);
});

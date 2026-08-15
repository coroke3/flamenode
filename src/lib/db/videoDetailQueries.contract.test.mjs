import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

test("related-video member lookup stays below D1 bind limits", () => {
  const source = read("src/lib/db/videoDetailQueries.ts");
  assert.match(source, /uniqueMemberXIds\.length <= 80/);
  assert.match(source, /sharedMemberIdsWhere/);
  assert.match(source, /FROM json_each\(\$\{JSON\.stringify\(uniqueMemberXIds\)\}/);
  assert.match(source, /CAST\(related_member_x_ids\.value AS TEXT\) = LOWER/);
});

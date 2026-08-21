import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL(
  "../../../app/(admin)/admin/youtube-sync/page.tsx",
  import.meta.url,
);

test("YouTube同期一覧は未使用の x_users JOIN を持たない", async () => {
  const source = await readFile(pageUrl, "utf8");

  assert.doesNotMatch(source, /xUsersTable/);
  assert.doesNotMatch(source, /leftJoin\(\s*xUsers/i);
  assert.match(source, /leftJoin\(\s*videoYoutubeMetadata/);
  assert.match(source, /COALESCE\(\$\{videoYoutubeMetadata\.updated_at\}/);
  assert.match(source, /\.limit\(LIMIT \+ 1\)/);
});

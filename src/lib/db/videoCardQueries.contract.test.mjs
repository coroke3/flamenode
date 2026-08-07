import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const queries = await readFile(new URL("./queries.ts", import.meta.url), "utf8");
const listQueries = await readFile(new URL("./listQueries.ts", import.meta.url), "utf8");
const videoDetailQueries = await readFile(
  new URL("./videoDetailQueries.ts", import.meta.url),
  "utf8",
);

function assertNoCreatorXUsersJoin(source, label) {
  assert.doesNotMatch(
    source,
    /\.leftJoin\(xUsers,\s*eq\(xUsers\.id,\s*videos\.creator_x_user_id\)\)/,
    `${label} must not join x_users for video cards`,
  );
}

test("公開作品一覧クエリは creator 表示に x_users を JOIN しない", () => {
  assert.match(queries, /creatorNameExpr/);
  assert.match(queries, /creatorIconExpr/);
  assertNoCreatorXUsersJoin(queries, "queries.ts");
  assertNoCreatorXUsersJoin(listQueries, "listQueries.ts");
});

test("関連動画・再生リストは videos.creator_* のみを使う", () => {
  assert.match(videoDetailQueries, /storedCreatorNameExpr/);
  assert.match(videoDetailQueries, /videos\.creator_icon_url/);
  assertNoCreatorXUsersJoin(videoDetailQueries, "videoDetailQueries.ts");
  assert.match(videoDetailQueries, /videoMembers\.x_user_id/);
});

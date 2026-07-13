import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./listQueries.ts", import.meta.url), "utf8");
const route = await readFile(
  new URL("../../../app/api/videos/route.ts", import.meta.url),
  "utf8",
);

test("公開作品ページ取得はCOUNT OVERで総件数を同時取得する", () => {
  assert.match(source, /total_count:\s*sql<number>`COUNT\(\*\) OVER\(\)`/);
  assert.match(source, /export async function fetchPublicVideosPage/);
});

test("範囲外ページだけ総件数クエリへフォールバックする", () => {
  assert.match(
    source,
    /pageRows\.length > 0[\s\S]*offset > 0[\s\S]*countPublicVideos/,
  );
});

test("公開作品APIは一覧と総件数を別々にPromise.allしない", () => {
  assert.match(route, /fetchPublicVideosPage/);
  assert.doesNotMatch(route, /countPublicVideos/);
  assert.doesNotMatch(route, /Promise\.all/);
});

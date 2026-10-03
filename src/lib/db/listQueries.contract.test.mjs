import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./listQueries.ts", import.meta.url), "utf8");
const route = await readFile(
  new URL("../../../app/api/videos/route.ts", import.meta.url),
  "utf8",
);

test("listQueries は単体取得とsort正規化だけを公開し、全件走査クエリを持たない", () => {
  assert.match(source, /export async function fetchPublicVideoByIdOrYoutube/);
  assert.match(source, /export function parsePublicVideoSort/);
  assert.doesNotMatch(
    source,
    /fetchPublicVideosPage|fetchPublicVideos\b|countPublicVideos/,
  );
  assert.doesNotMatch(source, /COUNT\(\*\) OVER|LIKE/);
});

test("公開作品一覧APIはD1を読まずR2静的ローダー4種だけを使う", () => {
  assert.doesNotMatch(
    route,
    /withDatabaseRead|getDatabase|fetchPublicVideosPage|countPublicVideos/,
  );
  assert.doesNotMatch(route, /@\/lib\/cloudflare|drizzle-orm|db\/schema/);
  for (const loader of [
    "loadPublicEventVideosPage",
    "loadStaticSearchVideosPage",
    "loadStaticPopularVideosPage",
    "loadStaticRecentVideosPage",
  ]) {
    assert.match(route, new RegExp(loader));
  }
  assert.doesNotMatch(route, /Promise\.all/);
});

test("公開作品一覧APIは既存のpayload形・Cache-Control・上限を維持する", () => {
  assert.match(route, /PUBLIC_VIDEO_KEYS/);
  assert.match(route, /status: "public" as const/);
  assert.match(route, /\{ items, total: listPage\.total, page, limit \}/);
  assert.match(route, /assertNoForbiddenKeys\(payload\)/);
  assert.match(
    route,
    /"public, max-age=30, s-maxage=60, stale-while-revalidate=120"/,
  );
  assert.match(route, /checkPublicApiRateLimit\(req, "\/api\/videos"\)/);
  assert.match(route, /MAX_PUBLIC_LIST_LIMIT/);
  assert.match(route, /MAX_SEARCH_LENGTH = 100/);
  assert.match(route, /MAX_PROJECTED_ITEMS = 5_000/);
  assert.match(route, /Math\.ceil\(MAX_PROJECTED_ITEMS \/ limit\)/);
});

test("公開作品一覧APIは投影欠損時に503を返し、空配列200にしない", () => {
  assert.match(
    route,
    /if \(!listPage\) \{\s*return publicServiceUnavailableResponse\("static_list_unavailable"\);/,
  );
  assert.match(
    route,
    /catch \(error\)[\s\S]*?publicServiceUnavailableResponse\("database_unavailable"\)/,
  );
});

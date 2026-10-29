// MIG-0510: CURRENT query keys, RH-032 transport/DTO and JS-off SSG parity.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  LIST_EVENT_UNAVAILABLE_MESSAGE, LIST_NO_RESULTS_MESSAGE, LIST_SHORT_SEARCH_MESSAGE,
  LIST_UNAVAILABLE_MESSAGE, decodePublicList, isDefaultListQuery,
  listHref, listQueryFromSearch, publicListApiPath,
} from "../apps/site/src/lib/listFilterCore.ts";
import { fetchPublicJson } from "../apps/site/src/lib/publicApi.ts";
import { LIST_PAGE_SIZE } from "../apps/site/src/lib/listQuery.ts";

const dto = (id = "test") => ({
  id, title: "公開作品", youtube_video_id: "AAAAAAAAAAA", display_name: "作者",
  icon_url: null, primary_event_id: null, scheduled_time: 1790000000, status: "public",
});
const okPage = (query, items = [dto()]) => ({ items, total: items.length, page: query.page, limit: LIST_PAGE_SIZE });

test("T01: CURRENT q/sort/event/view/page keys normalize and URL deep links roundtrip", () => {
  const q = listQueryFromSearch("?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123&page=2&view=index");
  assert.deepEqual({ q: q.q, sort: q.sort, event: q.event, page: q.page, view: q.view },
    { q: "テスト", sort: "score", event: "e123", page: 2, view: "index" });
  assert.equal(publicListApiPath(q), "/api/videos?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123&page=2&limit=24");
  assert.equal(listHref(q), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123&view=index&page=2");
  assert.equal(listHref(q, { q: "", page: "1" }), "/list?sort=score&event=e123&view=index");
  assert.equal(listHref(q, { sort: "new", page: "1" }), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&event=e123&view=index");
  assert.equal(listHref(q, { event: "", page: "1" }), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&view=index");
  assert.equal(listHref(q, { view: "grid", page: "1" }), "/list?q=%E3%83%86%E3%82%B9%E3%83%88&sort=score&event=e123");
  assert.equal(listQueryFromSearch(listHref(q).slice(5)).page, 2);
  assert.equal(isDefaultListQuery(listQueryFromSearch("")), true);
  assert.equal(isDefaultListQuery(q), false);
  assert.equal(listQueryFromSearch("?page=9999999999999999999").page, Math.ceil(5000 / 24));
  assert.equal(listQueryFromSearch("?page=9999").page, Math.ceil(5000 / 24));
  assert.equal(listQueryFromSearch("?sort=unknown&view=other").sort, "new");
  assert.equal(listQueryFromSearch("?sort=unknown&view=other").view, "grid");
});

test("T01: RH-032 DTO projection is public-only and preserves pagination", () => {
  const query = listQueryFromSearch("?q=abcd&sort=old&page=2&view=compact");
  const r = decodePublicList({ ...okPage(query), total: 52 }, query);
  assert.ok(r);
  assert.equal(r.page, 2);
  assert.equal(r.totalPages, 3);
  assert.equal(r.videos[0].href, "/AAAAAAAAAAA");
  assert.equal(r.videos[0].creatorName, "作者");
  assert.match(r.videos[0].thumbnailUrl, /^\/api\/youtube-thumbnail\//);
  assert.equal(decodePublicList(okPage(query, []), query)?.videos.length, 0);
  assert.equal(LIST_NO_RESULTS_MESSAGE, "条件に合う作品が見つかりませんでした。条件を変えてお試しください。");
  assert.equal(LIST_SHORT_SEARCH_MESSAGE, "検索は文字・数字を2文字以上入力してください。");
});

test("T03: malformed or nonpublic DTO cannot replace static default fallback", () => {
  const query = listQueryFromSearch("?q=abcd");
  for (const invalid of [
    { ...okPage(query), items: [dto("a"), { ...dto("private"), status: "private" }] },
    { ...okPage(query), items: [dto("a"), { ...dto("voided"), status: "voided" }] },
    { ...okPage(query), items: [dto("a"), { ...dto("m"), id: 42 }] },
    { ...okPage(query), page: 3 },
    { ...okPage(query), limit: 48 },
    { ...okPage(query), total: -1 },
    { ...okPage(query), items: Array.from({ length: 25 }, (_, i) => dto(String(i))) },
  ]) {
    assert.equal(decodePublicList(invalid, query), null);
  }
  assert.equal(LIST_UNAVAILABLE_MESSAGE, "作品一覧を一時的に表示できません。");
  assert.equal(LIST_EVENT_UNAVAILABLE_MESSAGE, "このイベントの作品一覧を一時的に表示できません。");
  assert.equal(listQueryFromSearch("?q=%E3%81%82").searchTooShort, true);
});

test("T03: public JSON transport uses same-origin/no-store; 503, bad JSON or network errors fail closed", async () => {
  let args;
  const fetcher = async (url, init) => {
    args = { url, init };
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  assert.deepEqual(await fetchPublicJson("/api/videos?limit=24", {}, fetcher),
    { ok: true, status: 200, data: { items: [] } });
  assert.equal(args.url, "/api/videos?limit=24");
  assert.equal(args.init.credentials, "same-origin");
  assert.equal(args.init.cache, "no-store");
  assert.equal(args.init.headers.get("Accept"), "application/json");
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => new Response("down", { status: 503 })),
    { ok: false, status: 503 });
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })),
    { ok: false, status: 0 });
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => new Response("invalid", { status: 200, headers: { "Content-Type": "application/json" } })),
    { ok: false, status: 0 });
  assert.deepEqual(await fetchPublicJson("/api/videos", {}, async () => { throw new Error("offline"); }),
    { ok: false, status: 0 });
  assert.deepEqual(await fetchPublicJson("https://evil.example/steal", {}, fetcher),
    { ok: false, status: 0 });
});

test("T02/T04: top GET search works without JS; /list static fallback keeps legal controls absent", () => {
  const topPath = "apps/site/dist/index.html", listPath = "apps/site/dist/list/index.html";
  const source = fs.readFileSync("packages/ui/src/screens/TopView.tsx", "utf8");
  assert.match(source, /method="get" action="\/list" role="search"/);
  assert.match(source, /name="q"/);
  const page = fs.readFileSync("apps/site/src/pages/list.astro", "utf8");
  assert.match(page, /id="list-static-fallback"/);
  assert.match(page, /id="list-filter-mount"/);
  assert.match(page, /mountListFilters\(\)/);
  if (!fs.existsSync(topPath) || !fs.existsSync(listPath)) {
    if (process.env.REQUIRE_BUILT) throw new Error("Built / and /list required");
    return;
  }
  const home = new JSDOM(fs.readFileSync(topPath, "utf8")).window.document;
  const form = home.querySelector('form[method="get"][action="/list"] input[name="q"]');
  assert.ok(form, "real GET search input in static home");
  assert.equal(form.getAttribute("maxlength"), "100");
  assert.ok(form.closest("form").querySelector('button[type="submit"]'));
  const listing = new JSDOM(fs.readFileSync(listPath, "utf8")).window.document;
  assert.ok(listing.querySelector("#list-static-fallback main"));
  assert.equal(listing.querySelector("#list-static-fallback button"), null);
  assert.equal(listing.querySelector("#list-filter-mount button"), null);
});

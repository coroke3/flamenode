// MIG-0504 characterization: built /user, /user/[id], /user/[id]/portfolio HTML and the build-time user data
// against CURRENT (texts, links, head, Person JSON-LD, paging, private/banned handling, query keys).
// Run `npm run build -w @flamenode/ui && npm run build -w @flamenode/site` first (the HTML tests read apps/site/dist).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

const DOM_URL = "https://flamenode.net/user/long_list";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: DOM_URL, pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "location"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { act } = React;
const h = React.createElement;
const { loadUserBuildDataFrom, fixturePayloadSource, snapshotPayloadSource, userPayloadSourceFromEnv } = await import("../apps/site/src/lib/userData.ts");
const views = await import("../apps/site/src/lib/userViews.ts");
const { buildPageHead, compactText } = await import("../apps/site/src/lib/pageHead.ts");
// test:unit runs before the ui build, so the Islands (which import @flamenode/ui) load only when packages/ui/dist exists;
// the CI REQUIRE_BUILT step fails instead of skipping.
const uiBuilt = fs.existsSync(path.resolve("packages/ui/dist/index.js"));
const skipUi = uiBuilt ? false : "packages/ui/dist missing: build @flamenode/ui first";
const { CreatorProfileIsland } = uiBuilt ? await import("../apps/site/src/components/CreatorProfileIsland.ts") : {};
const { UsersIndexIsland } = uiBuilt ? await import("../apps/site/src/components/UsersIndexIsland.ts") : {};
const { SnapshotBuildError } = await import("../apps/site/src/lib/publicDataLoader.ts");
const { parseSocialLinks } = await import("../src/lib/socialLinks.ts");
const { clampPaging, totalPagesFor } = await import("../src/lib/utils/sql.ts");
const { prepareUsersIndexItems, paginateUsersIndexItems } = await import("../src/lib/publicData/staticUsersIndexCore.ts");
const { FIXTURE_USER_PROFILES, FIXTURE_USERS_INDEX } = await import("../apps/site/src/lib/userFixtures.ts");

const DIST = path.resolve("apps/site/dist");
const built = fs.existsSync(path.join(DIST, "user/index.html")) && fs.existsSync(path.join(DIST, "user/miku_producer/index.html"));
const skip = built ? false : "apps/site/dist missing: build @flamenode/site first";
if (process.env.REQUIRE_BUILT && (skip || skipUi)) throw new Error("REQUIRE_BUILT is set but " + (skip || skipUi));
const loadHtml = (file) => new JSDOM(fs.readFileSync(path.join(DIST, file), "utf-8")).window.document;
const meta = (doc, sel) => doc.querySelector(sel)?.getAttribute("content");
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const hrefs = (el) => [...el.querySelectorAll("a")].map((a) => a.getAttribute("href"));
const origin = "https://flamenode.net";

const currentIndexSource = fs.readFileSync("app/(public)/user/UserIndexView.tsx", "utf-8");
const currentProfileSource = fs.readFileSync("app/(public)/user/[id]/UserProfilePage.tsx", "utf-8");
const currentPortfolioSource = fs.readFileSync("app/(public)/user/[id]/portfolio/page.tsx", "utf-8");

test("U02 head: profile title/description/canonical/OGP equal CURRENT generateMetadata (T04)", { skip }, () => {
  const doc = loadHtml("user/miku_producer/index.html");
  assert.equal(doc.title, "初音P - クリエイター | FlameNode");
  assert.equal(meta(doc, 'meta[name="description"]'), "FlameNodeでボカロ楽曲・映像を制作しています。");
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute("href"), `${origin}/user/miku_producer`);
  assert.equal(meta(doc, 'meta[property="og:type"]'), "profile");
  assert.equal(meta(doc, 'meta[property="og:image"]'), "https://example.com/miku.png");
  assert.equal(meta(doc, 'meta[property="og:image:alt"]'), "初音P - クリエイター");
  assert.equal(doc.querySelector('meta[property="og:image:width"]'), null, "a page icon carries no size, like CURRENT");
  assert.equal(meta(doc, 'meta[name="twitter:image"]'), "https://example.com/miku.png");
  assert.equal(meta(doc, 'meta[name="robots"]'), "index, follow");
  // The literals CURRENT uses.
  assert.ok(currentProfileSource.includes("`${user.x_name} - クリエイター`"));
  assert.ok(currentProfileSource.includes("`FlameNodeで公開されている${user.x_name}の作品。`"));
  // No icon, no profile text: brand card and the CURRENT fallback description.
  const bare = loadHtml("user/minimal_user/index.html");
  assert.equal(meta(bare, 'meta[name="description"]'), "FlameNodeで公開されているminimal_userの作品。");
  assert.equal(meta(bare, 'meta[property="og:image"]'), `${origin}/brand/flamenode-social-card.png`);
  assert.equal(meta(bare, 'meta[property="og:image:width"]'), "1200");
});

test("U03 head: portfolio is noindex with CURRENT title and description", { skip }, () => {
  const doc = loadHtml("user/miku_producer/portfolio/index.html");
  assert.equal(doc.title, "初音P - Portfolio | FlameNode");
  assert.equal(meta(doc, 'meta[name="robots"]'), "noindex, nofollow");
  assert.equal(meta(doc, 'meta[name="googlebot"]'), "noindex, nofollow");
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute("href"), `${origin}/user/miku_producer/portfolio`);
  assert.equal(meta(doc, 'meta[property="og:type"]'), "website");
  assert.ok(currentPortfolioSource.includes("noIndex: true"));
  // CURRENT compactText(profile_text): the site description when the profile has no text.
  assert.equal(meta(loadHtml("user/minimal_user/portfolio/index.html"), 'meta[name="description"]'), compactText(null));
  const idx = loadHtml("user/index.html");
  assert.equal(idx.title, "クリエイターを見つける | FlameNode");
  assert.equal(meta(idx, 'meta[name="description"]'), "FlameNodeで作品を公開している映像クリエイターと参加作品を探せます。");
  assert.equal(idx.querySelector('link[rel="canonical"]').getAttribute("href"), `${origin}/user`);
});

test("U02 body: every CURRENT profile entry point is in the static HTML (texts, links, external rel)", { skip }, () => {
  const doc = loadHtml("user/miku_producer/index.html");
  assert.equal(text(doc.querySelector("h1")), "初音P");
  const main = doc.querySelector("main");
  const links = hrefs(main);
  for (const href of ["/user", "/user/miku_producer/portfolio", "https://x.com/miku_producer", "https://www.youtube.com/@miku",
    "https://miku.example.com/", "mailto:contact@example.com", "/yta10000000", "/yta20000000", "/ytc10000000"]) {
    assert.ok(links.includes(href), `missing ${href}`);
  }
  assert.ok(text(main).includes("クリエイター一覧"));
  assert.ok(text(main).includes("FlameNodeでボカロ楽曲・映像を制作しています。"));
  assert.ok(text(main).includes("contact@example.com"));
  assert.ok(text(main).includes("作品"));
  assert.ok(text(main).includes("参加作品"));
  for (const a of main.querySelectorAll('a[href^="https://"]')) {
    assert.equal(a.getAttribute("target"), "_blank");
    assert.match(a.getAttribute("rel"), /noopener/);
  }
  assert.equal(main.querySelector('a[href^="mailto:"]').getAttribute("target"), null, "mailto opens in place");
  // The header X link already is the primary X ID: the duplicate X profile link is dropped (CURRENT).
  assert.equal(links.filter((l) => l === "https://x.com/miku_producer").length, 1);
});

test("T02: private and voided works never reach the profile or portfolio HTML; banned users have no page", { skip }, () => {
  for (const file of ["user/miku_producer/index.html", "user/miku_producer/portfolio/index.html"]) {
    const html = fs.readFileSync(path.join(DIST, file), "utf-8");
    for (const secret of ["非公開の作品", "無効の作品", "a-private", "a-voided"]) assert.equal(html.includes(secret), false, `${file} leaks ${secret}`);
  }
  assert.equal(fs.existsSync(path.join(DIST, "user/suspended_user/index.html")), false);
  assert.equal(fs.existsSync(path.join(DIST, "user/suspended_user/portfolio/index.html")), false);
  const index = JSON.parse(fs.readFileSync(path.join(DIST, "user/index.json"), "utf-8"));
  assert.equal(index.some((e) => e.x_id === "suspended_user"), false, "the search index lists only creators that have a page");
});

test("T06 (G06): Person JSON-LD in the built page deep-equals CURRENT's profileJsonLd formula", { skip }, () => {
  const doc = loadHtml("user/miku_producer/index.html");
  const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent));
  const person = blocks.filter((b) => b["@type"] === "Person");
  assert.equal(person.length, 1);
  // CURRENT user/[id]/UserProfilePage.tsx: profileJsonLd, evaluated for the fixture profile.
  const user = FIXTURE_USER_PROFILES.miku_producer.user;
  const socialLinks = parseSocialLinks(user.other_social_links);
  const expected = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "初音P",
    alternateName: "@miku_producer",
    url: `${origin}/user/miku_producer`,
    image: "https://example.com/miku.png",
    description: "FlameNodeでボカロ楽曲・映像を制作しています。",
    sameAs: ["https://x.com/miku_producer", user.youtube_channel_url, ...socialLinks.map((l) => l.url)].filter((u) => Boolean(u?.startsWith("http"))),
  };
  assert.deepEqual(person[0], JSON.parse(JSON.stringify(expected)));
  for (const key of ['"@type": "Person"', "alternateName: `@${user.id}`", "sameAs: [", "description: profileDescription"]) {
    assert.ok(currentProfileSource.includes(key), `CURRENT no longer has ${key}`);
  }
  // The root WebSite/Organization graph is still emitted next to it (MIG-0501 G06).
  assert.ok(blocks.some((b) => Array.isArray(b["@graph"])));
  // minimal user: no image key (undefined in CURRENT), description fallback, only the X link.
  const bare = [...loadHtml("user/minimal_user/index.html").querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => JSON.parse(s.textContent)).find((b) => b["@type"] === "Person");
  assert.equal("image" in bare, false);
  assert.deepEqual(bare.sameAs, ["https://x.com/minimal_user"]);
  assert.equal(bare.description, "FlameNodeで公開されているminimal_userの作品とプロフィール。");
});

test("U03 body: portfolio texts and links follow CURRENT (back link, works, About/Contact, empty state)", { skip }, () => {
  const doc = loadHtml("user/miku_producer/portfolio/index.html");
  const main = doc.querySelector("main");
  assert.equal(text(main.querySelector("h1")), "初音P");
  const t = text(main);
  for (const s of ["@miku_producer の公開プロフィール", "Portfolio", "Works", "About", "Contact", "FlameNodeでボカロ楽曲・映像を制作しています。", "contact@example.com"]) {
    assert.ok(t.includes(s), `missing ${s}`);
  }
  assert.equal(main.querySelector(".metric b").textContent, "3");
  assert.equal(main.querySelector('a[aria-label="一覧へ戻る"]').getAttribute("href"), "/user");
  assert.ok(hrefs(main).includes("/user/miku_producer"));
  assert.equal(hrefs(main).filter((l) => l.startsWith("/yt")).length, 2, "public works only");
  assert.equal(t.includes("すべて見る"), false, "3 works <= WORK_LIMIT");
  // 40 works: first 36 only, with the すべて見る link back to the profile.
  const long = loadHtml("user/long_list/portfolio/index.html").querySelector("main");
  assert.equal(hrefs(long).filter((l) => l.startsWith("/yt")).length, 24, "the profile object carries artifact page 1 (24)");
  assert.ok(text(long).includes("すべて見る"));
  assert.equal(long.querySelector(".metric b").textContent, "40");
  const bare = text(loadHtml("user/minimal_user/portfolio/index.html").querySelector("main"));
  assert.ok(bare.includes("このポートフォリオには、まだプロフィール項目が登録されていません。"));
  assert.ok(bare.includes("まだ公開されている作品がありません。"));
  assert.ok(currentPortfolioSource.includes("const WORK_LIMIT = 36"));
});

test("U01 body: /user default view (title, search form, sort options, cards, counts) follows CURRENT", { skip }, () => {
  const doc = loadHtml("user/index.html");
  const main = doc.querySelector("main");
  assert.equal(text(main.querySelector("h1")), "クリエイターを見つける");
  const form = main.querySelector("form");
  assert.equal(form.getAttribute("method"), "get");
  const q = form.querySelector('input[name="q"]');
  assert.equal(q.getAttribute("placeholder"), "名前 / X ID");
  assert.deepEqual([...form.querySelectorAll("select[name=sort] option")].map((o) => [o.value, o.textContent]),
    [["score", "おすすめ順"], ["works", "作品数順"], ["name", "名前順"]]);
  assert.equal(form.querySelector("a"), null, "リセット only with a query");
  const cards = [...main.querySelectorAll(".cr-icons a")];
  assert.deepEqual(cards.map((a) => a.getAttribute("href")), ["/user/long_list", "/user/miku_producer", "/user/minimal_user"], "score order; suspended_user absent");
  assert.ok(text(cards[1]).includes("初音P") && text(cards[1]).includes("@miku_producer") && text(cards[1]).includes("4 作品") && text(cards[1]).includes("主催 3 / 参加 1"));
  assert.ok(text(main).includes("3 件"));
  for (const s of ["クリエイターを見つける", "名前 / X ID", "おすすめ順", "作品数順", "名前順", "リセット", "条件に合うクリエイターが見つかりませんでした。", "公開クリエイター一覧を一時的に表示できません。", "主催", "参加"]) {
    assert.ok(currentIndexSource.includes(s), `CURRENT no longer has ${s}`);
  }
  // No do-nothing controls: the mock's view switcher (icon/list/works) is not rendered.
  assert.equal(main.querySelectorAll('button[aria-label="リスト"]').length, 0);
});

test("T05 (G03) /user query keys: q, sort, page match CURRENT for value, empty and unknown", () => {
  const entries = [...Array(120)].map((_, i) => ({
    x_id: `user${String(i).padStart(3, "0")}`, x_name: i % 2 ? `あ${i}` : `Bee${i}`, icon_url: null,
    personal_count: i % 7, collab_count: i % 3, total_works: (i % 7) + (i % 3), sort_score: 120 - i,
  }));
  const current = (q, sort, page) => {
    const prepared = prepareUsersIndexItems(entries, q, sort === "name" || sort === "works" ? sort : "score");
    return paginateUsersIndexItems(prepared, page, 48);
  };
  for (const [qs, q, sort, page] of [
    ["", "", "score", 1],
    ["?q=bee", "bee", "score", 1],
    ["?q=", "", "score", 1],
    ["?sort=works", "", "works", 1],
    ["?sort=name&page=2", "", "name", 2],
    ["?sort=bogus", "", "score", 1],
    ["?page=3", "", "score", 3],
    ["?page=99", "", "score", 99],
    ["?page=abc", "", "score", 1],
    ["?page=-2", "", "score", 1],
    ["?q=zzzz", "zzzz", "score", 1],
  ]) {
    const sp = new URLSearchParams(qs);
    const parsed = { q: sp.get("q") ?? "", sort: views.parseUsersIndexSort(sp.get("sort")), page: views.parseIndexPage(sp.get("page")) };
    assert.deepEqual(parsed, { q, sort, page: page > 0 && Number.isFinite(page) ? Math.min(page, 99) : 1 }, qs);
    const view = views.computeUsersIndexView(entries, parsed.q, parsed.sort, parsed.page);
    const want = current(parsed.q, parsed.sort, parsed.page);
    assert.deepEqual(view.creators.map((c) => c.id), want.current.map((e) => e.x_id), qs);
    assert.equal(view.total, want.total, qs);
    assert.equal(view.safePage, want.safePage, qs);
  }
  // CURRENT params(): defaults left out, q kept verbatim, page 1 leaves a bare "/user?".
  assert.equal(views.usersIndexQuery("", "score", 1), "");
  assert.equal(views.usersIndexQuery("a b", "works", 2), "q=a+b&sort=works&page=2");
  assert.ok(currentIndexSource.includes('merged.sort !== "score"') && currentIndexSource.includes('merged.page !== "1"'));
  assert.equal(views.USERS_INDEX_PAGE_SIZE, 48);
});

test("T05 (G03) /user/:id query keys: worksPage and collabPage slice like CURRENT (value, empty, unknown)", () => {
  const all = [...Array(40)].map((_, i) => `作品 w${String(i + 1).padStart(2, "0")}`);
  const pages = views.buildSectionPages(
    { total: 40, pageSize: 24, items: all.slice(0, 24).map((title, i) => ({ id: `w${i}`, title, youtube_video_id: null, display_name: "x" })) },
    new Map([[2, { page: 2, total: 40, pageSize: 24, generatedAt: null, items: all.slice(24).map((title, i) => ({ id: `w${24 + i}`, title, youtube_video_id: null, display_name: "x" })) }]]),
    8, 24,
  );
  assert.equal(pages.pages.length, totalPagesFor(40, 8));
  pages.pages.forEach((items, i) => assert.deepEqual(items.map((c) => c.title), all.slice(i * 8, i * 8 + 8), `display page ${i + 1}`));
  // A missing artifact page is null (CURRENT: 404), and nothing exists beyond 15 display pages.
  const missing = views.buildSectionPages({ total: 40, pageSize: 24, items: [] }, new Map(), 8, 24);
  assert.deepEqual(missing.pages.map((p) => p === null), [false, false, false, true, true]);
  const huge = views.buildSectionPages({ total: 9999, pageSize: 24, items: [] }, new Map(), 8, 24);
  assert.equal(huge.pages.length, views.USER_STATIC_DISPLAY_MAX_PAGES);
  assert.equal(views.USER_STATIC_DISPLAY_MAX_PAGES, 15);
  // Page keys: page 1 is the bare URL (served from the static file), later pages use the CURRENT keys.
  assert.equal(views.profilePageHref("long_list", "worksPage", 1), "/user/long_list");
  assert.equal(views.profilePageHref("long_list", "worksPage", 3), "/user/long_list?worksPage=3");
  assert.equal(views.profilePageHref("long_list", "collabPage", 2), "/user/long_list?collabPage=2");
  assert.ok(currentProfileSource.includes('usp.set("worksPage"') && currentProfileSource.includes('usp.set("collabPage"'));
  assert.equal(clampPaging({ page: "", pageSize: 8, defaultPageSize: 8, maxPageSize: 8 }).page, 1);
});

async function mountIsland(url, element) {
  dom.window.history.pushState({}, "", url);
  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  document.body.append(container);
  let root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return { container, root };
}

async function profileProps(id) {
  const data = await loadUserBuildDataFrom(fixturePayloadSource());
  const entry = data.users.get(id);
  return {
    header: views.buildCreatorHeader(entry.profile),
    works: views.buildSectionPages(entry.profile.works, entry.worksPages, 8, 24),
    collabs: views.buildSectionPages(entry.profile.collabs, entry.collabsPages, 8, 24),
  };
}

test("T05 profile Island: ?worksPage=3 shows display page 3; unknown/empty values stay on page 1; a 404 page shows a notice", { skip: skipUi }, async () => {
  const props = await profileProps("long_list");
  const titles = (c) => [...c.querySelectorAll(".fn-vc__title")].map((n) => n.textContent);
  let m = await mountIsland(`${DOM_URL}`, h(CreatorProfileIsland, props));
  assert.deepEqual(titles(m.container), [...Array(8)].map((_, i) => `作品 w${String(i + 1).padStart(2, "0")}`));
  await act(async () => m.root.unmount());
  m = await mountIsland(`${DOM_URL}?worksPage=3`, h(CreatorProfileIsland, props));
  assert.deepEqual(titles(m.container), [...Array(8)].map((_, i) => `作品 w${String(i + 17).padStart(2, "0")}`));
  assert.ok(hrefs(m.container).includes("/user/long_list?worksPage=2"));
  assert.ok(hrefs(m.container).includes("/user/long_list"), "page 1 links to the bare profile URL");
  await act(async () => m.root.unmount());
  m = await mountIsland(`${DOM_URL}?worksPage=5`, h(CreatorProfileIsland, props));
  assert.deepEqual(titles(m.container), [...Array(8)].map((_, i) => `作品 w${String(i + 33).padStart(2, "0")}`), "artifact page 2 of the works");
  await act(async () => m.root.unmount());
  for (const q of ["?worksPage=", "?worksPage=abc", "?collabPage=1&foo=bar", "?worksPage=0"]) {
    m = await mountIsland(`${DOM_URL}${q}`, h(CreatorProfileIsland, props));
    assert.equal(titles(m.container)[0], "作品 w01", q);
    await act(async () => m.root.unmount());
  }
  m = await mountIsland(`${DOM_URL}?worksPage=9`, h(CreatorProfileIsland, props));
  assert.ok(text(m.container).includes("ページが見つかりません"), "CURRENT: beyond the last page is a 404");
  await act(async () => m.root.unmount());
  m = await mountIsland(`${DOM_URL}?collabPage=2`, h(CreatorProfileIsland, props));
  assert.ok(text(m.container).includes("ページが見つかりません"), "CURRENT: a collab page past the end is a 404 even with no collabs");
  await act(async () => m.root.unmount());
});

test("T05 index Island: ?q= ?sort= ?page= are applied from /user/index.json like CURRENT; a failed fetch shows the unavailable notice", { skip: skipUi }, async () => {
  const data = await loadUserBuildDataFrom(fixturePayloadSource());
  const initial = views.computeUsersIndexView(data.index, "", "score", 1);
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => data.index };
  };
  try {
    const props = { initial, unavailable: false, indexUrl: "/user/index.json" };
    let m = await mountIsland("https://flamenode.net/user", h(UsersIndexIsland, props));
    assert.deepEqual(calls, [], "no query = static HTML as is, no fetch");
    await act(async () => m.root.unmount());
    m = await mountIsland("https://flamenode.net/user?q=%E5%88%9D&sort=works", h(UsersIndexIsland, props));
    assert.deepEqual(calls, ["/user/index.json"]);
    assert.deepEqual([...m.container.querySelectorAll(".cr-icons a")].map((a) => a.getAttribute("href")), ["/user/miku_producer"]);
    assert.equal(m.container.querySelector('input[name="q"]').value, "初");
    assert.equal(m.container.querySelector("select[name=sort]").value, "works");
    assert.ok(hrefs(m.container).includes("/user"), "リセット link when a query is active");
    await act(async () => m.root.unmount());
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    m = await mountIsland("https://flamenode.net/user?sort=name", h(UsersIndexIsland, props));
    assert.ok(text(m.container).includes("公開クリエイター一覧を一時的に表示できません。"));
    await act(async () => m.root.unmount());
  } finally {
    globalThis.fetch = original;
  }
});

function envelope(key, payload, generation = "g1", over = {}) {
  return JSON.stringify({ schemaVersion: 1, generation, key, visibility: "public", sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), payload, ...over });
}

function snapshotSource(objects, allowed, blocked = []) {
  const bytes = (s) => new TextEncoder().encode(s);
  const files = new Map(Object.entries(objects).map(([k, v]) => [k, bytes(v)]));
  return snapshotPayloadSource({ read: async (k) => files.get(k) ?? null }, { schemaVersion: 1, generation: "g1", allowedKeys: allowed, blockedKeys: blocked }, "g1");
}

const INDEX_KEY = "snapshot/users-index/current.json";
const profileKey = (id) => `snapshot/user-profile/${id}.json`;
const payloadOf = (id) => FIXTURE_USER_PROFILES[id];

test("T01 snapshot loader: banned/unapproved (blocked or unpublished) users get no page; tampered objects fail the build", async () => {
  const index = { generated_at: 1, items: FIXTURE_USERS_INDEX.items };
  const objects = {
    [INDEX_KEY]: envelope(INDEX_KEY, index),
    [profileKey("miku_producer")]: envelope(profileKey("miku_producer"), payloadOf("miku_producer")),
    [profileKey("minimal_user")]: envelope(profileKey("minimal_user"), payloadOf("minimal_user")),
    [profileKey("long_list")]: envelope(profileKey("long_list"), payloadOf("long_list")),
    [profileKey("suspended_user")]: envelope(profileKey("suspended_user"), { user: { id: "suspended_user", x_name: "x" }, works: { total: 1, items: [] } }),
  };
  const allowed = [INDEX_KEY, profileKey("miku_producer"), profileKey("minimal_user"), profileKey("long_list"), profileKey("suspended_user")];
  // suspended_user is in the blocked list: no page, no error.
  const data = await loadUserBuildDataFrom(snapshotSource(objects, allowed, [profileKey("suspended_user")]));
  assert.deepEqual([...data.users.keys()].sort(), ["long_list", "miku_producer", "minimal_user"]);
  assert.equal(data.index.some((e) => e.x_id === "suspended_user"), false);
  // Missing from the manifest allow-list = not public.
  const notAllowed = await loadUserBuildDataFrom(snapshotSource(objects, allowed.filter((k) => k !== profileKey("miku_producer")), [profileKey("suspended_user")]));
  assert.equal(notAllowed.users.has("miku_producer"), false);
  // A profile object that names another user is never published under this URL.
  const swapped = { ...objects, [profileKey("long_list")]: envelope(profileKey("long_list"), payloadOf("minimal_user")) };
  assert.equal((await loadUserBuildDataFrom(snapshotSource(swapped, allowed, []))).users.has("long_list"), false);
  // Tampering is not "no page": the build fails.
  const tampered = { ...objects, [profileKey("miku_producer")]: envelope(profileKey("miku_producer"), payloadOf("miku_producer"), "g1", { sha256: "0".repeat(64) }) };
  await assert.rejects(loadUserBuildDataFrom(snapshotSource(tampered, allowed, [])), (e) => e instanceof SnapshotBuildError && e.code === "HASH_MISMATCH");
  const stale = { ...objects, [INDEX_KEY]: envelope(INDEX_KEY, index, "old") };
  await assert.rejects(loadUserBuildDataFrom(snapshotSource(stale, allowed, [])), (e) => e instanceof SnapshotBuildError && e.code === "GENERATION_MISMATCH");
  // A missing index = no listing, no pages (CURRENT: the unavailable notice).
  const noIndex = await loadUserBuildDataFrom(snapshotSource({}, [], []));
  assert.equal(noIndex.index, null);
  assert.equal(noIndex.users.size, 0);
});

test("T01 non-public works: CURRENT normalizer drops private/voided rows from every section and page", async () => {
  const data = await loadUserBuildDataFrom(fixturePayloadSource());
  const miku = data.users.get("miku_producer").profile;
  assert.deepEqual(miku.works.items.map((v) => v.id), ["a1", "a2"]);
  assert.equal(data.users.get("long_list").worksPages.get(2).items.length, 16);
  assert.equal(data.source, "fixture");
});

test("head builder: page image replaces the brand card without size/type; noindex only when asked", () => {
  const withImage = buildPageHead({ path: "/user/a", title: "T", image: "/api/google-drive-image/abcdef123", ogType: "profile" });
  assert.equal(withImage.ogImage, `${origin}/api/google-drive-image/abcdef123`);
  assert.equal(withImage.ogImageWidth, null);
  assert.equal(withImage.ogType, "profile");
  assert.equal(withImage.noindex, false);
  const brand = buildPageHead({ path: "/about", title: "T" });
  assert.equal(brand.ogImageWidth, 1200);
  assert.equal(brand.ogImageType, "image/png");
});

test("snapshot env: all unset means fixtures, a partly set configuration fails the build (never silently falls back to fixtures)", () => {
  assert.equal(userPayloadSourceFromEnv({}), null);
  assert.equal(userPayloadSourceFromEnv({ FLAMENODE_SNAPSHOT_DIR: " ", FLAMENODE_SNAPSHOT_MANIFEST_FILE: "", FLAMENODE_SNAPSHOT_GENERATION: undefined }), null);
  const full = { FLAMENODE_SNAPSHOT_DIR: "/x", FLAMENODE_SNAPSHOT_MANIFEST_FILE: "/x/manifest.json", FLAMENODE_SNAPSHOT_GENERATION: "g1" };
  for (const missing of Object.keys(full)) {
    const partial = { ...full, [missing]: undefined };
    assert.throws(() => userPayloadSourceFromEnv(partial), /Snapshot env incomplete/, `${missing} missing`);
  }
  // A complete configuration with an unreadable manifest throws too.
  assert.throws(() => userPayloadSourceFromEnv(full));
});

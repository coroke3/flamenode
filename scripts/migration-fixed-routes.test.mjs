// MIG-0501 characterization: built /about and /rules HTML against CURRENT pages (texts, links, head,
// terms body, date format), mock structure, and the build-time terms loader.
// Run `npm run build -w @flamenode/ui && npm run build -w @flamenode/site` first (the HTML tests read apps/site/dist).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { RESERVED_ROOT_SLUGS } from "../apps/site/src/lib/routeMap.ts";
import { buildPageHead, compactText } from "../apps/site/src/lib/pageHead.ts";
import { loadRulesForBuild, rulesSourceFromEnv, RulesBuildError } from "../apps/site/src/lib/rulesLoader.ts";
import { parseLegalMarkdown } from "../src/lib/terms/legalMarkdown.ts";
import { DEFAULT_TERMS_MARKDOWN, DEFAULT_TERMS_VERSION_LABEL } from "../src/lib/terms/defaultTerms.ts";
import { formatUnix } from "../src/lib/utils/format.ts";

const DIST = path.resolve("apps/site/dist");
const built = fs.existsSync(path.join(DIST, "about/index.html")) && fs.existsSync(path.join(DIST, "rules/index.html"));
const skip = built ? false : "apps/site/dist missing: build @flamenode/site first";
// CI step after the ui/site builds sets REQUIRE_BUILT=1: a missing build must fail, not skip (test:unit runs before the build).
if (process.env.REQUIRE_BUILT && skip) throw new Error("REQUIRE_BUILT is set but " + skip);
const load = (route) => new JSDOM(fs.readFileSync(path.join(DIST, route, "index.html"), "utf-8")).window.document;
const meta = (doc, sel) => doc.querySelector(sel)?.getAttribute("content");
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
const aboutSource = fs.readFileSync("app/(public)/about/page.tsx", "utf-8");

/** Every Japanese string literal in CURRENT about/page.tsx outside metadata (body, titles, labels, link text). */
function currentAboutStrings() {
  const body = aboutSource.slice(aboutSource.indexOf("const HERO_POINTS"));
  const found = new Set();
  for (const m of body.matchAll(/"([^"\n]*[぀-ヿ一-鿿][^"\n]*)"/g)) found.add(m[1]);
  for (const m of body.matchAll(/>\s*([^<>{}\n]*[぀-ヿ一-鿿][^<>{}\n]*?)\s*</g)) found.add(m[1].trim());
  for (const m of body.matchAll(/^\s{12,}([^<>{}"=\n]*[぀-ヿ一-鿿][^<>{}"=\n]*)$/gm)) found.add(m[1].trim());
  return [...found].filter((s) => s.length > 1 && !s.startsWith("FlameNode の主な流れ"));
}

test("route map: /about and /rules are fixed routes that no slug can shadow", () => {
  assert.ok(RESERVED_ROOT_SLUGS.has("about"));
  assert.ok(RESERVED_ROOT_SLUGS.has("rules"));
});

test("head: title/description/canonical/OGP/Twitter equal CURRENT buildPageMetadata output", { skip }, () => {
  const expected = {
    "/about": { title: "FlameNode について", description: "FlameNode は、個人制作映像のアーカイブとイベント参加・投稿・運営の記録をつなぐサイトです。" },
    "/rules": { title: "利用規約", description: "FlameNodeの投稿・閲覧・イベント参加に関する利用規約です。" },
  };
  for (const [route, want] of Object.entries(expected)) {
    const doc = load(route);
    const url = `https://flamenode.net${route}`;
    assert.equal(doc.title, `${want.title} | FlameNode`);
    assert.equal(meta(doc, 'meta[name="description"]'), want.description);
    assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute("href"), url);
    assert.equal(meta(doc, 'meta[property="og:title"]'), want.title);
    assert.equal(meta(doc, 'meta[property="og:url"]'), url);
    assert.equal(meta(doc, 'meta[property="og:type"]'), "website");
    assert.equal(meta(doc, 'meta[property="og:site_name"]'), "FlameNode");
    assert.equal(meta(doc, 'meta[property="og:image"]'), "https://flamenode.net/brand/flamenode-social-card.png");
    assert.equal(meta(doc, 'meta[property="og:image:width"]'), "1200");
    assert.equal(meta(doc, 'meta[name="twitter:card"]'), "summary_large_image");
    assert.equal(doc.documentElement.lang, "ja");
  }
  // The CURRENT metadata literals are the ones above.
  assert.ok(aboutSource.includes(expected["/about"].description));
  assert.ok(fs.readFileSync("app/(public)/rules/page.tsx", "utf-8").includes(expected["/rules"].description));
});

test("pageHead: compactText keeps CURRENT collapsing, cap and fallback", () => {
  assert.equal(compactText("  a \n b  "), "a b");
  assert.equal(compactText("x".repeat(200)).length, 160);
  assert.ok(compactText("x".repeat(200)).endsWith("..."));
  assert.equal(compactText(""), "映像作品とクリエイター、イベントをつなぐ動画プラットフォーム。");
  assert.equal(buildPageHead({ path: "/about", title: "T" }).canonical, "https://flamenode.net/about");
});

test("about T01: every CURRENT text is in the built HTML without JS (static body)", { skip }, () => {
  const doc = load("about");
  const html = text(doc.body);
  const missing = currentAboutStrings().filter((s) => !html.includes(s.replace(/\s+/g, " ")));
  // Mock wording is not adopted for CURRENT texts; the only CURRENT strings allowed to be absent are
  // layout-only labels listed here (decorative eyebrows/badges the mock drops: no cards, no extra headings).
  const DROPPED = new Set(["ABOUT FLAMENODE", "CORE FLOW", "What It Connects", "FOR VIEWERS", "FOR CREATORS", "FOR ORGANIZERS", "Policy", "3 GUIDELINES", "CREDITS", "IDENTITY", "TYPEFACE", "Start", "01", "02", "03", "制作：", "FlameNode がつなぐ情報", "FlameNode の対象ユーザー"]);
  const unexpected = missing.filter((s) => !DROPPED.has(s) && !/^[\x00-\x7f]+$/.test(s));
  assert.deepEqual(unexpected, []);
});

test("about: entry links and credit links match CURRENT (UX-PUB-009), external links are noopener", { skip }, () => {
  const doc = load("about");
  const main = doc.querySelector("main");
  const hrefs = [...main.querySelectorAll("a")].map((a) => a.getAttribute("href"));
  for (const href of ["/list", "/event", "/entry", "https://x.com/tomoki3192", "https://www.foriio.com/tomokidesign"]) {
    assert.ok(hrefs.includes(href), `missing ${href}`);
  }
  for (const a of main.querySelectorAll('a[href^="https://"]')) {
    assert.equal(a.getAttribute("target"), "_blank");
    assert.match(a.getAttribute("rel"), /noopener/);
  }
  assert.deepEqual([...main.querySelectorAll(".actions a")].map(text), ["作品を見る", "イベントを見る"]);
  assert.equal(main.querySelectorAll("h1").length, 1);
  assert.match(text(main.querySelector("h1")), /^作品が見つかり、 ?イベントの記録も残る場所。$/);
});

test("about: mock structure (hero, kv, 3 columns, identity, credits) and no stats block without a snapshot", { skip }, () => {
  const doc = load("about");
  for (const sel of [".ab-hero .t-display", ".actions .fn-btn--primary", ".actions .fn-btn--secondary", ".kv.ab-kv", ".ab-cols", ".ab-ident", "dl.kv[aria-label='制作クレジット']"]) {
    assert.ok(doc.querySelector(sel), `missing ${sel}`);
  }
  assert.equal(doc.querySelectorAll(".ab-kv dt").length, 3);
  assert.equal(doc.querySelector(".metrics"), null, "stats are hidden when no build snapshot provides them (CURRENT hides on failure)");
});

test("rules T01: terms body, version line, event-host anchor are in static HTML (UX-PUB-010)", { skip }, () => {
  const doc = load("rules");
  const article = doc.querySelector("article.prose");
  assert.equal(text(article.querySelector("h1")), "利用規約");
  assert.equal(text(article.querySelector("p.t-sm")), `バージョン: ${DEFAULT_TERMS_VERSION_LABEL}`);
  const blocks = parseLegalMarkdown(DEFAULT_TERMS_MARKDOWN);
  assert.equal(article.querySelectorAll("h2").length, blocks.filter((b) => b.type === "heading2").length);
  assert.equal(article.querySelectorAll("h3").length, blocks.filter((b) => b.type === "heading3").length);
  assert.equal(article.querySelectorAll("ul > li").length, blocks.filter((b) => b.type === "list").reduce((n, b) => n + b.items.length, 0));
  assert.equal(article.querySelectorAll("p:not(.t-label):not(.t-sm)").length, blocks.filter((b) => b.type === "paragraph").length);
  for (const b of blocks.filter((x) => x.type === "heading3")) assert.ok(text(article).includes(b.text));
  const host = doc.querySelector("#event-host");
  assert.ok(host, "footer links to /rules#event-host");
  assert.match(text(host), /イベント開催相談.*Discord から運営にご連絡ください/);
});

test("rules: no do-nothing controls; consent form is withheld until MIG-0605", { skip }, () => {
  const doc = load("rules");
  const main = doc.querySelector("main");
  assert.equal(main.querySelector("form, button, input"), null);
  assert.equal(doc.querySelector(".rl-side")?.textContent.includes("利用規約への同意"), false);
});

test("shell: header Island (mobile nav) and static footer with CURRENT links on both routes (T03)", { skip }, () => {
  for (const route of ["about", "rules"]) {
    const doc = load(route);
    assert.ok(doc.querySelector("astro-island[client='load']"), "header hydrates");
    assert.ok(doc.querySelector("button.hd-burger"));
    const footer = [...doc.querySelectorAll("footer a")].map((a) => a.getAttribute("href"));
    for (const href of ["/about", "/rules", "/rules#event-host", "/list", "/event", "/entry"]) assert.ok(footer.includes(href), `${route}: footer ${href}`);
    assert.equal(doc.querySelectorAll("astro-island").length, 1, "only the header is an Island");
    const current = doc.querySelector('.hd-nav a[aria-current="page"]');
    assert.equal(current, null, "/about and /rules are not top-nav items (CURRENT isPublicNavItemActive)");
  }
});

test("rules loader: null source = CURRENT built-in terms; payload wins; date format = formatUnix", async () => {
  const fallback = await loadRulesForBuild({ read: async () => null });
  assert.equal(fallback.versionLabel, DEFAULT_TERMS_VERSION_LABEL);
  assert.equal(fallback.updatedLabel, null);
  assert.deepEqual(fallback.blocks, parseLegalMarkdown(DEFAULT_TERMS_MARKDOWN));

  const payload = { version_label: "v9", body_markdown: "# T\n\n本文\n\n* a\n* b", published_at: 1790000000, updated_at: 1790100000 };
  const rules = await loadRulesForBuild({ read: async () => payload });
  assert.equal(rules.versionLabel, "v9");
  assert.equal(rules.updatedLabel, formatUnix(1790000000, { dateOnly: true }));
  assert.deepEqual(rules.blocks.map((b) => b.type), ["heading2", "paragraph", "list"]);

  const blank = await loadRulesForBuild({ read: async () => ({ version_label: "x", body_markdown: "  " }) });
  assert.equal(blank.versionLabel, DEFAULT_TERMS_VERSION_LABEL, "blank body falls back like CURRENT");
});

test("rules T02: an unreadable source fails the build instead of emitting an empty page", async () => {
  await assert.rejects(loadRulesForBuild({ read: async () => { throw new Error("boom"); } }), RulesBuildError);
  await assert.rejects(loadRulesForBuild({ read: async () => "not an object" }), RulesBuildError);
  await assert.rejects(loadRulesForBuild(rulesSourceFromEnv({ FLAMENODE_RULES_SNAPSHOT_FILE: path.resolve("no-such-rules.json") })));
  assert.equal((await loadRulesForBuild(rulesSourceFromEnv({}))).versionLabel, DEFAULT_TERMS_VERSION_LABEL);
});

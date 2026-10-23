// MIG-0501 coverage-gap units (G05 head extras, G06 WebSite JSON-LD, G07 GA4, G08 theme/fonts, G10 404/503,
// G23 text row, about-stats snapshot; /maintenance is MIG-0619-owned (PublicPage, no JS) so G10/G23 text rows only cross-check it) compared with CURRENT app/layout.tsx, app/(public)/layout.tsx,
// not-found/error/maintenance pages and @next/third-parties.
// Run `npm run build -w @flamenode/ui && npm run build -w @flamenode/site` first.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import {
  THEME_BOOTSTRAP_CODE, buildSiteJsonLd, serializeJsonLd, gaMeasurementId, gaInitScript, gaLoaderSrc, buildPageHead,
} from "../apps/site/src/lib/pageHead.ts";
import { loadAboutStatsSnapshot, ABOUT_STATS_KEY } from "../apps/site/src/lib/publicDataLoader.ts";
import { loadAboutStatsForBuild } from "../apps/site/src/lib/aboutStats.ts";

const DIST = path.resolve("apps/site/dist");
const built = fs.existsSync(path.join(DIST, "about/index.html"));
const skip = built ? false : "apps/site/dist missing: build @flamenode/site first";
const uiBuilt = fs.existsSync(path.resolve("packages/ui/dist/index.js"));
const skipUi = uiBuilt ? false : "packages/ui/dist missing: build @flamenode/ui first";
const html = (file) => fs.readFileSync(path.join(DIST, file), "utf-8");
const dom = (file) => new JSDOM(html(file)).window.document;
const rootLayout = fs.readFileSync("app/layout.tsx", "utf-8");
const seo = fs.readFileSync("src/lib/seo.ts", "utf-8");

test("G08: theme bootstrap is CURRENT's script verbatim and runs before the first stylesheet/body", { skip }, () => {
  const current = rootLayout.match(/const themeBootstrapCode = `([^`]*)`;/)[1];
  assert.equal(THEME_BOOTSTRAP_CODE, current);
  for (const route of ["about/index.html", "rules/index.html", "404.html"]) {
    const text = html(route);
    const at = text.indexOf(current);
    assert.ok(at > 0, `${route}: bootstrap inlined`);
    assert.ok(at < text.indexOf("<title>"), "before title");
    assert.ok(at < text.indexOf("rel=\"stylesheet\""), "before stylesheets (no FOUC)");
  }
});

function runBootstrap({ stored, prefersDark }) {
  const d = new JSDOM("<!doctype html><html></html>", { runScripts: "outside-only", url: "https://flamenode.net/" });
  const w = d.window;
  if (stored) w.localStorage.setItem("fn-theme", stored);
  w.matchMedia = () => ({ matches: prefersDark, addEventListener() {}, addListener() {} });
  w.eval(THEME_BOOTSTRAP_CODE);
  return [w.document.documentElement.getAttribute("data-theme"), w.document.documentElement.getAttribute("data-theme-preference")];
}

test("G08: stored fn-theme and system preference set data-theme before paint", () => {
  assert.deepEqual(runBootstrap({ stored: "light", prefersDark: true }), ["light", "light"]);
  assert.deepEqual(runBootstrap({ stored: "dark", prefersDark: false }), ["dark", "dark"]);
  assert.deepEqual(runBootstrap({ stored: null, prefersDark: false }), ["light", "system"]);
  assert.deepEqual(runBootstrap({ stored: null, prefersDark: true }), ["dark", "system"]);
  assert.deepEqual(runBootstrap({ stored: "garbage", prefersDark: true }), ["dark", "system"]);
});

test("G08: font file and @font-face match CURRENT FlameNodeSans.otf", { skip }, () => {
  assert.ok(fs.readFileSync("app/fonts/FlameNodeSans.otf").equals(fs.readFileSync("apps/site/public/fonts/FlameNodeSans.otf")));
  assert.ok(fs.existsSync(path.join(DIST, "fonts/FlameNodeSans.otf")));
  const doc = dom("about/index.html");
  assert.ok(doc.querySelector('link[rel="preload"][as="font"][href="/fonts/FlameNodeSans.otf"]'));
});

test("G06: WebSite/Organization JSON-LD equals CURRENT buildSiteJsonLd and is emitted on every page", { skip }, () => {
  const ld = buildSiteJsonLd("https://flamenode.net");
  assert.equal(ld["@graph"][1]["@type"], "WebSite");
  assert.equal(ld["@graph"][1].inLanguage, "ja-JP");
  for (const lit of ['"@type": "Organization"', '"@type": "WebSite"', 'inLanguage: "ja-JP"', "width: 512", "height: 512", "caption: SITE_NAME", 'absoluteUrl("/#organization")', 'absoluteUrl("/#website")', 'absoluteUrl("/#logo")']) {
    assert.ok(seo.includes(lit.replace(/"@type": /, "\"@type\": ")), `seo.ts has ${lit}`);
  }
  assert.ok(seo.includes('"映像作品とクリエイター、イベントをつなぐ動画プラットフォーム。"'));
  assert.ok(rootLayout.includes('id="flamenode-site-structured-data"'));
  for (const route of ["about/index.html", "rules/index.html", "404.html", "503/index.html"]) {
    const script = dom(route).querySelector('script#flamenode-site-structured-data[type="application/ld+json"]');
    assert.deepEqual(JSON.parse(script.textContent), JSON.parse(serializeJsonLd(ld)));
  }
  assert.equal(serializeJsonLd({ a: "</script>" }), '{"a":"\\u003c/script>"}');
});

test("G05: root-layout head extras (manifest, icons, apple, robots, locale, theme-color) match CURRENT", { skip }, () => {
  const doc = dom("about/index.html");
  const content = (sel) => doc.querySelector(sel)?.getAttribute("content");
  const href = (sel) => doc.querySelector(sel)?.getAttribute("href");
  assert.equal(href('link[rel="manifest"]'), "/manifest.webmanifest");
  assert.equal(href('link[rel="icon"][type="image/svg+xml"]'), "/brand/flamenode-favicon.svg");
  assert.equal(href('link[rel="icon"][sizes="32x32"]'), "/brand/flamenode-icon-32.png");
  assert.equal(href('link[rel="icon"][sizes="512x512"]'), "/brand/flamenode-icon-512.png");
  assert.equal(href('link[rel="shortcut icon"]'), "/favicon.ico");
  assert.equal(href('link[rel="apple-touch-icon"]'), "/brand/flamenode-apple-touch-icon.png");
  assert.equal(content('meta[property="og:locale"]'), "ja_JP");
  assert.equal(content('meta[name="msapplication-TileColor"]'), "#c8f21f");
  assert.equal(content('meta[name="robots"]'), "index, follow");
  assert.equal(content('meta[name="googlebot"]'), "index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1");
  assert.equal(content('meta[name="category"]'), "entertainment");
  assert.equal(content('meta[name="viewport"]'), "width=device-width, initial-scale=1, viewport-fit=cover");
  assert.equal(content('meta[name="theme-color"][media="(prefers-color-scheme: light)"]'), "#fbfaf5");
  assert.equal(content('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]'), "#0b0d10");
  for (const lit of ['"/manifest.webmanifest"', '"/brand/flamenode-favicon.svg"', '"/brand/flamenode-icon-32.png"', '"/brand/flamenode-apple-touch-icon.png"', '"ja_JP"', '"#c8f21f"', '"#fbfaf5"', '"#0b0d10"', '"max-image-preview": "large"', 'category: "entertainment"', '"black-translucent"', 'viewportFit: "cover"']) {
    assert.ok(rootLayout.includes(lit), `app/layout.tsx has ${lit}`);
  }
  assert.equal(buildPageHead({ path: "/x", title: "t", noIndex: true }).noindex, true);
});

test("G07: GA4 tag is absent without the env and identical to @next/third-parties when set", { skip: skip || skipUi }, () => {
  for (const route of ["about/index.html", "rules/index.html"]) assert.equal(html(route).includes("googletagmanager"), false);
  assert.equal(gaMeasurementId({}), null);
  assert.equal(gaMeasurementId({ PUBLIC_GA_MEASUREMENT_ID: " G-ABC123 " }), "G-ABC123");
  assert.equal(gaMeasurementId({ NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-OLD" }), "G-OLD");
  const ga = fs.readFileSync("node_modules/@next/third-parties/dist/google/ga.js", "utf-8");
  const template = ga.match(/__html: `([\s\S]*?)`,/)[1];
  const expected = new Function("dataLayerName", "gaId", "debugMode", `return \`${template}\`;`)("dataLayer", "G-ABC123", false);
  assert.equal(gaInitScript("G-ABC123"), expected);
  assert.equal(gaLoaderSrc("G-ABC123"), "https://www.googletagmanager.com/gtag/js?id=G-ABC123");
  assert.match(fs.readFileSync("app/(public)/layout.tsx", "utf-8"), /gaMeasurementId \? <GoogleAnalytics gaId=\{gaMeasurementId\}/);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fn-ga-"));
  execFileSync(process.execPath, [path.resolve("node_modules/astro/astro.js"), "build", "--outDir", out], {
    cwd: path.resolve("apps/site"),
    env: { ...process.env, PUBLIC_GA_MEASUREMENT_ID: "G-TEST123" },
    stdio: "pipe",
  });
  const withGa = new JSDOM(fs.readFileSync(path.join(out, "about/index.html"), "utf-8")).window.document;
  assert.equal(withGa.querySelector("script#_next-ga").getAttribute("src"), "https://www.googletagmanager.com/gtag/js?id=G-TEST123");
  assert.ok(withGa.querySelector("script#_next-ga-init").textContent.includes("gtag('config', 'G-TEST123'"));
  fs.rmSync(out, { recursive: true, force: true });
});

test("G10/G23: 404, 503 and /maintenance carry CURRENT text, noindex and a way back; no do-nothing buttons", { skip }, () => {
  const notFound = fs.readFileSync("app/not-found.tsx", "utf-8");
  const error = fs.readFileSync("app/error.tsx", "utf-8");
  const maintenance = fs.readFileSync("app/(public)/maintenance/page.tsx", "utf-8");
  const cases = [
    ["404.html", "ページが見つかりません", "URL を確認するか、トップページから再度お探しください。", notFound, "トップへ戻る"],
    ["503/index.html", "問題が発生しました", "読み込みに失敗しました。再試行するか、しばらくしてからお戻りください。", error, "トップへ戻る"],
    ["maintenance/index.html", "メンテナンス中", "ご迷惑をおかけしますが、しばらくお待ちください。", maintenance, "トップへ戻る"],
  ];
  for (const [file, title, lead, source, action] of cases) {
    const doc = dom(file);
    assert.ok(source.includes(title) && source.includes(lead) && source.includes(action), `${file}: CURRENT source has the text`);
    const main = doc.querySelector("main");
    assert.ok(main.textContent.includes(title) && main.textContent.includes(lead.replace(/。$/, "")));
    assert.equal(doc.querySelector('meta[name="robots"]').getAttribute("content"), "noindex, nofollow");
    assert.equal(doc.querySelector('meta[name="googlebot"]').getAttribute("content"), "noindex, nofollow");
    assert.equal(main.querySelector('a[href="/"]').textContent.trim(), action);
    assert.equal(main.querySelector("button, form"), null);
  }
  assert.ok(maintenance.includes("noIndex: true"));
});

function envelope(key, payload, over = {}) {
  return { schemaVersion: 1, generation: "g1", key, visibility: "public", payload, sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), ...over };
}
const sourceOf = (obj) => ({ read: async () => (obj ? new TextEncoder().encode(JSON.stringify(obj)) : null) });
const manifest = { schemaVersion: 1, generation: "g1", allowedKeys: [ABOUT_STATS_KEY], blockedKeys: [] };
const opts = { manifest, generation: "g1" };

test("about-stats snapshot: same validation as CURRENT normalizeStats, fail closed otherwise", async () => {
  const good = { publicVideos: 3240, creators: 812, events: 46 };
  assert.deepEqual(await loadAboutStatsSnapshot(sourceOf(envelope(ABOUT_STATS_KEY, good)), opts), good);
  for (const bad of [{ publicVideos: -1, creators: 1, events: 1 }, { publicVideos: 1.5, creators: 1, events: 1 }, { publicVideos: "x", creators: 1, events: 1 }, [1, 2, 3], null]) {
    await assert.rejects(loadAboutStatsSnapshot(sourceOf(envelope(ABOUT_STATS_KEY, bad)), opts), { code: "INVALID_PAYLOAD" });
  }
  await assert.rejects(loadAboutStatsSnapshot(sourceOf(envelope(ABOUT_STATS_KEY, good, { sha256: "a".repeat(64) })), opts), { code: "HASH_MISMATCH" });
  await assert.rejects(loadAboutStatsSnapshot(sourceOf(envelope(ABOUT_STATS_KEY, good, { visibility: "private" })), opts), { code: "NOT_PUBLIC" });
  await assert.rejects(loadAboutStatsSnapshot(sourceOf(envelope(ABOUT_STATS_KEY, good)), { ...opts, manifest: { ...manifest, blockedKeys: [ABOUT_STATS_KEY] } }), { code: "NOT_PUBLIC" });
  await assert.rejects(loadAboutStatsSnapshot(sourceOf(null), opts), { code: "SNAPSHOT_MISSING" });
});

test("about stats at build: shown from a verified snapshot, hidden (not failed) when unavailable, like CURRENT", async () => {
  assert.equal(await loadAboutStatsForBuild({}), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-stats-"));
  const good = { publicVideos: 3240, creators: 812, events: 46 };
  fs.mkdirSync(path.join(dir, "snapshot/about-stats"), { recursive: true });
  fs.writeFileSync(path.join(dir, ABOUT_STATS_KEY), JSON.stringify(envelope(ABOUT_STATS_KEY, good)));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  const env = { FLAMENODE_SNAPSHOT_DIR: dir, FLAMENODE_SNAPSHOT_MANIFEST_FILE: path.join(dir, "manifest.json"), FLAMENODE_SNAPSHOT_GENERATION: "g1" };
  assert.deepEqual(await loadAboutStatsForBuild(env), good);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loadAboutStatsForBuild({ ...env, FLAMENODE_SNAPSHOT_GENERATION: "g2" }), null);
    assert.equal(await loadAboutStatsForBuild({ ...env, FLAMENODE_SNAPSHOT_MANIFEST_FILE: path.join(dir, "missing.json") }), null);
  } finally {
    console.warn = warn;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("about stats render: CURRENT numbers, ja-JP grouping, unit 件, labels and notes; nothing without stats", { skip: skipUi }, async () => {
  const { AboutView } = await import("@flamenode/ui");
  const doc = (props) => new JSDOM(renderToStaticMarkup(React.createElement(AboutView, props))).window.document;
  const shown = doc({ stats: { publicVideos: 3240, creators: 812, events: 46 } });
  const items = [...shown.querySelectorAll(".metric")].map((m) => [m.querySelector("b").textContent, m.querySelectorAll("span")[0].textContent, m.querySelectorAll("span")[1].textContent]);
  assert.deepEqual(items, [
    ["3,240件", "公開作品", "動画ページ・作品棚・イベントから閲覧できます。"],
    ["812件", "クリエイター名義", "X ID を公開名義として作品と紐づけます。"],
    ["46件", "イベント", "募集・公開・アーカイブの記録を扱います。"],
  ]);
  const src = fs.readFileSync("app/(public)/about/AboutStats.tsx", "utf-8");
  for (const [, label, note] of items) { assert.ok(src.includes(label) && src.includes(note)); }
  assert.ok(src.includes('toLocaleString("ja-JP")') && src.includes('unit: "件"'));
  assert.equal(doc({ stats: null }).querySelector(".metrics"), null);
});

// MIG-0621 U01 — byte-exact robots.txt parity with CURRENT's real Next.js serializer.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { buildRobotsText, GET, ROBOTS_DISALLOW } from "../apps/site/src/pages/robots.txt.ts";
import { siteOrigin } from "../apps/site/src/lib/pageHead.ts";
import { buildSitemapEntries, serializeSitemap } from "../apps/site/src/lib/sitemap.ts";
import { sitemapVideosOrEmpty } from "../apps/site/src/pages/sitemap.xml.ts";
import { SITEMAP_VIDEOS_KEY } from "../apps/site/src/lib/publicDataLoader.ts";

const require = createRequire(import.meta.url);
const { resolveRobots, resolveSitemap } = require("next/dist/build/webpack/loaders/metadata/resolve-route-data.js");
const root = new URL("../", import.meta.url);
const origin = "https://flamenode.net";

function currentRobotsContract(source) {
  // Deliberately fail if CURRENT changes syntax or directives: silently accepting
  // an old hardcoded list would weaken the migration parity guarantee.
  const match = source.match(/disallow:\s*\[([\s\S]*?)\]/);
  assert.ok(match, "CURRENT robots.ts must contain an explicit disallow array");
  assert.match(source, /userAgent:\s*["']\*["']/);
  assert.match(source, /allow:\s*["']\/["']/);
  assert.match(source, /sitemap:\s*absoluteUrl\(["']\/sitemap\.xml["']\)/);
  assert.match(source, /host:\s*site\.origin/);
  const entries = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  assert.equal(entries.length, 9, "CURRENT must explicitly list 9 disallows");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: entries }],
    host: origin,
    sitemap: `${origin}/sitemap.xml`,
  };
}

test("MIG-0621 U01 T01: Astro robots output equals Next resolveRobots byte-for-byte", async () => {
  assert.equal(typeof resolveRobots, "function", "Next metadata serializer must exist");
  const source = await readFile(new URL("app/robots.ts", root), "utf8");
  const contract = currentRobotsContract(source);
  assert.deepEqual([...ROBOTS_DISALLOW], contract.rules[0].disallow);
  const expected = resolveRobots(contract);
  assert.equal(buildRobotsText(origin), expected);
  assert.equal(Buffer.compare(Buffer.from(buildRobotsText(origin)), Buffer.from(expected)), 0);
  assert.ok(expected.endsWith("\n"), "must retain trailing newline");
});

test("MIG-0621 U01: Astro GET is plain text and keeps the configured public origin", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/i);
  assert.equal(await response.text(), buildRobotsText(siteOrigin()));
});

test("MIG-0621 U01: built robots.txt matches the exact Next output (REQUIRE_BUILT gate)", async (t) => {
  if (process.env.REQUIRE_BUILT !== "1") return t.skip("set REQUIRE_BUILT=1 after Astro build");
  const source = await readFile(new URL("app/robots.ts", root), "utf8");
  const expected = resolveRobots(currentRobotsContract(source));
  const built = await readFile(new URL("apps/site/dist/robots.txt", root));
  assert.equal(Buffer.compare(built, Buffer.from(expected)), 0);
});

test("MIG-0621 U03 T05: sitemap XML is byte-identical to Next resolveSitemap", () => {
  assert.equal(typeof resolveSitemap, "function", "Next sitemap serializer must exist");
  const entries = buildSitemapEntries({
    origin,
    videos: [{ id: "video_1", youtube_video_id: "yt-1", scheduled_time: 1_700_000_000 }],
    events: [{ id: "event 1", end_time: null, start_time: 1_700_000_100 }],
    creators: [{ x_id: "creator_a", updated_at: null }],
    generatedAt: [1_700_000_020],
    now: new Date("2026-10-27T00:00:00.000Z"),
  });
  assert.equal(entries.length, 10, "seven static entries and three dynamic entries");
  assert.deepEqual(entries.map((row) => new URL(row.url).pathname.slice(0, 6)).filter((x) => x === "/event").length, 2);
  assert.ok(entries.some((row) => row.url === origin + "/yt-1"));
  assert.ok(entries.some((row) => row.url === origin + "/event/event%201"));
  assert.ok(entries.some((row) => row.url === origin + "/user/creator_a"));
  assert.equal(entries.at(-1).lastModified.toISOString(), new Date(1_700_000_020_000).toISOString());
  assert.equal(serializeSitemap(entries), resolveSitemap(entries), "Next 15.5 XML serialization must remain identical");
});

test("MIG-0621 U03 T04: missing manifest sitemap key warns once and omits only video URLs", async () => {
  const warnings = [];
  const access = {
    source: { read: async () => null },
    options: {
      manifest: { schemaVersion: 1, generation: "g1", allowedKeys: [], blockedKeys: [] },
      generation: "g1",
    },
  };
  const omitted = await sitemapVideosOrEmpty(access, (message) => warnings.push(message));
  assert.deepEqual(omitted, { generated_at: null, videos: [] });
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(SITEMAP_VIDEOS_KEY));
  const entries = buildSitemapEntries({
    origin,
    videos: omitted.videos,
    events: [{ id: "public-event", start_time: null, end_time: null }],
    creators: [],
    generatedAt: [],
    now: new Date("2026-10-27T00:00:00.000Z"),
  });
  assert.equal(entries.length, 8, "missing video snapshot must not delete the public event/static URLs");
});

test("MIG-0621 U03: hash-corrupted optional video snapshot fails closed, not silently omitted", async () => {
  const warnings = [];
  const payload = {
    schemaVersion: 1, generation: "g1", key: SITEMAP_VIDEOS_KEY,
    visibility: "public", sha256: "0".repeat(64),
    payload: { generated_at: null, videos: [] },
  };
  const access = {
    source: { read: async () => new TextEncoder().encode(JSON.stringify(payload)) },
    options: {
      manifest: { schemaVersion: 1, generation: "g1", allowedKeys: [SITEMAP_VIDEOS_KEY], blockedKeys: [] },
      generation: "g1",
    },
  };
  await assert.rejects(
    sitemapVideosOrEmpty(access, (message) => warnings.push(message)),
    (error) => error?.code === "HASH_MISMATCH",
  );
  assert.equal(warnings.length, 0);
});


test("MIG-0621 U03 T02: built sitemap.xml contains all static URLs exactly once", async (t) => {
  if (process.env.REQUIRE_BUILT !== "1") return t.skip("set REQUIRE_BUILT=1 after Astro build");
  const xml = await readFile(new URL("apps/site/dist/sitemap.xml", root), "utf8");
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.ok(xml.endsWith("</urlset>\n"));
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(urls.length, new Set(urls).size, "sitemap cannot contain duplicated canonical URLs");
  for (const path of ["/", "/recommend", "/list", "/event", "/user", "/about", "/rules"]) {
    assert.ok(urls.includes(origin + path), `missing static sitemap URL ${path}`);
  }
  assert.equal(urls.some((url) => url.includes("/admin/") || url.includes("/dashboard/")), false,
    "private workspace URLs cannot appear in sitemap");
  assert.equal([...xml.matchAll(/<url>/g)].length, urls.length, "all sitemap entries need a loc");
});


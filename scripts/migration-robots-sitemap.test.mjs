// MIG-0621 U01 — byte-exact robots.txt parity with CURRENT's real Next.js serializer.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { buildRobotsText, GET, ROBOTS_DISALLOW } from "../apps/site/src/pages/robots.txt.ts";
import { siteOrigin } from "../apps/site/src/lib/pageHead.ts";

const require = createRequire(import.meta.url);
const { resolveRobots } = require("next/dist/build/webpack/loaders/metadata/resolve-route-data.js");
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

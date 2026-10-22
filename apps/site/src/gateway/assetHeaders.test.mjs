import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

// MIG-0620 T01-T03. Resolves Cache-Control the way Workers Static Assets does:
// every matching rule applies top to bottom, values of the same header are joined
// with ", ", and `! Header` removes what earlier rules set.
const parse = (text) => {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), ops: [] });
      continue;
    }
    const line = raw.trim();
    if (line.startsWith("!")) {
      rules.at(-1).ops.push({ detach: line.slice(1).trim().toLowerCase() });
    } else {
      const i = line.indexOf(":");
      rules.at(-1).ops.push({ name: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() });
    }
  }
  return rules;
};
const matches = (pattern, path) =>
  new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(path);
const cacheControl = (rules, path) => {
  let value = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    for (const op of rule.ops) {
      if (op.detach === "cache-control") value = null;
      else if (op.name === "cache-control") value = value === null ? op.value : value + ", " + op.value;
    }
  }
  return value;
};

const root = new URL("../../../../", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");
const current = parse(await read("public/_headers"));
const site = parse(await read("apps/site/public/_headers"));
const app = parse(await read("apps/app/public/_headers"));
const IMMUTABLE = cacheControl(current, "/_next/static/chunks/a.js");
const DAY = cacheControl(current, "/favicon.ico");
const SWR = cacheControl(current, "/logo.png");

test("CURRENT values (the table the new rules must match)", () => {
  assert.equal(IMMUTABLE, "public, max-age=31536000, immutable");
  assert.equal(DAY, "public, max-age=86400");
  assert.equal(SWR, "public, max-age=86400, stale-while-revalidate=604800");
});

test("T01 hashed prefixes are immutable 1y (no SWR merge)", () => {
  for (const p of ["/_astro/index.AbC123.js", "/_astro/x.AbC123.css", "/_astro/hero.AbC123.png", "/_astro/i.AbC123.svg"]) {
    assert.equal(cacheControl(site, p), IMMUTABLE, p);
  }
  for (const p of ["/_personal_assets/index-AbC123.js", "/_personal_assets/index-AbC123.css", "/_personal_assets/a-AbC.svg"]) {
    assert.equal(cacheControl(app, p), IMMUTABLE, p);
  }
});

test("T02 brand, fonts, favicon follow CURRENT", () => {
  assert.equal(cacheControl(site, "/favicon.ico"), DAY);
  for (const p of ["/brand/flamenode-mark.png", "/brand/flamenode-favicon.svg", "/brand/x.webp", "/fonts/a.svg", "/logo.png"]) {
    assert.equal(cacheControl(site, p), cacheControl(current, p), p);
    assert.equal(cacheControl(site, p), SWR, p);
  }
  // No CURRENT rule: left to the platform default, never immutable.
  for (const p of ["/manifest.webmanifest", "/robots.txt", "/fonts/a.woff2"]) assert.equal(cacheControl(site, p), null, p);
});

test("T03 HTML and unhashed paths are never immutable", () => {
  for (const p of ["/", "/about", "/index.html", "/maintenance/index.html", "/abc123xyz", "/user/u1", "/event/e1"]) {
    assert.equal(cacheControl(site, p), null, p);
    assert.equal(cacheControl(app, p), null, p);
  }
  for (const rules of [site, app]) {
    assert.equal(rules.some((r) => r.pattern === "/*" || r.pattern === "/"), false);
  }
});

test("build output carries _headers", { skip: !existsSync(new URL("apps/site/dist", root)) }, async () => {
  assert.equal(await read("apps/site/dist/_headers"), await read("apps/site/public/_headers"));
  if (existsSync(new URL("apps/app/dist/_headers", root))) {
    assert.equal(await read("apps/app/dist/_headers"), await read("apps/app/public/_headers"));
  }
});

// MIG-0707 試験: 2 SPA の build で asset が混ざらない、noindex。
// CI は `npm run build --workspace=@flamenode/app` と `--workspace=@flamenode/ops` の後にこの test を実行する。
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";

const opsDist = new URL("../dist/", import.meta.url);
const appDist = new URL("../../app/dist/", import.meta.url);

const requireDist = (dist, workspace) =>
  assert.ok(existsSync(dist), `${dist.pathname} is missing; run npm run build --workspace=${workspace} first`);

const assetRefs = (html) => [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);

test("Ops build emits hashed assets only under /_ops_assets/", async () => {
  requireDist(opsDist, "@flamenode/ops");
  const entries = await readdir(opsDist);
  assert.ok(entries.includes("_ops_assets"), entries.join(","));
  assert.ok(!entries.includes("_personal_assets"), "Personal assets leaked into the Ops dist");
  assert.ok(!entries.includes("assets"), "Vite default assets dir must not be used");
  const html = await readFile(new URL("index.html", opsDist), "utf8");
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, "index.html has no module script");
  for (const ref of assetRefs(html).filter((r) => /\.(js|css)$/.test(r))) {
    assert.match(ref, /^\/_ops_assets\//, ref);
  }
});

test("Personal build does not contain Ops assets", async () => {
  requireDist(appDist, "@flamenode/app");
  const entries = await readdir(appDist);
  assert.ok(entries.includes("_personal_assets"), entries.join(","));
  assert.ok(!entries.includes("_ops_assets"), "Ops assets leaked into the Personal dist");
  const html = await readFile(new URL("index.html", appDist), "utf8");
  assert.ok(!html.includes("/_ops_assets/"), "Personal index.html references Ops assets");
});

test("Ops index.html is noindex, nofollow", async () => {
  requireDist(opsDist, "@flamenode/ops");
  const html = await readFile(new URL("index.html", opsDist), "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow"\s*\/?>/);
});

#!/usr/bin/env node
/**
 * MIG-0405 U02: run the gateway under `wrangler dev` (local workerd, Static Assets
 * with run_worker_first, local KV) and check the decisions end to end.
 * Local only: no remote resources, no Route, no deploy. Not run in CI (needs workerd).
 *
 *   node --experimental-strip-types scripts/migration-gateway.wrangler-smoke.mjs
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRouteShards } from "../apps/site/src/gateway/routeShards.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "fn-gateway-smoke-"));
const assets = join(work, "assets");
const persist = join(work, "state");
const port = 8790 + Math.floor(Math.random() * 100);

const generation = "smoke-gen-1";
const manifest = {
  schemaVersion: 1,
  generation,
  routes: {
    "clip-1": { type: "canonical", kind: "video", id: "clip-1", canonicalPath: "/clip-1" },
    "clip-2": { type: "canonical", kind: "video", id: "clip-2", canonicalPath: "/clip-2" },
    "user/creator": { type: "canonical", kind: "user", id: "Creator", canonicalPath: "/user/creator" },
    "old-clip": { type: "redirect", targetPath: "/clip-1", status: 308, reason: "alias" },
  },
};
const write = (path, body) => {
  mkdirSync(dirname(join(assets, path)), { recursive: true });
  writeFileSync(join(assets, path), body);
};
for (const { path, body } of buildRouteShards(manifest)) write(path, body);
for (const page of ["clip-1", "clip-2", "user/creator"]) write(`${page}/index.html`, `<!doctype html><title>${page}</title>`);

writeFileSync(join(work, "wrangler.json"), JSON.stringify({
  name: "flamenode-gateway-smoke",
  main: join(root, "apps/site/src/gateway/index.ts"),
  compatibility_date: "2026-07-21", // same as wrangler.toml
  assets: { directory: assets, binding: "ASSETS", run_worker_first: true },
  kv_namespaces: [{ binding: "VISIBILITY_KV", id: "smoke-local" }],
}));

const wrangler = join(root, "node_modules/.bin/wrangler");
const config = ["--config", join(work, "wrangler.json")];
// Revoked after the build: the page and its shard entry still exist.
const put = spawnSync(wrangler, ["kv", "key", "put", "deny:video:clip-2", "1", "--binding", "VISIBILITY_KV", "--local", "--persist-to", persist, ...config], { encoding: "utf8" });
assert.equal(put.status, 0, put.stderr);

const dev = spawn(wrangler, ["dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist, ...config], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

const base = `http://127.0.0.1:${port}`;
const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });

try {
  for (let i = 0; ; i++) {
    try {
      await get("/_fn/routes/0.json");
      break;
    } catch {
      if (i > 120) throw new Error(`wrangler dev did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const checks = [
    ["/clip-1", 200, (r, body) => assert.match(body, /<title>clip-1/)],
    ["/user/Creator", 200, (r, body) => assert.match(body, /<title>user\/creator/)],
    ["/user/@creator/", 200],
    ["/old-clip?tab=works", 308, (r) => assert.equal(r.headers.get("location"), "/clip-1?tab=works")],
    ["/clip-2", 404, (r) => assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow")],
    ["/clip-404", 404],
    ["/../clip-1", 200], // the URL parser folds `..` before the Worker sees it
    ["/clip%2f1", 404],
  ];
  for (const [path, status, extra] of checks) {
    const r = await get(path);
    const body = await r.text();
    assert.equal(r.status, status, `${path}: ${r.status} ${body.slice(0, 80)}`);
    extra?.(r, body);
    console.log(`ok ${status} ${path}`);
  }
  // The shard file itself is not a page.
  assert.equal((await get("/_fn/routes/0.json")).status, 404);
  assert.equal((await get("/clip-1", { method: "POST" })).status, 405);
  assert.equal((await get("/api/auth/session")).status, 503); // no AUTH_ORIGIN bound in the smoke
  console.log("ok shard file 404, POST 405, /api/auth without AUTH_ORIGIN 503");

  // Request wall time through wrangler's local proxy. Local workerd reports no CPU
  // time (its trace spans carry wall duration only), so CPU stays the Node T05 number.
  const times = [];
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    await (await get(i % 2 ? "/clip-1" : "/user/creator")).arrayBuffer();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
  console.log(`[gateway-wrangler] n=200 wall p50=${q(0.5)}ms p99=${q(0.99)}ms max=${times.at(-1).toFixed(2)}ms (includes the local proxy; not Workers CPU)`);
} finally {
  dev.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
}

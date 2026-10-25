#!/usr/bin/env node
/**
 * MIG-0512: non-production workerd Static Assets smoke.
 * Exercises the ACTUAL built 404.html and 503/index.html with
 * not_found_handling=404-page and run_worker_first, rather than faking
 * Cloudflare's unusual HTTP 404 + text/html 404-page response.
 * No remote resources, deployment, Route or production KV.
 * Run after: npm run build --workspace=@flamenode/site
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "apps/site/dist");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
for (const path of [join(dist, "404.html"), join(dist, "503/index.html"), wrangler]) {
  assert.ok(existsSync(path), `MIG-0512 smoke requires built file ${path}`);
}
const work = mkdtempSync(join(tmpdir(), "fn-gateway-errors-"));
const assets = join(work, "assets");
mkdirSync(join(assets, "503"), { recursive: true });
copyFileSync(join(dist, "404.html"), join(assets, "404.html"));
copyFileSync(join(dist, "503/index.html"), join(assets, "503/index.html"));

const config = {
  name: "fn-gateway-404-smoke",
  compatibility_date: "2026-07-21",
  main: join(root, "apps/site/src/gateway/index.ts"),
  assets: {
    directory: assets,
    binding: "ASSETS",
    run_worker_first: true,
    not_found_handling: "404-page",
    html_handling: "auto-trailing-slash",
  },
  kv_namespaces: [{ binding: "VISIBILITY_KV", id: "smoke-local" }],
};
writeFileSync(join(work, "wrangler.json"), JSON.stringify(config));
const port = 8910 + Math.floor(Math.random() * 80);
const dev = spawn(process.execPath, [
  wrangler, "dev", "--port", String(port), "--ip", "127.0.0.1",
  "--persist-to", join(work, "state"), "--config", join(work, "wrangler.json"),
], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
dev.stdout.on("data", (data) => (log += data));
dev.stderr.on("data", (data) => (log += data));
const base = `http://127.0.0.1:${port}`;
try {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(base + "/%2f", { redirect: "manual" });
      await res.arrayBuffer();
      break;
    } catch {
      if (i > 120) throw new Error("local wrangler dev did not start:\n" + log);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Unknown impossible route has no valid shard key => 404 + the ACTUAL Astro 404.
  // A valid key with no available shard => 503 + the ACTUAL Astro 503.
  for (const [route, status, content] of [
    ["/%2f", 404, "ページが見つかりません"],
    ["/missing-public-route", 503, "問題が発生しました"],
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const res = await fetch(base + route, { method, redirect: "manual" });
      const body = await res.text();
      assert.equal(res.status, status, `${method} ${route}: status, body=${body.slice(0, 150)}\n${log}`);
      assert.match(res.headers.get("content-type") ?? "", /^text\/html/i);
      assert.equal(res.headers.get("cache-control"), "no-store, private");
      assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.equal(res.headers.get("retry-after"), status === 503 ? "30" : null);
      if (method === "HEAD") assert.equal(body, "");
      else assert.ok(body.includes(content), `${method} ${route}: expected Astro error page text`);
      console.log(`ok workerd ${method} ${route}: HTTP ${res.status} ${res.headers.get("content-type")}`);
    }
  }
} finally {
  dev.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  rmSync(work, { recursive: true, force: true });
}
console.log("MIG-0512 workerd error-page smoke PASS");
process.exit(0);

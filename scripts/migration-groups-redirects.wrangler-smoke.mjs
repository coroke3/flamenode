#!/usr/bin/env node
/**
 * MIG-0503: run the real `apps/site/public/_redirects` under `wrangler dev` (local workerd, Workers Static Assets)
 * and record the status and Location of the `/groups` compatibility redirects, both with Static Assets alone and
 * behind the visibility gateway (`run_worker_first`). Local only: no remote resource, no Route, no deploy.
 * Not run in CI (needs workerd).
 *
 *   node --experimental-strip-types scripts/migration-groups-redirects.wrangler-smoke.mjs
 *
 * Observed with wrangler 4 / workerd (2026-10-23) and asserted here so a change is noticed:
 *   - 307 with `Location: /event` and `/event#event-group-{slug}` (fragment kept, `:slug` substituted)
 *   - assets alone: a request query string is appended (`/groups?x=1` -> `/event?x=1`); CURRENT drops it
 *   - behind the current gateway PoC (MIG-0405, `run_worker_first`) the redirects are NOT reproduced: `/groups` is
 *     answered 200 with the /event page (the gateway calls `ASSETS.fetch` with the default `redirect: "follow"`),
 *     and `/groups/{slug}` is not on the fixed-page allowlist and answers 503. The gateway section below prints
 *     MISMATCH lines for these (informational, exit 0); the fix belongs to the gateway owners (MIG-0404/0405/0406).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const wranglerJs = join(root, "node_modules/wrangler/bin/wrangler.js");

async function run(label, withGateway, expectations) {
  const work = mkdtempSync(join(tmpdir(), "fn-groups-smoke-"));
  const assets = join(work, "assets");
  mkdirSync(join(assets, "event"), { recursive: true });
  writeFileSync(join(assets, "event/index.html"), "<!doctype html><title>event</title>");
  copyFileSync(join(root, "apps/site/public/_redirects"), join(assets, "_redirects"));
  const config = {
    name: "fn-groups-smoke",
    compatibility_date: "2026-07-21",
    assets: withGateway ? { directory: assets, binding: "ASSETS", run_worker_first: true } : { directory: assets },
    ...(withGateway
      ? { main: join(root, "apps/site/src/gateway/index.ts"), kv_namespaces: [{ binding: "VISIBILITY_KV", id: "smoke-local" }] }
      : {}),
  };
  writeFileSync(join(work, "wrangler.json"), JSON.stringify(config));
  const port = 8800 + Math.floor(Math.random() * 90);
  const dev = spawn(process.execPath, [wranglerJs, "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", join(work, "state"), "--config", join(work, "wrangler.json")], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: work,
  });
  let log = "";
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(base + "/event/", { redirect: "manual" });
        break;
      } catch {
        if (i > 120) throw new Error(`wrangler dev did not start:\n${log}`);
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    for (const [path, status, location] of expectations) {
      const r = await fetch(base + path, { redirect: "manual" });
      await r.arrayBuffer();
      if (r.status !== status && label === "assets") assert.fail(`${label} ${path}: status ${r.status}, want ${status}`);
      if (r.status !== status) { console.log(`MISMATCH ${label} ${path}: status ${r.status} location ${r.headers.get("location")} (want ${status})`); continue; }
      if (label === "assets") assert.equal(r.headers.get("location"), location, `${label} ${path}: location ${r.headers.get("location")}`);
      else if (r.headers.get("location") !== location) { console.log(`MISMATCH ${label} ${path}: location ${r.headers.get("location")} (want ${location})`); continue; }
      console.log(`ok ${label} ${status} ${path} -> ${location}`);
    }
  } finally {
    dev.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(work, { recursive: true, force: true });
  }
}

await run("assets", false, [
  ["/groups", 307, "/event"],
  ["/groups/", 307, "/event"],
  ["/groups?x=1", 307, "/event?x=1"], // CURRENT: /event (query dropped)
  ["/groups/spring", 307, "/event#event-group-spring"],
  ["/groups/spring/", 307, "/event#event-group-spring"],
  ["/groups/a%20b", 307, "/event#event-group-a%20b"], // CURRENT: raw space; same URL after parsing
  ["/groups/spring?x=1", 307, "/event?x=1#event-group-spring"],
  ["/groups/a/b", 404, null],
]);
await run("gateway", true, [
  ["/groups", 307, "/event"],
  ["/groups?x=1", 307, "/event"],
  ["/groups/spring", 307, "/event#event-group-spring"],
]);
console.log("groups redirects smoke OK");
process.exit(0);

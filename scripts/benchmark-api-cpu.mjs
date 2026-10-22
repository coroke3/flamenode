#!/usr/bin/env node
/**
 * MIG-0606 U01: LOCAL-ONLY CPU benchmark harness for the Hono API (apps/api).
 *
 * Never deploys, never uses --remote, never calls a Cloudflare account API.
 * Every number it prints is a LOCAL measurement, not a production value.
 *
 *   --mode wrangler (default)  `wrangler dev --local` (workerd, local D1 built from
 *                              repo migrations, local R2). CPU = workerd's own
 *                              per-invocation `cpu_time_ms` from the wrangler local
 *                              observability spans (integer ms resolution).
 *   --mode inproc              Hono app in this Node process, D1 emulated by
 *                              node:sqlite on the same migrations. Time = performance.now()
 *                              wall delta around app.fetch (microsecond resolution). A PROXY:
 *                              Node/V8 wall time (includes GC/scheduler noise), no workerd, D1
 *                              I/O not included. process.cpuUsage() was rejected: on Windows it
 *                              ticks in ~15.6ms steps. No cold kind (needs a fresh isolate).
 *   --dry-run                  print the plan and a self-check of the aggregation; run nothing.
 *
 * Judged by MAX against ZERO_1102.md section 3 (S2 < 7ms, S3 < 8ms, S4 <= 2ms).
 * p50/p95/p99 are recorded but never decide pass/fail.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------- pure logic
export const BUDGETS_MS = Object.freeze({ S2: 7, S3: 8, S4: 2 });
export const KINDS = Object.freeze(["normal", "limit", "invalid", "cold"]);
export const MIN_SAMPLES = 50;

/** Nearest-rank percentile over an ascending-sorted array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, p50: null, p95: null, p99: null, max: null };
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Budget verdict from the MAX only (p50/p95/p99 never decide).
 *  - resolutionMs: clock/sampler granularity; the measured max may under-read by this much.
 *  - noiseMs: the max a zero-work route (BASELINE) produced in the same run. Noise only
 *    INFLATES a reading, so it can excuse an over-budget reading but never a passing one.
 *  - PASS         max + resolution is below the budget.
 *  - FAIL         even after subtracting the noise floor, max is at/over the budget.
 *  - INCONCLUSIVE otherwise (over budget but within noise, or too close to the budget for the clock).
 * kind "lt" = strictly below (S2/S3), "le" = at most (S4).
 */
export function judge(maxMs, budgetMs, { resolutionMs = 0, noiseMs = 0, kind = "lt" } = {}) {
  if (maxMs == null) return "NOT_MEASURED";
  const upper = maxMs + resolutionMs;
  if (kind === "le" ? upper <= budgetMs : upper < budgetMs) return "PASS";
  const net = maxMs - noiseMs;
  if (kind === "le" ? net > budgetMs : net >= budgetMs) return "FAIL";
  return "INCONCLUSIVE";
}

/** Group raw samples {kind, cpuMs, status, bytes, d1} into per-kind summaries. */
export function aggregate(samples, { runtimeClass, resolutionMs, noiseMs = 0 }) {
  const budget = BUDGETS_MS[runtimeClass];
  const budgetKind = runtimeClass === "S4" ? "le" : "lt";
  const kinds = {};
  for (const kind of KINDS) {
    const rows = samples.filter((s) => s.kind === kind);
    const cpu = summarize(rows.map((r) => r.cpuMs));
    kinds[kind] = {
      ...cpu,
      meetsMinSamples: cpu.n >= MIN_SAMPLES,
      unexpectedStatus: rows.filter((r) => r.unexpected).length,
      maxBytes: rows.reduce((m, r) => Math.max(m, r.bytes ?? 0), 0),
      maxD1Statements: rows.reduce((m, r) => Math.max(m, r.d1 ?? 0), 0),
    };
  }
  const maxima = Object.values(kinds).map((k) => k.max).filter((v) => v != null);
  const overallMax = maxima.length ? Math.max(...maxima) : null;
  return {
    runtimeClass,
    budgetMs: budget,
    kinds,
    overallMax,
    noiseMs,
    verdict: judge(overallMax, budget, { resolutionMs, noiseMs, kind: budgetKind }),
  };
}

export function parseArgs(argv) {
  const out = {
    mode: "wrangler", samples: MIN_SAMPLES, coldSamples: MIN_SAMPLES, warmup: 10,
    port: 8788, inspectorPort: 9239, d1: "replay", samplingUs: 100, only: null, out: null, dryRun: false, skipCold: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} requires a value`);
      i += 1;
      return v;
    };
    if (a === "--mode") out.mode = next();
    else if (a === "--samples") out.samples = Number(next());
    else if (a === "--cold-samples") out.coldSamples = Number(next());
    else if (a === "--warmup") out.warmup = Number(next());
    else if (a === "--port") out.port = Number(next());
    else if (a === "--d1") out.d1 = next();
    else if (a === "--sampling-us") out.samplingUs = Number(next());
    else if (a === "--inspector-port") out.inspectorPort = Number(next());
    else if (a === "--only") out.only = next().split(",");
    else if (a === "--out") out.out = next();
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--skip-cold") out.skipCold = true;
    else throw new Error(`Unsupported argument: ${a}`);
  }
  if (!["replay", "sim"].includes(out.d1)) throw new Error("--d1 must be replay|sim");
  if (!["wrangler", "inproc"].includes(out.mode)) throw new Error(`--mode must be wrangler|inproc`);
  for (const k of ["samples", "coldSamples", "warmup", "port", "inspectorPort", "samplingUs"]) {
    if (!Number.isInteger(out[k]) || out[k] < 0) throw new Error(`--${k} must be a non-negative integer`);
  }
  return out;
}

export function formatMs(v, digits) {
  return v == null ? "-" : v.toFixed(digits);
}

export function renderMarkdown(results, { digits, label }) {
  const lines = [
    `| scenario | class | kind | n | p50 | p95 | p99 | max (ms) | D1 stmts | bytes | unexpected status |`,
    `| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const r of results) {
    for (const kind of KINDS) {
      const k = r.agg.kinds[kind];
      lines.push(
        `| ${r.id} ${r.title} | ${r.runtimeClass} | ${kind} | ${k.n} | ${formatMs(k.p50, digits)} | ${formatMs(k.p95, digits)} | ${formatMs(k.p99, digits)} | ${formatMs(k.max, digits)} | ${k.maxD1Statements} | ${k.maxBytes} | ${k.unexpectedStatus} |`,
      );
    }
  }
  lines.push("", `Budget verdict by max (${label}):`, "");
  lines.push(`| scenario | class | budget | overall max (ms) | verdict |`, `| --- | --- | --- | ---: | --- |`);
  for (const r of results) {
    const op = r.runtimeClass === "S4" ? "<=" : "<";
    lines.push(`| ${r.id} ${r.title} | ${r.runtimeClass} | ${op} ${r.agg.budgetMs}ms | ${formatMs(r.agg.overallMax, digits)} | ${r.agg.verdict} |`);
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------- scenarios
// Every scenario builds a request spec per sample. `setup` (optional) seeds
// rows through the target's exec() before the request. Specs carry the status
// codes a healthy run must return; anything else is counted as "unexpected"
// so a broken seed can never produce silently meaningless CPU numbers.
const SITE_URL = "https://bench.flamenode.invalid";
const SESSION_TOKEN = "bench-admin-session-token";
const ADMIN_COOKIE = `authjs.session-token=${SESSION_TOKEN}`;
const STATS_KEY = "top/sections/stats.v1.json";
const MAX_STATS_BYTES = 64 * 1024;

function adminHeaders() {
  return { cookie: ADMIN_COOKIE, origin: SITE_URL, "content-type": "application/json" };
}
const json = (v) => JSON.stringify(v);
const annBody = (extra = {}) => ({ title: "Bench", body: "Bench body", severity: "info", target_audience: "all", is_published: 1, ...extra });

export function buildScenarios(ctx) {
  const stats = (padBytes) => {
    const base = { schema_version: 1, generated_at: 1_700_000_000, stats: { public_videos: 3000, creators: 800, public_events: 20 } };
    if (padBytes <= 0) return json(base);
    const probe = json({ ...base, pad: "" });
    return json({ ...base, pad: "x".repeat(Math.max(0, padBytes - probe.length)) });
  };
  const annRow = (id, updatedAt) => ({
    sql: `INSERT INTO announcements (id, title, body, severity, is_published, target_audience, created_by_user_id, created_at, updated_at) VALUES (?, 'seed', 'seed', 'info', 1, 'all', 'bench-admin', ?, ?)`,
    params: [id, updatedAt, updatedAt],
  });
  const eventRow = (id) => ({
    sql: `INSERT INTO events (id, title, event_type, visibility_status, start_time, end_time, created_at, updated_at, public_api_enabled) VALUES (?, 'bench event', 'event', 'public', 1000, 2000, 10, 20, 0)`,
    params: [id],
  });
  const LONG_TITLE = "T".repeat(200);
  const LONG_BODY = "B".repeat(8000);
  const LONG_EVENT_ID = "e".repeat(128);

  return [
    {
      id: "RH-018", title: "GET /api/health", runtimeClass: "S2",
      kinds: {
        normal: () => ({ method: "GET", path: "/api/health", expect: [200] }),
        limit: () => ({ method: "GET", path: `/api/health?x=${"a".repeat(2000)}`, expect: [200] }),
        invalid: () => ({ method: "POST", path: "/api/health", expect: [404] }),
      },
    },
    {
      id: "RH-017", title: "GET /api/health/deep", runtimeClass: "S2",
      kinds: {
        normal: () => ({ method: "GET", path: "/api/health/deep", headers: { authorization: `Bearer ${ctx.adminToken}` }, expect: [503] }),
        limit: () => ({ method: "GET", path: "/api/health/deep", headers: { authorization: `Bearer ${"t".repeat(4096)}` }, expect: [401] }),
        invalid: () => ({ method: "GET", path: "/api/health/deep", expect: [401] }),
      },
    },
    {
      id: "RH-026", title: "GET /api/public/about-stats", runtimeClass: "S2",
      // R2 object is replaced per kind by prepareKind; 64KiB is the route's byte cap.
      prepareKind: { normal: { r2: stats(0) }, limit: { r2: stats(MAX_STATS_BYTES) }, invalid: { r2: null } },
      kinds: {
        normal: () => ({ method: "GET", path: "/api/public/about-stats", clearCache: true, expect: [200] }),
        limit: () => ({ method: "GET", path: "/api/public/about-stats", clearCache: true, expect: [200] }),
        invalid: () => ({ method: "GET", path: "/api/public/about-stats", clearCache: true, expect: [503] }),
      },
    },
    {
      id: "RH-029", title: "GET /api/software/suggestions", runtimeClass: "S2",
      kinds: {
        normal: (i) => ({ method: "GET", path: "/api/software/suggestions?limit=20", headers: { "cf-connecting-ip": `10.0.${(i >> 8) & 255}.${i & 255}` }, expect: [200] }),
        limit: (i) => ({ method: "GET", path: "/api/software/suggestions?limit=50&q=aaaa", headers: { "cf-connecting-ip": `10.1.${(i >> 8) & 255}.${i & 255}` }, expect: [200] }),
        invalid: (i) => ({ method: "GET", path: "/api/software/suggestions?limit=-5&q=%00%00", headers: { "cf-connecting-ip": `10.2.${(i >> 8) & 255}.${i & 255}` }, expect: [200] }),
      },
    },
    {
      id: "SA-004", title: "POST /api/admin/announcements", runtimeClass: "S3",
      kinds: {
        normal: () => ({ method: "POST", path: "/api/admin/announcements", headers: adminHeaders(), body: json(annBody()), expect: [200] }),
        limit: () => ({ method: "POST", path: "/api/admin/announcements", headers: adminHeaders(), body: json(annBody({ title: LONG_TITLE, body: LONG_BODY })), expect: [200] }),
        invalid: () => ({ method: "POST", path: "/api/admin/announcements", headers: adminHeaders(), body: json(annBody({ title: "" })), expect: [400] }),
      },
    },
    {
      id: "SA-005", title: "PUT /api/admin/announcements/:id", runtimeClass: "S3",
      kinds: {
        normal: (i, tag) => ({ setup: [annRow(`ann-${tag}-${i}`, 100)], method: "PUT", path: `/api/admin/announcements/ann-${tag}-${i}`, headers: adminHeaders(), body: json(annBody({ base_updated_at: 100 })), expect: [200] }),
        limit: (i, tag) => ({ setup: [annRow(`ann-${tag}-${i}`, 100)], method: "PUT", path: `/api/admin/announcements/ann-${tag}-${i}`, headers: adminHeaders(), body: json(annBody({ base_updated_at: 100, title: LONG_TITLE, body: LONG_BODY })), expect: [200] }),
        invalid: (i, tag) => ({ setup: [annRow(`ann-${tag}-${i}`, 100)], method: "PUT", path: `/api/admin/announcements/ann-${tag}-${i}`, headers: adminHeaders(), body: json(annBody({ base_updated_at: 99 })), expect: [409] }),
      },
    },
    {
      id: "SA-006", title: "DELETE /api/admin/announcements/:id", runtimeClass: "S3",
      kinds: {
        normal: (i, tag) => ({ setup: [annRow(`ann-${tag}-${i}`, 100)], method: "DELETE", path: `/api/admin/announcements/ann-${tag}-${i}`, headers: adminHeaders(), expect: [200] }),
        limit: (i, tag) => ({ setup: [annRow(`ann-${tag}-${i}`, 100)], method: "DELETE", path: `/api/admin/announcements/ann-${tag}-${i}`, headers: adminHeaders(), expect: [200] }),
        invalid: (i, tag) => ({ method: "DELETE", path: `/api/admin/announcements/missing-${tag}-${i}`, headers: adminHeaders(), expect: [404] }),
      },
    },
    {
      id: "SA-007", title: "POST /api/admin/api-endpoints", runtimeClass: "S3",
      kinds: {
        normal: (i, tag) => ({ setup: [eventRow(`ev-${tag}-${i}`)], method: "POST", path: "/api/admin/api-endpoints", headers: adminHeaders(), body: json({ event_id: `ev-${tag}-${i}` }), expect: [200] }),
        limit: (i, tag) => {
          const id = `${LONG_EVENT_ID.slice(0, 128 - `${tag}-${i}`.length - 1)}-${tag}-${i}`;
          return { setup: [eventRow(id)], method: "POST", path: "/api/admin/api-endpoints", headers: adminHeaders(), body: json({ event_id: id }), expect: [200] };
        },
        invalid: () => ({ method: "POST", path: "/api/admin/api-endpoints", headers: adminHeaders(), body: json({ event_id: "" }), expect: [400] }),
      },
    },
    {
      id: "SA-008", title: "PATCH /api/admin/api-endpoints/:id", runtimeClass: "S3",
      kinds: {
        normal: (i, tag) => ({ setup: [eventRow(`ev-${tag}-${i}`)], method: "PATCH", path: `/api/admin/api-endpoints/ev-${tag}-${i}`, headers: adminHeaders(), body: json({ public_api_enabled: "1" }), expect: [200] }),
        limit: (i, tag) => {
          const id = `${LONG_EVENT_ID.slice(0, 128 - `${tag}-${i}`.length - 1)}-${tag}-${i}`;
          return { setup: [eventRow(id)], method: "PATCH", path: `/api/admin/api-endpoints/${id}`, headers: adminHeaders(), body: json({ public_api_enabled: "1" }), expect: [200] };
        },
        invalid: (i, tag) => ({ method: "PATCH", path: `/api/admin/api-endpoints/missing-${tag}-${i}`, headers: adminHeaders(), body: json({ public_api_enabled: "1" }), expect: [404] }),
      },
    },
    {
      id: "S4", title: "session resolution (cookie -> session -> user, 1 D1 read)", runtimeClass: "S4",
      kinds: {
        normal: () => ({ method: "GET", path: "/__bench/session", headers: { cookie: ADMIN_COOKIE }, expect: [200] }),
        limit: () => ({ method: "GET", path: "/__bench/session", headers: { cookie: `${Array.from({ length: 20 }, (_, n) => `c${n}=${"v".repeat(150)}`).join("; ")}; ${ADMIN_COOKIE}` }, expect: [200] }),
        invalid: () => ({ method: "GET", path: "/__bench/session", headers: { cookie: "authjs.session-token=no-such-token" }, expect: [200] }),
      },
    },
    {
      id: "BASELINE", title: "no-op worker route (harness/runtime floor, not a budget item)", runtimeClass: "S2",
      baseline: true,
      kinds: {
        normal: () => ({ method: "GET", path: "/__bench/noop", expect: [200] }),
        limit: () => ({ method: "GET", path: "/__bench/noop", expect: [200] }),
        invalid: () => ({ method: "GET", path: "/__bench/noop", expect: [200] }),
      },
    },
  ];
}

// ------------------------------------------------------------ shared seeding
const SEED = (adminToken) => [
  { sql: `INSERT OR REPLACE INTO "user" (id, name, role, is_banned, is_tos_accepted) VALUES ('bench-admin', 'Bench Admin', 'admin', 0, 1)`, params: [] },
  { sql: `INSERT OR REPLACE INTO "session" ("sessionToken", "userId", "expires") VALUES (?, 'bench-admin', ?)`, params: [SESSION_TOKEN, Date.now() + 365 * 24 * 3600 * 1000] },
  { sql: `INSERT OR REPLACE INTO system_settings (id, operation_mode) VALUES ('default', 'normal')`, params: [] },
  ...Array.from({ length: 100 }, (_, n) => ({
    sql: `INSERT OR REPLACE INTO software_catalog (id, name, normalized_name, category, is_active, is_verified) VALUES (?, ?, ?, 'edit', 1, ?)`,
    params: [`sw-${n}`, `aaaa Software ${n}`, `aaaa software ${n}`, n % 2],
  })),
];

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PATH = path.join(REPO_ROOT, "apps/api/src/app.ts");
const SESSION_PATH = path.join(REPO_ROOT, "apps/api/src/auth/session.ts");

function materializeMigrations() {
  return import("./d1-migration-compat.mjs").then((m) => m.materializeD1CompatibleMigrations(path.join(REPO_ROOT, "migrations")));
}

// ------------------------------------------------------------ target: inproc
async function createInprocTarget(plan) {
  const { DatabaseSync } = await import("node:sqlite");
  const mig = await materializeMigrations();
  const sqlite = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync(mig.outputDir).filter((n) => n.endsWith(".sql")).sort()) {
    sqlite.exec(fs.readFileSync(path.join(mig.outputDir, f), "utf8"));
  }
  fs.rmSync(mig.workspace, { recursive: true, force: true });

  let stmts = 0;
  let rec = null; // when set, every D1/R2 result is appended in call order (replay script)
  const keep = (v) => { if (rec) rec.push(v); return v; };
  const make = (sql, params) => ({
    _sql: sql, _params: params,
    first: async () => keep(sqlite.prepare(sql).get(...params) ?? null),
    all: async () => keep({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => keep({ results: sqlite.prepare(sql).all(...params) }),
  });
  const db = {
    prepare: (sql) => ({ bind: (...params) => { stmts += 1; return make(sql, params); } }),
    batch: async (list) => {
      sqlite.exec("BEGIN");
      try {
        const out = list.map((s) => ({ results: sqlite.prepare(s._sql).all(...s._params) }));
        sqlite.exec("COMMIT");
        return keep(out);
      } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  };
  let r2Body = null;
  const bucket = {
    get: async (key) => {
      if (key !== STATS_KEY || r2Body == null) return keep(null);
      keep({ size: Buffer.byteLength(r2Body), text: r2Body });
      return { size: Buffer.byteLength(r2Body), json: async () => JSON.parse(r2Body), body: null };
    },
  };
  const env = { DB: db, BUCKET: bucket, BUILD_COMMIT_SHA: "a".repeat(40), WORKER_ADMIN_TOKEN: plan.adminToken, NEXT_PUBLIC_SITE_URL: SITE_URL };
  const { app } = await import(pathToFileURL(APP_PATH).href);
  const { sessionMiddleware } = await import(pathToFileURL(SESSION_PATH).href);
  const sm = sessionMiddleware();

  const exec = async (list) => { for (const s of list) sqlite.prepare(s.sql).run(...s.params); };
  await exec(SEED(plan.adminToken));

  const fetchOnce = async (spec) => {
    const url = `http://bench.local${spec.path}`;
    stmts = 0;
    const headers = new Headers(spec.headers ?? {});
    const before = performance.now();
    let res;
    if (spec.path.startsWith("/__bench/session")) {
      const vars = {};
      const c = { req: { url, header: (n) => headers.get(n) ?? undefined }, env, set: (k, v) => { vars[k] = v; }, header() {} };
      await sm(c, async () => {});
      res = Response.json({ state: vars.sessionState });
    } else if (spec.path.startsWith("/__bench/noop")) {
      res = new Response("ok");
    } else {
      res = await app.fetch(new Request(url, { method: spec.method, headers, body: spec.body }), env);
    }
    const cpuMs = performance.now() - before;
    const buf = await res.arrayBuffer();
    return { status: res.status, bytes: buf.byteLength, cpuMs, d1: stmts };
  };

  return {
    name: "inproc",
    resolutionMs: 0.001,
    digits: 3,
    cpuSource: "performance.now() wall delta around app.fetch (Node/V8, node:sqlite as D1; WALL-TIME PROXY, not workerd CPU)",
    supportsCold: false,
    setR2: async (body) => { r2Body = body; },
    exec,
    record: async () => null,
    run: async (spec) => fetchOnce(spec),
    /** Execute once (side effects included) and capture D1/R2 results for workerd replay. */
    recordForReplay: async (spec) => {
      rec = [];
      try {
        const r = await fetchOnce(spec);
        return { script: rec, status: r.status, d1: r.d1 };
      } finally { rec = null; }
    },
    close: async () => { sqlite.close(); },
  };
}

// ---------------------------------------------------------- target: wrangler
function workerSource(buildId) {
  const appUrl = APP_PATH.replaceAll("\\", "/");
  const sessionUrl = SESSION_PATH.replaceAll("\\", "/");
  return `// generated by scripts/benchmark-api-cpu.mjs (bench-only wrapper; not part of apps/api)
import { app } from ${JSON.stringify(appUrl)};
import { sessionMiddleware } from ${JSON.stringify(sessionUrl)};
const BUILD_ID = ${JSON.stringify(buildId)};
const sm = sessionMiddleware();
const STATS_KEY = ${JSON.stringify(STATS_KEY)};
const scripts = new Map();

// Replay env: D1/R2 return the results recorded by the in-process run, in call order,
// so the measured CPU is the app's own work without wrangler's local D1/R2 simulator.
function replayEnv(env, script) {
  let k = 0;
  const next = () => {
    if (k >= script.length) throw new Error("bench replay script exhausted");
    return script[k++];
  };
  const stmt = { bind: () => stmt, first: async () => next(), all: async () => next(), run: async () => next() };
  return [{
    ...env,
    DB: { prepare: () => stmt, batch: async () => next() },
    BUCKET: { get: async () => { const v = next(); return v && { size: v.size, json: async () => JSON.parse(v.text), body: null }; } },
  }, () => k];
}

function counting(env) {
  let n = 0;
  const DB = env.DB;
  const wrapped = {
    ...env,
    DB: {
      prepare: (s) => { n += 1; return DB.prepare(s); },
      batch: (list) => DB.batch(list),
      exec: (s) => DB.exec(s),
    },
  };
  return [wrapped, () => n];
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/__bench/ping") return new Response("ok", { headers: { "x-bench-build": BUILD_ID } });
    if (url.pathname === "/__bench/noop") return new Response("ok");
    if (url.pathname === "/__bench/burn") {
      // Calibration only: synchronous CPU burn so the harness can check the clock is real.
      let x = 0;
      const iters = Number(url.searchParams.get("iters") ?? 0);
      for (let i = 0; i < iters; i += 1) x = (x + Math.sqrt(i)) % 1e9;
      return new Response(String(x));
    }
    if (url.pathname === "/__bench/d1") {
      // Calibration only: n sequential trivial D1 reads = pure local-D1-simulator cost.
      const n = Number(url.searchParams.get("n") ?? 0);
      for (let i = 0; i < n; i += 1) await env.DB.prepare("SELECT 1 AS x").first();
      return new Response("ok");
    }
    if (url.pathname === "/__bench/cache-delete") {
      // Calibration only: n sequential Cache API deletes (what SA-007/008 do 8 times after commit).
      const n = Number(url.searchParams.get("n") ?? 0);
      for (let i = 0; i < n; i += 1) await caches.default.delete(new Request(url.origin + "/__bench/k" + i));
      return new Response("ok");
    }
    if (url.pathname === "/__bench/cache-clear") {
      // about-stats caches under a fixed key; clear it so every sample takes the R2-miss path.
      await caches.default.delete(new Request(url.origin + "/api/public/about-stats"));
      return new Response("ok");
    }
    if (url.pathname === "/__bench/exec") {
      const { list } = await request.json();
      const stmts = list.map((s) => env.DB.prepare(s.sql).bind(...s.params));
      await env.DB.batch(stmts);
      return new Response("ok");
    }
    if (url.pathname === "/__bench/r2") {
      if (request.method === "PUT") await env.BUCKET.put(STATS_KEY, await request.text());
      else await env.BUCKET.delete(STATS_KEY);
      return new Response("ok");
    }
    if (url.pathname === "/__bench/script") {
      const { id, script } = await request.json();
      scripts.set(id, script);
      return new Response("ok");
    }
    const sid = request.headers.get("x-bench-script");
    const script = sid ? scripts.get(sid) : null;
    if (sid) scripts.delete(sid);
    const [benchEnv, count] = script ? replayEnv(env, script) : counting(env);
    if (url.pathname === "/__bench/session") {
      const vars = {};
      const c = { req: { url: request.url, header: (n) => request.headers.get(n) ?? undefined }, env: benchEnv, set: (k, v) => { vars[k] = v; }, header() {} };
      await sm(c, async () => {});
      return Response.json({ state: vars.sessionState }, { headers: { "x-bench-d1": String(count()) } });
    }
    const res = await app.fetch(request, benchEnv, ctx);
    const out = new Response(res.body, res);
    out.headers.set("x-bench-d1", String(count()));
    return out;
  },
};
`;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createWranglerTarget(plan, opts) {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  const wranglerBin = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-api-bench-"));
  const state = path.join(workDir, "state");
  const mig = await materializeMigrations();
  const toml = path.join(workDir, "wrangler.toml");
  fs.writeFileSync(toml, [
    'name = "flamenode-api-bench-local"',
    'main = "worker.mjs"',
    'compatibility_date = "2025-01-09"',
    'compatibility_flags = ["nodejs_compat"]',
    "",
    "[vars]",
    `BUILD_COMMIT_SHA = "${"a".repeat(40)}"`,
    `WORKER_ADMIN_TOKEN = "${plan.adminToken}"`,
    `NEXT_PUBLIC_SITE_URL = "${SITE_URL}"`,
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "flamenode_db"',
    'database_id = "00000000-0000-0000-0000-000000000000"',
    `migrations_dir = ${JSON.stringify(mig.outputDir.replaceAll("\\", "/"))}`,
    "",
    "[[r2_buckets]]",
    'binding = "BUCKET"',
    'bucket_name = "flamenode-bench-local"',
    "",
  ].join("\n"));
  let build = 0;
  const workerPath = path.join(workDir, "worker.mjs");
  fs.writeFileSync(workerPath, workerSource(`b${build}`));

  const apply = spawnSync(process.execPath, [wranglerBin, "d1", "migrations", "apply", "flamenode_db", "--local", "--config", toml, "--persist-to", state], { cwd: workDir, encoding: "utf8" });
  fs.rmSync(mig.workspace, { recursive: true, force: true });
  if (apply.status !== 0) throw new Error(`local D1 migration apply failed:\n${apply.stdout}\n${apply.stderr}`);

  const base = `http://127.0.0.1:${opts.port}`;
  const child = spawn(process.execPath, [wranglerBin, "dev", "--local", "--config", toml, "--persist-to", state, "--port", String(opts.port), "--ip", "127.0.0.1", "--inspector-port", String(opts.inspectorPort)], { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const cleanup = async () => {
    killTree(child);
    await sleep(1500); // let workerd release its file handles (Windows EPERM otherwise)
    try { fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }); } catch (e) { console.error(`warning: could not remove ${workDir}: ${e.code}`); }
  };

  const ping = async () => {
    try { const r = await fetch(`${base}/__bench/ping`); return r.ok ? r.headers.get("x-bench-build") : null; } catch { return null; }
  };
  const waitBuild = async (want, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await ping()) === want) return; await sleep(150); }
    throw new Error(`wrangler dev did not serve build ${want} within ${ms}ms. Log tail:\n${log.slice(-1500)}`);
  };
  try { await waitBuild("b0"); } catch (e) { await cleanup(); throw e; }

  const post = (p, body, method = "POST") => fetch(`${base}${p}`, { method, body });
  const exec = async (list) => {
    for (let i = 0; i < list.length; i += 40) {
      const res = await post("/__bench/exec", json({ list: list.slice(i, i + 40) }));
      if (!res.ok) throw new Error(`exec failed: ${res.status} ${await res.text()}`);
    }
  };
  await exec(SEED(plan.adminToken));

  // CPU source: V8 sampling profiler on the workerd inspector (ws), one
  // Profiler.start/stop pair around each request. CPU = sum of sample deltas that
  // are not "(idle)" (I/O waits excluded). Sampling interval bounds the resolution.
  // NOTE: workerd's own span cpu_time_ms is NOT used: in wrangler dev --local it
  // reports 0 even for a multi-second synchronous burn (see clockCalibration).
  const WebSocket = createRequire(require.resolve("wrangler/package.json"))("ws");
  const SAMPLING_US = opts.samplingUs;
  let ws = null;
  let msgId = 0;
  const waiters = new Map();
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = (msgId += 1);
    waiters.set(id, resolve);
    ws.send(json({ id, method, params }));
  });
  const connect = async () => {
    if (ws) { try { ws.terminate(); } catch { /* already closed */ } }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${opts.inspectorPort}/json`)).json();
        const url = list[0]?.webSocketDebuggerUrl;
        if (url) {
          const sock = new WebSocket(url);
          await new Promise((res, rej) => { sock.once("open", res); sock.once("error", rej); });
          sock.on("message", (raw) => {
            const d = JSON.parse(raw.toString());
            const w = d.id && waiters.get(d.id);
            if (w) { waiters.delete(d.id); w(d); }
          });
          ws = sock;
          const en = await call("Profiler.enable");
          if (en.error) throw new Error(JSON.stringify(en.error));
          await call("Profiler.setSamplingInterval", { interval: SAMPLING_US });
          return;
        }
      } catch { /* inspector not ready yet */ }
      await sleep(150);
    }
    throw new Error("could not attach to the workerd inspector");
  };
  await connect();

  // The sampler on this host does not tick every SAMPLING_US: one non-idle sample can carry
  // a multi-ms delta. The largest single non-idle delta seen in real measurements is the
  // honest resolution of every number below (used by judge()).
  let quantumMs = SAMPLING_US / 1000;
  let countQuantum = false;
  const profileBusyMs = (profile) => {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    let busy = 0;
    profile.samples.forEach((sid, k) => {
      if (byId.get(sid)?.callFrame.functionName === "(idle)") return;
      const dt = profile.timeDeltas[k] / 1000;
      busy += dt;
      if (countQuantum && dt > quantumMs) quantumMs = dt;
    });
    return busy;
  };
  let scriptSeq = 0;
  const run = async (spec, rec = null) => {
    const headers = { ...(spec.headers ?? {}) };
    if (rec) {
      const id = `s${(scriptSeq += 1)}`;
      const reg = await post("/__bench/script", json({ id, script: rec.script }));
      if (!reg.ok) throw new Error(`script upload failed: ${reg.status}`);
      headers["x-bench-script"] = id;
    }
    await call("Profiler.start");
    const res = await fetch(`${base}${spec.path}`, { method: spec.method, headers, body: spec.body });
    const buf = await res.arrayBuffer();
    const stop = await call("Profiler.stop");
    if (stop.error) throw new Error(`Profiler.stop failed: ${json(stop.error)}`);
    return {
      status: res.status, bytes: buf.byteLength, d1: rec ? rec.d1 : Number(res.headers.get("x-bench-d1") ?? 0),
      cpuMs: profileBusyMs(stop.result.profile),
      replayStatusMismatch: rec ? rec.status !== res.status : false,
    };
  };

  // Calibration: the profiler must track a known synchronous burn, and we record that
  // workerd's own cpu_time_ms span attribute does not (kept as evidence for the doc).
  const calibration = [];
  for (const iters of [0, 2_000_000, 20_000_000]) {
    const t0 = performance.now();
    const r = await run({ method: "GET", path: `/__bench/burn?iters=${iters}` });
    calibration.push({ route: "burn", iters, clientWallMs: Math.round(performance.now() - t0), profilerBusyMs: Number(r.cpuMs.toFixed(2)) });
  }
  // Local D1 simulator cost per trivial read (production D1 is a remote call: its wait is not CPU).
  for (const n of [1, 8]) {
    const runs = [];
    for (let k = 0; k < 5; k += 1) runs.push((await run({ method: "GET", path: `/__bench/cache-delete?n=${n}` })).cpuMs);
    calibration.push({ route: "cache-api-deletes", n, profilerBusyMsMax: Number(Math.max(...runs).toFixed(2)), profilerBusyMsMin: Number(Math.min(...runs).toFixed(2)) });
  }
  for (const n of [1, 17]) {
    const runs = [];
    for (let k = 0; k < 5; k += 1) runs.push((await run({ method: "GET", path: `/__bench/d1?n=${n}` })).cpuMs);
    calibration.push({ route: "d1-trivial-reads", n, profilerBusyMsMax: Number(Math.max(...runs).toFixed(2)), profilerBusyMsMin: Number(Math.min(...runs).toFixed(2)) });
  }

  quantumMs = SAMPLING_US / 1000;
  countQuantum = true;

  return {
    calibration,
    name: "wrangler",
    get resolutionMs() { return quantumMs; },
    digits: 2,
    cpuSource: `V8 sampling profiler (${SAMPLING_US}us interval, non-idle samples) attached to wrangler dev --local (workerd) via inspector; local D1/R2 SIMULATOR CPU INCLUDED (--d1 sim); local, not production`,
    supportsCold: true,
    setR2: async (body) => { if (body == null) await post("/__bench/r2", undefined, "DELETE"); else await post("/__bench/r2", body, "PUT"); },
    exec,
    clearCache: async () => { await post("/__bench/cache-clear"); },
    record: async () => null,
    run,
    reload: async () => {
      build += 1;
      fs.writeFileSync(workerPath, workerSource(`b${build}`));
      await waitBuild(`b${build}`);
      await connect();
    },
    toolVersions: () => spawnSync(process.execPath, [wranglerBin, "--version"], { encoding: "utf8" }).stdout.trim(),
    close: async () => { try { ws?.terminate(); } catch { /* ignore */ } await cleanup(); },
  };
}

// --------------------------------------------------------------------- runner
function tag(prefix, n) { return `${prefix}${n.toString(36)}`; }

async function runScenario(target, sc, opts, state) {
  const samples = [];
  const note = (kind, spec, r, cpuMs) => samples.push({
    kind, cpuMs, status: r.status, bytes: r.bytes, d1: r.d1,
    unexpected: !spec.expect.includes(r.status) || r.replayStatusMismatch === true,
  });
  for (const kind of ["normal", "limit", "invalid"]) {
    const pk = sc.prepareKind?.[kind];
    if (pk) await target.setR2(pk.r2);
    const make = sc.kinds[kind];
    const runTag = tag("k", ++state.tagSeq);
    for (let i = 0; i < opts.warmup; i += 1) {
      const spec = make(i, `${runTag}w`);
      if (spec.setup) await target.exec(spec.setup);
      if (spec.clearCache) await target.clearCache?.();
      await target.run(spec, await target.record(spec));
    }
    for (let i = 0; i < opts.samples; i += 1) {
      const spec = make(i, runTag);
      if (spec.setup) await target.exec(spec.setup);
      if (spec.clearCache) await target.clearCache?.();
      const r = await target.run(spec, await target.record(spec));
      note(kind, spec, r, r.cpuMs);
    }
  }
  return samples;
}

/** Cold: seed first, reload the isolate, then fire one request per scenario (rotated). */
async function runCold(target, scenarios, opts) {
  const live = scenarios;
  const coldSamples = new Map(live.map((s) => [s.id, []]));
  const statsScenario = scenarios.find((s) => s.id === "RH-026");
  if (statsScenario) await target.setR2(statsScenario.prepareKind.normal.r2);
  for (let round = 0; round < opts.coldSamples; round += 1) {
    const plan = [];
    for (const sc of live) {
      const spec = sc.kinds.normal(round, tag(`c${sc.id.replace(/[^A-Za-z0-9]/g, "")}`, round));
      if (spec.setup) await target.exec(spec.setup);
      if (spec.clearCache) await target.clearCache?.();
      plan.push({ sc, spec, rec: await target.record(spec) });
    }
    await target.reload();
    const order = plan.map((_, n) => plan[(n + round) % plan.length]);
    for (const { sc, spec, rec } of order) {
      const r = await target.run(spec, rec);
      coldSamples.get(sc.id).push({ kind: "cold", cpuMs: r.cpuMs, status: r.status, bytes: r.bytes, d1: r.d1, unexpected: !spec.expect.includes(r.status) || r.replayStatusMismatch === true });
    }
    process.stderr.write(`cold round ${round + 1}/${opts.coldSamples}\r`);
  }
  process.stderr.write("\n");
  return coldSamples;
}

/** Replay: setup/record on the in-process sqlite, measure on workerd with D1/R2 stubbed. */
function createReplayTarget(inproc, wr) {
  return {
    ...wr,
    cpuSource: wr.cpuSource.replace("local D1/R2 SIMULATOR CPU INCLUDED (--d1 sim)", "D1/R2 stubbed with results recorded from an in-process node:sqlite run (--d1 replay): CPU = app code in workerd; local D1/R2 simulator and real D1 round-trip excluded"),
    exec: inproc.exec,
    setR2: inproc.setR2,
    record: (spec) => inproc.recordForReplay(spec),
    close: async () => { await wr.close(); await inproc.close(); },
  };
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const plan = { adminToken: `bench-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}` };
  const scenarios = buildScenarios(plan).filter((s) => !opts.only || opts.only.includes(s.id) || s.id === "BASELINE");

  if (opts.dryRun) {
    const fake = Array.from({ length: opts.samples }, (_, i) => ({ kind: "normal", cpuMs: (i % 7) + 0.5, status: 200, bytes: 10, d1: 2, unexpected: false }));
    const agg = aggregate(fake, { runtimeClass: "S2", resolutionMs: 1 });
    console.log(`dry-run: mode=${opts.mode} samples=${opts.samples} warmup=${opts.warmup} cold=${opts.skipCold ? "skipped" : opts.coldSamples}`);
    for (const s of scenarios) console.log(`  ${s.id.padEnd(8)} ${s.runtimeClass}  ${s.title}`);
    console.log(`aggregation self-check (synthetic, NOT a measurement): max=${agg.overallMax} verdict=${agg.verdict}`);
    return;
  }

  let target;
  if (opts.mode === "inproc") target = await createInprocTarget(plan);
  else if (opts.d1 === "sim") target = await createWranglerTarget(plan, opts);
  else target = createReplayTarget(await createInprocTarget(plan), await createWranglerTarget(plan, opts));
  const startedAt = new Date().toISOString();
  const results = [];
  try {
    const state = { tagSeq: 0 };
    for (const sc of scenarios) {
      process.stderr.write(`measuring ${sc.id} ...\n`);
      const samples = await runScenario(target, sc, opts, state);
      results.push({ id: sc.id, title: sc.title, runtimeClass: sc.runtimeClass, samples });
    }
    if (target.supportsCold && !opts.skipCold) {
      const cold = await runCold(target, scenarios, opts);
      for (const r of results) r.samples.push(...cold.get(r.id));
    }
    const resolutionMs = target.resolutionMs;
    const base = results.find((r) => r.id === "BASELINE");
    const baseAgg = base ? aggregate(base.samples, { runtimeClass: "S2", resolutionMs }) : null;
    const noiseMs = baseAgg?.overallMax ?? 0;
    for (const r of results) {
      r.agg = aggregate(r.samples, { runtimeClass: r.runtimeClass, resolutionMs, noiseMs });
      if (r.id === "BASELINE") r.agg.verdict = "NOISE_FLOOR";
    }
  } finally {
    try { await target.close(); } catch (e) { console.error(`warning: target close failed: ${e.message}`); }
  }

  const meta = {
    label: "LOCAL MEASUREMENT - NOT A PRODUCTION VALUE",
    startedAt, mode: target.name === "wrangler" ? `wrangler (--d1 ${opts.d1})` : target.name, cpuSource: target.cpuSource,
    node: process.version, platform: `${process.platform}/${os.arch()}`,
    wrangler: target.toolVersions?.() ?? null,
    commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim(),
    samplesPerKind: opts.samples, coldSamples: target.supportsCold && !opts.skipCold ? opts.coldSamples : 0, warmupDiscarded: opts.warmup,
    resolutionMs: target.resolutionMs,
    noiseFloorMs: results.find((r) => r.id === "BASELINE")?.agg.overallMax ?? null,
    clockCalibration: target.calibration ?? null,
  };
  const md = renderMarkdown(results, { digits: target.digits, label: target.name === "inproc" ? "Node proxy, not workerd" : "local workerd, 1ms clock" });
  console.log(`# ${meta.label}\n\n${json(meta)}\n\n${md}`);
  if (opts.out) {
    fs.writeFileSync(opts.out, json({ meta, results: results.map(({ id, title, runtimeClass, agg }) => ({ id, title, runtimeClass, agg })) }, null, 2));
  }
  if (results.some((r) => Object.values(r.agg.kinds).some((k) => k.unexpectedStatus > 0))) {
    console.error("WARNING: some samples returned an unexpected HTTP status; those CPU numbers are not trustworthy (see 'unexpected status' column).");
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
}

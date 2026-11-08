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
    port: 8788, inspectorPort: 9239, d1: "replay", samplingUs: 100, only: null, out: null, dryRun: false, skipCold: false, includePending: false,
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
    else if (a === "--include-pending") out.includePending = true;
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
const BENCH_ETAG = "bench-etag";
// Bench-only upstream image stub: media proxy scenarios must never reach the network.
const BENCH_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const benchFetchStub = async () => new Response(BENCH_PNG, { headers: { "content-type": "image/png" } });
const MAX_STATS_BYTES = 64 * 1024;

function adminHeaders() {
  return { cookie: ADMIN_COOKIE, origin: SITE_URL, "content-type": "application/json" };
}
const json = (v) => JSON.stringify(v);
const annBody = (extra = {}) => ({ title: "Bench", body: "Bench body", severity: "info", target_audience: "all", is_published: 1, ...extra });

const RH013_EVENT_ID = "bench-export-event";
const RH013_VIDEOS = 500;
const RH013_MEMBERS_PER_VIDEO = 100;
let rh013Seeded = false;
let rh013IpSeq = 0;
const rh013Ip = () => { rh013IpSeq += 1; return { "cf-connecting-ip": `10.13.${(rh013IpSeq >> 8) & 255}.${rh013IpSeq & 255}` }; };
/** Seed once per process: returns [] after the first call (the event persists in the target DB). */
function rh013Seed() {
  if (rh013Seeded) return [];
  rh013Seeded = true;
  return [
    { sql: `INSERT OR REPLACE INTO events (id, title, event_type, visibility_status, start_time, end_time, created_at, updated_at, max_slots_per_video, public_api_enabled) VALUES (?, 'bench export event', 'event', 'public', 1000, 2000, 10, 20, 1, 1)`, params: [RH013_EVENT_ID] },
    {
      sql: `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?) INSERT OR REPLACE INTO videos (id, title, submitted_by_user_id, creator_display_name, primary_event_id, visibility_status, scheduled_time) SELECT 'bench-export-v' || i, 'bench export video ' || i, 'bench-admin', 'creator', ?, 'public', 1500 + i FROM n`,
      params: [RH013_VIDEOS - 1, RH013_EVENT_ID],
    },
    {
      sql: `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?) INSERT OR REPLACE INTO video_members (id, video_id, x_user_id, name, role, order_index, is_public_member) SELECT 'bench-export-m' || v.i || '-' || m.i, 'bench-export-v' || v.i, NULL, 'member ' || m.i, 'editor', m.i, 1 FROM (SELECT i FROM n WHERE i < ?) v CROSS JOIN (SELECT i FROM n WHERE i < ?) m`,
      params: [Math.max(RH013_VIDEOS, RH013_MEMBERS_PER_VIDEO) - 1, RH013_VIDEOS, RH013_MEMBERS_PER_VIDEO],
    },
  ];
}

export function buildScenarios(ctx, { includePending = false } = {}) {
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
  // MIG-0639: seed bounded collections in one recursive SQL statement per table.
  // Unique per-sample IDs prevent 15s isolate response caching from hiding the scan cost.
  const liveEventId = (endpoint, i, tag) => `live-${endpoint}-${tag}-${i}`;
  const liveSlotRows = (id, count) => numberedRows(
    count,
    "INSERT INTO slots (id, event_id, start_time, status) SELECT ? || '-slot-' || n, ?, n, 'available' FROM seq",
    [id, id],
  );
  const liveVideoRows = (id, count) => [
    numberedRows(count, "INSERT INTO videos (id, submitted_by_user_id, creator_display_name, title, visibility_status, updated_at) SELECT ? || '-v-' || n, 'bench-admin', 'Bench', 'Bench', 'public', 1000 + n FROM seq", [id]),
    numberedRows(count, "INSERT INTO video_events (video_id, event_id) SELECT ? || '-v-' || n, ? FROM seq", [id, id]),
  ];
  const liveSpec = (endpoint, count, i, tag) => {
    const id = liveEventId(endpoint, i, tag);
    const rows = endpoint === "submissions" ? liveVideoRows(id, count) : [liveSlotRows(id, count)];
    return { method: "GET", path: `/api/live/events/${id}/${endpoint}`, setup: [eventRow(id), ...rows], expect: [200] };
  };
  const invalidLive = (endpoint) => ({
    method: "GET", path: `/api/live/events/${"e".repeat(129)}/${endpoint}`, expect: [400],
  });
  const LONG_TITLE = "T".repeat(200);
  const LONG_BODY = "B".repeat(8000);
  const LONG_EVENT_ID = "e".repeat(128);

  const core = [
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
      // MIG-0632 U04. Upper bound: event 1 x 500 public videos x 100 public members each.
      // scheduled + clearCache => the payload Cache API entry never hits, so every sample
      // runs the full D1 gate + snapshot + payload build path (the realtime isolate micro
      // cache would otherwise turn warm samples into cheap hits). Seeding is idempotent and
      // done once per target through a single recursive-CTE statement per table.
      id: "RH-013", title: "GET /api/event-endpoints/:id (500 videos x 100 members)", runtimeClass: "S2",
      kinds: {
        // distinct client IP per request: the route has a 60/min per-IP isolate rate guard
        normal: () => ({ setup: rh013Seed(), method: "GET", path: `/api/event-endpoints/${RH013_EVENT_ID}?format=v5&update=scheduled&refresh=15`, headers: rh013Ip(), clearCache: true, expect: [200] }),
        limit: () => ({ setup: rh013Seed(), method: "GET", path: `/api/event-endpoints/${RH013_EVENT_ID}?format=legacy&update=scheduled&refresh=1440`, headers: rh013Ip(), clearCache: true, expect: [200] }),
        invalid: () => ({ method: "GET", path: `/api/event-endpoints/${RH013_EVENT_ID}?format=xxx`, headers: rh013Ip(), expect: [400] }),
      },
    },
    {
      id: "RH-020", title: "GET /api/live/events/:id/slots (6000-slot D-12 cap)", runtimeClass: "S2",
      kinds: {
        normal: (i, tag) => liveSpec("slots", 1, i, tag),
        limit: (i, tag) => liveSpec("slots", 6000, i, tag),
        invalid: () => invalidLive("slots"),
      },
    },
    {
      id: "RH-021", title: "GET /api/live/events/:id/submissions (50 public videos)", runtimeClass: "S2",
      kinds: {
        normal: (i, tag) => liveSpec("submissions", 1, i, tag),
        limit: (i, tag) => liveSpec("submissions", 50, i, tag),
        invalid: () => invalidLive("submissions"),
      },
    },
    {
      id: "RH-022", title: "GET /api/live/events/:id/summary (6000-slot counts)", runtimeClass: "S2",
      kinds: {
        normal: (i, tag) => liveSpec("summary", 1, i, tag),
        limit: (i, tag) => liveSpec("summary", 6000, i, tag),
        invalid: () => invalidLive("summary"),
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
  // MIG-0639: every other main Hono method (inventory below), then BASELINE last (noise floor of the same run).
  const baseline = core.pop();
  return [...core, ...buildRouteScenarios(), ...(includePending ? buildPendingScenarios() : []), baseline];
}

// ------------------------------------------------ MIG-0639 route inventory
// One entry per remaining main Hono method (taken from `app.routes`; RH-017/018/020..022/026/029 and
// SA-004..008 have their own scenarios above). Access classes:
//   p = public (anonymous), s = signed-in reader, a = admin reader, w = admin write (origin + JSON body).
// Kinds for this generic inventory (fixture = the shared minimal rows in SEED):
//   normal  valid request on the shared fixture, with a session when the route needs one
//   limit   same request with every bounded input at its cap (limit/page/q, long reasons, long csv)
//   invalid public: 129-char id or garbage query. session reads: no session. writes: session + empty body.
// Data-depth upper bounds (6000 slots, 50 videos, 500 videos x 100 members, spreadsheet page) have their own
// named scenarios; this table does NOT claim data-depth coverage for the other methods.
const numberedRows = (limit, sql, params) => ({
  sql: `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${limit}) ${sql}`,
  params,
});
const BENCH_IP = (kind, i) => `${{ normal: "10.20", limit: "10.21", invalid: "10.22" }[kind]}.${(i >> 8) & 255}.${i & 255}`;
const BIG_Q = `?limit=100&page=1000&q=${"a".repeat(100)}`;

const RELEASE_KEY = "events/bench-evt/release.v1.json";
const releaseArtifact = (videos, members) => json({
  schema_version: 1, generated_at: 1_700_000_000,
  event: { id: "bench-evt", title: "bench event", visibility_status: "public" },
  videos: Array.from({ length: videos }, (_, v) => ({
    id: `rv-${v}`, title: `Video ${v}`, youtube_video_id: `yt${v}`, visibility_status: "public", collaboration_type: "individual",
    creator_display_name: "Bench", scheduled_time: 1_700_000_000 + v,
    members: Array.from({ length: members }, (_, m) => ({ name: `Member ${m}`, x_user_id: `mx${m}`, role: "edit", comment: "c", order_index: m })),
  })),
  total: videos,
});
const MANIFEST_KEY = "visibility/blocked-entities.v1.json";
const emptyManifest = json({ schema_version: 1, revision: 1, generated_at: 1_700_000_000, entities: [] });
const staffArtifact = (n) => json({
  generated_at: 1_700_000_000,
  event: { id: "bench-evt", title: "bench event", visibility_status: "public" },
  public_staff: Array.from({ length: n }, (_, k) => ({ display_name: `Staff ${k}`, public_role_label: "staff", x_user_id: `Staff_${k}`, x_name: `Staff ${k}`, icon_url: "/icon.jpg", has_public_profile: true, permission_preset: "owner" })),
});
const recentArtifact = (n) => json({
  generated_at: 1_700_000_000, total: n,
  items: Array.from({ length: n }, (_, k) => ({ id: `rv${k}`, title: `Video ${k}`, youtube_video_id: `yt${k}`, display_name: "Bench", icon_url: "https://img.invalid/1.png", scheduled_time: 1_700_000_000 + k, status: "public" })),
});
const videoOverlayArtifact = json({
  version: 1, generated_at: 1000,
  video: { id: "bench-vid", title: "Bench video", visibility_status: "public", scheduled_time: 2000, primary_event_id: "bench-evt" },
  public_events: [], public_chapters: [],
});
const prep = (normal, limit, invalid = normal) => ({ normal: { r2Objects: normal }, limit: { r2Objects: limit }, invalid: { r2Objects: invalid } });
const tplRow = (id) => ({ sql: `INSERT INTO event_templates (id, name, settings_json, created_by_user_id, created_at, updated_at) VALUES (?, 'bench tpl', '{}', 'bench-admin', 10, 10)`, params: [id] });
const chapterRow = (id) => ({ sql: `INSERT INTO video_chapters (id, video_id, chapter_time, chapter_label, visibility, created_at, updated_at) VALUES (?, 'bench-vid', 7, 'bench', 'public', 10, 10)`, params: [id] });

// MIG-0639 / SA-045..048: deterministic local-only notification rows.
// Each request gets its own outbox ID so retry/cancel/force writes cannot consume a later sample.
const benchNotificationId = (i, tag) => `bench-notif-${tag}-${i}`;
const notificationRow = (id, status = "failed") => ({
  sql: "INSERT OR REPLACE INTO notification_outbox (id,recipient_user_id,type,payload_json,delivery_route,status,attempt_count,created_at) VALUES (?, 'bench-admin', 'video_approved', '{\"content\":\"bench\"}', 'dm', ?, 5, 100)",
  params: [id, status],
});
const notificationParams = (kind, i, tag) => ({ id: benchNotificationId(i, tag) });
const notificationSetup = (status) => (kind, i, tag) => [notificationRow(benchNotificationId(i, tag), status)];

export const ROUTE_INVENTORY = [
  // [id, method, path, access, options]
  ["MIG-0661", "GET", "/api/operation-mode/banner", "p"],
  ["RH-027", "OPTIONS", "/api/public/events/:id/staff", "p", { headers: (k) => ({ origin: k === "invalid" ? "https://evil.invalid" : "https://pvsf.jp", "access-control-request-method": "GET" }) }],
  ["RH-028", "GET", "/api/public/events/:id/staff", "p", { prepare: prep({ [MANIFEST_KEY]: emptyManifest, "events/bench-evt/base.v1.json": staffArtifact(1) }, { [MANIFEST_KEY]: emptyManifest, "events/bench-evt/base.v1.json": staffArtifact(100) }) }],
  ["HONO-PERS-01", "POST", "/api/personal/terms/accept", "w"],
  ["HONO-PERS-02", "POST", "/api/personal/onboarding/terms", "w"],
  ["HONO-PERS-03", "POST", "/api/personal/onboarding/complete", "w"],
  ["HONO-PERS-04", "GET", "/api/personal/session", "s"],
  ["HONO-PERS-05", "GET", "/api/personal/dashboard", "s"],
  ["HONO-PERS-06", "GET", "/api/personal/library", "s"],
  ["HONO-PERS-07", "GET", "/api/personal/settings", "s"],
  ["HONO-PERS-08", "GET", "/api/personal/onboarding", "s"],
  ["HONO-PERS-09", "GET", "/api/personal/entry", "s"],
  ["HONO-PERS-10", "GET", "/api/personal/entry/slotted", "s"],
  ["HONO-PERS-11", "GET", "/api/personal/entry/unslotted", "s"],
  ["HONO-PERS-12", "GET", "/api/personal/edit/:id/permissions", "s"],
  ["HONO-PERS-13", "GET", "/api/personal/edit/:id/form-options", "s"],
  ["HONO-PERS-14", "GET", "/api/personal/edit/:id", "s"],
  ["HONO-AR-01", "GET", "/api/admin-read/cost-guard-banner", "a"],
  ["HONO-AR-02", "GET", "/api/admin-read/users/:id/edit", "a"],
  ["HONO-AR-03", "GET", "/api/admin-read/users", "a"],
  ["HONO-AR-04", "GET", "/api/admin-read/users/:id", "a"],
  ["HONO-AR-05", "GET", "/api/admin-read/videos", "a"],
  ["HONO-AR-06", "GET", "/api/admin-read/videos/:id/members", "a"],
  ["HONO-AR-07", "GET", "/api/admin-read/videos/:id", "a"],
  ["HONO-AR-08", "GET", "/api/admin-read/event-groups", "a"],
  ["HONO-AR-09", "GET", "/api/admin-read/event-groups/:id", "a"],
  ["HONO-AR-10", "GET", "/api/admin-read/events/templates", "a"],
  ["HONO-AR-11", "GET", "/api/admin-read/events/new", "a"],
  ["HONO-AR-12", "GET", "/api/admin-read/events", "a"],
  ["HONO-AR-13", "GET", "/api/admin-read/moderation", "a"],
  ["HONO-AR-14", "GET", "/api/admin-read/x-link-requests", "a"],
  ["HONO-AR-15", "GET", "/api/admin-read/x-id-merges", "a"],
  ["HONO-AR-16", "GET", "/api/admin-read/announcements", "a"],
  ["HONO-AR-17", "GET", "/api/admin-read/announcements/:id", "a"],
  ["HONO-AR-18", "GET", "/api/admin-read/rules", "a"],
  ["HONO-AR-19", "GET", "/api/admin-read/rules/:id", "a"],
  ["HONO-AR-20", "GET", "/api/admin-read/permissions/simulator", "a"],
  ["HONO-AR-21", "GET", "/api/admin-read/api-endpoints", "a"],
  ["HONO-AR-22", "GET", "/api/admin-read/audit-settings", "a"],
  ["HONO-AR-23", "GET", "/api/admin-read/audit", "a"],
  ["HONO-AR-24", "GET", "/api/admin-read/audit/restore", "a"],
  ["HONO-AR-25", "GET", "/api/admin-read/audit/:id", "a"],
  ["HONO-AR-26", "GET", "/api/admin-read/audit/:id/payload/:field", "a", { nq: "", lq: "?offset=12000" }],
  ["HONO-AR-27", "GET", "/api/admin-read/ops/notifications", "a"],
  ["HONO-AR-28", "GET", "/api/admin-read/ops/health", "a"],
  ["HONO-AR-29", "GET", "/api/admin-read/ops/integrity", "a"],
  ["HONO-AR-30", "GET", "/api/admin-read/ops/static-builds", "a"],
  ["HONO-AR-31", "GET", "/api/admin-read/ops/workers", "a"],
  ["HONO-AR-32", "GET", "/api/admin-read/ops/security", "a"],
  ["HONO-AR-33", "GET", "/api/admin-read/ops/youtube-playlists", "a"],
  ["HONO-AR-34", "GET", "/api/admin-read/ops/youtube-quota", "a"],
  ["HONO-AR-35", "GET", "/api/admin-read/ops/top", "a"],
  ["HONO-AR-36", "GET", "/api/admin-read/ops/cost-guard", "a"],
  ["HONO-AR-37", "GET", "/api/admin-read/ops/youtube-sync", "a"],
  ["HONO-MG-01", "GET", "/api/manage/navigation", "s"],
  ["HONO-MG-02", "GET", "/api/manage/events/:id/staff", "s"],
  ["HONO-MG-03", "GET", "/api/manage/events/:id/slots", "s"],
  ["HONO-MG-04", "GET", "/api/manage/events/:id/edit", "s"],
  ["HONO-MG-05", "GET", "/api/manage/events/:id/videos/:videoId", "s"],
  ["HONO-MG-06", "GET", "/api/manage/events/:id/videos", "s"],
  ["HONO-MG-07", "GET", "/api/manage/events/:id/youtube-playlist", "s"],
  ["SA-038", "PUT", "/api/manage/events/:id/youtube-playlist", "w"],
  ["SA-039", "POST", "/api/manage/events/:id/youtube-playlist/sync", "w"],
  ["HONO-MG-08", "GET", "/api/manage/events/:id/audience", "s"],
  ["HONO-MG-09", "GET", "/api/manage/events/:id", "s"],
  ["HONO-MG-10", "GET", "/api/manage/notifications", "s"],
  ["HONO-MG-11", "GET", "/api/manage/x-link-requests", "s"],
  ["HONO-MG-12", "GET", "/api/manage", "s"],
  ["RH-003", "GET", "/api/admin/spreadsheet/data", "a", { nq: "?table=events&page=1&limit=50", setup: (k) => (k === "limit" ? [spreadsheetRows(60)] : undefined) }],
  ["RH-007", "GET", "/api/admin/spreadsheet/export", "a", { nq: "?table=events&format=csv", setup: (k) => (k === "limit" ? [spreadsheetRows(120)] : undefined) }],
  ["RH-009", "GET", "/api/admin/spreadsheet/tables", "a"],
  // SA-045..048: verified handler contracts from apps/api/src/routes/admin/notifications.ts
  ["SA-048", "POST", "/api/admin/notifications/retry-failed", "w", { setup: notificationSetup("failed") }],
  ["SA-045", "POST", "/api/admin/notifications/:id/retry", "w", { params: notificationParams, setup: notificationSetup("failed") }],
  ["SA-046", "POST", "/api/admin/notifications/:id/cancel", "w", { params: notificationParams, setup: notificationSetup("pending") }],
  ["SA-047", "POST", "/api/admin/notifications/:id/force-resend", "w", { params: notificationParams, setup: notificationSetup("sent") }],
  ["HONO-ADM-01", "GET", "/api/admin/event-templates", "a"],
  ["SA-009", "POST", "/api/admin/audit/settings", "w"],
  ["SA-010", "POST", "/api/admin/audit/dry-run", "w"],
  ["SA-016", "POST", "/api/admin/cost-guard/mode", "w"],
  ["SA-017", "POST", "/api/admin/cost-guard/maintenance", "w"],
  ["SA-018", "POST", "/api/admin/cost-guard/override", "w"],
  ["SA-019", "POST", "/api/admin/cost-guard/disabled-features", "w", { setup: () => [{ sql: `UPDATE system_settings SET disabled_features_json = NULL WHERE id = 'default'`, params: [] }] }],
  ["SA-020", "POST", "/api/admin/cost-guard/override/clear", "w"],
  ["HONO-ADM-02", "POST", "/api/admin/users/:userId/role", "w"],
  ["HONO-ADM-03", "POST", "/api/admin/users/:userId/banned", "w"],
  ["HONO-ADM-04", "POST", "/api/admin/users/:userId/notifications", "w"],
  ["HONO-ADM-05", "POST", "/api/admin/users/:userId/can-create-events", "w"],
  ["HONO-ADM-06", "POST", "/api/admin/x-users/:xUserId/icon-refresh", "w"],
  ["HONO-ADM-07", "POST", "/api/admin/event-templates", "w"],
  ["SA-036", "DELETE", "/api/admin/event-templates/:id", "w", { params: (k, i, tag) => ({ id: `tpl-${tag}-${i}` }), setup: (k, i, tag) => [tplRow(`tpl-${tag}-${i}`)] }],
  // RH-014 limit = D-12: the signed-in viewer owns exactly MAX_VIEWER_SLOTS (100) slots (fails closed above that or above 64 KiB).
  ["RH-014", "GET", "/api/events/:id/slots/viewer-overlay", "p", { session: true, params: (k) => (k === "limit" ? { id: "bench-evt-own" } : {}), setup: (k) => (k === "limit" ? [ownEventRow(), ownSlotRows(100)] : undefined) }],
  // RH-015 limit = MIG-0631 T17: a full page of 60 public events with a 2,000-char explanation each.
  ["RH-015", "GET", "/api/events", "p", { lq: "?page=1&limit=60", setup: (k) => (k === "limit" ? [publicEventRows(60)] : undefined) }],
  // RH-012 limit = MIG-0631 T17: 500 videos x 100 members in the event_release artifact (EVENT_RELEASE_MAX_*).
  ["RH-012", "GET", "/api/event-endpoints/:id/release", "p", { prepare: prep({ [RELEASE_KEY]: releaseArtifact(1, 1) }, { [RELEASE_KEY]: releaseArtifact(500, 100) }) }],
  ["RH-032", "GET", "/api/videos", "p", { lq: "?limit=48&page=1&sort=recent", prepare: prep({ "list/recent.json": recentArtifact(5) }, { "list/recent.json": recentArtifact(200) }) }],
  ["RH-031", "GET", "/api/videos/:id/viewer-overlay", "p", { session: true, prepare: prep({ "videos/bench-vid.json": videoOverlayArtifact }, { "videos/bench-vid.json": videoOverlayArtifact }) }],
  ["RH-030", "GET", "/api/videos/:id", "p"],
  ["SA-012", "POST", "/api/videos/:videoId/chapters", "w"],
  ["SA-015", "POST", "/api/videos/:videoId/chapters/bulk", "w"],
  ["SA-013", "PUT", "/api/videos/chapters/:chapterId", "w"],
  ["SA-014", "DELETE", "/api/videos/chapters/:chapterId", "w", { params: (k, i, tag) => ({ chapterId: `ch-${tag}-${i}` }), setup: (k, i, tag) => [chapterRow(`ch-${tag}-${i}`)] }],
  ["SA-087", "POST", "/api/videos/:videoId/interaction", "w"],
  ["RH-001", "GET", "/api/account/summary", "s"],
  ["RH-016", "GET", "/api/google-drive-image/:id", "p"],
  ["RH-033", "GET", "/api/youtube-thumbnail/:id/:size", "p"],
  ["RH-024", "GET", "/api/media/manage-x-icon/*", "p"],
  ["RH-025", "GET", "/api/media/slot-submission-icon/:slotId", "p"],
  ["RH-023", "GET", "/api/media/*", "p"],
  ["RH-019", "GET", "/api/internal/x-users/search", "s"],
];

function routeParam(pattern, name) {
  if (name === "videoId") return "bench-vid";
  if (name === "userId") return "bench-target";
  if (name === "xUserId") return "bench-x";
  if (name === "slotId") return "bench-slot";
  if (name === "chapterId") return "bench-chapter";
  if (name === "field") return "before";
  if (name === "size") return "hqdefault";
  if (/\/google-drive-image\/:id/.test(pattern)) return "bench-drive-id-123456";
  if (/\/youtube-thumbnail\/:id/.test(pattern)) return "dQw4w9WgXcQ";
  if (/\/(events|event-endpoints)\/:id/.test(pattern)) return "bench-evt";
  if (/\/(videos|personal\/edit)\/:id/.test(pattern)) return "bench-vid";
  if (/\/users\/:id/.test(pattern)) return "bench-target";
  if (/\/announcements\/:id/.test(pattern)) return "bench-ann";
  if (/\/rules\/:id/.test(pattern)) return "bench-terms";
  if (/\/audit\/:id/.test(pattern)) return "bench-audit";
  if (/event-groups\/:id/.test(pattern)) return "bench-group";
  return "bench-missing";
}

const fillRoute = (pattern, longId, dyn = {}) => pattern
  .replace(/:([A-Za-z]+)/g, (_, name) => dyn[name] ?? (longId && name === "id" ? "e".repeat(129) : routeParam(pattern, name)))
  .replace("*", pattern.includes("manage-x-icon") ? "bench/icon.png" : "public/bench.png");

// Spreadsheet max page (MIG-0605 F-7): enough `events` rows that the page (50) / export (99) caps are what bound the work.
const spreadsheetRows = (count) => numberedRows(count, "INSERT OR REPLACE INTO events (id, title, event_type, visibility_status, start_time, end_time, created_at, updated_at, public_api_enabled) SELECT 'sp-' || n, 'spreadsheet row ' || n, 'event', 'public', n, n + 1, 1, 1, 0 FROM seq", []);
const ownEventRow = () => ({
  sql: `INSERT OR REPLACE INTO events (id, title, event_type, visibility_status, start_time, end_time, created_at, updated_at, public_api_enabled) VALUES ('bench-evt-own', 'own slots event', 'event', 'public', 1000, 2000, 10, 20, 0)`,
  params: [],
});
const ownSlotRows = (count) => numberedRows(
  count,
  "INSERT OR REPLACE INTO slots (id, event_id, start_time, status, reserved_by_user_id, display_name, reserved_x_id_snapshot) SELECT 'own-' || n, 'bench-evt-own', n, 'reserved', 'bench-admin', ?, 'bench-x' FROM seq",
  ["N".repeat(200)],
);
const publicEventRows = (count) => numberedRows(
  count,
  "INSERT OR REPLACE INTO events (id, title, event_type, visibility_status, start_time, end_time, created_at, updated_at, public_api_enabled, explanation) SELECT 'pub15-' || n, 'public event ' || n, 'event', 'public', 2000000000 + n, 2000000100 + n, 1, 1, 0, ? FROM seq",
  ["E".repeat(2000)],
);
const REASON = (k) => (k === "limit" ? "r".repeat(500) : "bench");
/** Request bodies for the write inventory. `limit` fills the bounded text fields to their caps. */
const WRITE_BODIES = {
  "POST /api/admin/notifications/retry-failed": () => ({}),
  "POST /api/admin/notifications/:id/retry": () => ({}),
  "POST /api/admin/notifications/:id/cancel": (kind) => ({ reason: kind === "limit" ? "r".repeat(500) : "bench" }),
  "POST /api/admin/notifications/:id/force-resend": () => ({}),
  "POST /api/personal/terms/accept": () => ({}),
  "POST /api/personal/onboarding/terms": () => ({}),
  "POST /api/personal/onboarding/complete": () => ({}),
  "PUT /api/manage/events/:id/youtube-playlist": (k) => ({ playlist_id: "", sync_mode: "off", sync_interval_minutes: k === "limit" ? "10080" : "720" }),
  "POST /api/manage/events/:id/youtube-playlist/sync": () => ({}),
  "POST /api/admin/audit/settings": () => ({}),
  "POST /api/admin/audit/dry-run": (k) => ({ audit_id: "bench-missing", reason: REASON(k) }),
  "POST /api/admin/cost-guard/mode": (k) => ({ mode: "normal", reason: REASON(k) }),
  "POST /api/admin/cost-guard/maintenance": (k) => ({ is_maintenance_mode: "0", reason: REASON(k) }),
  "POST /api/admin/cost-guard/override": (k) => ({ reason: REASON(k), confirm: "OVERRIDE", features: ["edit_video"] }),
  "POST /api/admin/cost-guard/disabled-features": (k) => ({ reason: REASON(k), confirm: "APPLY", features: [], expected_disabled_features_json: "null" }),
  "POST /api/admin/cost-guard/override/clear": (k) => ({ reason: REASON(k), confirm: "CLEAR" }),
  "POST /api/admin/users/:userId/role": (k, i) => ({ role: i % 2 ? "user" : "moderator" }),
  "POST /api/admin/users/:userId/banned": (k) => ({ is_banned: "0", reason: REASON(k) }),
  "POST /api/admin/users/:userId/notifications": (k, i) => ({ is_notification_enabled: i % 2 ? "1" : "0" }),
  "POST /api/admin/users/:userId/can-create-events": (k, i) => ({ can_create_events: i % 2 ? "1" : "0" }),
  "POST /api/admin/x-users/:xUserId/icon-refresh": () => ({}),
  "POST /api/admin/event-templates": (k, i, tag) => ({ event_id: "bench-evt", name: k === "limit" ? "N".repeat(80) : `tpl-${tag}-${i}`, description: k === "limit" ? "D".repeat(500) : "bench" }),
  "DELETE /api/admin/event-templates/:id": () => undefined,
  "POST /api/videos/:videoId/chapters": (k, i) => ({ chapter_time: `${(i % 50) + 1}:00`, chapter_label: k === "limit" ? "L".repeat(120) : "bench", note: k === "limit" ? "N".repeat(1000) : null, visibility: "public", active_x_snapshot: "bench-x" }),
  "POST /api/videos/:videoId/chapters/bulk": (k) => ({ active_x_snapshot: "bench-x", csv: k === "limit" ? Array.from({ length: 8 }, (_, n) => `${n + 1}:00,${"L".repeat(100)}`).join("\n") : "1:00,bench" }),
  "PUT /api/videos/chapters/:chapterId": (k) => ({ chapter_time: "1:00", chapter_label: k === "limit" ? "L".repeat(120) : "bench", visibility: "public" }),
  "DELETE /api/videos/chapters/:chapterId": () => undefined,
  "POST /api/videos/:videoId/interaction": (k, i) => ({ kind: i % 2 ? "like" : "bookmark" }),
};

/** The previously pending RH-013 route is now mounted and has a named bounded scenario.
 * Keep this extension point for future unmounted routes; do not duplicate RH-013.
 */
export function buildPendingScenarios() {
  return [];
}

export function buildRouteScenarios() {
  return ROUTE_INVENTORY.map(([id, method, pattern, access, opts = {}]) => {
    const writes = access === "w";
    const key = `${method} ${pattern}`;
    const expected = ROUTE_EXPECT[key];
    if (!expected) throw new Error(`ROUTE_EXPECT is missing ${key}`);
    const make = (kind) => (i, tag) => {
      const longId = kind === "invalid" && access === "p";
      let query = opts.nq ?? "";
      if (kind === "limit") query = opts.lq ?? opts.nq ?? (method === "GET" ? BIG_Q : "");
      if (kind === "invalid" && access === "p") query = "?limit=-5&page=0&q=%00";
      const headers = { "cf-connecting-ip": BENCH_IP(kind, i), ...(opts.headers?.(kind) ?? {}) };
      if (writes || ((access !== "p" || opts.session) && kind !== "invalid")) headers.cookie = ADMIN_COOKIE;
      let body;
      if (writes) {
        headers.origin = SITE_URL;
        headers["content-type"] = "application/json";
        if (kind === "invalid") body = "{}";
        else { const b = WRITE_BODIES[key]?.(kind, i, tag); body = b === undefined ? undefined : json(b); }
      }
      const dyn = opts.params?.(kind, i, tag) ?? {};
      const setup = kind === "invalid" ? undefined : opts.setup?.(kind, i, tag);
      return { method, path: fillRoute(pattern, longId, dyn) + query, headers, body, expect: expected[kind], ...(setup ? { setup } : {}) };
    };
    return {
      id, title: `${method} ${pattern}`, runtimeClass: opts.cls ?? (method === "GET" || method === "OPTIONS" ? "S2" : "S3"),
      ...(opts.prepare ? { prepareKind: opts.prepare } : {}),
      kinds: { normal: make("normal"), limit: make("limit"), invalid: make("invalid") },
    };
  });
}

// Statuses a healthy run must return, pinned from an in-process probe of the main-branch app on the shared
// fixture (MIG-0639). A different status means the fixture or the route changed and the CPU number is void.
const ROUTE_EXPECT = {
  "POST /api/admin/notifications/retry-failed": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/admin/notifications/:id/retry": { normal: [200], limit: [200], invalid: [404] },
  "POST /api/admin/notifications/:id/cancel": { normal: [200], limit: [200], invalid: [404] },
  "POST /api/admin/notifications/:id/force-resend": { normal: [200], limit: [200], invalid: [404] },
  "GET /api/operation-mode/banner": { normal: [200], limit: [200], invalid: [200] },
  "OPTIONS /api/public/events/:id/staff": { normal: [204], limit: [204], invalid: [403] },
  "GET /api/public/events/:id/staff": { normal: [200], limit: [200], invalid: [404] },
  "POST /api/personal/terms/accept": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/personal/onboarding/terms": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/personal/onboarding/complete": { normal: [200], limit: [200], invalid: [200] },
  "GET /api/personal/session": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/dashboard": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/library": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/settings": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/onboarding": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/entry": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/entry/slotted": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/entry/unslotted": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/edit/:id/permissions": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/edit/:id/form-options": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/personal/edit/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/cost-guard-banner": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/users/:id/edit": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/users": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/users/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/videos": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/videos/:id/members": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/videos/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/event-groups": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/event-groups/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/events/templates": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/events/new": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/events": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/moderation": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/x-link-requests": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/x-id-merges": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/announcements": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/announcements/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/rules": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/rules/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/permissions/simulator": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/api-endpoints": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/audit-settings": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/audit": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/audit/restore": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/audit/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/audit/:id/payload/:field": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/notifications": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/health": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/integrity": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/static-builds": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/workers": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/security": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/youtube-playlists": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/youtube-quota": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/top": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/cost-guard": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin-read/ops/youtube-sync": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/navigation": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/events/:id/staff": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/events/:id/slots": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/events/:id/edit": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/events/:id/videos/:videoId": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/events/:id/videos": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/events/:id/youtube-playlist": { normal: [200], limit: [200], invalid: [401] },
  "PUT /api/manage/events/:id/youtube-playlist": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/manage/events/:id/youtube-playlist/sync": { normal: [409], limit: [409], invalid: [409] },
  "GET /api/manage/events/:id/audience": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/events/:id": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/notifications": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage/x-link-requests": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/manage": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin/spreadsheet/data": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin/spreadsheet/export": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin/spreadsheet/tables": { normal: [200], limit: [200], invalid: [401] },
  "GET /api/admin/event-templates": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/admin/audit/settings": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/admin/audit/dry-run": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/cost-guard/mode": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/cost-guard/maintenance": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/cost-guard/override": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/cost-guard/disabled-features": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/cost-guard/override/clear": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/users/:userId/role": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/users/:userId/banned": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/users/:userId/notifications": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/users/:userId/can-create-events": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/x-users/:xUserId/icon-refresh": { normal: [400], limit: [400], invalid: [400] },
  "POST /api/admin/event-templates": { normal: [200], limit: [200], invalid: [400] },
  "DELETE /api/admin/event-templates/:id": { normal: [200], limit: [200], invalid: [404] },
  "GET /api/events/:id/slots/viewer-overlay": { normal: [200], limit: [200], invalid: [404] },
  "GET /api/events": { normal: [200], limit: [200], invalid: [200] },
  "GET /api/event-endpoints/:id/release": { normal: [200], limit: [200], invalid: [404] },
  "GET /api/videos": { normal: [200], limit: [200], invalid: [200] },
  "GET /api/videos/:id/viewer-overlay": { normal: [200], limit: [200], invalid: [503] },
  "GET /api/videos/:id": { normal: [200], limit: [200], invalid: [404] },
  "POST /api/videos/:videoId/chapters": { normal: [200], limit: [200], invalid: [409] },
  "POST /api/videos/:videoId/chapters/bulk": { normal: [200], limit: [200], invalid: [409] },
  "PUT /api/videos/chapters/:chapterId": { normal: [200], limit: [200], invalid: [400] },
  "DELETE /api/videos/chapters/:chapterId": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/videos/:videoId/interaction": { normal: [200], limit: [200], invalid: [400] },
  "GET /api/account/summary": { normal: [200], limit: [200], invalid: [200] },
  "GET /api/google-drive-image/:id": { normal: [200], limit: [200], invalid: [200] },
  "GET /api/youtube-thumbnail/:id/:size": { normal: [200], limit: [200], invalid: [404] },
  "GET /api/media/manage-x-icon/*": { normal: [404], limit: [404], invalid: [404] },
  "GET /api/media/slot-submission-icon/:slotId": { normal: [404], limit: [404], invalid: [404] },
  "GET /api/media/*": { normal: [404], limit: [404], invalid: [404] },
  "GET /api/internal/x-users/search": { normal: [200], limit: [503], invalid: [401] },
};

// ------------------------------------------------------------ shared seeding
export const SEED = (adminToken) => [
  { sql: `INSERT OR REPLACE INTO "user" (id, name, role, is_banned, is_tos_accepted) VALUES ('bench-admin', 'Bench Admin', 'admin', 0, 1)`, params: [] },
  { sql: `INSERT OR REPLACE INTO "session" ("sessionToken", "userId", "expires") VALUES (?, 'bench-admin', ?)`, params: [SESSION_TOKEN, Date.now() + 365 * 24 * 3600 * 1000] },
  { sql: `INSERT OR REPLACE INTO system_settings (id, operation_mode) VALUES ('default', 'normal')`, params: [] },
  // MIG-0639 shared fixtures for the generic Hono method inventory (minimal rows; deep inputs are seeded per sample).
  { sql: `INSERT OR REPLACE INTO "user" (id, name, role, is_banned, is_tos_accepted) VALUES ('bench-target', 'Bench Target', 'user', 0, 1)`, params: [] },
  { sql: `INSERT OR REPLACE INTO events (id, title, event_type, visibility_status, start_time, end_time, created_at, updated_at, public_api_enabled) VALUES ('bench-evt', 'bench event', 'event', 'public', 1000, 2000, 10, 20, 1)`, params: [] },
  { sql: `INSERT OR REPLACE INTO videos (id, submitted_by_user_id, creator_display_name, title, visibility_status, updated_at) VALUES ('bench-vid', 'bench-admin', 'Bench', 'Bench video', 'public', 1000)`, params: [] },
  { sql: `INSERT OR REPLACE INTO video_events (video_id, event_id) VALUES ('bench-vid', 'bench-evt')`, params: [] },
  { sql: `INSERT OR REPLACE INTO slots (id, event_id, start_time, status) VALUES ('bench-slot', 'bench-evt', 1000, 'available')`, params: [] },
  { sql: `INSERT OR REPLACE INTO x_users (id, x_name, approval_status) VALUES ('bench-x', 'Bench X', 'approved')`, params: [] },
  { sql: `INSERT OR REPLACE INTO x_user_account_links (x_user_id, auth_user_id, link_role) VALUES ('bench-x', 'bench-admin', 'owner')`, params: [] },
  { sql: `UPDATE "user" SET active_x_user_id = 'bench-x' WHERE id = 'bench-admin'`, params: [] },
  { sql: `INSERT OR REPLACE INTO event_groups (id, name, slug) VALUES ('bench-group', 'Bench group', 'bench-group')`, params: [] },
  { sql: `INSERT OR REPLACE INTO announcements (id, title, body, severity, is_published, target_audience, created_by_user_id, created_at, updated_at) VALUES ('bench-ann', 'Bench', 'Bench', 'info', 1, 'all', 'bench-admin', 10, 10)`, params: [] },
  { sql: `INSERT OR REPLACE INTO terms_versions (id, version_label, body_markdown, created_by_user_id) VALUES ('bench-terms', 'bench', 'bench terms', 'bench-admin')`, params: [] },
  // 24,000-char payload: two 12,000-char chunks for GET /audit/:id/payload/:field.
  { sql: `INSERT OR REPLACE INTO audit_logs (id, table_name, target_id, operation, before_json, actor_user_id, created_at) VALUES ('bench-audit', 'announcements', 'bench-ann', 'UPDATE', '{"title":"' || replace(hex(zeroblob(12000)), '0', 'a') || '"}', 'bench-admin', 10)`, params: [] },
  { sql: `INSERT OR REPLACE INTO video_chapters (id, video_id, chapter_time, chapter_label, visibility, created_at, updated_at) VALUES ('bench-chapter', 'bench-vid', 5, 'bench', 'public', 10, 10)`, params: [] },
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
export async function createInprocTarget(plan) {
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
    // D1 .raw() (array rows) is what Drizzle's typed select() uses (RH-013).
    raw: async () => {
      const prepared = sqlite.prepare(sql);
      prepared.setReturnArrays(true);
      try { return keep(prepared.all(...params).map((row) => [...row])); } finally { prepared.setReturnArrays(false); }
    },
    run: async () => keep({ results: sqlite.prepare(sql).all(...params) }),
    // drizzle's D1 driver reads rows as arrays through raw().
    raw: async () => { const st = sqlite.prepare(sql); st.setReturnArrays(true); try { return keep(st.all(...params)); } finally { st.setReturnArrays(false); } },
  });
  const db = {
    // D1 allows first()/all()/run()/raw() straight on prepare() (no bind); count a statement on either path.
    prepare: (sql) => {
      const unbound = make(sql, []);
      const counted = (fn) => (...a) => { stmts += 1; return fn(...a); };
      return {
        bind: (...params) => { stmts += 1; return make(sql, params); },
        _sql: sql, _params: [],
        first: counted(unbound.first), all: counted(unbound.all), run: counted(unbound.run), raw: counted(unbound.raw),
      };
    },
    batch: async (list) => {
      sqlite.exec("BEGIN");
      try {
        const out = list.map((s) => ({ results: sqlite.prepare(s._sql).all(...s._params) }));
        sqlite.exec("COMMIT");
        return keep(out);
      } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  };
  const r2Objects = new Map();
  const bucket = {
    get: async (key) => {
      const body = r2Objects.get(key);
      if (body == null) return keep(null);
      const size = Buffer.byteLength(body);
      keep({ size, text: body, etag: BENCH_ETAG });
      return { size, etag: BENCH_ETAG, json: async () => JSON.parse(body), text: async () => body, body: null };
    },
  };
  const env = { DB: db, BUCKET: bucket, BUILD_COMMIT_SHA: "a".repeat(40), WORKER_ADMIN_TOKEN: plan.adminToken, NEXT_PUBLIC_SITE_URL: SITE_URL, ADMIN_SPREADSHEET_ENABLED: "1", AUTH_SECRET: "bench-auth-secret" };
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
    const realFetch = globalThis.fetch;
    globalThis.fetch = benchFetchStub;
    try {
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
    } finally { globalThis.fetch = realFetch; }
    const cpuMs = performance.now() - before;
    const buf = await res.arrayBuffer();
    return { status: res.status, bytes: buf.byteLength, cpuMs, d1: stmts, debug: process.env.BENCH_DEBUG ? Buffer.from(buf).toString("utf8").slice(0, 240) : undefined };
  };

  return {
    name: "inproc",
    resolutionMs: 0.001,
    digits: 3,
    cpuSource: "performance.now() wall delta around app.fetch (Node/V8, node:sqlite as D1; WALL-TIME PROXY, not workerd CPU)",
    supportsCold: false,
    setR2: async (body, key = STATS_KEY) => { if (body == null) r2Objects.delete(key); else r2Objects.set(key, body); },
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
const BENCH_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
// Bench-only upstream image stub: media proxy scenarios must never reach the network.
globalThis.fetch = async () => new Response(BENCH_PNG, { headers: { "content-type": "image/png" } });

// Replay env: D1/R2 return the results recorded by the in-process run, in call order,
// so the measured CPU is the app's own work without wrangler's local D1/R2 simulator.
function replayEnv(env, script) {
  let k = 0;
  const next = () => {
    if (k >= script.length) throw new Error("bench replay script exhausted");
    return script[k++];
  };
  const stmt = { bind: () => stmt, first: async () => next(), all: async () => next(), run: async () => next(), raw: async () => next() };
  return [{
    ...env,
    DB: { prepare: () => stmt, batch: async () => next() },
    BUCKET: { get: async () => { const v = next(); return v && { size: v.size, etag: v.etag, json: async () => JSON.parse(v.text), text: async () => v.text, body: null }; } },
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
      const key = url.searchParams.get("key") ?? STATS_KEY;
      if (request.method === "PUT") await env.BUCKET.put(key, await request.text());
      else await env.BUCKET.delete(key);
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
    'ADMIN_SPREADSHEET_ENABLED = "1"',
    'AUTH_SECRET = "bench-auth-secret"',
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
    setR2: async (body, key = STATS_KEY) => {
      const q = `/__bench/r2?key=${encodeURIComponent(key)}`;
      if (body == null) await post(q, undefined, "DELETE"); else await post(q, body, "PUT");
    },
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
    if (pk?.r2 !== undefined) await target.setR2(pk.r2);
    for (const [key, body] of Object.entries(pk?.r2Objects ?? {})) await target.setR2(body, key);
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
  for (const sc of scenarios) {
    const pk = sc.prepareKind?.normal;
    if (pk?.r2 !== undefined) await target.setR2(pk.r2);
    for (const [key, body] of Object.entries(pk?.r2Objects ?? {})) await target.setR2(body, key);
  }
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
  const scenarios = buildScenarios(plan, { includePending: opts.includePending }).filter((s) => !opts.only || opts.only.includes(s.id) || s.id === "BASELINE");

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

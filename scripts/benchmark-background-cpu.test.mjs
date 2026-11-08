import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WORKERS, BUDGET_MS, FIXED_TIME, plan, parseArgs, seedForKind, wrapperSource,
  judgeBackground, limitRecommendation, cpuFromProfile, validateSample,
} from "./benchmark-background-cpu.mjs";
import { judge, summarize, MIN_SAMPLES } from "./benchmark-api-cpu.mjs";

test("T03: exactly three deployed Worker entries and their scheduled/queue plan", () => {
  assert.deepEqual(WORKERS.map(w=>w.id), ["content","fast","sync"]);
  assert.deepEqual(WORKERS.map(w=>w.queue), [
    "flamenode-static-rebuild-wake","flamenode-notification-wake","flamenode-youtube-sync-wake",
  ]);
  assert.equal(plan().length, 6);
  for (const w of WORKERS) {
    assert.equal(plan().filter(s=>s.worker===w.id).length, 2);
    assert.equal(plan().filter(s=>s.worker===w.id && s.kind==="scheduled").length, 1);
    assert.equal(plan().filter(s=>s.worker===w.id && s.kind==="queue").length, 1);
  }
});

test("T03 --dry-run prints plan and synthetic stats without starting local Wrangler", () => {
  const r=spawnSync(process.execPath,["scripts/benchmark-background-cpu.mjs","--dry-run"],
    {cwd:process.cwd(),encoding:"utf8",timeout:10_000});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no Worker\/D1\/R2\/inspector\/network started/);
  for (const s of plan()) assert.ok(r.stdout.includes(s.id), s.id);
  assert.match(r.stdout, /synthetic-only verdict=/);
});

test("dry-run and run are explicitly exclusive, remote is rejected, each kind has >=50 samples", () => {
  const dry=parseArgs(["--dry-run"]);
  assert.equal(dry.samples,MIN_SAMPLES);
  assert.equal(dry.coldSamples,MIN_SAMPLES);
  assert.throws(()=>parseArgs(["--remote"]),/Unsupported/);
  assert.throws(()=>parseArgs(["--run","--samples","49"]),/50\+/);
  assert.throws(()=>parseArgs(["--run","--cold-samples","0"]),/50\+/);
  assert.throws(()=>parseArgs(["--run","--port","80"]),/invalid local port/);
  assert.throws(()=>parseArgs(["--run","--port","8789","--inspector-port","8789"]),/invalid local port/);
  assert.throws(()=>parseArgs([]),/exactly one/);
  assert.throws(()=>parseArgs(["--run","--dry-run"]),/exactly one/);
});

test("T05 external fetch trap precedes importing the worker; unknown outbound requests fail-closed", () => {
  const content=wrapperSource(WORKERS[0].entry);
  assert.ok(content.indexOf("globalThis.fetch = async") < content.indexOf("await import("));
  assert.match(content,/external HTTP forbidden/);
  assert.match(content,/outbound > before/);
  assert.match(content,/external_blocked/);
  assert.match(content,/status:502/);
  assert.match(content,/status:500/);
  assert.ok(!content.includes("https://discord.com"));
  assert.ok(!content.includes("https://youtube.googleapis.com"));
});

test("Queue inputs are strictly bounded to ten and scheduled cron is encoded", () => {
  for(const sc of plan()) {
    const limit=seedForKind(sc,"limit");
    if(sc.kind==="queue") { assert.equal(JSON.parse(limit.body).count,10); assert.equal(JSON.parse(seedForKind(sc,"invalid").body).count,1); }
    else assert.ok(limit.path.includes("cron="+encodeURIComponent(sc.cron)));
    assert.ok(seedForKind(sc,"normal").path.startsWith("/__bench/"));
  }
  assert.equal(FIXED_TIME,1760000000000);
});

test("T04 budget compares max against 8ms with API judge's noise and resolution semantics", () => {
  assert.equal(BUDGET_MS,8);
  for (const [values,noise,resolution] of [
    [[0.1,4.2,7.8],0,0.1],
    [[0.1,4.2,8],0,0],
    [[0.1,4.2,9],4,0.1],
    [[0.1,4.2,9],0.2,0.1],
  ]) {
    const a=judgeBackground(values,noise,resolution);
    const b=judge(summarize(values).max,8,{kind:"lt",noiseMs:noise,resolutionMs:resolution});
    assert.equal(a.verdict,b);
  }
  assert.equal(judgeBackground([1,2,4],0,0.1).verdict,"PASS");
  assert.equal(judgeBackground([1,2,9],0,0.1).verdict,"FAIL");
  assert.equal(judgeBackground([1,2,9],5,0.1).verdict,"INCONCLUSIVE");
  assert.equal(limitRecommendation(0.5),14);
  assert.equal(limitRecommendation(8),0);
  assert.equal(limitRecommendation(0),null);
});

test("workerd V8 sampling ignores idle and counts actual busy-sample resolution", () => {
  const {cpuMs,resolutionMs}=cpuFromProfile({
    nodes:[{id:1,callFrame:{functionName:"worker"}},{id:2,callFrame:{functionName:"(idle)"}}],
    samples:[1,2,1],timeDeltas:[100,300,700],
  },0.1);
  assert.ok(Math.abs(cpuMs-0.8) < 1e-9);
  assert.equal(resolutionMs,0.7);
});

/** Loads the generated wrapper around a stub entry; counts calls reaching the REAL fetch. */
async function loadWrapper(entrySource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-bg-wrapper-test-"));
  fs.writeFileSync(path.join(dir, "entry.mjs"), entrySource);
  fs.writeFileSync(path.join(dir, "wrapper.mjs"), wrapperSource("entry.mjs", dir));
  const original = globalThis.fetch;
  const realCalls = [];
  globalThis.fetch = async (...args) => { realCalls.push(args); throw Error("real fetch reached"); };
  try {
    const mod = await import(pathToFileURL(path.join(dir, "wrapper.mjs")).href + "?t=" + Math.random());
    const call = async (spec, env = { DB: { prepare: () => ({}) } }) => {
      const res = await mod.default.fetch(new Request("http://127.0.0.1" + spec.path,
        { method: "POST", body: spec.body }), env, {});
      return { status: res.status, text: await res.text() };
    };
    return { call, realCalls, restore: () => { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); } };
  } catch (e) { globalThis.fetch = original; throw e; }
}

test("T05: wrapper counts external fetches; zero reach the real host and a job hitting one is invalid", async () => {
  const w = await loadWrapper(`export default {
    async scheduled() { await fetch("https://discord.com/api/webhooks/x"); },
    async queue() { await fetch("https://youtube.googleapis.com/v3/videos"); },
  };`);
  try {
    for (const sc of plan()) {
      const spec = seedForKind(sc, "normal");
      const r = await w.call(spec);
      assert.ok([500, 502].includes(r.status), sc.id);
      assert.equal(validateSample(spec, r.status, r.text), false, sc.id);
      assert.equal(JSON.parse(r.text).outbound, 1);
    }
    assert.equal(w.realCalls.length, 0);
  } finally { w.restore(); }
});

test("Queue wake: canonical bodies are processed, malformed bodies are skipped, HTTP 200 alone is not valid", async () => {
  const w = await loadWrapper(`const KINDS = ["notification_available","static_rebuild_available","youtube_sync_pending","youtube_playlist_sync"];
    const ok = b => b && b.version === 1 && KINDS.includes(b.kind) && typeof b.source === "string"
      && Number.isFinite(b.requested_at) && typeof b.trace_id === "string" && b.trace_id.length > 0;
    export default {
      async scheduled(_c, env) { await env.DB.prepare("SELECT 1"); },
      async queue(batch, env) {
        const wake = batch.messages.find(m => ok(m.body));
        if (wake) await env.DB.prepare("SELECT 1");
        for (const m of batch.messages) m.ack();
      },
    };`);
  try {
    for (const sc of plan().filter(s => s.kind === "queue")) {
      for (const kind of ["normal", "limit", "cold"]) {
        const spec = seedForKind(sc, kind);
        const r = await w.call(spec);
        const body = JSON.parse(r.text);
        assert.equal(r.status, 200);
        assert.equal(body.acked, kind === "limit" ? 10 : 1, sc.id + kind);
        assert.ok(body.d1 > 0, "consumer touched D1: " + sc.id + kind);
        assert.equal(validateSample(spec, r.status, r.text), true);
      }
      const bad = seedForKind(sc, "invalid");
      const r = await w.call(bad);
      assert.equal(JSON.parse(r.text).d1, 0, "malformed wake must not process");
      assert.equal(validateSample(bad, r.status, r.text), true);
      // A consumer that silently skipped a canonical wake (HTTP 200, d1 = 0) is NOT a valid measurement.
      const good = seedForKind(sc, "normal");
      assert.equal(validateSample(good, 200, JSON.stringify({ ok: true, outbound: 0, acked: 1, retried: 0, d1: 0 })), false);
      assert.equal(validateSample(good, 200, JSON.stringify({ ok: true, outbound: 0, acked: 0, retried: 1, d1: 3 })), false);
    }
    const sched = await w.call(seedForKind(plan().find(s => s.kind === "scheduled"), "normal"));
    assert.equal(sched.status, 200);
  } finally { w.restore(); }
});

test("Queue plan uses the canonical wake kind per worker", () => {
  const kinds = Object.fromEntries(plan().filter(s => s.kind === "queue").map(s => [s.worker, s.wakeKind]));
  assert.deepEqual(kinds, { content: "static_rebuild_available", fast: "notification_available", sync: "youtube_sync_pending" });
  assert.match(seedForKind(plan().find(s => s.kind === "queue"), "normal").path, /wake=static_rebuild_available/);
});

// ---------------------------------------------------------------------------------------------
// U02 named per-job fixtures
// ---------------------------------------------------------------------------------------------
import {
  JOBS, RESET_TABLES, SYNTHETIC_RESPONDER, backgroundVerdict, gen, jobById, renderMarkdown, validateJobSample,
} from "./benchmark-background-cpu.mjs";

const MEASURED = JOBS.filter(j => !j.golden);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = rel => fs.readFileSync(path.join(REPO, rel), "utf8");

test("U02: every Work Order job has a named fixture on the Worker that deploys it", () => {
  const expected = {
    "cache-cleanup": "content", "audit-cleanup": "content", "x-slot-bind-recovery": "content",
    "daily-top-enqueue": "content", "static-rebuild-queue": "content",
    "slot-reminders": "fast", "notification-dispatch": "fast",
    "youtube-sync": "sync", "youtube-blocked-recheck": "sync", "score-recalc": "sync",
    "playlist-sync": "sync", "ga4-ranking": "sync",
    "queue-consumer-content": "content", "queue-consumer-fast": "fast", "queue-consumer-sync": "sync",
  };
  assert.deepEqual(Object.fromEntries(MEASURED.map(j => [j.id, j.worker])), expected);
  assert.equal(new Set(JOBS.map(j => j.id)).size, JOBS.length, "ids are unique");
  for (const job of JOBS) {
    assert.ok(WORKERS.some(w => w.id === job.worker), job.id);
    assert.ok(job.modules.length > 0 && job.run.startsWith("async ("), job.id);
    assert.equal(typeof job.seed, "function");
    assert.equal(typeof job.check, "function");
  }
});

test("U02: fixture limits equal the CURRENT caps in the worker sources (drift guard)", () => {
  const num = (rel, name) => Number(new RegExp("(?:const|let) " + name + "\\s*=\\s*([0-9_]+)").exec(read(rel))?.[1]?.replaceAll("_", ""));
  assert.equal(num("workers/cleanup/incrementalCache.ts", "INCREMENTAL_CACHE_SCAN_LIMIT"), jobById("cache-cleanup").limit);
  assert.equal(num("workers/cleanup/retention.ts", "AUDIT_CLEANUP_BATCH_LIMIT"), jobById("audit-cleanup").limit);
  assert.equal(num("workers/content-jobs/xIdSlotBindRecovery.ts", "X_ID_SLOT_BIND_RECOVERY_REQUEST_LIMIT"), jobById("x-slot-bind-recovery").limit);
  assert.equal(num("workers/content-jobs/xIdSlotBindRecovery.ts", "X_ID_SLOT_BIND_RECOVERY_SLOT_LIMIT"), 30);
  assert.equal(num("workers/notification-dispatcher/reminders.ts", "REMINDER_LIMIT"), jobById("slot-reminders").limit);
  assert.equal(num("workers/notification-dispatcher/dispatch.ts", "MAX_NOTIFICATION_BATCH"), jobById("notification-dispatch").limit);
  assert.equal(num("workers/score-recalc/index.ts", "SCORE_RECALC_BATCH_SIZE"), jobById("score-recalc").limit);
  assert.equal(num("workers/youtube-sync/index.ts", "YOUTUBE_SYNC_BATCH_SIZE") * num("workers/youtube-sync/index.ts", "YOUTUBE_SYNC_MAX_API_CALLS_PER_RUN"), jobById("youtube-sync").limit);
  assert.equal(num("workers/youtube-sync/index.ts", "BLOCKED_RECHECK_MAX_VIDEOS_PER_RUN"), jobById("youtube-blocked-recheck").limit);
  assert.equal(num("workers/ga-analytics/ranking.ts", "TRENDING_MAX_ITEMS"), jobById("ga4-ranking").limit);
  assert.equal(num("workers/youtube-playlist-sync/index.ts", "MAX_SOURCE_VIDEOS"), jobById("playlist-sync").limit);
  assert.equal(num("workers/json-generator/queuePolicy.ts", "MAX_QUEUE_ITEMS_PER_RUN"), jobById("static-rebuild-queue").limit);
});

const sqlOf = spec => spec.sql.map(([q]) => q).join("\n");
test("U02: seeds are bounded, payload-free and clear every table they may touch", () => {
  for (const job of JOBS) for (const kind of ["normal", "limit", "invalid"]) {
    const spec = job.seed(kind);
    assert.deepEqual(spec.clearTables, [...RESET_TABLES], job.id + kind);
    assert.ok(Array.isArray(spec.sql) && spec.sql.every(s => Array.isArray(s) && typeof s[0] === "string"), job.id + kind);
    assert.ok(JSON.stringify(spec).length < 200_000, "rows come from recursive CTEs, not payloads: " + job.id + kind);
    for (const [q, ...binds] of spec.sql) {
      assert.equal((q.match(/\?/g) ?? []).length, binds.length, job.id + kind + ": placeholder/bind mismatch in " + q.slice(0, 80));
    }
  }
  // limit seeds hold MORE than the cap so the cap, not the input, ends the run
  assert.equal(jobById("audit-cleanup").seed("limit").sql.filter(s => /^WITH RECURSIVE/.test(s[0])).every(s => s[1] > 500), true);
  assert.equal(jobById("cache-cleanup").seed("limit").r2Count, 201);
  assert.equal(jobById("score-recalc").seed("limit").sql[1][1], 200);
  assert.equal(jobById("slot-reminders").seed("limit").sql.find(x => /INTO "user"/.test(x[0]) && x.length > 1)[1], 60);
  assert.equal(jobById("playlist-sync").seed("limit").sql.find(s => /INTO videos/.test(s[0]))[1], 5000);
  // string-concatenated ids must not depend on bound numbers (D1 binds JS numbers as REAL)
  for (const job of JOBS) assert.ok(!/\|\| \(\? \+/.test(sqlOf(job.seed("limit"))), job.id);
});

test("U02: gen() builds a payload-free recursive INSERT with n first, extra binds after", () => {
  const [q, ...binds] = gen(3, "t", ["a", "b"], ["'x' || i", "?"], 42);
  assert.match(q, /^WITH RECURSIVE n\(i\) AS .* INSERT INTO t \(a, b\) SELECT 'x' \|\| i, \? FROM n$/);
  assert.deepEqual(binds, [3, 42]);
});

test("U02: check() rejects empty, skipped and partial runs (an idle job is NOT a measurement)", () => {
  const cache = jobById("cache-cleanup");
  assert.equal(cache.check("limit", { scanned: 200, deleted: 200, hasMore: true, skipped: false }), true);
  assert.equal(cache.check("limit", { scanned: 0, deleted: 0, hasMore: false, skipped: true }), false);
  assert.equal(cache.check("limit", { scanned: 200, deleted: 100, hasMore: true, skipped: false }), false);
  const score = jobById("score-recalc");
  assert.equal(score.check("limit", { processed: 150, failed: 0, skipped: 0 }), true);
  assert.equal(score.check("limit", { processed: 0, failed: 0, skipped: 1 }), false);
  assert.equal(score.check("invalid", { processed: 0, failed: 0, skipped: 1 }), true);
  assert.equal(jobById("notification-dispatch").check("limit", { processed: 6, failed: 0, external_api_calls: 12 }), true);
  assert.equal(jobById("notification-dispatch").check("limit", { processed: 6, failed: 0, external_api_calls: 0 }), false);
  assert.equal(jobById("x-slot-bind-recovery").check("limit", { processed: 5, completed: 5, bound: 150, failed: 0 }), true);
  assert.equal(jobById("x-slot-bind-recovery").check("limit", { processed: 5, completed: 5, bound: 0, failed: 0 }), false);
  assert.equal(jobById("g18-golden").check("normal", { added: 1, ids: Array(20).fill("a"), hash: "0".repeat(64) }), true);
  assert.equal(jobById("g18-golden").check("normal", { added: 0, ids: [], hash: "" }), false);
  for (const job of MEASURED) assert.equal(job.check("normal", null), false, job.id);
  const ok = JSON.stringify({ ok: true, outbound: 0, d1: 3, result: { processed: 150, failed: 0, skipped: 0 } });
  assert.equal(validateJobSample(score, "limit", 200, ok), true);
  assert.equal(validateJobSample(score, "limit", 500, ok), false);
  assert.equal(validateJobSample(score, "limit", 200, ok.replace('"outbound":0', '"outbound":1')), false);
  assert.equal(validateJobSample(score, "limit", 200, "not json"), false);
});

test("U02: synthetic responder answers only bounded fixed bodies for allow-listed hosts", async () => {
  const respond = (0, eval)("(" + SYNTHETIC_RESPONDER + ")");
  const body = async (url, init) => { const r = respond(new URL(url), init); return r && { status: r.status, json: await r.json() }; };
  assert.deepEqual((await body("https://discord.com/api/v10/users/@me/channels", { method: "POST" })).json, { id: "1000000000000000001" });
  assert.ok((await body("https://discord.com/api/v10/channels/123/messages", { method: "POST" })).json.id);
  const yt = await body("https://www.googleapis.com/youtube/v3/videos?id=a1,missing-b2,c3");
  assert.deepEqual(yt.json.items.map(i => i.id), ["a1", "c3"]);
  assert.equal((await body("https://oauth2.googleapis.com/token", { method: "POST" })).json.access_token, "bench-access-token");
  assert.equal((await body("https://www.googleapis.com/youtube/v3/playlistItems", { method: "POST" })).status, 200);
  // not allow-listed: webhooks, unknown hosts and unknown paths fail closed (null -> the wrapper throws)
  for (const url of ["https://discord.com/api/webhooks/1/abc", "https://example.com/", "https://www.googleapis.com/youtube/v3/channels",
    "https://api.github.com/x"]) assert.equal(respond(new URL(url), {}), null, url);
});

async function loadJobWrapper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-bg-jobs-test-"));
  fs.mkdirSync(path.join(dir, "workers", "stub"), { recursive: true });
  fs.writeFileSync(path.join(dir, "entry.mjs"), "export default { async scheduled() {}, async queue() {} };");
  fs.writeFileSync(path.join(dir, "workers", "stub", "mod.mjs"), `export async function go(env, mode) {
    const status = (await fetch("https://www.googleapis.com/youtube/v3/videos?id=a,b")).status;
    if (mode === "leak") await fetch("https://example.com/leak");
    await env.DB.prepare("SELECT 1");
    return { status };
  }`);
  const jobs = [{ id: "stub", modules: ["workers/stub/mod.mjs"],
    run: "async (env, ctx, kind, imp) => { const m = await imp('workers/stub/mod.mjs'); return await m.go(env, kind); }" }];
  fs.writeFileSync(path.join(dir, "wrapper.mjs"), wrapperSource("entry.mjs", dir, jobs, "tagX"));
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (...a) => { calls.push(a); throw Error("real fetch reached"); };
  const stmts = [];
  const db = {
    prepare: q => ({ q, bind(...b) { return { q, b, run: async () => ({}) }; }, run: async () => ({}) }),
    batch: async list => { stmts.push(list.map(s => s.q)); return []; },
  };
  const env = { DB: db, KV: { delete: async () => {}, put: async () => {} }, R2: {} };
  const mod = await import(pathToFileURL(path.join(dir, "wrapper.mjs")).href + "?t=" + Math.random());
  const call = async (p, init = {}) => {
    const res = await mod.default.fetch(new Request("http://127.0.0.1" + p, { method: "POST", ...init }), env, {});
    return { status: res.status, text: await res.text() };
  };
  return { call, calls, stmts, restore: () => { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("U02: named-job route lets only allow-listed synthetic hosts through, and only while a job runs", async () => {
  const w = await loadJobWrapper();
  try {
    const ok = await w.call("/__bench/job?job=stub&kind=normal");
    assert.equal(ok.status, 200);
    const okBody = JSON.parse(ok.text);
    assert.equal(okBody.synthetic, 1);
    assert.equal(okBody.outbound, 0);
    assert.equal(okBody.d1, 1);
    const leak = await w.call("/__bench/job?job=stub&kind=leak");
    assert.equal(leak.status, 500, "the fail-closed trap throws inside the job: never a 200");
    const leakBody = JSON.parse(leak.text);
    assert.equal(leakBody.reason, "job_failed");
    assert.equal(leakBody.outbound, 1);
    assert.equal(validateJobSample({ check: () => true }, "normal", leak.status, leak.text), false);
    assert.equal((await w.call("/__bench/job?job=nope")).status, 404);
    assert.equal((await w.call("/__bench/build")).text, "tagX");
    assert.equal(w.calls.length, 0, "no call ever reached the real fetch");
  } finally { w.restore(); }
});

test("U02: seed route clears tables one by one and seeds in bounded batches", async () => {
  const w = await loadJobWrapper();
  try {
    const sql = Array.from({ length: 45 }, (_, i) => ["INSERT INTO t VALUES (?)", i]);
    const r = await w.call("/__bench/seed", { body: JSON.stringify({ clearTables: ["a", "b"], sql }) });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(w.stmts.map(b => b.length), [40, 5], "at most 40 statements per D1 batch");
    assert.equal(w.stmts[0][0], "INSERT INTO t VALUES (?)");
  } finally { w.restore(); }
});

test("D-14-1 verdict: max is judged against 8 ms and a noisy baseline makes 4-12 ms INCONCLUSIVE", () => {
  assert.equal(backgroundVerdict(3, 0.5, 0.1), "PASS");
  assert.equal(backgroundVerdict(30, 0.5, 0.1), "FAIL");
  assert.equal(backgroundVerdict(null, 0, 0.1), "NOT_MEASURED");
  assert.equal(backgroundVerdict(5, 4, 0.1), "INCONCLUSIVE");
  assert.equal(backgroundVerdict(12, 4, 0.1), "INCONCLUSIVE");
  assert.equal(backgroundVerdict(2, 4, 0.1), "PASS");
  assert.equal(backgroundVerdict(40, 4, 0.1), "FAIL");
});

test("U03 renderMarkdown prints per-kind p50/p95/max and the cap only for jobs over budget", () => {
  const kind = max => ({ n: 50, p50: max / 2, p95: max * 0.9, max, unexpectedStatus: 0, maxD1Statements: 7 });
  const summary = (o, n, l, i, c) => ({ overallMax: o, kinds: { normal: kind(n), limit: kind(l), invalid: kind(i), cold: kind(c) } });
  const report = {
    kinds: ["normal", "limit", "invalid", "cold"],
    jobs: [
      { id: "slow", worker: "sync", limitItems: 100, noiseMs: 0.4, validMeasure: true, summary: summary(20, 2, 20, 1, 5) },
      { id: "fast", worker: "fast", limitItems: 6, noiseMs: 0.4, validMeasure: true, summary: summary(3, 1, 3, 1, 2) },
      { id: "bad", worker: "fast", limitItems: 6, noiseMs: 0.4, validMeasure: false, summary: summary(3, 1, 3, 1, 2) },
    ],
    triggers: [],
  };
  const md = renderMarkdown(report);
  assert.match(md, /\| `slow` \| limit \| 50 \| 10\.00 \| 18\.00 \| 20\.00 \| 0 \| 7 \|/);
  assert.match(md, /\| `slow` \| sync \| 100 \| 0\.40 \| 2\.00 \| 20\.00 \| \*\*FAIL\*\* \| 3 \|/);
  assert.match(md, /\| `fast` \| fast \| 6 \| 0\.40 \| 1\.00 \| 3\.00 \| \*\*PASS\*\* \| - \|/);
  assert.match(md, /\*\*INVALID\*\*/);
});

test("U02: the wrapper source embeds a literal import() per declared module so wrangler bundles it", () => {
  const jobs = JOBS.filter(j => j.worker === "content");
  const src = wrapperSource("workers/content-jobs/index.ts", REPO, jobs, "b0");
  for (const m of new Set(jobs.flatMap(j => j.modules))) {
    assert.ok(src.includes('import("' + path.join(REPO, m).replaceAll("\\", "/") + '")'), m);
  }
  assert.ok(src.indexOf("globalThis.fetch = async") < src.indexOf("await import("), "trap precedes entry import");
  assert.ok(!src.includes("https://discord.com") && !src.includes("https://youtube.googleapis.com"));
});

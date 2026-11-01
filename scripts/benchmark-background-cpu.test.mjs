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

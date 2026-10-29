import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  WORKERS, BUDGET_MS, FIXED_TIME, plan, parseArgs, seedForKind, wrapperSource,
  judgeBackground, limitRecommendation, cpuFromProfile,
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
    if(sc.kind==="queue") assert.equal(JSON.parse(limit.body).count,10);
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
  assert.equal(cpuMs,0.8);
  assert.equal(resolutionMs,0.7);
});

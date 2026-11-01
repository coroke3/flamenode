#!/usr/bin/env node
/**
 * MIG-0609 U01. LOCAL ONLY. No deployment, account API, remote D1 or R2.
 * Workerd V8 profiler samples (not wall time) are used for CPU.
 * The wrapper blocks ALL outbound fetches before importing a worker entry.
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { aggregate, judge, MIN_SAMPLES, summarize } from "./benchmark-api-cpu.mjs";
import { materializeD1CompatibleMigrations } from "./d1-migration-compat.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BUDGET_MS = 8;
export const FIXED_TIME = 1760000000000;
export const WORKERS = Object.freeze([
  { id: "content", entry: "workers/content-jobs/index.ts", cron: "15 * * * *", queue: "flamenode-static-rebuild-wake", wakeKind: "static_rebuild_available" },
  { id: "fast", entry: "workers/fast-jobs/index.ts", cron: "0 * * * *", queue: "flamenode-notification-wake", wakeKind: "notification_available" },
  { id: "sync", entry: "workers/sync-jobs/index.ts", cron: "7,52 * * * *", queue: "flamenode-youtube-sync-wake", wakeKind: "youtube_sync_pending" },
]);
export const plan = () => WORKERS.flatMap(w => [
  { id: w.id + ".scheduled", worker: w.id, kind: "scheduled", cron: w.cron, inputMax: 1 },
  { id: w.id + ".queue", worker: w.id, kind: "queue", queue: w.queue, wakeKind: w.wakeKind, inputMax: 10 },
]);

export function parseArgs(args) {
  const opts = { dryRun: false, run: false, samples: MIN_SAMPLES, coldSamples: MIN_SAMPLES,
    warmup: 10, port: 8789, inspectorPort: 9240, out: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => { const v = args[++i]; if (!v || v.startsWith("--")) throw Error(arg + " requires value"); return v; };
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--run") opts.run = true;
    else if (arg === "--samples") opts.samples = Number(value());
    else if (arg === "--cold-samples") opts.coldSamples = Number(value());
    else if (arg === "--warmup") opts.warmup = Number(value());
    else if (arg === "--port") opts.port = Number(value());
    else if (arg === "--inspector-port") opts.inspectorPort = Number(value());
    else if (arg === "--out") opts.out = value();
    else throw Error("Unsupported argument (remote options prohibited): " + arg);
  }
  if (opts.dryRun === opts.run) throw Error("choose exactly one of --dry-run and --run");
  for (const k of ["samples", "coldSamples", "warmup", "port", "inspectorPort"])
    if (!Number.isInteger(opts[k]) || opts[k] < 0) throw Error(k + " must be a non-negative integer");
  if (opts.samples < MIN_SAMPLES || opts.coldSamples < MIN_SAMPLES) throw Error("50+ samples per kind required");
  if (opts.port < 1024 || opts.port > 65535 || opts.inspectorPort < 1024 ||
      opts.inspectorPort > 65535 || opts.port === opts.inspectorPort) throw Error("invalid local port");
  return opts;
}
export function limitRecommendation(oneItemMaxMs) {
  return Number.isFinite(oneItemMaxMs) && oneItemMaxMs > 0 ? Math.floor(7 / oneItemMaxMs) : null;
}
export function judgeBackground(values, noiseMs = 0, resolutionMs = 0) {
  const stats = summarize(values);
  return { ...stats, noiseMs, resolutionMs,
    verdict: judge(stats.max, BUDGET_MS, { kind: "lt", noiseMs, resolutionMs }) };
}

/**
 * Ephemeral Worker generated as a file. It imports the entry only after
 * assigning fetch's fail-closed trap, and only exposes localhost bench routes.
 */
export function wrapperSource(entry, rootDir = ROOT) {
  const fullPath = path.join(rootDir, entry).replaceAll("\\", "/");
  return [
    "// LOCAL BENCH ONLY - MIG-0609",
    "let outbound = 0;",
    "globalThis.fetch = async () => { outbound++; throw Error('external HTTP forbidden'); };",
    "let entry;",
    "const getEntry = async () => entry ??= (await import(" + JSON.stringify(fullPath) + ")).default;",
    "const fixedTime = " + FIXED_TIME + ";",
    "const counts = { acked: 0, retried: 0, d1: 0 };",
    "const countingEnv = env => {",
    "  if (!env.DB) return env;",
    "  const db = new Proxy(env.DB, { get(target, prop) {",
    "    const value = target[prop];",
    "    if (typeof value !== 'function') return value;",
    "    return (...args) => { if (prop === 'prepare' || prop === 'batch' || prop === 'exec') counts.d1++; return value.apply(target, args); };",
    "  } });",
    "  return { ...env, DB: db };",
    "};",
    "// Canonical wake body (parseQueueWakeMessage); invalid = deliberately malformed, must be skipped.",
    "const wakeBody = (wakeKind, valid, i) => valid",
    "  ? { version:1, kind:wakeKind, source:'recovery', requested_at: Math.floor(fixedTime/1000), trace_id:'bench-' + i }",
    "  : { kind:'recovery', version:1 };",
    "const batch = (wakeKind, valid, n) => ({",
    "  queue: 'flamenode-bench-local',",
    "  messages: Array.from({length:n}, (_,i)=>({",
    "    id:'bench-'+i, timestamp:new Date(fixedTime),",
    "    body:wakeBody(wakeKind, valid, i), attempts:1,",
    "    ack(){ counts.acked++; }, retry(){ counts.retried++; }",
    "  })), ackAll(){}, retryAll(){}",
    "});",
    "export default { async fetch(req, env, ctx) {",
    "  const url = new URL(req.url);",
    "  if (url.pathname === '/__bench/ping') return new Response('ready');",
    "  if (url.pathname === '/__bench/noop') return new Response('ok');",
    "  if (req.method !== 'POST') return new Response('Not found', {status:404});",
    "  const before = outbound;",
    "  counts.acked = 0; counts.retried = 0; counts.d1 = 0;",
    "  const benchEnv = countingEnv(env);",
    "  try {",
    "    const current = await getEntry();",
    "    const kind = url.searchParams.get('kind') || 'normal';",
    "    if (url.pathname === '/__bench/scheduled') {",
    "      await current.scheduled({ cron:url.searchParams.get('cron') || '0 * * * *', scheduledTime:fixedTime, type:'scheduled' }, benchEnv, ctx);",
    "    } else if (url.pathname === '/__bench/queue') {",
    "      const body = await req.json();",
    "      if (!Number.isInteger(body.count) || body.count < 0 || body.count > 10) return new Response('invalid count', {status:400});",
    "      await current.queue(batch(url.searchParams.get('wake') || '', kind !== 'invalid', body.count), benchEnv, ctx);",
    "    } else return new Response('Not found', {status:404});",
    "    if (outbound > before) return Response.json({ok:false, reason:'external_blocked', outbound:outbound-before}, {status:502});",
    "    return Response.json({ok:true, outbound:0, acked:counts.acked, retried:counts.retried, d1:counts.d1});",
    "  } catch { return Response.json({ok:false, reason:'job_failed', outbound:outbound-before}, {status:500}); }",
    "} };",
  ].join("\n");
}
export function seedForKind(scenario, kind) {
  if (scenario.kind === "scheduled") {
    return { path: "/__bench/scheduled?cron=" + encodeURIComponent(scenario.cron) +
      "&kind=" + kind, body: "{}" };
  }
  const count = kind === "limit" ? scenario.inputMax : 1;
  return { path: "/__bench/queue?kind=" + kind + "&wake=" + scenario.wakeKind, body: JSON.stringify({count}), count };
}
/**
 * A queue sample is valid only if the consumer really ran: valid wakes touch D1 and are acked;
 * malformed wakes are acked without any D1 statement. HTTP 200 alone proves nothing.
 */
export function validateSample(spec, status, responseText) {
  if (status !== 200) return false;
  let body;
  try { body = JSON.parse(responseText); } catch { return false; }
  if (body?.ok !== true || body.outbound !== 0) return false;
  if (!spec.path.startsWith("/__bench/queue")) return Number.isInteger(body.d1);
  if (body.retried !== 0 || body.acked !== spec.count) return false;
  return spec.path.includes("kind=invalid") ? body.d1 === 0 : body.d1 > 0;
}
export function cpuFromProfile(profile, initialResolutionMs = 0.1) {
  const names = new Map(profile.nodes.map(n => [n.id, n.callFrame.functionName]));
  let cpuMs = 0, resolutionMs = initialResolutionMs;
  profile.samples.forEach((id, i) => {
    if (names.get(id) === "(idle)") return;
    const ms = profile.timeDeltas[i] / 1000;
    cpuMs += ms;
    resolutionMs = Math.max(resolutionMs, ms);
  });
  return {cpuMs, resolutionMs};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {stdio:"ignore"});
  else child.kill("SIGKILL");
}

async function localTarget(worker, opts) {
  const require = createRequire(path.join(ROOT,"package.json"));
  const wranglerBin = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
  const WebSocket = createRequire(require.resolve("wrangler/package.json"))("ws");
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-background-bench-"));
  const state = path.join(workDir, "state");
  const mig = await materializeD1CompatibleMigrations(path.join(ROOT,"migrations"));
  const toml = path.join(workDir, "wrangler.toml");
  const workerPath = path.join(workDir, "worker.mjs");
  let child, socket, seq = 0, log = "", build = 0;
  const pending = new Map();
  const cleanup = async () => {
    try { socket?.terminate(); } catch { /* ignore */ }
    kill(child);
    await sleep(1000);
    fs.rmSync(workDir, {recursive:true, force:true, maxRetries:10, retryDelay:300});
  };
  try {
    fs.writeFileSync(workerPath, wrapperSource(worker.entry));
    fs.writeFileSync(toml, [
      'name = "flamenode-background-bench-local"',
      'main = "worker.mjs"',
      'compatibility_date = "2025-01-09"',
      'compatibility_flags = ["nodejs_compat"]',
      "[vars]", 'BUILD_COMMIT_SHA = "'+"a".repeat(40)+'"',
      "[[d1_databases]]", 'binding = "DB"', 'database_name = "flamenode_db"',
      'database_id = "00000000-0000-0000-0000-000000000000"',
      "migrations_dir = " + JSON.stringify(mig.outputDir.replaceAll("\\","/")),
      "[[r2_buckets]]", 'binding = "BUCKET"', 'bucket_name = "flamenode-bench-local"',
      "[[kv_namespaces]]", 'binding = "KV"', 'id = "00000000-0000-0000-0000-000000000000"',
    ].join("\n"));
    const apply = spawnSync(process.execPath, [wranglerBin,"d1","migrations","apply","flamenode_db",
      "--local","--config",toml,"--persist-to",state],
      {cwd:workDir, encoding:"utf8", timeout:120000});
    if (apply.status !== 0) throw Error("local D1 migration failed: "+String(apply.stderr).slice(-500));
    const base = "http://127.0.0.1:" + opts.port;
    child = spawn(process.execPath, [wranglerBin,"dev","--local","--config",toml,
      "--persist-to",state,"--port",String(opts.port),"--ip","127.0.0.1",
      "--inspector-port",String(opts.inspectorPort)], {
      cwd:workDir, env:{...process.env,WRANGLER_SEND_METRICS:"false"},stdio:["ignore","pipe","pipe"] });
    child.stdout.on("data", d => {log+=d.toString().slice(-400);});
    child.stderr.on("data", d => {log+=d.toString().slice(-400);});
    let ready = false;
    for (let n=0;n<300;n++) {
      try {ready=(await fetch(base+"/__bench/ping")).ok;} catch { /* local startup */ }
      if (ready) break;
      await sleep(150);
    }
    if (!ready) throw Error("localhost Wrangler startup failed: "+log.slice(-500));
    const connect = async () => {
      try {socket?.terminate();} catch { /* ignore */ }
      for(let n=0;n<200;n++) {
        try {
          const targets=await (await fetch("http://127.0.0.1:"+opts.inspectorPort+"/json")).json();
          if (!targets[0]?.webSocketDebuggerUrl) throw Error("no local inspector");
          socket = new WebSocket(targets[0].webSocketDebuggerUrl);
          await new Promise((ok,err)=>{socket.once("open",ok);socket.once("error",err);});
          socket.on("message", raw => {
            const data=JSON.parse(raw.toString()), cb=pending.get(data.id);
            if(cb) {pending.delete(data.id);cb(data);}
          });
          return;
        } catch {await sleep(150);}
      }
      throw Error("local V8 inspector unavailable");
    };
    await connect();
    const call=(method, params={})=>new Promise(resolve=>{
      const id=++seq;
      pending.set(id,resolve);
      socket.send(JSON.stringify({id,method,params}));
    });
    await call("Profiler.enable");
    await call("Profiler.setSamplingInterval",{interval:100});
    const run=async(spec)=>{
      const started=await call("Profiler.start");
      if (started.error) throw Error("V8 sampling start failed: "+JSON.stringify(started.error));
      const r=await fetch(base+spec.path,{method:"POST",body:spec.body,
        headers:{"content-type":"application/json"}});
      const responseText=await r.text();
      const result=await call("Profiler.stop");
      if (result.error || !result.result?.profile) throw Error("V8 sampling failed: "+JSON.stringify(result).slice(0,300));
      return {status:r.status, bytes:responseText.length, responseText,
        ...cpuFromProfile(result.result.profile)};
    };
    const reload=async()=>{
      build++;
      fs.writeFileSync(workerPath, wrapperSource(worker.entry)+"\n// build "+build);
      await sleep(400);
      await connect();
      await call("Profiler.enable");
      await call("Profiler.setSamplingInterval",{interval:100});
    };
    return {run,reload,cleanup,wrangler:spawnSync(process.execPath,[wranglerBin,"--version"],
      {encoding:"utf8"}).stdout.trim()};
  } catch(error) {
    await cleanup();
    throw error;
  } finally {
    fs.rmSync(mig.workspace,{recursive:true,force:true});
  }
}
export async function main(args) {
  const opts=parseArgs(args), scenarios=plan();
  if(opts.dryRun) {
    const sample=Array.from({length:MIN_SAMPLES},(_,i)=>i/10);
    console.log("MIG-0609 local-only dry-run: no Worker/D1/R2/inspector/network started");
    for(const item of scenarios) console.log("  "+item.id+" "+(item.cron??item.queue));
    console.log("synthetic-only verdict="+judgeBackground(sample,0.2,0.1).verdict);
    return;
  }
  const results=[];
  for(const w of WORKERS) {
    const target=await localTarget(w,opts);
    try {
      const scenariosForWorker=scenarios.filter(s=>s.worker===w.id);
      const rows=new Map(scenariosForWorker.map(s=>[s.id,[]]));
      const baseline=[];
      for(let i=0;i<opts.samples;i++) baseline.push((await target.run({path:"/__bench/noop",body:"{}"})).cpuMs);
      const noiseMs=summarize(baseline).max??0;
      for(const s of scenariosForWorker) {
        for(const kind of ["normal","limit","invalid"]) {
          const spec=seedForKind(s,kind);
          for(let i=0;i<opts.warmup;i++) await target.run(spec);
          for(let i=0;i<opts.samples;i++) {
            const r=await target.run(spec);
            rows.get(s.id).push({kind,cpuMs:r.cpuMs,status:r.status,
              bytes:r.bytes,d1:0,unexpected:!validateSample(spec,r.status,r.responseText)});
          }
        }
      }
      for(let i=0;i<opts.coldSamples;i++) {
        await target.reload();
        for(const s of scenariosForWorker) {
          const spec=seedForKind(s,"normal");
          const r=await target.run(spec);
          rows.get(s.id).push({kind:"cold",cpuMs:r.cpuMs,status:r.status,
            bytes:r.bytes,d1:0,unexpected:!validateSample(spec,r.status,r.responseText)});
        }
      }
      for(const [id,samples] of rows) {
        results.push({id,worker:w.id,noiseMs,summary:aggregate(samples,{
          runtimeClass:"S3",resolutionMs:0.1,noiseMs}),
          // These generic seeds are U01 smoke probes, NOT U02 per-job max work.
          validMeasure:samples.every(s=>!s.unexpected)});
      }
    } finally {await target.cleanup();}
  }
  const report={label:"LOCAL ONLY - NOT PRODUCTION",host:{
    node:process.version,os:process.platform,arch:os.arch()},
    note:"U01 smoke only; do not use until U02 per-job upper bound seeds are added",
    kinds:["normal","limit","invalid","cold"],minSamples:MIN_SAMPLES,results};
  if(opts.out) fs.writeFileSync(opts.out,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(results.some(r=>!r.validMeasure)) process.exitCode=2;
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)
  main(process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1;});

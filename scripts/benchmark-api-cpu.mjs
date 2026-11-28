#!/usr/bin/env node
/**
 * MIG-0606 U01: LOCAL-ONLY CPU benchmark harness for the Hono API (apps/api).
 *
 * Never deploys, never uses --remote, never calls a Cloudflare account API.
 * Every number it prints is a LOCAL measurement, not a production value.
 *
 *   --mode wrangler (default)  `wrangler dev --local` (workerd, local D1 built from
 *                              repo migrations, local R2). CPU = calibrated V8
 *                              sampling profiler; the largest observed sampling
 *                              quantum bounds resolution. Not platform cpuTime.
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
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainThread, parentPort, threadId, Worker, workerData } from "node:worker_threads";

// ---------------------------------------------------------------- pure logic

// MIG-0639 / #918 fixture descriptors: generated lazily outside any request timer.
// This catalog alone does not register a scenario or establish CPU acceptance.
export function operationModeMirrorFixtureCases() {
  const sizes = [65535, 65536, 65537, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
  const shapes = ["plain-reason", "multibyte", "escaped-reason", "deep-array", "deep-object", "dense-array", "dense-string-array", "mixed-string-array", "malformed-string-array", "dense-object", "long-integer", "long-exponent", "duplicate-mode", "malformed-tail"];
  return ["canonical", ...sizes.flatMap(size => shapes.map(shape => `${shape}:${size}`))];
}

export function buildOperationModeMirrorFixture(id) {
  if (!operationModeMirrorFixtureCases().includes(id)) throw new Error("unknown operation-mode mirror fixture");
  const fixedReason = "bounded note";
  const mode = "maintenance";
  const canonicalReason = "\u0001".repeat(500);
  if (id === "canonical") {
    // A safe synthetic Unix-seconds timestamp, not a claim about all possible writer timestamps.
    const raw = JSON.stringify({ mode: "static_only", reason: canonicalReason, updated_at: 99999999999999 });
    return { id, raw, bytes: Buffer.byteLength(raw, "utf8"), expected: { mode: "static_only", reason: canonicalReason }, valid: true, updatedAt: 99999999999999 };
  }
  const [shape, sizeText] = id.split(":");
  const size = Number(sizeText);
  // All generated tokens other than the explicit multibyte fill are ASCII.
  const prefix = '{"mode":"maintenance","updated_at":1,"reason":"bounded note","extra":';
  const reasonPrefix = '{"mode":"maintenance","updated_at":1,"reason":"';
  const rootNumber = '{"mode":"maintenance","reason":"bounded note","updated_at":';
  const fit = (start, unit, end, pad = " ") => {
    const remaining = size - Buffer.byteLength(start + end, "utf8");
    if (remaining < 0) throw new Error("fixture size too small");
    const n = Buffer.byteLength(unit, "utf8");
    return start + unit.repeat(Math.floor(remaining / n)) + pad.repeat(remaining % n) + end;
  };
  const nested = (open, close, maxDepth) => {
    const remaining = size - prefix.length - 2; // scalar 0 and final root brace
    const depth = Math.min(maxDepth, Math.floor(remaining / (open.length + close.length)));
    const core = open.repeat(depth) + "0" + close.repeat(depth);
    return prefix + core + " ".repeat(size - prefix.length - core.length - 1) + "}";
  };
  let raw, valid = true, expectedMode = mode, expectedReason = size <= 65536 ? fixedReason : null, updatedAt = 1;
  switch (shape) {
    case "plain-reason":
      raw = fit(reasonPrefix, "x", '"}', "x"); expectedReason = null; break;
    case "multibyte":
      raw = fit(prefix + '"', "日", '"}', "x"); break;
    case "escaped-reason":
      raw = fit(reasonPrefix, "\\u0001", '"}', "x"); expectedReason = null; break;
    case "deep-array":
      raw = nested("[", "]", 65536); break;
    case "deep-object":
      raw = nested('{"x":', "}", 32768); break;
    case "dense-array":
      raw = fit(prefix + "[", "0,", "0]}"); break;
    case "dense-string-array":
      raw = fit(prefix + "[0,", '"","日","🚀","a,b","{}[]",', "0]}"); break;
    case "mixed-string-array":
      raw = fit(prefix + "[0,", '"short","' + "x".repeat(32) + '","' + "y".repeat(33) + '","\\u0061",{},[1,2],', "0]}"); break;
    case "malformed-string-array":
      raw = fit(prefix + "[0,", '"","日","🚀","a,b","{}[]",', '"\\x"]}'); valid = false; expectedMode = "normal"; expectedReason = null; updatedAt = null; break;
    case "dense-object":
      raw = fit(prefix + "{", '"x":0,', '"z":0}}'); break;
    case "long-integer":
      raw = fit(rootNumber, "9", "}", "9"); valid = false; expectedMode = "normal"; expectedReason = null; updatedAt = null; break;
    case "long-exponent":
      raw = fit(rootNumber + "1e-", "9", "}", "9"); updatedAt = 0; break;
    case "duplicate-mode":
      raw = fit('{"mode":"normal","updated_at":1,"reason":"bounded note","extra":"', "x", '","mode":"maintenance"}', "x"); break;
    case "malformed-tail":
      raw = fit(prefix + '"', "x", '","tail":[1,]}', "x"); valid = false; expectedMode = "normal"; expectedReason = null; updatedAt = null; break;
    default: throw new Error("unreachable fixture shape");
  }
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes !== size) throw new Error("operation-mode mirror fixture byte mismatch");
  return { id, raw, bytes, expected: { mode: expectedMode, reason: expectedReason }, valid, updatedAt };
}

export function operationModeBannerReceiptMismatch(fixture, receipt, phase) {
  if (phase !== "miss" && phase !== "hit" && phase !== "expiry") return true;
  const expectedReads = phase === "hit" ? 0 : 1;
  if (receipt?.status !== 200 || receipt.d1 !== 0 || receipt.kvGets !== expectedReads
    || receipt.kvPuts !== 0 || receipt.kvDeletes !== 0
    || receipt.cacheControl !== "no-store"
    || typeof receipt.contentType !== "string" || !/^application\/json(?:\s*;|$)/i.test(receipt.contentType)
    || typeof receipt.body !== "string" || !Number.isSafeInteger(receipt.bytes)
    || receipt.bytes !== Buffer.byteLength(receipt.body, "utf8") || receipt.bytes > 64 * 1024) return true;
  try {
    const parsed = JSON.parse(receipt.body);
    return parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.keys(parsed).length !== 2 || parsed.mode !== fixture.expected.mode
      || parsed.reason !== fixture.expected.reason;
  } catch { return true; }
}

export function createOperationModeKvProbe(resetCaches, digestText) {
  const key = "operation_mode:mirror";
  let receipt = null;
  return async function probe(request, env, ordinal, dispatch) {
    const url = new URL(request.url);
    if (url.pathname === "/__bench/operation-mode-kv-seed") {
      receipt = null;
      const reset = url.searchParams.get("reset");
      if (request.method !== "PUT" || !["0", "1"].includes(reset)) return new Response("bad seed request", { status: 400 });
      if (!env.KV) throw new Error("bench missing local KV binding");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length < 1 || bytes.length > 4 * 1024 * 1024) return new Response("bad seed size", { status: 400 });
      const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      await env.KV.put(key, raw);
      if (reset === "1") resetCaches();
      return Response.json({ bytes: bytes.length, sha256: await digestText(raw), reset: reset === "1" });
    }
    if (url.pathname === "/__bench/operation-mode-kv-receipt") {
      if (request.method !== "GET" || receipt === null || url.searchParams.get("request") !== String(receipt.ordinal)) {
        return new Response("missing or stale KV receipt", { status: 409 });
      }
      const { raw, ...evidence } = receipt;
      receipt = null;
      return Response.json({ ...evidence, readBytes: raw === null ? null : new TextEncoder().encode(raw).length,
        readSha256: raw === null ? null : await digestText(raw) });
    }
    if (url.pathname !== "/api/operation-mode/banner") return null;
    receipt = null;
    if (request.method !== "GET" || request.headers.has("x-bench-script")) return new Response("native KV diagnostic only", { status: 400 });
    if (!env.KV) throw new Error("bench missing local KV binding");
    const evidence = { ordinal, kvGets: 0, kvPuts: 0, kvDeletes: 0, kvOther: 0, kvGetFailures: 0, d1: 0, raw: null };
    const reject = (field) => (..._args) => { evidence[field] += 1; throw new Error("unexpected operation in KV diagnostic: " + field); };
    const native = env.KV;
    const kv = {
      get: async (...args) => {
        evidence.kvGets += 1;
        try {
          if (args.length !== 2 || args[0] !== key || args[1]?.cacheTtl !== 30 || Object.keys(args[1]).length !== 1) {
            throw new Error("unexpected operation-mode KV key/options");
          }
          const raw = await native.get(...args);
          if (typeof raw !== "string") throw new Error("missing or non-text KV fixture");
          evidence.raw = evidence.kvGets === 1 ? raw : null;
          return raw;
        } catch (error) {
          evidence.kvGetFailures += 1;
          evidence.raw = null;
          throw error;
        }
      },
      put: reject("kvPuts"), delete: reject("kvDeletes"),
      list: reject("kvOther"), getWithMetadata: reject("kvOther"),
    };
    const db = { prepare: reject("d1"), batch: reject("d1"), exec: reject("d1"), dump: reject("d1"), withSession: reject("d1") };
    const response = await dispatch(request, { ...env, KV: kv, DB: db });
    receipt = evidence;
    return response;
  };
}

export function operationModeScannerBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0", "ascii")).update(bytes).digest("hex");
}

export const EXPECTED_OPERATION_MODE_SCANNER_BLOB_SHA = "aa576714a174166a37aa0e15c116be40a13488be";

export function assertOperationModeScannerSource(content, expectedSha = EXPECTED_OPERATION_MODE_SCANNER_BLOB_SHA) {
  const actualSha = operationModeScannerBlobSha(content);
  if (actualSha !== expectedSha) {
    throw new Error("operation-mode KV diagnostic requires the pinned #918 scanner source; expected " + expectedSha + ", got " + actualSha);
  }
  return actualSha;
}


export function operationModeKvEvidenceMismatch(fixture, seed, evidence, ordinal, phase) {
  if (!["miss", "hit", "expiry"].includes(phase)) return true;
  const gets = phase === "hit" ? 0 : 1;
  return seed?.bytes !== fixture.bytes || typeof seed?.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(seed.sha256)
    || !Number.isSafeInteger(ordinal) || ordinal < 1 || evidence?.ordinal !== ordinal
    || evidence.kvGets !== gets || evidence.kvPuts !== 0 || evidence.kvDeletes !== 0 || evidence.kvOther !== 0
    || evidence.kvGetFailures !== 0 || evidence.d1 !== 0
    || evidence.readBytes !== (gets ? fixture.bytes : null)
    || evidence.readSha256 !== (gets ? seed.sha256 : null);
}

export const BUDGETS_MS = Object.freeze({ S2: 7, S3: 8, S4: 2 });
export const WARM_KINDS = Object.freeze(["normal", "limit", "invalid"]);
export const KINDS = Object.freeze([...WARM_KINDS, "cold"]);
export const QUIET_BASELINE_MAX_MS = 4;
export const MIN_SAMPLES = 50;

/** Nearest-rank percentile over an ascending-sorted array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(values) {
  // CPU durations cannot be negative. Invalid readings are tracked by
  // aggregate() and must never be silently accepted as enough samples.
  const sorted = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
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
 *  - noiseMs: the WARM-only max of BASELINE in the same run. Cold startup CPU is excluded. Noise only
 *    INFLATES a reading, so it can excuse an over-budget reading but never a passing one.
 *  - PASS         max + resolution is below the budget.
 *  - FAIL         even after subtracting the noise floor, max is at/over the budget.
 *  - INCONCLUSIVE otherwise (over budget but within noise, or too close to the budget for the clock).
 * kind "lt" = strictly below (S2/S3), "le" = at most (S4).
 */
export function judge(maxMs, budgetMs, { resolutionMs = 0, noiseMs = 0, kind = "lt" } = {}) {
  // A malformed CPU measurement, clock, or baseline must never be a PASS.
  if (![maxMs, budgetMs, resolutionMs, noiseMs].every((n) =>
    Number.isFinite(n) && n >= 0)) return "NOT_MEASURED";
  const upper = maxMs + resolutionMs;
  if (kind === "le" ? upper <= budgetMs : upper < budgetMs) return "PASS";
  const net = maxMs - noiseMs;
  if (kind === "le" ? net > budgetMs : net >= budgetMs) return "FAIL";
  return "INCONCLUSIVE";
}

/**
 * Calibration is a precondition for reporting CPU statistics, not evidence of
 * meeting a route budget. A 10× synchronous burn must produce a measurable,
 * strongly increasing profile. If samples are missing or the profiler is
 * disconnected, do not let a synthetic 0ms measurement become PASS.
 */
export function validateCpuProfilerCalibration(rows) {
  const burn = (iters) => rows.find((r) => r.route === "burn" && r.iters === iters)?.profilerBusyMs;
  const idle = burn(0);
  const light = burn(2_000_000);
  const heavy = burn(20_000_000);
  if (![idle, light, heavy].every((v) => Number.isFinite(v) && v >= 0)
    || light < 1 || heavy < 10 || heavy <= light * 2 || heavy <= idle + 10) {
    throw new Error("CPU profiler calibration failed: synchronous 2M/20M burn was not consistently measurable; route CPU evidence is invalid");
  }
  return { idleMs: idle, lightMs: light, heavyMs: heavy };
}

/**
 * Require a successful Chrome DevTools Protocol response envelope. A command
 * that returns an error or omits its result cannot be used as CPU evidence.
 */
export function requireInspectorResult(reply, method) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)
    || !Number.isSafeInteger(reply.id) || reply.id < 1) {
    throw new Error(`${method} failed: malformed inspector response`);
  }
  if (reply.error !== undefined) throw new Error(`${method} failed: inspector error`);
  if (!reply.result || typeof reply.result !== "object" || Array.isArray(reply.result)) {
    throw new Error(`${method} failed: missing inspector result`);
  }
  return reply.result;
}

/**
 * Convert one complete V8 CPUProfile into busy milliseconds and the largest
 * non-idle sample quantum. Validate every node/sample/delta before returning,
 * so malformed or unsampled profiles can never become a numeric zero.
 */
export function summarizeCpuProfile(profile) {
  const invalid = () => { throw new Error("CPU profiler returned malformed profile"); };
  if (!profile || typeof profile !== "object" || Array.isArray(profile)
    || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)
    || !Array.isArray(profile.timeDeltas) || profile.samples.length === 0
    || profile.samples.length !== profile.timeDeltas.length) invalid();

  const functionById = new Map();
  for (const node of profile.nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)
      || !Number.isSafeInteger(node.id) || node.id < 1 || functionById.has(node.id)
      || !node.callFrame || typeof node.callFrame !== "object" || Array.isArray(node.callFrame)
      || typeof node.callFrame.functionName !== "string") invalid();
    functionById.set(node.id, node.callFrame.functionName);
  }

  let busyMs = 0;
  let maxDeltaMs = 0;
  for (let i = 0; i < profile.samples.length; i += 1) {
    const sampleId = profile.samples[i];
    const deltaUs = profile.timeDeltas[i];
    if (!Number.isSafeInteger(sampleId) || sampleId < 1 || !functionById.has(sampleId)
      || typeof deltaUs !== "number" || !Number.isFinite(deltaUs) || deltaUs < 0) invalid();
    const deltaMs = deltaUs / 1000;
    if (!Number.isFinite(deltaMs)) invalid();
    // Validate idle deltas too; only non-idle work contributes to busy time/resolution.
    if (functionById.get(sampleId) !== "(idle)") {
      busyMs += deltaMs;
      if (!Number.isFinite(busyMs)) invalid();
      if (deltaMs > maxDeltaMs) maxDeltaMs = deltaMs;
    }
  }
  return { busyMs, maxDeltaMs };
}

/** Number of rows delivered to application code; NOT Cloudflare D1 billed rows_read. */
export function returnedRows(mode, value) {
  if (mode === "first") return value == null ? 0 : 1;
  if (mode === "raw") return Array.isArray(value) ? value.length : 0;
  if (mode === "batch") return Array.isArray(value)
    ? value.reduce((sum, result) => sum + (Array.isArray(result?.results) ? result.results.length : 0), 0)
    : 0;
  return Array.isArray(value?.results) ? value.results.length : 0;
}

/** Group raw samples {kind, cpuMs, status, bytes, d1, d1RowsReturned, d1PerQueryRows} into per-kind summaries. */
export function aggregate(samples, { runtimeClass, resolutionMs, noiseMs = 0 }) {
  const budget = BUDGETS_MS[runtimeClass];
  const budgetKind = runtimeClass === "S4" ? "le" : "lt";
  const kinds = {};
  for (const kind of [...new Set([...KINDS, ...samples.map((s) => s.kind)])]) {
    const rows = samples.filter((s) => s.kind === kind);
    const cpu = summarize(rows.map((r) => r.cpuMs));
    // 50 good samples + 1 NaN/negative sample is NOT 50 trustworthy
    // observations. Preserve all invalid readings in a reviewable count.
    const invalidCpuSamples = rows.filter((r) =>
      !Number.isFinite(r.cpuMs) || r.cpuMs < 0).length;
    kinds[kind] = {
      ...cpu,
      invalidCpuSamples,
      meetsMinSamples: cpu.n >= MIN_SAMPLES && invalidCpuSamples === 0,
      unexpectedStatus: rows.filter((r) => r.unexpected).length,
      // Cold isolate first-request provenance is NOT inferred from a post-reload
      // label. Only independently verified first-isolate requests qualify.
      verifiedIsolateStarts: kind === "cold"
        ? rows.filter((r) => r.isFirstIsolateRequest === true).length : 0,
      coldStarts: kind === "cold" ? rows.map((r) => ({
        generation: r.coldGeneration ?? null, processId: r.coldProcessId ?? null,
        requestOrdinal: r.requestOrdinal ?? null, verified: r.isFirstIsolateRequest === true,
        recorder: r.coldRecorder ?? null,
      })) : undefined,
      maxBytes: rows.reduce((m, r) => Math.max(m, r.bytes ?? 0), 0),
      maxD1Statements: rows.reduce((m, r) => Math.max(m, r.d1 ?? 0), 0),
      // Returned-result proxy; missing counts stay unknown, never become zero.
      d1RowsReturned: (() => {
        const counts = rows.map((r) => r.d1RowsReturned)
          .filter((v) => Number.isSafeInteger(v) && v >= 0).sort((a, b) => a - b);
        return counts.length ? {
          min: counts[0], median: percentile(counts, 50),
          max: counts[counts.length - 1], total: counts.reduce((a, b) => a + b, 0),
        } : null;
      })(),
      d1PerQueryRowsBySample: rows.map((r) => r.d1PerQueryRows ?? null),
    };
  }
  // ZERO_1102 §3 judges every warm request path, including RH-013's named
  // scheduled-warm/realtime-warm modes. Only cold isolate starts are diagnostic.
  const warmMaxima = Object.entries(kinds)
    .filter(([kind]) => kind !== "cold")
    .map(([, row]) => row.max)
    .filter((max) => max != null);
  const overallMax = warmMaxima.length ? Math.max(...warmMaxima) : null;
  const coldMax = kinds.cold.max;
  return {
    runtimeClass,
    budgetMs: budget,
    kinds,
    overallMax, // Warm-only maximum; used for the S2/S3/S4 budget verdict.
    coldMax,    // Separately reported, never used as warm noise or budget max.
    noiseMs,
    verdict: judge(overallMax, budget, { resolutionMs, noiseMs, kind: budgetKind }),
  };
}

/**
 * Apply the run-level acceptance gate after all samples are collected.
 * A quiet BASELINE is mandatory: warm max < 4ms, with >= 50 valid samples in
 * each warm kind. Cold startup never changes the warm noise or budget verdict.
 * This is local evidence only, not Cloudflare production CPU accounting.
 */
export function applyBudgetVerdicts(results, { resolutionMs }) {
  const baseline = results.find((r) => r.id === "BASELINE");
  const baseAgg = baseline ? aggregate(baseline.samples, { runtimeClass: "S2", resolutionMs }) : null;
  const noiseFloorMs = baseAgg?.overallMax ?? null;
  const baselineColdMaxMs = baseAgg?.coldMax ?? null;
  // A V8 sampling profiler may under-read by one clock quantum. A warm
  // BASELINE of 3.5ms with a 0.5ms quantum does NOT prove strict <4ms.
  const baselineUpperBoundMs = noiseFloorMs !== null
    && Number.isFinite(resolutionMs) && resolutionMs >= 0
    ? noiseFloorMs + resolutionMs : null;
  const quietBaseline = baselineUpperBoundMs !== null
    && baselineUpperBoundMs < QUIET_BASELINE_MAX_MS
    && WARM_KINDS.every((kind) => baseAgg.kinds[kind].meetsMinSamples && baseAgg.kinds[kind].unexpectedStatus === 0);

  for (const r of results) {
    r.agg = aggregate(r.samples, {
      runtimeClass: r.runtimeClass, resolutionMs, noiseMs: noiseFloorMs ?? 0,
    });
    if (r.id === "BASELINE") {
      r.agg.verdict = "NOISE_FLOOR";
    } else if (!quietBaseline) {
      r.agg.verdict = "STOP_BASELINE";
    } else if (![...new Set([
      ...WARM_KINDS, ...(r.expectedWarmKinds ?? []),
      ...Object.keys(r.agg.kinds).filter((kind) => kind !== "cold"),
    ])].every((kind) => r.agg.kinds[kind]?.meetsMinSamples
      && r.agg.kinds[kind]?.unexpectedStatus === 0)) {
      // Missing/unhealthy RH-013 special warm mode must NEVER become a PASS.
      r.agg.verdict = "STOP_SAMPLES";
    }
  }
  return { noiseFloorMs, baselineColdMaxMs, baselineUpperBoundMs, quietBaseline };
}

/**
 * Prevent a valid proxy/partial run from being misreported as API CPU acceptance.
 * Linux workerd with local D1/R2 replay and complete cold coverage is necessary
 * for MIG-0639 U02; it is never a substitute for actual production telemetry.
 * This is intentionally separate from pure judge()/aggregate() unit math.
 */
export function enforceCpuMeasurementEnvironment(results, {
  mode, d1, platform, only = null, skipCold = false, coldSamples = 0, warmup = 0,
}) {
  let stopReason = null;
  if (mode !== "wrangler") stopReason = "STOP_PROXY";
  else if (platform !== "linux") stopReason = "STOP_PLATFORM";
  else if (d1 !== "replay") stopReason = "STOP_D1_SIM";
  else if (only != null) stopReason = "STOP_PARTIAL";
  else if (warmup < 10) stopReason = "STOP_WARMUP";
  else if (skipCold || coldSamples < MIN_SAMPLES
    || !results.every((r) => r.agg?.kinds?.cold?.meetsMinSamples === true
      && r.agg.kinds.cold.verifiedIsolateStarts >= MIN_SAMPLES
      && r.agg.kinds.cold.unexpectedStatus === 0)) {
    stopReason = "STOP_COLD";
  }
  if (stopReason) {
    for (const r of results) {
      if (r.id === "BASELINE") continue;
      // Keep the more specific baseline/sample STOP, never convert a STOP to PASS.
      if (r.agg.verdict !== "STOP_BASELINE" && r.agg.verdict !== "STOP_SAMPLES") {
        r.agg.verdict = stopReason;
      }
    }
  }
  return { eligible: stopReason === null, stopReason };
}

export function parseArgs(argv) {
  const out = {
    mode: "wrangler", samples: MIN_SAMPLES, coldSamples: MIN_SAMPLES, warmup: 10,
    port: 8788, inspectorPort: 9239, d1: "replay", samplingUs: 100, only: null, out: null, dryRun: false, skipCold: false, includePending: false, operationModeKvCase: null, operationModeKv: false,
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
    else if (a === "--operation-mode-kv") {
      if (out.operationModeKv) throw new Error("--operation-mode-kv requires exactly one workload per invocation");
      out.operationModeKvCase = next();
      out.operationModeKv = true;
    }
    else throw new Error(`Unsupported argument: ${a}`);
  }
  if (!["replay", "sim"].includes(out.d1)) throw new Error("--d1 must be replay|sim");
  if (!["wrangler", "inproc"].includes(out.mode)) throw new Error(`--mode must be wrangler|inproc`);
  for (const k of ["samples", "coldSamples", "warmup", "port", "inspectorPort", "samplingUs"]) {
    if (!Number.isInteger(out[k]) || out[k] < 0) throw new Error(`--${k} must be a non-negative integer`);
  }
  if (out.operationModeKv) {
    if (!operationModeMirrorFixtureCases().includes(out.operationModeKvCase)) throw new Error("unknown --operation-mode-kv workload");
    if (out.mode !== "wrangler" || out.d1 !== "sim" || out.only !== null || out.includePending) {
      throw new Error("--operation-mode-kv requires --mode wrangler --d1 sim and cannot combine with --only or --include-pending");
    }
    if (out.samples < 1 || (!out.skipCold && out.coldSamples < 1)) throw new Error("KV diagnostic requires nonzero samples");
  }
  return out;
}

export function formatMs(v, digits) {
  return v == null ? "-" : v.toFixed(digits);
}

export function renderMarkdown(results, { digits, label }) {
  const lines = [
    `| scenario | class | kind | n | p50 | p95 | p99 | max (ms) | D1 execution requests | D1 returned rows proxy (min/med/max/total) | bytes | unexpected status |`,
    `| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const r of results) {
    for (const kind of Object.keys(r.agg.kinds)) {
      const k = r.agg.kinds[kind];
      lines.push(
        `| ${r.id} ${r.title} | ${r.runtimeClass} | ${kind} | ${k.n} | ${formatMs(k.p50, digits)} | ${formatMs(k.p95, digits)} | ${formatMs(k.p99, digits)} | ${formatMs(k.max, digits)} | ${k.maxD1Statements} | ${k.d1RowsReturned ? [k.d1RowsReturned.min, k.d1RowsReturned.median, k.d1RowsReturned.max, k.d1RowsReturned.total].join("/") : "-"} | ${k.maxBytes} | ${k.unexpectedStatus} |`,
      );
    }
  }
  lines.push("", "D1 execution requests (JSON maxD1Statements): prepare/bind/rebind count 0; each first/all/run/raw attempt counts 1; batch counts submitted entries, including failed batches. These are not completed physical DB operations or billed D1 usage. Returned rows are an application-visible proxy, not D1 rows_read.", "");
  lines.push("Cold provenance: fresh local processes attest their generation and first request ordinal; inspect JSON agg.kinds.cold.coldStarts and verifiedIsolateStarts. Unverified post-reload targets remain diagnostics. LOCAL evidence does not replace separately authorized nonproduction Worker/tail cpuTime under ZERO_1102 §5.", "");
  lines.push(`Warm-only budget verdict by max (${label}); cold shown separately (never judged):`, "");
  lines.push(`| scenario | class | budget | warm max (ms) | cold max (ms) | verdict |`, `| --- | --- | --- | ---: | ---: | --- |`);
  for (const r of results) {
    const op = r.runtimeClass === "S4" ? "<=" : "<";
    lines.push(`| ${r.id} ${r.title} | ${r.runtimeClass} | ${op} ${r.agg.budgetMs}ms | ${formatMs(r.agg.overallMax, digits)} | ${formatMs(r.agg.coldMax, digits)} | ${r.agg.verdict} |`);
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
// SA-105 validates both dimensions >=64px: the generic 1x1 media stub is deliberately NOT a valid icon.
const BENCH_ICON_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAUUlEQVR42u3PMQ0AMAgAMJhv5OAFWVPBQdI6aFZPXPbiOAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYF9H5y5AmrFkgYHAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));
const benchFetchStub = async () => new Response(BENCH_PNG, { headers: { "content-type": "image/png" } });
const MAX_STATS_BYTES = 64 * 1024;

function adminHeaders() {
  return { cookie: ADMIN_COOKIE, origin: SITE_URL, "content-type": "application/json" };
}
const json = (v) => JSON.stringify(v);
const annBody = (extra = {}) => ({ title: "Bench", body: "Bench body", severity: "info", target_audience: "all", is_published: 1, ...extra });

const RH013_EVENT_ID = "bench-export-event";
const RH013_VIDEOS = 500;
/** Exact Cache API URLs used by server-core publicJsonCacheUrl(eventExportPayloadCacheKey(...)). */
export function eventExportCacheRequestUrls(eventId = RH013_EVENT_ID) {
  return ["v5", "legacy"].flatMap((format) => [15, 60, 360, 1440].map((refresh) => {
    const key = ["public-event-export", 9, encodeURIComponent(eventId), format, refresh].join(":");
    return `https://flamenode.internal/public-json/${encodeURIComponent(key)}`;
  }));
}
const RH013_MEMBERS_PER_VIDEO = 100;
let rh013Seeded = false;
let rh013IpSeq = 0;
const rh013Ip = () => { rh013IpSeq += 1; return { "cf-connecting-ip": `10.13.${(rh013IpSeq >> 8) & 255}.${rh013IpSeq & 255}` }; };
/** Seed once per process: returns [] after the first call (the event persists in the target DB). */
function rh013Seed() {
  if (rh013Seeded) return [];
  rh013Seeded = true;
  return rh013Fixture();
}

/** Complete fixture for a new database, independent of the parent seed flag. */
function rh013Fixture() {
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

export function buildScenarios(ctx, { includePending = false, includeEventPlaylist = false } = {}) {
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
      // Warm requests reuse their database and the seed-once generator below.
      // Each cold recorder has a fresh DB and needs all three unchanged seeds.
      prepareKind: {
        normal: { coldSetup: rh013Fixture() },
        limit: { coldSetup: rh013Fixture() },
      },
      // Warm-path measurements are separate from the scheduled full-rebuild control.
      warmModes: {
        "scheduled-warm": { path: `/api/event-endpoints/${RH013_EVENT_ID}?format=v5&update=scheduled&refresh=15`, expectCache: "HIT", verifyBodyReuse: true },
        "realtime-warm": { path: `/api/event-endpoints/${RH013_EVENT_ID}?format=v5&update=realtime`, expectCache: "BYPASS", verifyBodyReuse: true },
      },
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
  return [...core, ...buildRouteScenarios(), ...(includePending ? buildPendingScenarios() : []),
    ...(includeEventPlaylist ? [buildEventPlaylistScenario()] : []), baseline];
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

// Explicit diagnostic variant, not another mounted method or part of the default
// 155-scenario inventory. Positive fence/race behavior requires the attested
// #719/#723 runtime candidate; this harness branch does not supply those fixes.
function buildEventPlaylistScenario() {
  const videoId = "bench-playlist-video", eventId = "bench-playlist-event";
  const blockedId = "bp-v1";
  const detail = json({
    version: 1, generated_at: 1000,
    video: { id: videoId, title: "Bench playlist video", visibility_status: "public", scheduled_time: 2000, primary_event_id: eventId },
    public_events: [{ id: eventId, title: "Bench playlist", visibility_status: "public" }],
    public_chapters: [],
  });
  const manifest = json({ schema_version: 1, revision: 1, generated_at: 1_700_000_000,
    entities: [{ entity_type: "video", entity_id: blockedId, fence_token: "bench-playlist-fence", blocked_at: 1_700_000_000 }],
  });
  const items = (count) => Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? videoId : `bp-v${i}`, title: "V", display_name: "B", youtube_video_id: `yt${i}`, scheduled_time: null,
  }));
  const counts = { normal: 3, limit: 500, invalid: 501 };
  const prepareKind = {}, kinds = {};
  for (const [kind, count] of Object.entries(counts)) {
    const rows = items(count);
    prepareKind[kind] = { r2Objects: {
      [MANIFEST_KEY]: manifest,
      [`videos/${videoId}.json`]: detail,
      [`events/${eventId}/playlist.v1.json`]: json({
        schema_version: 1, generated_at: 1_700_000_000, event_id: eventId, complete: true, items: rows,
      }),
    } };
    kinds[kind] = (i) => ({
      method: "GET", path: `/api/videos/${videoId}/viewer-overlay?playlist=${eventId}`,
      headers: { "cf-connecting-ip": BENCH_IP(kind, i), cookie: ADMIN_COOKIE },
      visibilityGuardMode: "enforce", expect: [200],
      expectPlaylist: {
        label: kind === "invalid" ? "再生リスト" : "Bench playlist 上映順",
        ids: kind === "invalid" ? [] : rows.filter((row) => row.id !== blockedId).map((row) => row.id),
      },
      setup: [
        { sql: "INSERT OR REPLACE INTO events (id, title, event_type, visibility_status, start_time, end_time, created_at, updated_at, public_api_enabled) VALUES (?, 'Bench playlist', 'event', 'public', 1000, 2000, 10, 20, 0)", params: [eventId] },
        { sql: "INSERT OR REPLACE INTO videos (id, submitted_by_user_id, creator_display_name, title, visibility_status, updated_at, primary_event_id) VALUES (?, 'bench-admin', 'B', 'V', 'public', 1000, ?)", params: [videoId, eventId] },
      ],
    });
  }
  return { id: "RH-031-PLAYLIST", title: "GET video viewer-overlay with enforced event playlist (opt-in candidate diagnostic)", runtimeClass: "S2", prepareKind, kinds };
}

/** Bench-only transport; an explicit mode is never installed in shared env. */
export function benchmarkRequestHeaders(spec) {
  const headers = new Headers(spec.headers ?? {});
  if (headers.has("x-bench-visibility-guard-mode")) throw new Error("bench visibility guard header is reserved; use visibilityGuardMode");
  if (Object.hasOwn(spec, "visibilityGuardMode")) {
    if (!["off", "observe", "enforce"].includes(spec.visibilityGuardMode)) throw new Error("bench invalid visibility guard mode");
    headers.set("x-bench-visibility-guard-mode", spec.visibilityGuardMode);
  }
  return headers;
}

export function benchmarkRequestEnv(env, headers) {
  const mode = headers.get("x-bench-visibility-guard-mode");
  if (mode === null) return env;
  if (!["off", "observe", "enforce"].includes(mode)) throw new Error("bench invalid visibility guard mode");
  return { ...env, PUBLIC_VISIBILITY_GUARD_MODE: mode };
}

/** Host-side assertion after timing/profiling stops; no response bytes enter a transcript. */
export function playlistResponseMismatch(spec, body) {
  if (spec.expectPlaylist == null) return false;
  const bytes = Buffer.from(body);
  if (bytes.byteLength > 64 * 1024) return true;
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    const expected = spec.expectPlaylist;
    return value.loggedIn !== true || value.authUnavailable !== false
      || value.playlistLabel !== expected.label || !Array.isArray(value.playlistItems)
      || value.playlistItems.length !== expected.ids.length
      || value.playlistItems.some((item, i) => item?.id !== expected.ids[i]);
  } catch { return true; }
}

// Local-only fixture. Reset the template table on every authenticated sample;
// otherwise a prior SA-035 write or earlier limit sample can pollute normal.
// No fixture generation or validation is included in the workerd profile.
const BENCH_TEMPLATE_ID = "bench-ar-template-001";
function benchTemplateFixture(kind, selected) {
  const limit = kind === "limit";
  const count = limit ? 100 : 1;
  const name = limit ? "\u3042".repeat(120) : "Bench template";
  const description = limit ? "\u3042".repeat(500) : "Short description";
  const prefix = '{"v":"', suffix = '"}';
  const raw = limit ? prefix + ('\\' + '"').repeat((65536 - Buffer.byteLength(prefix + suffix)) / 2) + suffix : '{"v":1}';
  const templates = Array.from({ length: count }, (_, i) => ({
    id: "bench-ar-template-" + String(i + 1).padStart(3, "0"),
    name, description, source_event_id: "bench-evt", updated_at: 4102444800 - i - 1,
  }));
  const expected = { guardOk: true, templates, ...(selected ? {
    userId: "bench-admin", templateId: BENCH_TEMPLATE_ID, templateName: name,
    templateSettingsJson: raw, formInitial: "deferred",
  } : {}) };
  return { expected, setup: [
    { sql: "DELETE FROM event_templates", params: [] },
    { sql: "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < ?)\n" +
      "INSERT INTO event_templates (id,name,description,source_event_id,settings_json,created_by_user_id,created_at,updated_at)\n" +
      "SELECT printf('bench-ar-template-%03d',n), ?, ?, 'bench-evt', CASE WHEN n=1 THEN ? ELSE '{\"v\":1}' END,\n" +
      "'bench-admin',1700000000,4102444800-n FROM seq", params: [limit ? count + 1 : count, name, description, raw] },
  ] };
}

/** Host-side check of exact DTO wire bytes and actual read evidence, not an
 * exception to the S2 total-byte budget. A real maximal valid result can
 * exceed 64KiB; never turn a truncated or denied list into a CPU PASS. */
export function templateResponseMismatch(spec, body, headers, d1, rows) {
  const expected = spec.expectTemplates;
  if (expected == null) return false;
  if (headers.get("cache-control") !== "private, no-store" || !/^application\/json(?:;|$)/i.test(headers.get("content-type") ?? "") ||
      d1 !== 3 || rows?.length !== 3 || rows[0] !== 1 || rows[1] !== 1 || rows[2] !== expected.templates.length) return true;
  return !Buffer.from(body).equals(Buffer.from(JSON.stringify(expected)));
}

function hasResponseExpectation(spec) {
  return spec.expectPlaylist != null || spec.expectTemplates != null;
}
function benchmarkResponseMismatch(spec, body, headers, d1, rows) {
  return playlistResponseMismatch(spec, body) || templateResponseMismatch(spec, body, headers, d1, rows);
}

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

// MIG-0639 / SA-049,051..055: local drafts/published terms, isolated across samples.
let termsPublishSeq = 900;
const benchTermsId = (i, tag) => `bench-terms-${tag}-${i}`;
const termsParams = (kind, i, tag) => ({ id: benchTermsId(i, tag) });
const termsRow = (id, status, severity = "major") => ({
  sql: "INSERT OR REPLACE INTO terms_versions (id,version_label,body_markdown,status,severity,published_at,created_by_user_id,created_at,updated_at) VALUES (?, 'bench-v1', 'bench body', ?, ?, ?, 'bench-admin', 100, 100)",
  params: [id, status, severity, status === "published" ? ++termsPublishSeq : null],
});
const termsSetup = (status, severity = "major", { keepSinglePublished = false } = {}) => (kind, i, tag) => [
  ...(keepSinglePublished ? [{
    sql: "UPDATE terms_versions SET status = 'archived' WHERE id LIKE 'bench-terms-%' AND status = 'published' AND id != COALESCE((SELECT id FROM terms_versions WHERE id LIKE 'bench-terms-%' AND status = 'published' ORDER BY published_at DESC, rowid DESC LIMIT 1), '')",
    params: [],
  }] : []),
  termsRow(benchTermsId(i, tag), status, severity),
  ...(status === "published" ? [{ sql: `UPDATE "user" SET accepted_terms_version_id = ? WHERE id = 'bench-admin'`, params: [benchTermsId(i, tag)] }] : []),
];

// MIG-0639 / SA-099..100: owned X-ID request rows on local D1 only.
const benchXRequestId = (i, tag) => `bench-xreq-${tag}-${i}`;
const clearPendingXRequests = {
  sql: "DELETE FROM x_identity_requests WHERE requested_by_auth_user_id = 'bench-admin' AND status = 'pending'",
  params: [],
};
const xMergeParentRow = (i, tag) => [
  clearPendingXRequests,
  { sql: "INSERT OR IGNORE INTO x_users (id,x_name,approval_status) VALUES ('bench-x-source','Bench Source','approved')", params: [] },
  {
  sql: "INSERT OR REPLACE INTO x_identity_requests (id,request_type,requested_by_auth_user_id,requested_x_id,source_x_user_id,target_x_user_id,restore_snapshot_json,revert_deadline_at,status,requested_at,updated_at) VALUES (?, 'merge', 'bench-admin', NULL, 'bench-x-source', 'bench-x', '{\"v\":1}', 4102444800, 'done', 50, 60)",
  params: [benchXRequestId(i, tag)],
  },
];
const xRequestRow = (i, tag) => ({
  sql: "INSERT OR REPLACE INTO x_identity_requests (id, request_type, requested_by_auth_user_id, requested_x_id, status, requested_at, updated_at) VALUES (?, 'new_link', 'bench-admin', ?, 'pending', 10, 10)",
  params: [benchXRequestId(i, tag), `bench-new-${tag}-${i}`],
});


/** MIG-0639: live MIG-0654 staff and MIG-0643 operational write fixtures.
 * Reset the affected local rows for every repetition so 50+ samples exercise
 * the same mutation rather than drifting into a duplicate/no-op case.
 */
const benchStaff = (id, x, preset = "public_staff") => ({
  sql: "INSERT OR REPLACE INTO event_staff (id,event_id,x_user_id,display_name,permission_preset,is_public,created_at,updated_at) VALUES (?,'bench-evt',?,'Benchmark staff',?,0,100,100)",
  params: [id,x,preset],
});
const benchStaffX = (id) => ({
  sql: "INSERT OR IGNORE INTO x_users (id,x_name,approval_status) VALUES (?, 'Benchmark staff', 'approved')",
  params: [id],
});
const benchStaffSetup = (kind, i, tag, action) => {
  const x = "bst_" + action;
  const staffId = "bench-" + action;
  return [
    benchStaffX(x),
    // The canonical bulk mutation invariant requires at least one operable owner.
    // Seed a distinct, approved and linked owner; the CSV subject is NOT the actor.
    ...(action === "csv" ? [
      benchStaffX("bst_csv_owner"),
      { sql:"INSERT OR IGNORE INTO x_user_account_links (x_user_id,auth_user_id,link_role) VALUES ('bst_csv_owner','bench-admin','owner')",params:[] },
      benchStaff("bench-csv-owner","bst_csv_owner","owner"),
    ] : []),
    ...(action === "create" || action === "csv" ? [{
      sql: "DELETE FROM event_staff WHERE event_id = 'bench-evt' AND x_user_id = ?", params:[x],
    }] : [benchStaff(staffId,x)]),
  ];
};
const benchTransferSetup = () => [
  benchStaffX("bench_from"),
  benchStaffX("bench_to"),
  { sql:"INSERT OR IGNORE INTO x_user_account_links (x_user_id,auth_user_id,link_role) VALUES ('bench_to','bench-admin','owner')",params:[] },
  { sql:"INSERT OR IGNORE INTO x_user_account_links (x_user_id,auth_user_id,link_role) VALUES ('bench_from','bench-admin','owner')",params:[] },
  benchStaff("bench-from","bench_from","owner"),
  benchStaff("bench-to-staff","bench_to","manager"),
];
const benchQueueId = (i, tag) => "bench-q-" + tag + "-" + i;
const benchFailedQueue = (i, tag) => ({
  sql: "INSERT OR REPLACE INTO static_rebuild_queue (id,target_type,target_id,reason,priority,status,attempt_count,created_at,updated_at) VALUES (?,'event',?,'bench retry','low','failed',1,100,100)",
  params:[benchQueueId(i,tag),"evt-" + tag + "-" + i],
});
const benchQueueSetup = (kind,i,tag) => [benchFailedQueue(i,tag)];
const benchVisibilitySetup = (kind,i,tag) => [{
  sql:"INSERT OR REPLACE INTO public_visibility_fences (entity_type,entity_id,fence_token,state,updated_at) VALUES ('event','bench-evt',?,'blocked',100)",
  params:["bench-fence-" + tag + "-" + i],
}];
const benchYoutubeId = (kind,i,tag) => kind === "limit" ? "v".repeat(128) : "bench-vid";
const benchYoutubeSetup = (kind,i,tag) => [
  ...(kind === "limit" ? [{
    sql:"INSERT OR REPLACE INTO videos (id,submitted_by_user_id,creator_display_name,title,visibility_status,updated_at) VALUES (?,'bench-admin','Bench','Benchmark','public',1000)",
    params:[benchYoutubeId(kind,i,tag)],
  }] : []),
  { sql:"DELETE FROM video_youtube_metadata WHERE video_id = ?",params:[benchYoutubeId(kind,i,tag)] },
];


/** MIG-0639: independent, real-handler input fixtures for SA-025..030 and SA-098/102..105.
 * A private event group avoids unrelated public R2 fencing during the write CPU
 * measurement; its membership is rebuilt before each sample. No live data.
 */
const BENCH_X_CANON = "bench_x";
const groupIdFor = (tag, i) => "g-" + String(tag).toLowerCase().replace(/[^a-z0-9]/g, "").slice(-32) + "-" + i;
const groupReset = () => [
  { sql: "INSERT OR REPLACE INTO event_groups (id,name,slug,group_type,visibility_status,sort_order,created_at,updated_at) VALUES ('bench-group','Bench group','bench-group','series','private',0,10,20)", params: [] },
];
const groupMemberReset = () => [
  ...groupReset(),
  { sql: "INSERT OR REPLACE INTO event_group_events (event_group_id,event_id,relation_type,created_at,updated_at) VALUES ('bench-group','bench-evt','member',10,20)", params: [] },
];
const groupLimitEvents = () => numberedRows(80,
  "INSERT OR REPLACE INTO events (id,title,event_type,visibility_status,start_time,end_time,created_at,updated_at,public_api_enabled) SELECT 'bevg-' || n,'Limit event ' || n,'event','public',1000,2000,10,20,0 FROM seq", []);
const groupAddSetup = (kind) => [...groupReset(), ...(kind === "limit" ? [groupLimitEvents()] : [])];
const xidCanonicalReset = () => [
  { sql: "INSERT OR IGNORE INTO x_users (id,x_name,approval_status,icon_url) VALUES ('bench_x','Benchmark X','approved','/api/media/xicons/bench_x/old.png')", params: [] },
  { sql: "INSERT OR IGNORE INTO x_user_account_links (x_user_id,auth_user_id,link_role) VALUES ('bench_x','bench-admin','owner')", params: [] },
];
const xidActiveReset = () => [...xidCanonicalReset(),
  { sql: "UPDATE \"user\" SET active_x_user_id='bench-x' WHERE id='bench-admin'", params: [] },
];
const xidIconReset = () => [...xidCanonicalReset(),
  { sql: "UPDATE x_users SET icon_url='/api/media/xicons/bench_x/old.png' WHERE id='bench_x'", params: [] },
  { sql: "UPDATE videos SET creator_x_user_id='bench_x', creator_icon_url='/api/media/xicons/bench_x/new.png', created_at=1000, visibility_status='public' WHERE id='bench-vid'", params: [] },
];

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
  ["HONO-AR-10", "GET", "/api/admin-read/events/templates", "a", { lq: "", templateRead: "list" }],
  ["HONO-AR-11", "GET", "/api/admin-read/events/new", "a", { nq: "?template=" + BENCH_TEMPLATE_ID, templateRead: "new" }],
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
  // SA-031..034: real staff create/update/delete, CSV, and owner transfer.
  ["SA-034", "POST", "/api/manage/events/:id/owner-transfer", "w", { setup: benchTransferSetup }],
  ["SA-032", "POST", "/api/manage/events/:id/staff/csv", "w", { setup: (k,i,t) => benchStaffSetup(k,i,t,"csv") }],
  ["SA-031-CREATE", "POST", "/api/manage/events/:id/staff", "w", { setup: (k,i,t) => benchStaffSetup(k,i,t,"create") }],
  ["SA-031-UPDATE", "PUT", "/api/manage/events/:id/staff/:staffId", "w", { params: () => ({staffId:"bench-update"}), setup: (k,i,t) => benchStaffSetup(k,i,t,"update") }],
  ["SA-033", "DELETE", "/api/manage/events/:id/staff/:staffId", "w", { params: () => ({staffId:"bench-delete"}), setup: (k,i,t) => benchStaffSetup(k,i,t,"delete") }],
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
  // SA-049 / SA-051..055: exact handler names and contracts per MIG-0642 parity suite
  ["SA-099", "POST", "/api/xid/requests", "w", { setup: () => [clearPendingXRequests] }],
  ["SA-100", "POST", "/api/xid/requests/:id/cancel", "w", { params: (kind, i, tag) => ({ id: benchXRequestId(i, tag) }), setup: (kind, i, tag) => [clearPendingXRequests, xRequestRow(i, tag)] }],
  ["SA-101", "POST", "/api/xid/merge-revert-requests", "w", { setup: (kind, i, tag) => xMergeParentRow(i, tag) }],
  ["SA-049", "PUT", "/api/admin/permissions/editable-fields", "w"],
  ["SA-051", "POST", "/api/admin/terms", "w"],
  ["SA-052", "PATCH", "/api/admin/terms/:id", "w", { params: termsParams, setup: termsSetup("draft") }],
  ["SA-053", "POST", "/api/admin/terms/:id/publish", "w", { params: termsParams, setup: termsSetup("draft", "minor", { keepSinglePublished: true }) }],
  ["SA-054", "POST", "/api/admin/terms/:id/reaccept-broadcast", "w", { params: termsParams, setup: termsSetup("published") }],
  ["SA-055", "POST", "/api/admin/terms/:id/archive", "w", { params: termsParams, setup: termsSetup("draft") }],
  ["SA-048", "POST", "/api/admin/notifications/retry-failed", "w", { setup: (kind, i, tag) => kind === "limit"
    ? Array.from({ length: 10 }, (_, n) => notificationRow(`${benchNotificationId(i, tag)}-${n}`, "failed"))
    : notificationSetup("failed")(kind, i, tag) }],
  ["SA-045", "POST", "/api/admin/notifications/:id/retry", "w", { params: notificationParams, setup: notificationSetup("failed") }],
  ["SA-046", "POST", "/api/admin/notifications/:id/cancel", "w", { params: notificationParams, setup: notificationSetup("pending") }],
  ["SA-047", "POST", "/api/admin/notifications/:id/force-resend", "w", { params: notificationParams, setup: notificationSetup("sent") }],
  // MIG-0643: five static-build operations, visibility repair, YouTube resync.
  ["SA-069", "POST", "/api/admin/static-builds/backfill", "w"],
  ["SA-070", "POST", "/api/admin/static-builds/queue/:queueId/retry", "w", { params:(k,i,t) => ({queueId:k === "invalid" ? "x".repeat(129) : benchQueueId(i,t)}),setup:benchQueueSetup }],
  ["SA-073", "POST", "/api/admin/static-builds/retry-failed", "w", { setup:benchQueueSetup, invalidOrigin:true }],
  ["SA-071", "POST", "/api/admin/static-builds/rebuild", "w", { setup: () => [{ sql:"DELETE FROM static_rebuild_queue WHERE target_type = 'event' AND target_id = 'bench-evt'",params:[] }] }],
  ["SA-072", "POST", "/api/admin/static-builds/shared-inputs/rebuild", "w", { invalidOrigin:true, setup:() => [{ sql:"DELETE FROM static_rebuild_queue WHERE target_type IN ('youtube_related_blocklist','random_video_pool') AND target_id = 'global'",params:[] }] }],
  ["SA-050", "POST", "/api/admin/visibility-repair", "w", { setup:benchVisibilitySetup }],
  ["SA-106", "POST", "/api/admin/youtube-sync/videos/:videoId/resync", "w", { params:(k,i,t) => ({videoId:k === "invalid" ? "x".repeat(129) : benchYoutubeId(k,i,t)}),setup:benchYoutubeSetup }],
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

  // MIG-0653 SA-025..030: actual bounded candidate read and audited private-group mutations.
  ["SA-025", "GET", "/api/admin/event-groups/event-options", "a", {
    nq:"?groupId=bench-group", lq:"?groupId=bench-group&q=" + "x".repeat(64),
    setup:(kind) => kind === "limit" ? [groupLimitEvents()] : [],
  }],
  ["SA-026", "POST", "/api/admin/event-groups", "w"],
  ["SA-027", "PATCH", "/api/admin/event-groups/:id", "w", {setup:groupReset}],
  ["SA-028", "DELETE", "/api/admin/event-groups/:id", "w", {
    setup:groupReset, params:(kind) => kind === "invalid" ? {id:"e".repeat(129)} : {},
  }],
  ["SA-030", "DELETE", "/api/admin/event-groups/:id/events/:eventId", "w", {
    setup:groupMemberReset, params:(kind) => ({eventId:"bench-evt",...(kind === "invalid" ? {id:"e".repeat(129)} : {})}),
  }],
  ["SA-029", "POST", "/api/admin/event-groups/:id/events", "w", {setup:groupAddSetup}],
  // MIG-0636 SA-098/102..105: canonical linked X handles, genuine audited write paths.
  ["SA-098", "POST", "/api/xid/active", "w", {setup:xidActiveReset}],
  ["SA-102", "PATCH", "/api/xid/:xUserId/profile", "w", {
    params:()=>({xUserId:BENCH_X_CANON}), setup:xidCanonicalReset,
    // Empty JSON is an allowed no-op profile patch; reject invalid Origin instead.
    invalidOrigin:true,
  }],
  ["SA-103", "DELETE", "/api/xid/:xUserId", "w", {
    params:()=>({xUserId:BENCH_X_CANON}), setup:xidActiveReset,
  }],
  ["SA-104", "PUT", "/api/xid/:xUserId/icon", "w", {
    params:()=>({xUserId:BENCH_X_CANON}), setup:xidIconReset,
  }],
  ["SA-105", "POST", "/api/xid/:xUserId/icon/upload", "w", {
    params:()=>({xUserId:BENCH_X_CANON}), setup:xidCanonicalReset, multipartIcon:true,
  }],
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

  "POST /api/admin/event-groups": (k,i,tag) => ({
    id:groupIdFor(tag,i), name:k === "limit" ? "N".repeat(120) : "Benchmark group",
    slug:groupIdFor(tag,i), description:k === "limit" ? "d".repeat(2000) : "Benchmark",
    group_type:"series", visibility_status:"private", sort_order:k === "limit" ? 9999 : 0,
  }),
  "PATCH /api/admin/event-groups/:id": (k,i,tag) => ({
    id:"bench-group", base_updated_at:20, name:k === "limit" ? "N".repeat(120) : "Bench updated " + tag + i,
    slug:"bench-group", description:k === "limit" ? "d".repeat(2000) : "updated",
    group_type:"series", visibility_status:"private", sort_order:k === "limit" ? 9999 : 0,
  }),
  "POST /api/admin/event-groups/:id/events": (kind) => ({
    eventIds:kind === "limit" ? Array.from({length:80},(_,i)=>"bevg-"+(i+1)) : ["bench-evt"],
  }),
  "POST /api/xid/active": () => ({x_user_id:BENCH_X_CANON}),
  "PATCH /api/xid/:xUserId/profile": (k,i,tag) => ({
    x_user_id:BENCH_X_CANON, x_name:k === "limit" ? "N".repeat(80) : "Updated " + tag + i,
    profile_text:k === "limit" ? "p".repeat(2000) : "Benchmark profile",
    portfolio_contact:"benchmark@example.com", youtube_channel_url:"https://example.com/",
    other_social_links:"[]",
  }),
  "DELETE /api/xid/:xUserId": () => ({x_user_id:BENCH_X_CANON,confirm:"DELETE " + BENCH_X_CANON}),
  "PUT /api/xid/:xUserId/icon": () => ({x_user_id:BENCH_X_CANON,icon_url:"/api/media/xicons/bench_x/new.png"}),
  "POST /api/manage/events/:id/owner-transfer": () => ({
    from_staff_id:"bench-from",to_staff_id:"bench-to-staff",reason:"benchmark transfer",
    confirm_text:"TRANSFER bench-evt",self_confirm_text:"SELF CHANGE bench-evt",
  }),
  "POST /api/manage/events/:id/staff/csv": (k) => ({reason:"benchmark csv",rows:[{
    lineNumber:1,display_name:k === "limit" ? "S".repeat(80) : "Staff",
    x_user_id:"bst_csv",permission_preset:"public_staff",permission_keys:[],
    is_public_staff:"1",public_role_label:"",
  }]}),
  "POST /api/manage/events/:id/staff": (k) => ({
    display_name:k === "limit" ? "S".repeat(80) : "Staff",
    x_user_id:"bst_create",permission_preset:"public_staff",is_public:1,reason:"benchmark create",
  }),
  "PUT /api/manage/events/:id/staff/:staffId": (k) => ({
    staff_id:"bench-update",display_name:k === "limit" ? "S".repeat(80) : "Staff",
    x_user_id:"bst_update",permission_preset:"public_staff",is_public:1,reason:"benchmark update",
  }),
  "DELETE /api/manage/events/:id/staff/:staffId": () => ({reason:"benchmark delete"}),
  "POST /api/admin/static-builds/backfill": () => ({kind:"event_crew",mode:"restart",cursor:""}),
  "POST /api/admin/static-builds/queue/:queueId/retry": () => undefined,
  "POST /api/admin/static-builds/retry-failed": () => undefined,
  "POST /api/admin/static-builds/rebuild": (k) => ({
    target_type:"event",target_id:"bench-evt",reason:k === "limit" ? "r".repeat(500) : "benchmark rebuild",
  }),
  "POST /api/admin/static-builds/shared-inputs/rebuild": () => undefined,
  "POST /api/admin/visibility-repair": (k,i,t) => ({
    entity_type:"event",entity_id:"bench-evt",fence_token:"bench-fence-" + t + "-" + i,
  }),
  "POST /api/admin/youtube-sync/videos/:videoId/resync": () => undefined,
  "POST /api/xid/requests": (kind, i, tag) => {
    const unique = `bn${String(tag).replace(/[^a-z0-9]/gi, "").slice(-6)}${i.toString(36)}`;
    return { x_id: kind === "limit" ? unique.padEnd(20, "x").slice(0, 20) : unique, request_type: "link" };
  },
  "POST /api/xid/requests/:id/cancel": () => undefined,
  "POST /api/xid/merge-revert-requests": (kind, i, tag) => ({ parent_request_id: benchXRequestId(i, tag) }),
  "PUT /api/admin/permissions/editable-fields": (kind) => ({ default_editable_fields: kind === "limit" ? ["title", "description"] : [], upcoming_editable_fields: kind === "limit" ? ["title"] : [] }),
  "POST /api/admin/terms": (kind, i, tag) => ({ id: benchTermsId(i, tag), version_label: kind === "limit" ? "v".repeat(80) : "benchmark-v1", body_markdown: kind === "limit" ? "x".repeat(40000) : "benchmark body", severity: "major" }),
  "PATCH /api/admin/terms/:id": (kind) => ({ version_label: kind === "limit" ? "v".repeat(80) : "benchmark-v2", body_markdown: kind === "limit" ? "x".repeat(40000) : "updated benchmark body", severity: "major" }),
  "POST /api/admin/terms/:id/publish": () => ({}),
  "POST /api/admin/terms/:id/reaccept-broadcast": (kind) => ({ confirm: "TERMS", content: kind === "limit" ? "n".repeat(1000) : "benchmark" }),
  "POST /api/admin/terms/:id/archive": () => ({}),

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
        headers.origin = kind === "invalid" && opts.invalidOrigin ? "https://evil.invalid" : SITE_URL;
        if (opts.multipartIcon && kind !== "invalid") {
          // Actual multipart upload: no manual content-type (Request sets its boundary).
          const form = new FormData();
          form.append("x_user_id", BENCH_X_CANON);
          form.append("icon_file", new File([BENCH_ICON_PNG], "bench.png", { type: "image/png" }));
          body = form;
        } else {
          headers["content-type"] = "application/json";
          if (kind === "invalid") body = "{}";
          else { const b = WRITE_BODIES[key]?.(kind, i, tag); body = b === undefined ? undefined : json(b); }
        }
      }
      const dyn = opts.params?.(kind, i, tag) ?? {};
      const template = opts.templateRead && kind !== "invalid" ? benchTemplateFixture(kind, opts.templateRead === "new") : null;
      const setup = template?.setup ?? (kind === "invalid" ? undefined : opts.setup?.(kind, i, tag));
      return { method, path: fillRoute(pattern, longId, dyn) + query, headers, body, expect: expected[kind], ...(setup ? { setup } : {}), ...(template ? { expectTemplates: template.expected } : {}) };
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

  "GET /api/admin/event-groups/event-options": {normal:[200],limit:[200],invalid:[401]},
  "POST /api/admin/event-groups": {normal:[200],limit:[200],invalid:[400]},
  "PATCH /api/admin/event-groups/:id": {normal:[200],limit:[200],invalid:[400]},
  "DELETE /api/admin/event-groups/:id": {normal:[200],limit:[200],invalid:[400]},
  "DELETE /api/admin/event-groups/:id/events/:eventId": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/admin/event-groups/:id/events": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/xid/active": {normal:[200],limit:[200],invalid:[400]},
  "PATCH /api/xid/:xUserId/profile": {normal:[200],limit:[200],invalid:[403]},
  "DELETE /api/xid/:xUserId": {normal:[200],limit:[200],invalid:[400]},
  "PUT /api/xid/:xUserId/icon": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/xid/:xUserId/icon/upload": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/manage/events/:id/owner-transfer": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/manage/events/:id/staff/csv": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/manage/events/:id/staff": {normal:[200],limit:[200],invalid:[400]},
  "PUT /api/manage/events/:id/staff/:staffId": {normal:[200],limit:[200],invalid:[400]},
  "DELETE /api/manage/events/:id/staff/:staffId": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/admin/static-builds/backfill": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/admin/static-builds/queue/:queueId/retry": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/admin/static-builds/retry-failed": {normal:[200],limit:[200],invalid:[403]},
  "POST /api/admin/static-builds/rebuild": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/admin/static-builds/shared-inputs/rebuild": {normal:[200],limit:[200],invalid:[403]},
  "POST /api/admin/visibility-repair": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/admin/youtube-sync/videos/:videoId/resync": {normal:[200],limit:[200],invalid:[400]},
  "POST /api/xid/requests": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/xid/requests/:id/cancel": { normal: [200], limit: [200], invalid: [404] },
  "POST /api/xid/merge-revert-requests": { normal: [200], limit: [200], invalid: [400] },
  "PUT /api/admin/permissions/editable-fields": { normal: [200], limit: [200], invalid: [200] },
  "POST /api/admin/terms": { normal: [200], limit: [200], invalid: [400] },
  "PATCH /api/admin/terms/:id": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/terms/:id/publish": { normal: [200], limit: [200], invalid: [404] },
  "POST /api/admin/terms/:id/reaccept-broadcast": { normal: [200], limit: [200], invalid: [400] },
  "POST /api/admin/terms/:id/archive": { normal: [200], limit: [200], invalid: [404] },

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

export function replayIdentity(value) {
  let nodes = 0, units = 0;
  const seen = new Set();
  const charge = (n) => {
    units += n;
    if (units > 262144) throw new Error("bench replay identity too large");
  };
  const walk = (v, depth) => {
    if (++nodes > 4096 || depth > 16) throw new Error("bench replay identity too complex");
    if (v === null) return ["null"];
    if (v === undefined) return ["undefined"];
    if (typeof v === "string") { charge(v.length); return ["string", v]; }
    if (typeof v === "boolean") return ["boolean", v];
    if (typeof v === "number" && Number.isFinite(v)) return ["number", Object.is(v, -0) ? "-0" : String(v)];
    if (typeof v === "bigint") return ["bigint", String(v)];
    if (typeof v !== "object") throw new Error("bench unsupported replay identity");
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
      const bytes = v instanceof ArrayBuffer
        ? new Uint8Array(v)
        : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      charge(bytes.length * 2);
      return ["bytes", Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")];
    }
    if (v instanceof Date) return ["date", v.toISOString()];
    if (seen.has(v)) throw new Error("bench cyclic replay identity");
    seen.add(v);
    try {
      const own = (key) => {
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          throw new Error("bench unsupported replay accessor");
        }
        return walk(descriptor.value, depth + 1);
      };
      if (Array.isArray(v)) {
        if (v.length > 4096 || Reflect.ownKeys(v).length !== v.length + 1) {
          throw new Error("bench unsupported replay array");
        }
        return ["array", Array.from({ length: v.length }, (_, i) => own(String(i)))];
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error("bench unsupported replay object");
      const keys = Object.keys(v).sort();
      if (Reflect.ownKeys(v).length !== keys.length || keys.length > 4096) {
        throw new Error("bench unsupported replay keys");
      }
      return ["object", keys.map((key) => { charge(key.length); return [key, own(key)]; })];
    } finally {
      seen.delete(v);
    }
  };
  return JSON.stringify(walk(value, 0));
}

// SQLite BLOBs are Uint8Array; Miniflare D1 exposes them as number[]. Preserve
// result column order (Drizzle maps Object.keys(row)), and reject JSON losses
// instead of silently changing what the Node app and the replay app observe.
// Results may contain 6000 slots / 500 x 100 members: identity limits do not apply.
export function snapshotReplayResult(value) {
  const active = new Set();
  const walk = (v) => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v) && !Object.is(v, -0)) return v;
    if (typeof v !== "object") throw new Error("bench unsupported replay result value");
    const proto = Object.getPrototypeOf(v);
    if (proto === Uint8Array.prototype) {
      const bytes = Array.from(Uint8Array.prototype.values.call(v));
      if (Reflect.ownKeys(v).length !== bytes.length) throw new Error("bench unsupported replay result bytes");
      return bytes;
    }
    if (active.has(v)) throw new Error("bench cyclic replay result");
    active.add(v);
    try {
      const own = (key) => {
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new Error("bench unsupported replay result property");
        }
        return walk(descriptor.value);
      };
      if (Array.isArray(v)) {
        if (proto !== Array.prototype || Reflect.ownKeys(v).length !== v.length + 1) {
          throw new Error("bench unsupported replay result array");
        }
        return Array.from({ length: v.length }, (_, i) => own(String(i)));
      }
      if (proto !== Object.prototype && proto !== null) throw new Error("bench unsupported replay result object");
      const out = {};
      for (const key of Reflect.ownKeys(v)) {
        if (typeof key !== "string") throw new Error("bench unsupported replay result key");
        Object.defineProperty(out, key, { value: own(key), enumerable: true, writable: true, configurable: true });
      }
      return out;
    } finally {
      active.delete(v);
    }
  };
  return walk(value);
}

// Validate once at recording/registration, never on every measured next().
export function snapshotReplayScript(script) {
  const snapshot = snapshotReplayResult(script);
  if (!Array.isArray(snapshot) || snapshot.some((entry) => !entry || !Object.hasOwn(entry, "identity") ||
      typeof entry.identity !== "string" || !Object.hasOwn(entry, "result"))) {
    throw new Error("bench invalid replay script");
  }
  return snapshot;
}

// Native nondeterministic inputs belong to the ordered replay trace too. Each
// replay still performs the native call; only its app-visible value is replayed.
// This scope is shared by all requests in a runtime, since the two host methods
// are global. Concurrent requests invalidate the active trace and are rejected.
export function createReplayInputScope() {
  const cryptoHost = globalThis.crypto;
  const dateHost = globalThis.Date;
  const nativeUUID = cryptoHost.randomUUID;
  const nativeNow = dateHost.now;
  let active = null;
  const assertIdle = () => {
    if (active) {
      active();
      throw new Error("bench concurrent replay input scope");
    }
    if (globalThis.crypto !== cryptoHost || globalThis.Date !== dateHost ||
        cryptoHost.randomUUID !== nativeUUID || dateHost.now !== nativeNow) {
      throw new Error("bench replay input host changed");
    }
  };
  const validate = (kind, value) => {
    const valid = kind === "input.randomUUID"
      ? typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      : Number.isSafeInteger(value) && value >= 0;
    if (!valid) throw new Error("bench invalid replay input value");
    return value;
  };
  return {
    assertIdle,
    async run(visit, invalidate, action) {
      try { assertIdle(); }
      catch (error) { invalidate(); throw error; }
      const uuidDescriptor = Object.getOwnPropertyDescriptor(cryptoHost, "randomUUID");
      const nowDescriptor = Object.getOwnPropertyDescriptor(dateHost, "now");
      let failed = false;
      const fail = () => { failed = true; invalidate(); };
      const wrap = (kind, native) => function (...args) {
        try {
          const actual = validate(kind, Reflect.apply(native, this, args));
          return validate(kind, visit(kind, args, actual));
        } catch (error) { fail(); throw error; }
      };
      const uuid = wrap("input.randomUUID", nativeUUID);
      const now = wrap("input.Date.now", nativeNow);
      active = fail;
      let uuidInstalled = false, nowInstalled = false;
      try {
        if (visit === null) {
          const result = await action();
          if (failed) throw new Error("bench concurrent replay input scope");
          return result;
        }
        Object.defineProperty(cryptoHost, "randomUUID", {
          ...uuidDescriptor, configurable: true, writable: true, value: uuid,
        });
        uuidInstalled = true;
        Object.defineProperty(dateHost, "now", { ...nowDescriptor, value: now });
        nowInstalled = true;
        return await action();
      } catch (error) { fail(); throw error; }
      finally {
        const changed = cryptoHost.randomUUID !== (uuidInstalled ? uuid : nativeUUID) ||
          dateHost.now !== (nowInstalled ? now : nativeNow) ||
          globalThis.crypto !== cryptoHost || globalThis.Date !== dateHost;
        try {
          if (uuidInstalled) {
            if (uuidDescriptor) Object.defineProperty(cryptoHost, "randomUUID", uuidDescriptor);
            else if (!Reflect.deleteProperty(cryptoHost, "randomUUID")) throw new Error("bench UUID restoration failed");
          }
        } finally {
          try { if (nowInstalled) Object.defineProperty(dateHost, "now", nowDescriptor); }
          finally { active = null; }
        }
        if (changed) {
          invalidate();
          throw new Error("bench replay input host changed during request");
        }
      }
    },
  };
}

const inprocInputs = createReplayInputScope();
let activeInprocRequest = null;
const assertInprocIdle = () => {
  if (activeInprocRequest) {
    activeInprocRequest.invalid = true;
    throw new Error("bench concurrent in-process request");
  }
  inprocInputs.assertIdle();
};
async function withInprocRequest(action) {
  assertInprocIdle();
  const state = activeInprocRequest = { invalid: false };
  try {
    const result = await action();
    if (state.invalid) throw new Error("bench concurrent in-process request");
    return result;
  } finally { activeInprocRequest = null; }
}

/** Preserve module-loading flags without inheriting parent-only eval/input modes. */
function coldRecorderExecArgv() {
  const args = process.execArgv;
  const result = [];
  const withValue = new Set(["--import", "--loader", "--experimental-loader", "--require", "-r", "--conditions"]);
  const flags = new Set([
    "--experimental-strip-types", "--experimental-transform-types",
    "--enable-source-maps", "--preserve-symlinks", "--preserve-symlinks-main",
  ]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (withValue.has(arg)) {
      if (args[i + 1] !== undefined) result.push(arg, args[++i]);
    } else if (
      flags.has(arg) ||
      /^--(?:import|loader|experimental-loader|require|conditions)=/.test(arg)
    ) {
      result.push(arg);
    }
  }
  return result;
}

/**
 * A new SQLite handle in the parent would still share imported application
 * caches. One short-lived Node worker gives each cold recording a fresh module
 * graph and the same explicit seed/setup/R2 fixture, before workerd starts.
 * Serialize the request once so multipart boundaries and body bytes also match
 * the measured request. None of this setup is included in request profiling.
 */
async function recordFreshColdRequest(plan, spec, fixture) {
  const request = new Request(`http://bench.local${spec.path}`, {
    method: spec.method, headers: spec.headers, body: spec.body,
  });
  const coldRequest = {
    ...spec, headers: [...request.headers],
    body: request.body == null ? undefined : new Uint8Array(await request.arrayBuffer()),
  };
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { kind: "flamenode-cold-recorder", plan, spec: coldRequest, fixture },
    execArgv: coldRecorderExecArgv(),
  });
  const expectedThreadId = worker.threadId;
  let exited = false, timeout;
  try {
    return await new Promise((resolve, reject) => {
      let received;
      timeout = setTimeout(() => reject(new Error("bench cold recorder timed out")), 30_000);
      worker.on("message", (message) => { received = message; });
      worker.once("error", reject);
      worker.once("exit", (code) => {
        exited = true;
        if (code !== 0 || !received?.ok) {
          reject(new Error(`bench cold recorder failed: ${received?.error ?? `exit ${code}`}`));
          return;
        }
        const record = received.record;
        if (record?.coldRecorder?.threadId !== expectedThreadId || record.coldRecorder.requestOrdinal !== 1) {
          reject(new Error("bench cold recorder first-request proof missing"));
          return;
        }
        resolve({ ...record, coldRequest });
      });
    });
  } finally {
    clearTimeout(timeout);
    // Do not leave a recorder alive while the next worker is measured, even
    // after a thrown setup/dispatch, a timeout or an abnormal worker exit.
    if (!exited) await worker.terminate();
  }
}

async function runColdRecorderWorker() {
  let target;
  try {
    target = await createInprocTarget(workerData.plan);
    const { fixture, spec } = workerData;
    if (fixture?.r2 !== undefined) await target.setR2(fixture.r2);
    for (const [key, body] of Object.entries(fixture?.r2Objects ?? {})) await target.setR2(body, key);
    // A scenario may omit its already-applied warm seed from later specs.
    // coldSetup is its complete replacement for the new recorder database.
    const setup = fixture?.coldSetup ?? spec.setup;
    if (setup) await target.exec(setup);
    const record = await target.recordForReplay(spec);
    if (target.requestOrdinal !== 1) throw new Error("bench cold recorder was already used");
    record.coldRecorder = { threadId, requestOrdinal: target.requestOrdinal };
    await target.close();
    target = null;
    parentPort.postMessage({ ok: true, record });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error?.message ?? "unknown recorder error" });
  } finally {
    if (target) await target.close();
    parentPort.close();
  }
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
  let requestOrdinal = 0;
  let d1RowsReturned = 0;
  let d1PerQueryRows = [];
  const countD1 = (mode, value) => {
    const n = returnedRows(mode, value);
    d1RowsReturned += n;
    d1PerQueryRows.push(n);
    return value;
  };
  let rec = null;
  let recInvalid = false;
  const trace = (kind, args, execute) => {
    try {
      const identity = rec ? replayIdentity([kind, ...args]) : null;
      const result = snapshotReplayResult(execute());
      if (!rec) return result;
      rec.push({ identity, result });
      // The app may mutate a returned row; retain an independent recorded value.
      return JSON.parse(JSON.stringify(result));
    } catch (error) {
      if (rec) recInvalid = true;
      throw error;
    }
  };
  const make = (sql, params) => ({
    _sql: sql, _params: params,
    bind: (...values) => make(sql, values),
    first: async (...args) => {
      stmts += 1;
      return trace("d1.first", [sql, params, args], () =>
        countD1("first", sqlite.prepare(sql).get(...params) ?? null));
    },
    all: async (...args) => {
      stmts += 1;
      return trace("d1.all", [sql, params, args], () =>
        countD1("all", { results: sqlite.prepare(sql).all(...params) }));
    },
    run: async (...args) => {
      stmts += 1;
      return trace("d1.run", [sql, params, args], () =>
        countD1("run", { results: sqlite.prepare(sql).all(...params) }));
    },
    // drizzle's D1 driver reads rows as arrays through raw().
    raw: async (...args) => {
      stmts += 1;
      return trace("d1.raw", [sql, params, args], () => {
        const st = sqlite.prepare(sql);
        st.setReturnArrays(true);
        try { return countD1("raw", st.all(...params)); }
        finally { st.setReturnArrays(false); }
      });
    },
  });
  const db = {
    // Execution requests, including failed calls, not prepares/binds, completed
    // physical DB operations, transaction-control statements or billed D1 usage.
    prepare: (sql) => make(sql, []),
    batch: async (list) => {
      stmts += list.length;
      return trace("d1.batch", [list.map((s) => [s._sql, s._params])], () => {
        sqlite.exec("BEGIN");
        try {
          const out = list.map((s) => ({ results: sqlite.prepare(s._sql).all(...s._params) }));
          sqlite.exec("COMMIT");
          for (const result of out) countD1("all", result);
          return out;
        } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
      });
    },
  };
  const r2Objects = new Map();
  // Store detached bytes, like R2. Base64 is a transcript transport format,
  // never the object's text or its byte length after a PUT.
  const r2Bytes = (value) => {
    if (typeof value === "string") return Buffer.from(value);
    if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    throw new Error("bench unsupported R2 body");
  };
  const r2Metadata = (body) => ({ size: body.byteLength, etag: BENCH_ETAG });
  const bucket = {
    put: async (key, value, ...args) => trace("r2.put", [key, value, args], () => {
      r2Objects.set(key, r2Bytes(value));
      return { etag: BENCH_ETAG };
    }),
    delete: async (key, ...args) => trace("r2.delete", [key, args], () => {
      r2Objects.delete(key);
      return { deleted: true };
    }),
    head: async (key, ...args) => trace("r2.head", [key, args], () => {
      const body = r2Objects.get(key);
      return body == null ? null : r2Metadata(body);
    }),
    get: async (key, ...args) => {
      const value = trace("r2.get", [key, args], () => {
        const body = r2Objects.get(key);
        if (body == null) return null;
        const metadata = r2Metadata(body);
        const text = body.toString("utf8");
        // Keep the existing JSON/text transcript shape. Invalid UTF-8 needs
        // lossless bytes as well, because text() intentionally decodes it.
        const binary = body.equals(Buffer.from(text)) ? {} : { bodyBase64: body.toString("base64") };
        return { size: metadata.size, text, etag: metadata.etag, ...binary };
      });
      return value && {
        size: value.size,
        etag: value.etag,
        json: async () => JSON.parse(value.text),
        text: async () => value.text,
        arrayBuffer: async () => Uint8Array.from(Buffer.from(
          value.bodyBase64 ?? value.text, value.bodyBase64 == null ? "utf8" : "base64",
        )).buffer,
        body: null,
      };
    },
  };
  const env = { DB: db, BUCKET: bucket, BUILD_COMMIT_SHA: "a".repeat(40), WORKER_ADMIN_TOKEN: plan.adminToken, NEXT_PUBLIC_SITE_URL: SITE_URL, ADMIN_SPREADSHEET_ENABLED: "1", AUTH_SECRET: "bench-auth-secret" };
  const { app } = await import(pathToFileURL(APP_PATH).href);
  const { sessionMiddleware } = await import(pathToFileURL(SESSION_PATH).href);
  const sm = sessionMiddleware();

  const exec = async (list) => {
    assertInprocIdle();
    for (const s of list) sqlite.prepare(s.sql).run(...s.params);
  };
  await exec(SEED(plan.adminToken));

  const fetchOnce = async (spec) => {
    requestOrdinal += 1;
    const url = `http://bench.local${spec.path}`;
    stmts = 0;
    d1RowsReturned = 0;
    d1PerQueryRows = [];
    const headers = benchmarkRequestHeaders(spec);
    const before = performance.now();
    const requestEnv = benchmarkRequestEnv(env, headers);
    let res;
    // Request construction is host setup, outside the app input transcript in
    // both Node and workerd. Keep performance.now() and profiling untouched.
    const request = spec.path.startsWith("/__bench/") ? null
      : new Request(url, { method: spec.method, headers, body: spec.body });
    const realFetch = globalThis.fetch;
    globalThis.fetch = benchFetchStub;
    try {
    const dispatch = async () => {
    if (spec.path.startsWith("/__bench/session")) {
      const vars = {};
      const c = { req: { url, header: (n) => headers.get(n) ?? undefined }, env: requestEnv, set: (k, v) => { vars[k] = v; }, header() {} };
      await sm(c, async () => {});
      res = Response.json({ state: vars.sessionState });
    } else if (spec.path.startsWith("/__bench/noop")) {
      res = new Response("ok");
    } else {
      res = await app.fetch(request, requestEnv);
    }
    };
    await inprocInputs.run(rec ? (kind, args, actual) => trace(kind, [args], () => actual) : null,
      () => { recInvalid = true; }, dispatch);
    } finally { globalThis.fetch = realFetch; }
    // Include response consumption in the Node wall-time proxy, just as the
    // workerd profiler remains active until the complete body is received.
    const buf = await res.arrayBuffer();
    const cpuMs = performance.now() - before;
    return { status: res.status, bytes: buf.byteLength, cpuMs, d1: stmts, d1RowsReturned, d1PerQueryRows: [...d1PerQueryRows], ...(hasResponseExpectation(spec) ? { responseBodyMismatch: benchmarkResponseMismatch(spec, buf, res.headers, stmts, d1PerQueryRows) } : {}), debug: process.env.BENCH_DEBUG ? Buffer.from(buf).toString("utf8").slice(0, 240) : undefined };
  };

  return {
    name: "inproc",
    get requestOrdinal() { return requestOrdinal; },
    resolutionMs: 0.001,
    digits: 3,
    cpuSource: "performance.now() wall delta through complete app.fetch response body (Node/V8, node:sqlite as D1 plus result normalization/counting; WALL-TIME PROXY, not workerd CPU)",
    supportsCold: false,
    setR2: async (body, key = STATS_KEY) => {
      assertInprocIdle();
      if (body == null) r2Objects.delete(key); else r2Objects.set(key, r2Bytes(body));
    },
    exec,
    record: async () => null,
    run: async (spec) => withInprocRequest(() => fetchOnce(spec)),
    /** Execute once (side effects included) and capture D1/R2 results for workerd replay. */
    recordForReplay: async (spec) => withInprocRequest(async () => {
      rec = [];
      recInvalid = false;
      try {
        const r = await fetchOnce(spec);
        if (recInvalid) throw new Error("bench replay recording invalid");
        return { script: rec, status: r.status, d1: r.d1, d1RowsReturned: r.d1RowsReturned, d1PerQueryRows: r.d1PerQueryRows, ...(hasResponseExpectation(spec) ? { responseBodyMismatch: r.responseBodyMismatch } : {}) };
      } finally {
        rec = null;
        recInvalid = false;
      }
    }),
    recordFirstRequest: (spec, fixture) => withInprocRequest(() => recordFreshColdRequest(plan, spec, fixture)),
    close: async () => { assertInprocIdle(); sqlite.close(); },
  };
}

// ---------------------------------------------------------- target: wrangler
export function workerSource(buildId, coldScript = null, { operationModeKv = false } = {}) {
  const appUrl = APP_PATH.replaceAll("\\", "/");
  const sessionUrl = SESSION_PATH.replaceAll("\\", "/");
  const coldScriptJson = coldScript === null ? null : JSON.stringify(snapshotReplayScript(coldScript));
  const kvPrelude = operationModeKv ? [
    "import { resetOperationModeCachesForTests } from " + JSON.stringify(path.join(REPO_ROOT, "apps/api/src/routes/live/operationMode.ts").replaceAll("\\", "/")) + ";",
    createOperationModeKvProbe.toString(),
    'const nativeKvProbe = createOperationModeKvProbe(resetOperationModeCachesForTests, async raw => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, "0")).join(""));',
  ].join("\n") + "\n" : "";
  return `// generated by scripts/benchmark-api-cpu.mjs (bench-only wrapper; not part of apps/api)
import { app } from ${JSON.stringify(appUrl)};
import { sessionMiddleware } from ${JSON.stringify(sessionUrl)};
${kvPrelude}const BUILD_ID = ${JSON.stringify(buildId)};
const identity = globalThis.__flamenodeBenchIdentity = { build: BUILD_ID, requests: 0 };
const sm = sessionMiddleware();
const STATS_KEY = ${JSON.stringify(STATS_KEY)};
const EVENT_EXPORT_CACHE_URLS = ${JSON.stringify(eventExportCacheRequestUrls())};
const scripts = new Map();
const coldScriptJson = ${JSON.stringify(coldScriptJson)};
// Parse JSON data, not a JS object literal: own "__proto__" columns remain data.
if (coldScriptJson !== null) scripts.set("cold", snapshotReplayScript(JSON.parse(coldScriptJson)));
const BENCH_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
// Bench-only upstream image stub: media proxy scenarios must never reach the network.
globalThis.fetch = async () => new Response(BENCH_PNG, { headers: { "content-type": "image/png" } });

// Replay env: D1/R2 return the results recorded by the in-process run, in call order.
// The request profile includes app code, retained native UUID/Date.now calls,
// and input-hook/transcript plus replay identity/counting bookkeeping,
// without wrangler's local D1/R2 simulator. Registration is outside warm profiling;
// cold parsing/validation runs at module initialization, which may precede profiling.
function returnedRows(mode, value) {
  if (mode === "first") return value == null ? 0 : 1;
  if (mode === "raw") return Array.isArray(value) ? value.length : 0;
  if (mode === "batch") return Array.isArray(value)
    ? value.reduce((sum, entry) => sum + (Array.isArray(entry?.results) ? entry.results.length : 0), 0)
    : 0;
  return Array.isArray(value?.results) ? value.results.length : 0;
}

// Count rows returned to this app by D1-compatible calls, not billed D1 rows_read.
function rowCounters() {
  let rowsReturned = 0;
  const perQueryRows = [];
  return {
    observe(mode, value) {
      const n = returnedRows(mode, value);
      rowsReturned += n;
      perQueryRows.push(n);
      return value;
    },
    totals() { return { rowsReturned, perQueryRows: [...perQueryRows] }; },
  };
}

${replayIdentity.toString()}
${snapshotReplayResult.toString()}
${snapshotReplayScript.toString()}
${createReplayInputScope.toString()}
${benchmarkRequestEnv.toString()}
const replayInputs = createReplayInputScope();
let activeRequest = null;

function replayEnv(env, script) {
  let k = 0, statements = 0, mismatch = false;
  const rows = rowCounters();
  const next = (kind, args) => {
    try {
      if (k >= script.length) throw new Error("bench replay script exhausted");
      const entry = script[k];
      if (!entry || !Object.hasOwn(entry, "result") ||
          entry.identity !== replayIdentity([kind, ...args])) {
        throw new Error("bench replay operation mismatch");
      }
      k += 1;
      return entry.result;
    } catch (error) {
      mismatch = true;
      throw error;
    }
  };
  const make = (sql, params) => {
    const query = (mode) => async (...args) => {
      statements += 1;
      return rows.observe(mode, next("d1." + mode, [sql, params, args]));
    };
    return {
      _sql: sql,
      _params: params,
      bind: (...values) => make(sql, values),
      first: query("first"),
      all: query("all"),
      run: query("run"),
      raw: query("raw"),
    };
  };
  return [{
    ...env,
    DB: {
      prepare: (sql) => make(sql, []),
      batch: async (list) => {
        statements += list.length;
        const result = next("d1.batch", [list.map((statement) => [statement._sql, statement._params])]);
        if (!Array.isArray(result) || result.length !== list.length) {
          mismatch = true;
          throw new Error("bench replay batch size mismatch");
        }
        for (const entry of result) rows.observe("all", entry);
        return result;
      },
    },
    BUCKET: {
      head: async (key, ...args) => {
        const value = next("r2.head", [key, args]);
        return value && { size: value.size, etag: value.etag };
      },
      get: async (key, ...args) => {
        const value = next("r2.get", [key, args]);
        return value && {
          size: value.size,
          etag: value.etag,
          json: async () => JSON.parse(value.text),
          text: async () => value.text,
          arrayBuffer: async () => value.bodyBase64 == null
            ? new TextEncoder().encode(value.text).buffer
            : Uint8Array.from(atob(value.bodyBase64), (char) => char.charCodeAt(0)).buffer,
          body: null,
        };
      },
      put: async (key, value, ...args) => next("r2.put", [key, value, args]),
      delete: async (key, ...args) => next("r2.delete", [key, args]),
    },
  }, () => ({ statements, ...rows.totals(), replayComplete: !mismatch && k === script.length }),
  (action) => replayInputs.run((kind, args) => next(kind, [args]), () => { mismatch = true; }, action)];
}

function counting(env) {
  let n = 0;
  const rows = rowCounters();
  const DB = env.DB;
  const wrap = (statement) => {
    const query = (mode) => async (...args) => {
      n += 1;
      return rows.observe(mode, await statement[mode](...args));
    };
    return {
      // D1.batch must receive native prepared objects, not the counting wrappers.
      _benchInner: statement,
      bind: (...params) => wrap(statement.bind(...params)),
      first: query("first"), all: query("all"), run: query("run"), raw: query("raw"),
    };
  };
  const wrapped = {
    ...env,
    DB: {
      prepare: (sql) => wrap(DB.prepare(sql)),
      batch: async (list) => {
        n += list.length;
        const result = await DB.batch(list.map((stmt) => stmt._benchInner ?? stmt));
        for (const entry of result) rows.observe("all", entry);
        return result;
      },
      exec: (sql) => DB.exec(sql),
    },
  };
  return [wrapped, () => ({ statements: n, ...rows.totals() })];
}

async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const requestEnv = benchmarkRequestEnv(env, request.headers);
    if (url.pathname === "/__bench/ping") return new Response("ok", { headers: { "x-bench-build": BUILD_ID } });
    if (url.pathname === "/__bench/noop" && !request.headers.has("x-bench-script")) return new Response("ok");

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
      // Clear both the fixed about-stats key and every RH-013 public event-export
      // Cache API key. The event-export server-core key is NOT the route URL:
      // publicJsonCacheUrl(eventExportPayloadCacheKey(...)) uses flamenode.internal.
      await caches.default.delete(new Request(url.origin + "/api/public/about-stats"));
      for (const cacheUrl of EVENT_EXPORT_CACHE_URLS) {
        await caches.default.delete(new Request(cacheUrl));
      }
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
      try {
        const { id, script } = await request.json();
        if (typeof id !== "string") throw new Error("bench invalid replay script id");
        scripts.set(id, snapshotReplayScript(script));
        return new Response("ok");
      } catch {
        return new Response("bench invalid replay registration", { status: 400 });
      }
    }
    const sid = request.headers.get("x-bench-script");
    const script = sid !== null ? scripts.get(sid) : null;
    if (sid !== null) scripts.delete(sid);
    if (sid !== null && !Array.isArray(script)) {
      return new Response("bench replay script missing", {
        status: 503,
        headers: { "x-bench-replay-complete": "0" },
      });
    }
    const [benchEnv, count, withInputs] = sid !== null ? replayEnv(requestEnv, script) : counting(requestEnv);
    const evidence = () => {
      const stats = count();
      return {
        "x-bench-d1": String(stats.statements),
        "x-bench-returned-rows": String(stats.rowsReturned),
        "x-bench-query-rows": stats.perQueryRows.join(","),
        ...(sid !== null ? { "x-bench-replay-complete": stats.replayComplete ? "1" : "0" } : {}),
      };
    };
    const dispatch = async () => {
    if (url.pathname === "/__bench/noop") return new Response("ok");
    if (url.pathname === "/__bench/session") {
      const vars = {};
      const c = { req: { url: request.url, header: (n) => request.headers.get(n) ?? undefined }, env: benchEnv, set: (k, v) => { vars[k] = v; }, header() {} };
      await sm(c, async () => {});
      return Response.json({ state: vars.sessionState });
    }
    return app.fetch(request, benchEnv, ctx);
    };
    const res = withInputs ? await withInputs(dispatch) : await dispatch();
    const out = new Response(res.body, res);
    for (const [name, value] of Object.entries(evidence())) out.headers.set(name, value);
    return out;
}
export default {
  async fetch(request, env, ctx) {
    const ordinal = ++identity.requests; // Includes every harness request, even rejected overlaps.
    if (activeRequest) {
      activeRequest.invalid = true;
      throw new Error("bench concurrent worker request");
    }
    replayInputs.assertIdle();
    const state = activeRequest = { invalid: false };
    try {
      ${operationModeKv ? 'const nativeResponse = await nativeKvProbe(request, env, ordinal, (req, bindings) => app.fetch(req, bindings, ctx));\n      const response = nativeResponse ?? await handleRequest(request, env, ctx);' : 'const response = await handleRequest(request, env, ctx);'}
      if (state.invalid) throw new Error("bench concurrent worker request");
      const out = new Response(response.body, response);
      out.headers.set("x-bench-build", BUILD_ID);
      out.headers.set("x-bench-request", String(ordinal));
      return out;
    } finally { activeRequest = null; }
  },
};
`;
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    try { child.kill("SIGKILL"); } catch { /* child already exited */ }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INSPECTOR_COMMAND_TIMEOUT_MS = 10_000;
const INSPECTOR_DISCOVERY_TIMEOUT_MS = 5_000;
const BENCHMARK_REQUEST_TIMEOUT_MS = 30_000;
const WORKER_EXIT_TIMEOUT_MS = 10_000;

export async function fetchWithDeadline(url, init = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? BENCHMARK_REQUEST_TIMEOUT_MS;
  const label = options.label ?? "benchmark request";
  const fetchImpl = options.fetchImpl ?? fetch;
  const schedule = options.setTimer ?? setTimeout;
  const cancel = options.clearTimer ?? clearTimeout;
  const controller = new AbortController();
  let timedOut = false;
  const timer = schedule(() => {
    timedOut = true;
    controller.abort(new Error(label + " timed out"));
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const bytes = await response.arrayBuffer();
    if (timedOut) throw new Error(label + " timed out");
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    return new Response(bytes.byteLength ? bytes : null, {
      status: response.status, statusText: response.statusText, headers,
    });
  } catch (error) {
    throw new Error(label + (timedOut ? " timed out" : " failed"), { cause: error });
  } finally {
    cancel(timer);
  }
}

export function waitForInspectorOpen(socket, options = {}) {
  const timeoutMs = options.timeoutMs ?? INSPECTOR_COMMAND_TIMEOUT_MS;
  const schedule = options.setTimer ?? setTimeout;
  const cancel = options.clearTimer ?? clearTimeout;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const remove = (name, handler) => {
      if (typeof socket.off === "function") socket.off(name, handler);
      else socket.removeListener(name, handler);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cancel(timer);
      remove("open", onOpen);
      remove("error", onError);
      remove("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onOpen = () => finish();
    const onError = () => finish(new Error("inspector WebSocket open failed"));
    const onClose = () => finish(new Error("inspector WebSocket closed before open"));
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("close", onClose);
    timer = schedule(() => finish(new Error("inspector WebSocket open timed out")), timeoutMs);
    if (socket.readyState === 1) finish();
  });
}

export function createInspectorSession(socket, options = {}) {
  const timeoutMs = options.timeoutMs ?? INSPECTOR_COMMAND_TIMEOUT_MS;
  const schedule = options.setTimer ?? setTimeout;
  const cancel = options.clearTimer ?? clearTimeout;
  const pending = new Map();
  let nextId = 0;
  let closed = false;
  let closedError = null;
  const terminate = () => {
    try {
      if (typeof socket.terminate === "function") socket.terminate();
      else if (typeof socket.close === "function") socket.close();
    } catch { /* transport is already closing */ }
  };
  const invalidate = (reason, terminateSocket = false) => {
    if (!closed) {
      closed = true;
      closedError = reason instanceof Error ? reason : new Error("inspector transport failed");
      for (const entry of pending.values()) {
        cancel(entry.timer);
        entry.reject(closedError);
      }
      pending.clear();
    }
    if (terminateSocket) terminate();
  };
  const onMessage = (raw) => {
    let message;
    try {
      const payload = typeof raw === "string"
        ? raw
        : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      message = JSON.parse(payload);
    } catch {
      invalidate(new Error("inspector returned malformed JSON"), true);
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      invalidate(new Error("inspector returned malformed message"), true);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(message, "id")) {
      if (typeof message.method === "string") return;
      invalidate(new Error("inspector returned an uncorrelated message"), true);
      return;
    }
    if (!Number.isSafeInteger(message.id) || message.id < 1) {
      invalidate(new Error("inspector returned an invalid response id"), true);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) {
      invalidate(new Error("inspector returned an unexpected response id"), true);
      return;
    }
    pending.delete(message.id);
    cancel(entry.timer);
    entry.resolve(message);
  };
  const onError = () => invalidate(new Error("inspector WebSocket transport error"));
  const onClose = () => invalidate(new Error("inspector WebSocket closed"));
  socket.on("message", onMessage);
  socket.on("error", onError);
  socket.on("close", onClose);
  return {
    call(method, params = {}) {
      if (closed) return Promise.reject(closedError ?? new Error("inspector session is closed"));
      if (socket.readyState !== 1) {
        const error = new Error("inspector WebSocket is not open");
        invalidate(error, true);
        return Promise.reject(error);
      }
      if (typeof method !== "string" || method.length === 0) {
        return Promise.reject(new Error("inspector method is invalid"));
      }
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = schedule(() => invalidate(new Error("inspector " + method + " timed out"), true), timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }), (error) => {
            if (error && pending.has(id)) invalidate(new Error("inspector " + method + " send failed"), true);
          });
        } catch {
          invalidate(new Error("inspector " + method + " send failed"), true);
        }
      });
    },
    close(reason) { invalidate(reason ?? new Error("inspector session closed"), true); },
    get pendingCount() { return pending.size; },
    get closed() { return closed; },
  };
}

export function waitForChildExit(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const timeoutMs = options.timeoutMs ?? WORKER_EXIT_TIMEOUT_MS;
  const schedule = options.setTimer ?? setTimeout;
  const cancel = options.clearTimer ?? clearTimeout;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const remove = (name, handler) => {
      if (typeof child.off === "function") child.off(name, handler);
      else child.removeListener(name, handler);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cancel(timer);
      remove("exit", onExit);
      remove("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = () => finish(new Error("worker child process error"));
    child.once("exit", onExit);
    child.once("error", onError);
    timer = schedule(() => finish(new Error("worker child exit timed out")), timeoutMs);
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
}


export function replayEvidenceMismatch(rec, headers) {
  const observedStatements = headers.get("x-bench-d1");
  const observedRows = headers.get("x-bench-returned-rows");
  const observedVector = headers.get("x-bench-query-rows");
  return headers.get("x-bench-replay-complete") !== "1" ||
    observedStatements === null || observedStatements !== String(rec.d1) ||
    observedRows === null || observedRows !== String(rec.d1RowsReturned) ||
    observedVector === null || observedVector !== rec.d1PerQueryRows.join(",");
}

export function requireBenchmarkControl(response, operation) {
  if (!response.ok) {
    throw new Error("benchmark " + operation + " failed: HTTP " + response.status);
  }
}

async function createWranglerTarget(plan, opts) {
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  const wranglerBin = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin", "wrangler.js");
  const mig = await materializeMigrations();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-api-bench-"));
  const state = path.join(workDir, "state");
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
    ...(opts.operationModeKv === true ? [
      "[[kv_namespaces]]",
      'binding = "KV"',
      'id = "00000000000000000000000000000001"',
      "",
    ] : []),
  ].join("\n"));
  let build = 0;
  const workerPath = path.join(workDir, "worker.mjs");
  fs.writeFileSync(workerPath, workerSource(`b${build}`, null, { operationModeKv: opts.operationModeKv === true }));

  const apply = spawnSync(process.execPath, [wranglerBin, "d1", "migrations", "apply", "flamenode_db", "--local", "--config", toml, "--persist-to", state], {
    cwd: workDir, encoding: "utf8", timeout: 120_000,
  });
  fs.rmSync(mig.workspace, { recursive: true, force: true });
  if (apply.status !== 0) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw new Error("local D1 migration apply failed:\\n" + (apply.stdout ?? "") + "\\n" + (apply.stderr ?? ""));
  }

  const base = `http://127.0.0.1:${opts.port}`;
  let child, ws = null, inspectorSession = null;
  let log = "";
  const startWorker = () => {
    child = spawn(process.execPath, [wranglerBin, "dev", "--local", "--config", toml, "--persist-to", state, "--port", String(opts.port), "--ip", "127.0.0.1", "--inspector-port", String(opts.inspectorPort)], { cwd: workDir, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
  };
  const stopWorker = async () => {
    if (inspectorSession) {
      inspectorSession.close(new Error("benchmark worker stopping"));
      inspectorSession = null;
    }
    try { ws?.terminate(); } catch { /* already closed */ }
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = waitForChildExit(child, { timeoutMs: WORKER_EXIT_TIMEOUT_MS });
    killTree(child);
    try {
      await exited;
    } catch {
      try { child.kill("SIGKILL"); } catch { /* child already exited */ }
      await waitForChildExit(child, { timeoutMs: 5_000 }).catch(() => {});
      if (child.exitCode === null && child.signalCode === null) {
        throw new Error("benchmark worker did not exit after forced termination");
      }
    }
  };
  const cleanup = async () => {
    let stopError = null;
    try { await stopWorker(); } catch (error) { stopError = error; }
    await sleep(1500);
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
    } catch (error) {
      try { console.error("warning: could not remove benchmark work directory: " + (error?.code ?? "unknown")); } catch {}
    }
    if (stopError) throw stopError;
  };

  const ping = async () => {
    try {
      const response = await fetchWithDeadline(base + "/__bench/ping", {}, {
        timeoutMs: 2_000, label: "worker readiness ping",
      });
      return response.ok ? response.headers.get("x-bench-build") : null;
    } catch { return null; }
  };
  const waitBuild = async (want, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (child && (child.exitCode !== null || child.signalCode !== null)) {
        throw new Error("wrangler dev exited before serving build " + want + ". Log tail:\\n" + log.slice(-1500));
      }
      if ((await ping()) === want) return;
      await sleep(150);
    }
    throw new Error("wrangler dev did not serve build " + want + " within " + ms + "ms. Log tail:\\n" + log.slice(-1500));
  };

  try {
    startWorker();
    await waitBuild("b0");
  } catch (error) {
    try { await cleanup(); } catch {}
    throw error;
  }

  const post = (p, body, method = "POST") => fetchWithDeadline(base + p, { method, body }, {
    timeoutMs: BENCHMARK_REQUEST_TIMEOUT_MS, label: "benchmark control " + method + " " + p,
  });
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
  const call = (method, params = {}) => {
    if (!inspectorSession) return Promise.reject(new Error("inspector is not connected"));
    return inspectorSession.call(method, params);
  };
  const connect = async () => {
    if (inspectorSession) {
      inspectorSession.close(new Error("inspector reconnect"));
      inspectorSession = null;
    }
    try { ws?.terminate(); } catch { /* already closed */ }
    ws = null;
    const deadline = Date.now() + 60_000;
    let lastError = null;
    while (Date.now() < deadline) {
      let sock = null;
      try {
        const remaining = deadline - Date.now();
        const response = await fetchWithDeadline(
          "http://127.0.0.1:" + opts.inspectorPort + "/json",
          {},
          { timeoutMs: Math.max(1, Math.min(INSPECTOR_DISCOVERY_TIMEOUT_MS, remaining)), label: "inspector discovery" },
        );
        if (!response.ok) throw new Error("inspector discovery returned HTTP " + response.status);
        const list = await response.json();
        const url = Array.isArray(list) ? list[0]?.webSocketDebuggerUrl : null;
        if (!url) {
          lastError = new Error("inspector target is not ready");
          await sleep(Math.min(150, Math.max(1, deadline - Date.now())));
          continue;
        }
        sock = new WebSocket(url);
        sock.on("error", () => {});
        await waitForInspectorOpen(sock, {
          timeoutMs: Math.max(1, Math.min(INSPECTOR_COMMAND_TIMEOUT_MS, deadline - Date.now())),
        });
        ws = sock;
        inspectorSession = createInspectorSession(sock, { timeoutMs: INSPECTOR_COMMAND_TIMEOUT_MS });
        requireInspectorResult(await call("Profiler.enable"), "Profiler.enable");
        requireInspectorResult(
          await call("Profiler.setSamplingInterval", { interval: SAMPLING_US }),
          "Profiler.setSamplingInterval",
        );
        return;
      } catch (error) {
        lastError = error;
        if (inspectorSession) {
          inspectorSession.close(new Error("inspector connection attempt failed"));
          inspectorSession = null;
        }
        try { sock?.terminate(); } catch {}
        if (ws === sock) ws = null;
        const remaining = deadline - Date.now();
        if (remaining > 0) await sleep(Math.min(150, remaining));
      }
    }
    throw new Error("could not attach to the workerd inspector: " +
      (lastError?.message ?? "no target") + ". Log tail:\\n" + log.slice(-1000));
  };
  await connect();

  // The sampler on this host does not tick every SAMPLING_US: one non-idle sample can carry
  // a multi-ms delta. The largest single non-idle delta seen in real measurements is the
  // honest resolution of every number below (used by judge()).
  let quantumMs = SAMPLING_US / 1000;
  let countQuantum = false;
  let scriptSeq = 0;
  const run = async (spec, rec = null, firstBuild = null) => {
    if (spec.operationModeKv === true && (opts.operationModeKv !== true || rec !== null ||
      spec.path !== "/api/operation-mode/banner" || spec.method !== "GET")) throw new Error("bench native KV request must use the local non-replay banner lane");
    const headers = benchmarkRequestHeaders(spec);
    if (rec && firstBuild !== null) headers.set("x-bench-script", "cold");
    else if (rec) {
      const id = `s${(scriptSeq += 1)}`;
      const reg = await post("/__bench/script", json({ id, script: snapshotReplayScript(rec.script) }));
      if (!reg.ok) throw new Error(`script upload failed: ${reg.status}`);
      headers.set("x-bench-script", id);
    }
    requireInspectorResult(await call("Profiler.start"), "Profiler.start");
    const res = await fetchWithDeadline(base + spec.path, {
      method: spec.method, headers, body: spec.body,
    }, {
      timeoutMs: BENCHMARK_REQUEST_TIMEOUT_MS, label: "measured benchmark request",
    });
    const buf = await res.arrayBuffer();
    const stopResult = requireInspectorResult(await call("Profiler.stop"), "Profiler.stop");
    const profileSummary = summarizeCpuProfile(stopResult.profile);
    // Publish the sampling quantum only after the entire profile has validated.
    if (countQuantum && profileSummary.maxDeltaMs > quantumMs) quantumMs = profileSummary.maxDeltaMs;
    // Receipt retrieval and large raw-value hashing are deliberately AFTER Profiler.stop.
    let nativeKv = null;
    if (spec.operationModeKv === true) {
      const ordinal = Number(res.headers.get("x-bench-request"));
      if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error("bench native KV request missing ordinal");
      const response = await post("/__bench/operation-mode-kv-receipt?request=" + ordinal, undefined, "GET");
      requireBenchmarkControl(response, "operation-mode-kv-receipt");
      const evidence = await response.json();
      nativeKv = { ...evidence, body: Buffer.from(buf).toString("utf8"),
        cacheControl: res.headers.get("cache-control"), contentType: res.headers.get("content-type") };
    }
    const d1 = nativeKv ? nativeKv.d1 : res.headers.has("x-bench-d1") ? Number(res.headers.get("x-bench-d1")) : rec ? null : 0;
    const rows = (res.headers.get("x-bench-query-rows") || "").split(",").filter(Boolean).map(Number);
    return {
      status: res.status, bytes: buf.byteLength,
      ...(nativeKv ? { nativeKv, workerBuild: res.headers.get("x-bench-build") } : {}),
      d1,
      d1RowsReturned: res.headers.has("x-bench-returned-rows")
        ? Number(res.headers.get("x-bench-returned-rows")) : null,
      d1PerQueryRows: rows,
      replayRowsMismatch: rec ? replayEvidenceMismatch(rec, res.headers) : false,
      cacheState: res.headers.get("x-flamenode-cache"),
      bodyHash: createHash("sha256").update(Buffer.from(buf)).digest("hex"),
      ...(hasResponseExpectation(spec) ? { responseBodyMismatch: benchmarkResponseMismatch(spec, buf, res.headers, d1, rows) || (rec != null && rec.responseBodyMismatch !== false) } : {}),
      cpuMs: profileSummary.busyMs,
      replayStatusMismatch: rec ? rec.status !== res.status : false,
      isFirstIsolateRequest: firstBuild !== null
        && res.headers.get("x-bench-build") === firstBuild
        && res.headers.get("x-bench-request") === "1",
      coldGeneration: firstBuild,
      requestOrdinal: Number(res.headers.get("x-bench-request")),
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

  // A broken/stalled V8 inspector can report 0ms for every route. Validate
  // synchronous calibration BEFORE accepting any route CPU measurements.
  validateCpuProfilerCalibration(calibration);
  quantumMs = SAMPLING_US / 1000;
  countQuantum = true;

  return {
    calibration,
    name: "wrangler",
    supportsCacheApi: true,
    get resolutionMs() { return quantumMs; },
    digits: 2,
    cpuSource: `V8 sampling profiler (${SAMPLING_US}us interval, non-idle samples) attached to wrangler dev --local (workerd) via inspector; local D1/R2 SIMULATOR CPU INCLUDED (--d1 sim); local, not production`,
    supportsCold: true,
    ...(opts.operationModeKv === true ? {
      seedOperationModeKv: async (fixture, { reset = true } = {}) => {
        const response = await post("/__bench/operation-mode-kv-seed?reset=" + (reset ? "1" : "0"), fixture.raw, "PUT");
        requireBenchmarkControl(response, "operation-mode-kv-seed");
        const receipt = await response.json();
        const expectedSha = createHash("sha256").update(fixture.raw, "utf8").digest("hex");
        if (receipt.bytes !== fixture.bytes || receipt.sha256 !== expectedSha || receipt.reset !== reset) {
          throw new Error("bench KV seed receipt mismatch");
        }
        return receipt;
      },
    } : {}),
    setR2: async (body, key = STATS_KEY) => {
      const q = `/__bench/r2?key=${encodeURIComponent(key)}`;
      const response = body == null
        ? await post(q, undefined, "DELETE")
        : await post(q, body, "PUT");
      requireBenchmarkControl(response, "r2");
    },
    exec,
    clearCache: async () => {
      requireBenchmarkControl(await post("/__bench/cache-clear"), "cache-clear");
    },
    record: async () => null,
    run,
    runFirstRequest: async (spec, rec) => {
      await stopWorker();
      const generation = `b${++build}`;
      fs.writeFileSync(workerPath, workerSource(generation, rec?.script ?? null, { operationModeKv: opts.operationModeKv === true }));
      startWorker(); // New workerd process, not merely reset counters or a hot reload.
      // The first fetch creates workerd's execution context. Inspector attach
      // must not warm it with a ping, script upload or Runtime.evaluate probe.
      try {
        await connect();
        return { ...await run(spec, rec, generation), coldProcessId: child.pid };
      } catch (error) {
        try { await cleanup(); } catch {}
        throw error;
      }
    },
    reload: async () => {
      build += 1;
      fs.writeFileSync(workerPath, workerSource("b" + build, null, { operationModeKv: opts.operationModeKv === true }));
      try {
        await waitBuild("b" + build);
        await connect();
      } catch (error) {
        try { await cleanup(); } catch {}
        throw error;
      }
    },
    toolVersions: () => spawnSync(process.execPath, [wranglerBin, "--version"], { encoding: "utf8" }).stdout.trim(),
    close: cleanup,
  };
  } catch (error) {
    try { await cleanup(); } catch {}
    throw error;
  }
}

// --------------------------------------------------------------------- runner
function tag(prefix, n) { return `${prefix}${n.toString(36)}`; }

export async function runScenario(target, sc, opts, state) {
  const samples = [];
  const note = (kind, spec, r, cpuMs) => samples.push({
    kind, cpuMs, status: r.status, bytes: r.bytes, d1: r.d1, d1RowsReturned: r.d1RowsReturned, d1PerQueryRows: r.d1PerQueryRows, cacheState: r.cacheState ?? null,
    unexpected: !spec.expect.includes(r.status) || r.replayStatusMismatch === true || r.replayRowsMismatch === true || (spec.expectCache != null && r.cacheState !== spec.expectCache) || r.bodyReuseMismatch === true || r.responseBodyMismatch === true || (hasResponseExpectation(spec) && r.responseBodyMismatch !== false),
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
  if (target.supportsCacheApi && sc.warmModes) {
    for (const [kind, mode] of Object.entries(sc.warmModes)) {
      const measure = async (sampleIndex, recordSample) => {
        const spec = { method: "GET", path: mode.path, headers: rh013Ip(), expect: [200], expectCache: mode.expectCache };
        if (sampleIndex === 0) {
          const seed = rh013Seed();
          if (seed.length) await target.exec(seed);
        }
        if (kind === "scheduled-warm") await target.clearCache();
        else await target.reload(); // realtime micro-cache is isolate-local
        // Capture replay scripts before priming so the measured request follows immediately.
        const primeRecord = await target.record(spec);
        const measuredRecord = recordSample ? await target.record(spec) : null;
        const primed = await target.run(spec, primeRecord);
        if (primed.status !== 200) throw new Error(`RH-013 ${kind} prime returned ${primed.status}`);
        if (!recordSample) return;
        // A 1.1s gap guarantees generated_at advances while staying inside the
        // 15s isolate-cache TTL; byte-identical output proves realtime reuse.
        await sleep(kind === "scheduled-warm" ? 25 : 1100);
        const measured = await target.run(spec, measuredRecord);
        if (mode.verifyBodyReuse) measured.bodyReuseMismatch = measured.bodyHash !== primed.bodyHash;
        note(kind, spec, measured, measured.cpuMs);
      };
      for (let i = 0; i < opts.warmup; i += 1) await measure(i, false);
      for (let i = 0; i < opts.samples; i += 1) {
        process.stderr.write(`measuring RH-013 ${kind} ${i + 1}/${opts.samples}\\r`);
        await measure(i + opts.warmup, true);
      }
      process.stderr.write("\\n");
    }
  }
  return samples;
}

/**
 * One new local Worker process per measured request. Replay inputs are prepared
 * before startup; inspector attachment makes no application request. The
 * response must attest the new generation and request ordinal 1. Older targets
 * without this lifecycle remain post-reload diagnostics, never cold acceptance.
 * Local measurements are not deployed-platform cpuTime or production evidence.
 */
export async function runCold(target, scenarios, opts) {
  const live = scenarios;
  const coldSamples = new Map(live.map((s) => [s.id, []]));
  for (let round = 0; round < opts.coldSamples; round += 1) {
    for (const sc of live) {
      const pk = sc.prepareKind?.normal;
      const spec = sc.kinds.normal(round, tag(`c${sc.id.replace(/[^A-Za-z0-9]/g, "")}`, round));
      // Cache API storage can survive the measured process restart. Clear it
      // through the old worker before recording/starting its fresh replacement.
      if (spec.clearCache) await target.clearCache?.();
      let rec;
      if (target.recordFirstRequest) {
        rec = await target.recordFirstRequest(spec, pk);
      } else {
        if (pk?.r2 !== undefined) await target.setR2(pk.r2);
        for (const [key, body] of Object.entries(pk?.r2Objects ?? {})) await target.setR2(body, key);
        if (spec.setup) await target.exec(spec.setup);
        rec = await target.record(spec);
      }
      const measuredSpec = rec?.coldRequest ?? spec;
      const r = target.runFirstRequest
        ? await target.runFirstRequest(measuredSpec, rec)
        : (await target.reload(), await target.run(measuredSpec, rec));
      coldSamples.get(sc.id).push({ kind: "cold",
        isFirstIsolateRequest: Boolean(target.runFirstRequest) && r.isFirstIsolateRequest === true,
        coldGeneration: r.coldGeneration ?? null, coldProcessId: r.coldProcessId ?? null,
        coldRecorder: rec?.coldRecorder ?? null,
        requestOrdinal: r.requestOrdinal ?? null,
        cpuMs: r.cpuMs, status: r.status, bytes: r.bytes, d1: r.d1, d1RowsReturned: r.d1RowsReturned, d1PerQueryRows: r.d1PerQueryRows,
        unexpected: !spec.expect.includes(r.status) || r.replayStatusMismatch === true || r.replayRowsMismatch === true || r.responseBodyMismatch === true || (hasResponseExpectation(spec) && r.responseBodyMismatch !== false) });
    }
    process.stderr.write(`cold round ${round + 1}/${opts.coldSamples}\r`);
  }
  process.stderr.write("\n");
  return coldSamples;
}

/** Replay: setup/record on the in-process sqlite, measure on workerd with D1/R2 stubbed. */
export function createReplayTarget(inproc, wr) {
  return {
    ...wr,
    // Object spread evaluates a getter into a fixed value. The V8 sampling
    // quantum can grow from 0.1ms to several ms while requests run; keep the
    // *live* workerd resolution so warm BASELINE and budget checks fail closed.
    get resolutionMs() { return wr.resolutionMs; },
    cpuSource: wr.cpuSource.replace("local D1/R2 SIMULATOR CPU INCLUDED (--d1 sim)", "D1/R2 stubbed with normalized results recorded from in-process node:sqlite (--d1 replay); request profiling includes app code, retained native UUID/Date.now calls, input-hook/transcript and replay identity/row/count bookkeeping; Node recording and warm registration excluded; cold JSON parsing/validation runs at module initialization and may precede profiling; local D1/R2 simulator and real D1 round-trip excluded"),
    exec: inproc.exec,
    setR2: inproc.setR2,
    record: (spec) => inproc.recordForReplay(spec),
    recordFirstRequest: inproc.recordFirstRequest,
    close: async () => { await wr.close(); await inproc.close(); },
  };
}

export async function collectOperationModeKvSamples(target, fixture, opts, { clock = () => performance.now(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const spec = { method: "GET", path: "/api/operation-mode/banner", expect: [200], operationModeKv: true };
  const samples = [], warmupFailures = [], generations = new Set();
  const makeSample = (kind, result, seed, provenance, elapsedMs = null) => {
    const e = result?.nativeKv;
    const phase = kind === "cold" ? "miss" : kind;
    const unexpected = !provenance || !Number.isFinite(result?.cpuMs) || result.cpuMs < 0
      || operationModeBannerReceiptMismatch(fixture, { ...e, status: result?.status, bytes: result?.bytes }, phase)
      || operationModeKvEvidenceMismatch(fixture, seed, e, result?.requestOrdinal, phase);
    return { kind, cpuMs: result?.cpuMs ?? null, status: result?.status ?? null, bytes: result?.bytes ?? null,
      d1: e?.d1 ?? null, kvGets: e?.kvGets ?? null, kvPuts: e?.kvPuts ?? null, kvDeletes: e?.kvDeletes ?? null,
      kvOther: e?.kvOther ?? null, kvGetFailures: e?.kvGetFailures ?? null,
      readBytes: e?.readBytes ?? null, readSha256: e?.readSha256 ?? null,
      workerBuild: result?.workerBuild ?? null, requestOrdinal: result?.requestOrdinal ?? null,
      coldProcessId: result?.coldProcessId ?? null, isFirstIsolateRequest: kind === "cold" && provenance,
      elapsedMs, unexpected };
  };
  const buildValid = r => typeof r?.workerBuild === "string" && r.workerBuild.length > 0;
  const follows = (prev, next) => buildValid(prev) && next?.workerBuild === prev.workerBuild
    && next.requestOrdinal === prev.requestOrdinal + 2;
  const finish = stopReason => ({ samples, warmupFailures, stopReason });
  const accept = (sample, warmup) => {
    if (!warmup) samples.push(sample);
    else if (sample.unexpected) warmupFailures.push(sample);
    return !sample.unexpected;
  };
  let lastWarmBuild = null;
  let previousExpiry = null;
  for (let i = 0; i < opts.warmup + opts.samples; i++) {
    const warmup = i < opts.warmup;
    const seed = await target.seedOperationModeKv(fixture, { reset: true });
    const start = clock();
    const miss = await target.run(spec);
    const missComplete = clock();
    // Between rounds: previous expiry receipt GET, seed PUT, then miss GET.
    // A reset of the ordinal or a build change must not pass as warm evidence.
    const continuous = buildValid(miss) && (previousExpiry === null ||
      (miss.workerBuild === previousExpiry.workerBuild &&
       miss.requestOrdinal === previousExpiry.requestOrdinal + 3));
    if (!accept(makeSample("miss", miss, seed, continuous), warmup)) return finish("STOP_RECEIPT");
    lastWarmBuild = miss.workerBuild;
    const hit = await target.run(spec);
    const hitElapsed = clock() - start;
    if (!accept(makeSample("hit", hit, seed, follows(miss, hit) && Number.isFinite(hitElapsed) && hitElapsed >= 0 && hitElapsed < 30_000, hitElapsed), warmup)) return finish("STOP_RECEIPT");
    // No reset, seed or reload between hit and expiry. Wait real elapsed time;
    // an early timer, restart or hidden request cannot count as expiry.
    await pause(31_000);
    const elapsed = clock() - missComplete;
    const expired = await target.run(spec);
    if (!accept(makeSample("expiry", expired, seed, follows(hit, expired) && Number.isFinite(elapsed) && elapsed >= 30_000, elapsed), warmup)) return finish("STOP_RECEIPT");
    previousExpiry = expired;
  }
  if (!opts.skipCold) {
    for (let i = 0; i < opts.coldSamples; i++) {
      const seed = await target.seedOperationModeKv(fixture, { reset: false });
      const result = await target.runFirstRequest(spec, null);
      const fresh = buildValid(result) && result.workerBuild !== lastWarmBuild
        && result.coldGeneration === result.workerBuild && !generations.has(result.workerBuild)
        && result.isFirstIsolateRequest === true && result.requestOrdinal === 1
        && Number.isSafeInteger(result.coldProcessId) && result.coldProcessId > 0;
      if (fresh) generations.add(result.workerBuild);
      if (!accept(makeSample("cold", result, seed, fresh), false)) return finish("STOP_COLD");
    }
  }
  return finish(null);
}

export function operationModeKvBaseline(samples, expected, resolutionMs) {
  const kinds = {};
  for (const kind of ["normal", "limit", "invalid"]) {
    const rows = samples.filter(r => r.kind === kind);
    kinds[kind] = { ...summarize(rows.map(r => r.cpuMs)), count: rows.length,
      unexpected: rows.filter(r => r.unexpected !== false || r.status !== 200).length };
  }
  const valid = Object.values(kinds).every(r => r.count === expected && r.n === expected && r.unexpected === 0);
  const max = valid && expected > 0 ? Math.max(...Object.values(kinds).map(r => r.max)) : null;
  const upper = max !== null && Number.isFinite(resolutionMs) && resolutionMs >= 0 ? max + resolutionMs : null;
  return { kinds, max, upper, quiet: upper !== null && upper < QUIET_BASELINE_MAX_MS };
}

export function summarizeOperationModeKvDiagnostic(collected, pre, post, opts, resolutionMs, platform) {
  const phases = ["miss", "hit", "expiry", "cold"];
  const kinds = Object.fromEntries(phases.map(kind => {
    const rows = collected.samples.filter(s => s.kind === kind);
    return [kind, { ...summarize(rows.map(s => s.cpuMs)), count: rows.length,
      unexpected: rows.filter(s => s.unexpected !== false).length,
      verifiedStarts: rows.filter(s => s.isFirstIsolateRequest === true).length,
      maxResponseBytes: rows.length ? Math.max(...rows.map(s => s.bytes ?? 0)) : null,
      maxKvGets: rows.length ? Math.max(...rows.map(s => s.kvGets ?? 0)) : null }];
  }));
  const warm = phases.slice(0, 3).map(p => kinds[p]);
  const warmMax = warm.every(k => k.max !== null) ? Math.max(...warm.map(k => k.max)) : null;
  const upper = warmMax !== null && Number.isFinite(resolutionMs) && resolutionMs >= 0 ? warmMax + resolutionMs : null;
  let verdict = collected.stopReason;
  if (!verdict && (!pre?.quiet || !post?.quiet)) verdict = "STOP_BASELINE";
  if (!verdict && platform !== "linux") verdict = "STOP_PLATFORM";
  if (!verdict && (opts.samples < MIN_SAMPLES || opts.warmup < 10 || !warm.every(k => k.count === opts.samples && k.n === opts.samples && k.unexpected === 0))) verdict = "STOP_SAMPLES";
  if (!verdict && (opts.skipCold || opts.coldSamples < MIN_SAMPLES || kinds.cold.count !== opts.coldSamples || kinds.cold.n !== opts.coldSamples || kinds.cold.verifiedStarts !== opts.coldSamples || kinds.cold.unexpected !== 0)) verdict = "STOP_COLD";
  if (!verdict && collected.warmupFailures.length) verdict = "STOP_RECEIPT";
  if (!verdict) verdict = upper !== null && upper < 7 ? "LOCAL_DIAGNOSTIC_WITHIN_S2" : "LOCAL_DIAGNOSTIC_NOT_WITHIN_S2";
  return { kinds, warmMax, upper, verdict, migrationAcceptance: false, productionAcceptance: false };
}

async function runOperationModeKvCli(plan, opts) {
  const fixture = buildOperationModeMirrorFixture(opts.operationModeKvCase);
  const label = "LOCAL NATIVE KV DIAGNOSTIC ONLY — NOT MIG-0639 / PRODUCTION ACCEPTANCE";
  const workload = { id: fixture.id, bytes: fixture.bytes, sha256: createHash("sha256").update(fixture.raw, "utf8").digest("hex") };
  if (opts.dryRun) {
    console.log(JSON.stringify({ label, dryRun: true, workload, expectedOperationModeScannerBlobSha: EXPECTED_OPERATION_MODE_SCANNER_BLOB_SHA, samplesPerPhase: opts.samples, warmups: opts.warmup,
      coldSamples: opts.skipCold ? 0 : opts.coldSamples, expiryWaitMs: 31000 }, null, 2));
    return;
  }
  const scannerPath = path.join(REPO_ROOT, "apps/api/src/routes/live/operationMode.ts");
  const scannerBlobSha = assertOperationModeScannerSource(fs.readFileSync(scannerPath));
  const target = await createWranglerTarget(plan, opts);
  const baseline = buildScenarios(plan).find(s => s.id === "BASELINE");
  const state = { tagSeq: 0 };
  let pre = null, post = null;
  let collected = { samples: [], warmupFailures: [], stopReason: null };
  let preRows = [], postRows = [];
  try {
    preRows = await runScenario(target, baseline, opts, state);
    pre = operationModeKvBaseline(preRows, opts.samples, target.resolutionMs);
    if (!pre.quiet) collected.stopReason = "STOP_BASELINE";
    else {
      collected = await collectOperationModeKvSamples(target, fixture, opts);
      postRows = await runScenario(target, baseline, opts, state);
      // Final observed profiler resolution applies to BOTH baselines.
      pre = operationModeKvBaseline(preRows, opts.samples, target.resolutionMs);
      post = operationModeKvBaseline(postRows, opts.samples, target.resolutionMs);
    }
  } finally { await target.close(); }
  const summary = summarizeOperationModeKvDiagnostic(collected, pre, post, opts, target.resolutionMs, process.platform);
  const report = { meta: { label, workload, operationModeScannerBlobSha: scannerBlobSha, commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim(),
    platform: process.platform, node: process.version, wrangler: target.toolVersions?.() ?? null, cpuSource: target.cpuSource,
    resolutionMs: target.resolutionMs, calibration: target.calibration, samplesPerPhase: opts.samples,
    warmupDiscarded: opts.warmup, coldSamplesRequested: opts.skipCold ? 0 : opts.coldSamples,
    expiryWaitMs: 31000, localNativeKv: true, migrationAcceptance: false, productionAcceptance: false },
    baseline: { pre, post }, summary, ...collected };
  console.log(JSON.stringify(report, null, 2));
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
  if (summary.verdict !== "LOCAL_DIAGNOSTIC_WITHIN_S2") process.exitCode = 2;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const plan = { adminToken: `bench-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}` };
  if (opts.operationModeKv) return runOperationModeKvCli(plan, opts);
  const scenarios = buildScenarios(plan, { includePending: opts.includePending,
    includeEventPlaylist: opts.only?.includes("RH-031-PLAYLIST") === true,
  }).filter((s) => !opts.only || opts.only.includes(s.id) || s.id === "BASELINE");

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
  let baselineEvidence = null;
  let environmentEvidence = null;
  try {
    const state = { tagSeq: 0 };
    for (const sc of scenarios) {
      process.stderr.write(`measuring ${sc.id} ...\n`);
      const samples = await runScenario(target, sc, opts, state);
      results.push({
        id: sc.id, title: sc.title, runtimeClass: sc.runtimeClass, samples,
        expectedWarmKinds: Object.keys(sc.warmModes ?? {}),
      });
    }
    if (target.supportsCold && !opts.skipCold) {
      const cold = await runCold(target, scenarios, opts);
      for (const r of results) r.samples.push(...cold.get(r.id));
    }
    baselineEvidence = applyBudgetVerdicts(results, { resolutionMs: target.resolutionMs });
    environmentEvidence = enforceCpuMeasurementEnvironment(results, { ...opts, platform: process.platform });
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
    noiseFloorMs: baselineEvidence?.noiseFloorMs ?? null, // Warm-only BASELINE, not cold-inclusive.
    baselineColdMaxMs: baselineEvidence?.baselineColdMaxMs ?? null,
    baselineUpperBoundMs: baselineEvidence?.baselineUpperBoundMs ?? null,
    quietBaseline: baselineEvidence?.quietBaseline ?? false,
    measurementEnvironmentEligible: environmentEvidence?.eligible ?? false,
    measurementEnvironmentStopReason: environmentEvidence?.stopReason ?? null,
    requiredWarmBaselineUnderMs: QUIET_BASELINE_MAX_MS,
    clockCalibration: target.calibration ?? null,
  };
  const md = renderMarkdown(results, { digits: target.digits, label: target.name === "inproc" ? "Node proxy, not workerd" : "local workerd, observed profiler resolution" });
  console.log(`# ${meta.label}\n\n${json(meta)}\n\n${md}`);
  if (opts.out) {
    fs.writeFileSync(opts.out, json({ meta, results: results.map(({ id, title, runtimeClass, agg }) => ({ id, title, runtimeClass, agg })) }, null, 2));
  }
  if (results.some((r) => Object.values(r.agg.kinds).some((k) => k.unexpectedStatus > 0))) {
    console.error("WARNING: some samples returned an unexpected HTTP status; those CPU numbers are not trustworthy (see 'unexpected status' column).");
    process.exitCode = 2;
  }
}

if (!isMainThread && workerData?.kind === "flamenode-cold-recorder") {
  await runColdRecorderWorker();
} else if (isMainThread && process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
}

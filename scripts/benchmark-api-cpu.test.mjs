import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { materializeD1CompatibleMigrations } from "./d1-migration-compat.mjs";
import {
  operationModeMirrorFixtureCases, buildOperationModeMirrorFixture, operationModeBannerReceiptMismatch, createOperationModeKvProbe, operationModeKvEvidenceMismatch, operationModeScannerBlobSha, assertOperationModeScannerSource, EXPECTED_OPERATION_MODE_SCANNER_BLOB_SHA, collectOperationModeKvSamples, operationModeKvBaseline, summarizeOperationModeKvDiagnostic,
  BUDGETS_MS, KINDS, MIN_SAMPLES, QUIET_BASELINE_MAX_MS, ROUTE_INVENTORY, SEED, WARM_KINDS, aggregate, applyBudgetVerdicts, benchmarkRequestHeaders, benchmarkRequestEnv, enforceCpuMeasurementEnvironment, buildPendingScenarios, buildScenarios, createInprocTarget, createReplayTarget, createReplayInputScope, runCold, runScenario, validateCpuProfilerCalibration, eventExportCacheRequestUrls, judge, parseArgs, percentile, playlistResponseMismatch, templateResponseMismatch, renderMarkdown, returnedRows, replayIdentity, replayEvidenceMismatch, requireBenchmarkControl, snapshotReplayResult, snapshotReplayScript, summarize, workerSource,
} from "./benchmark-api-cpu.mjs";

async function loadReplayWorker(generation, script, body) {
  const source = workerSource(generation, script).replace(/^import .*;$/gm, "");
  const stubs = `const app = { fetch: async (request, env) => {
    const pathname = new URL(request.url).pathname;
    ${body}
  } }; const sessionMiddleware = () => async () => {};`;
  return (await import("data:text/javascript," + encodeURIComponent(stubs + source))).default;
}

test("MIG-0639 / #918: lazy operation-mode KV workload catalog has exact UTF-8 sizes and strict banner receipts", () => {
  const ids = operationModeMirrorFixtureCases();
  assert.equal(ids.length, 85);
  assert.equal(new Set(ids).size, 85);
  for (const shape of ["dense-string-array", "mixed-string-array", "malformed-string-array"]) {
    assert.equal(ids.filter(id => id.startsWith(shape + ":")).length, 6, shape);
  }
  for (const id of ids) {
    const f = buildOperationModeMirrorFixture(id);
    let parsed;
    try { parsed = JSON.parse(f.raw); } catch { parsed = null; }
    assert.equal(parsed !== null && Number.isFinite(parsed.updated_at), f.valid, id);
    assert.equal(Buffer.byteLength(f.raw, "utf8"), f.bytes, id);
    if (id === "canonical") {
      assert.equal(f.bytes, 3062);
      assert.equal(parsed.reason.length, 500);
      assert.deepEqual(Object.keys(parsed), ["mode", "reason", "updated_at"]);
    } else {
      assert.equal(f.bytes, Number(id.split(":")[1]), id);
    }
    if (f.valid) {
      assert.equal(parsed.mode, f.expected.mode, id);
      assert.equal(parsed.updated_at, f.updatedAt, id);
      const reason = f.bytes <= 65536 && typeof parsed.reason === "string" && parsed.reason.length <= 2048 ? parsed.reason : null;
      assert.equal(reason, f.expected.reason, id);
    } else {
      assert.deepEqual(f.expected, { mode: "normal", reason: null }, id);
    }
    const body = JSON.stringify(f.expected);
    const receipt = { status: 200, d1: 0, kvGets: 1, kvPuts: 0, kvDeletes: 0,
      bytes: Buffer.byteLength(body), body, contentType: "application/json; charset=UTF-8", cacheControl: "no-store" };
    assert.equal(operationModeBannerReceiptMismatch(f, receipt, "miss"), false, id);
    assert.equal(operationModeBannerReceiptMismatch(f, receipt, "expiry"), false, id);
    assert.equal(operationModeBannerReceiptMismatch(f, { ...receipt, kvGets: 0 }, "hit"), false, id);
    const wrongBody = JSON.stringify({ ...f.expected, extra: true });
    for (const bad of [{ status: 503 }, { kvGets: 0 }, { d1: 1 }, { kvPuts: 1 }, { kvDeletes: 1 },
      { cacheControl: "public" }, { contentType: "text/plain" }, { bytes: receipt.bytes + 1 },
      { kvGets: undefined }, { d1: undefined }, { body: wrongBody, bytes: Buffer.byteLength(wrongBody) }]) {
      assert.equal(operationModeBannerReceiptMismatch(f, { ...receipt, ...bad }, "miss"), true, id);
    }
    assert.equal(operationModeBannerReceiptMismatch(f, receipt, "hit"), true, id);
    assert.equal(operationModeBannerReceiptMismatch(f, receipt, "unknown"), true, id);
  }
  assert.throws(() => buildOperationModeMirrorFixture("plain-reason:999999999"), /unknown/);
});

test("MIG-0639 / #918 native KV diagnostic transport: seed, exact read receipt, cache hit, failure and isolation", async () => {
  const sha256 = async raw => createHash("sha256").update(raw, "utf8").digest("hex");
  const fixture = buildOperationModeMirrorFixture("malformed-tail:65537");
  let stored = null, cached = false, actualGets = 0, actualPuts = 0, failGet = false;
  const probe = createOperationModeKvProbe(() => { cached = false; }, sha256);
  const native = {
    async put(key, raw) { assert.equal(key, "operation_mode:mirror"); actualPuts++; stored = raw; },
    async get(key, options) { assert.equal(this, native); assert.equal(key, "operation_mode:mirror"); assert.deepEqual(options, { cacheTtl: 30 }); actualGets++; if (failGet) throw Error("provider failure"); return stored; },
  };
  const env = { KV: native, DB: { prepare() { throw Error("must not reach native D1"); } } };
  const request = (pathname, method = "GET", body, headers) => new Request("http://bench.local" + pathname, { method, body, headers });
  const dispatch = async (_request, bindings) => {
    if (!cached) {
      try { await bindings.KV.get("operation_mode:mirror", { cacheTtl: 30 }); } catch {}
      cached = true;
    }
    return Response.json(fixture.expected, { headers: { "cache-control": "no-store" } });
  };
  assert.equal(await probe(request("/unrelated"), env, 1, dispatch), null);
  const seedResponse = await probe(request("/__bench/operation-mode-kv-seed?reset=1", "PUT", fixture.raw), env, 2, dispatch);
  const seed = await seedResponse.json();
  assert.deepEqual(seed, { bytes: fixture.bytes, sha256: await sha256(fixture.raw), reset: true });
  assert.equal(actualPuts, 1);
  assert.equal(stored, fixture.raw);
  assert.equal(actualGets, 0);
  const banner = "/api/operation-mode/banner", receiptPath = "/__bench/operation-mode-kv-receipt?request=";
  const measure = async (ordinal, phase, handler = dispatch) => {
    const response = await probe(request(banner), env, ordinal, handler);
    const body = await response.text();
    const result = await probe(request(receiptPath + ordinal), env, ordinal + 1, dispatch);
    assert.equal(result.status, 200);
    const evidence = await result.json();
    const receipt = { ...evidence, status: response.status, body, bytes: Buffer.byteLength(body), cacheControl: response.headers.get("cache-control"), contentType: response.headers.get("content-type") };
    return { evidence, mismatch: operationModeBannerReceiptMismatch(fixture, receipt, phase) || operationModeKvEvidenceMismatch(fixture, seed, evidence, ordinal, phase) };
  };
  assert.equal((await measure(3, "miss")).mismatch, false);
  assert.equal(actualGets, 1);
  assert.equal((await probe(request(receiptPath + 3), env, 5, dispatch)).status, 409, "receipt is one-use");
  assert.equal((await measure(6, "hit")).mismatch, false);
  assert.equal(actualGets, 1);
  cached = false; failGet = true;
  const failed = await measure(8, "miss");
  assert.equal(failed.evidence.kvGetFailures, 1);
  assert.equal(failed.mismatch, true, "normal 200 from caught KV failure is not a passing malformed-input sample");
  failGet = false;
  cached = false;
  const wrong = await measure(10, "miss", async (req, bindings) => {
    try { await bindings.DB.prepare("SELECT 1"); } catch {}
    try { await bindings.KV.get("wrong", { cacheTtl: 30 }); } catch {}
    return Response.json(fixture.expected, { headers: { "cache-control": "no-store" } });
  });
  assert.equal(wrong.evidence.d1, 1);
  assert.equal(wrong.evidence.kvGetFailures, 1);
  assert.equal(wrong.mismatch, true);
  assert.equal((await probe(request(banner, "GET", undefined, { "x-bench-script": "cold" }), env, 12, dispatch)).status, 400);
  assert.equal((await probe(request(receiptPath + 12), env, 13, dispatch)).status, 409);
  assert.ok(!workerSource("default").includes("nativeKvProbe"), "default 155-scenario worker remains uninstrumented");
  const enabled = workerSource("kv", null, { operationModeKv: true });
  assert.match(enabled, /resetOperationModeCachesForTests/);
  assert.match(enabled, /nativeKvProbe\(request, env, ordinal,/);
});

test("MIG-0639 native KV diagnostic pins the separate #918 scanner source blob", () => {
  assert.equal(operationModeScannerBlobSha("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.equal(EXPECTED_OPERATION_MODE_SCANNER_BLOB_SHA, "aa576714a174166a37aa0e15c116be40a13488be");
  assert.throws(() => assertOperationModeScannerSource("hello\n"), /pinned #918 scanner source/);
});
test("MIG-0639 native KV CLI requires an explicit workload and native sim; default stays unchanged", () => {
  assert.equal(parseArgs([]).operationModeKv, false);
  const flags = ["--d1", "sim", "--operation-mode-kv", "plain-reason:65537"];
  const o = parseArgs(flags);
  assert.equal(o.operationModeKv, true);
  assert.equal(o.operationModeKvCase, "plain-reason:65537");
  for (const invalid of [["--operation-mode-kv", "canonical"], [...flags, "--only", "MIG-0661"],
    [...flags, "--mode", "inproc"], [...flags, "--include-pending"], [...flags, "--operation-mode-kv", "canonical"],
    [...flags, "--samples", "0"], [...flags, "--cold-samples", "0"],
    ["--d1", "sim", "--operation-mode-kv", "unknown"]]) {
    assert.throws(() => parseArgs(invalid), /KV diagnostic|operation-mode-kv/);
  }
});

test("MIG-0639 native KV runner separates reset miss, warm hit, elapsed expiry and true cold; fails closed", async () => {
  const fixture = buildOperationModeMirrorFixture("malformed-tail:65537");
  const body = JSON.stringify(fixture.expected), sha = "a".repeat(64);
  const opts = { samples: 2, warmup: 1, coldSamples: 2, skipCold: false };
  function fake({ early = false, bad = null } = {}) {
    let t = 0, build = 0, ordinal = 0, phase = 0, seeds = 0;
    const make = kind => {
      ordinal++;
      const n = ordinal;
      ordinal++;
      t++;
      const gets = kind === "hit" ? 0 : 1;
      return { cpuMs: 1, status: 200, bytes: Buffer.byteLength(body), workerBuild: "b" + build, requestOrdinal: n,
        nativeKv: { ordinal: n, d1: 0, kvGets: gets, kvPuts: 0, kvDeletes: 0, kvOther: 0, kvGetFailures: 0,
          readBytes: gets ? fixture.bytes : null, readSha256: gets ? sha : null, body,
          cacheControl: "no-store", contentType: "application/json" } };
    };
    const target = {
      seedOperationModeKv: async (_fixture, { reset }) => { ordinal++; seeds++; if (reset) phase = 0; return { bytes: fixture.bytes, sha256: sha, reset }; },
      run: async () => {
        const kind = ["miss", "hit", "expiry"][phase++];
        const result = make(kind);
        if (bad === kind) result.nativeKv.readSha256 = "b".repeat(64);
        return result;
      },
      runFirstRequest: async () => {
        build++; ordinal = 0;
        const result = make("miss");
        return { ...result, coldGeneration: result.workerBuild, coldProcessId: build,
          isFirstIsolateRequest: bad !== "cold" };
      },
    };
    return { target, clock: () => t, pause: async ms => { t += early ? 100 : ms; }, seeds: () => seeds };
  }
  const m = fake();
  const out = await collectOperationModeKvSamples(m.target, fixture, opts, m);
  assert.equal(out.stopReason, null);
  assert.deepEqual(out.samples.map(r => r.kind), ["miss","hit","expiry","miss","hit","expiry","cold","cold"]);
  assert.ok(out.samples.every(r => !r.unexpected));
  assert.equal(m.seeds(), 5);
  assert.ok(out.samples.filter(r => r.kind === "expiry").every(r => r.elapsedMs >= 30000));
  assert.ok(out.samples.filter(r => r.kind === "cold").every(r => r.isFirstIsolateRequest && r.requestOrdinal === 1));
  for (const input of [{ bad: "miss" }, { bad: "hit" }, { bad: "expiry" }, { early: true }]) {
    const f = fake(input), r = await collectOperationModeKvSamples(f.target, fixture, opts, f);
    assert.equal(r.stopReason, "STOP_RECEIPT");
    assert.equal(r.warmupFailures.length, 1);
    assert.equal(r.samples.length, 0);
  }
  const f = fake({ bad: "cold" });
  assert.equal((await collectOperationModeKvSamples(f.target, fixture, opts, f)).stopReason, "STOP_COLD");
});

test("MIG-0639 native KV diagnostic requires both quiet baselines, complete phases and cold provenance, never global acceptance", () => {
  const base = Array.from({ length: 150 }, (_, i) => ({ kind: ["normal","limit","invalid"][i % 3], cpuMs: 1, status: 200, unexpected: false }));
  const quiet = operationModeKvBaseline(base, 50, .1);
  assert.equal(quiet.quiet, true);
  assert.equal(operationModeKvBaseline(base, 50, 3).quiet, false);
  assert.equal(operationModeKvBaseline(base.slice(1), 50, .1).quiet, false);
  const samples = Array.from({ length: 200 }, (_, i) => ({ kind: ["miss","hit","expiry","cold"][i % 4],
    cpuMs: 2, bytes: 31, kvGets: i % 4 === 1 ? 0 : 1, unexpected: false, isFirstIsolateRequest: i % 4 === 3 }));
  const collected = { samples, warmupFailures: [], stopReason: null };
  const opts = { samples: 50, warmup: 10, coldSamples: 50, skipCold: false };
  const result = (c = collected, pre = quiet, post = quiet, o = opts, res = .1, platform = "linux") =>
    summarizeOperationModeKvDiagnostic(c, pre, post, o, res, platform);
  assert.equal(result().verdict, "LOCAL_DIAGNOSTIC_WITHIN_S2");
  assert.equal(result().migrationAcceptance, false);
  assert.equal(result().productionAcceptance, false);
  assert.equal(result(collected, quiet, { quiet: false }).verdict, "STOP_BASELINE");
  assert.equal(result(collected, quiet, quiet, opts, 5).verdict, "LOCAL_DIAGNOSTIC_NOT_WITHIN_S2");
  assert.equal(result(collected, quiet, quiet, { ...opts, warmup: 9 }).verdict, "STOP_SAMPLES");
  assert.equal(result(collected, quiet, quiet, { ...opts, skipCold: true }).verdict, "STOP_COLD");
  assert.equal(result({ ...collected, samples: samples.slice(0, -1) }).verdict, "STOP_COLD");
  assert.equal(result({ ...collected, samples: samples.slice(1) }).verdict, "STOP_SAMPLES");
  assert.equal(result(collected, quiet, quiet, opts, .1, "win32").verdict, "STOP_PLATFORM");
});

test("D1 returned-row proxy counts first/all/raw/batch and preserves per-query sample evidence", () => {
  assert.equal(returnedRows("first", null), 0);
  assert.equal(returnedRows("first", { id: "v" }), 1);
  assert.equal(returnedRows("all", { results: [{ id: 1 }, { id: 2 }] }), 2);
  assert.equal(returnedRows("raw", [[1], [2], [3]]), 3);
  assert.equal(returnedRows("run", { results: [] }), 0);
  assert.equal(returnedRows("batch", [{ results: [{ id: 1 }] }, { results: [] }, { results: [1, 2] }]), 3);
  const samples = [
    { kind: "normal", cpuMs: 1, d1: 1, d1RowsReturned: 4, d1PerQueryRows: [1, 3] },
    { kind: "normal", cpuMs: 2, d1: 1, d1RowsReturned: 1, d1PerQueryRows: [1] },
    { kind: "normal", cpuMs: 3, d1: 1, d1RowsReturned: 3, d1PerQueryRows: [2, 1] },
  ];
  const k = aggregate(samples, { runtimeClass: "S2", resolutionMs: 0.1 }).kinds.normal;
  assert.deepEqual(k.d1RowsReturned, { min: 1, median: 3, max: 4, total: 8 });
  assert.deepEqual(k.d1PerQueryRowsBySample, [[1, 3], [1], [2, 1]]);
  const absent = aggregate([{ kind: "normal", cpuMs: 1 }], {
    runtimeClass: "S2", resolutionMs: 0.1,
  }).kinds.normal;
  assert.equal(absent.d1RowsReturned, null, "unknown rows must not masquerade as 0");
  const md = renderMarkdown([{
    id: "RH-013", title: "fixture", runtimeClass: "S2",
    agg: aggregate(samples, { runtimeClass: "S2", resolutionMs: 0.1 }),
  }], { digits: 2, label: "test only" });
  assert.match(md, /D1 returned rows proxy \(min\/med\/max\/total\)/);
  assert.match(md, /D1 execution requests/);
  assert.match(md, /not completed physical DB operations or billed D1 usage/);
  assert.match(md, /\| 1\/3\/4\/8 \|/);
});

test("MIG-0639 SA-105: replay recording captures real multipart upload and R2 cleanup results", async () => {
  const plan = { adminToken: "t" };
  const scenario = buildScenarios(plan).find((candidate) => candidate.id === "SA-105");
  assert.ok(scenario, "X icon upload must be mounted and measured");
  const target = await createInprocTarget(plan);
  try {
    const spec = scenario.kinds.normal(0, "replay-icon");
    assert.ok(spec.body instanceof FormData, "upload requires a real multipart request");
    assert.equal(spec.headers["content-type"], undefined, "Request adds the multipart boundary");
    if (spec.setup) await target.exec(spec.setup);
    const recorded = await target.recordForReplay(spec);
    assert.equal(recorded.status, 200, "real Hono upload must commit before it can be replayed");
    assert.ok(recorded.script.length > 0, "workerd replay must capture all external results");
    const results = recorded.script.map((entry) => {
      assert.ok(entry && typeof entry.identity === "string", "every replay operation has a typed identity");
      assert.ok(Object.hasOwn(entry, "result"), "every replay operation stores its result separately");
      return entry.result;
    });
    const puts = results.filter((value) =>
      value && typeof value === "object" && value.etag === "bench-etag" && !Object.hasOwn(value, "text"));
    const deletes = results.filter((value) =>
      value && typeof value === "object" && value.deleted === true);
    assert.equal(puts.length, 2, "staging and final R2 puts must be in the recorded script");
    assert.ok(deletes.length >= 1, "post-commit staging cleanup must be replayable");
    assert.ok(recorded.d1 > 0, "real upload must execute D1 authorization and audit");
    assert.equal(recorded.d1PerQueryRows.reduce((sum, n) => sum + n, 0), recorded.d1RowsReturned);
  } finally {
    await target.close();
  }
});

test("local migrated D1 records per-query result rows and carries them into replay fixtures", async () => {
  const plan = { adminToken: "t" };
  const scenario = buildScenarios(plan).find((candidate) => candidate.id === "RH-020");
  assert.ok(scenario, "live event slot benchmark is mounted");
  const target = await createInprocTarget(plan);
  try {
    const spec = scenario.kinds.normal(1, "row-proxy");
    if (spec.setup) await target.exec(spec.setup);
    const result = await target.run(spec);
    assert.ok(spec.expect.includes(result.status), "the benchmark must exercise the real endpoint");
    assert.ok(result.d1RowsReturned > 0, "D1 must return visible event/slot rows");
    assert.equal(result.d1PerQueryRows.reduce((a, b) => a + b, 0), result.d1RowsReturned);
    // The CURRENT live endpoint can cache an identical request in-isolate.
    // Use a fresh seeded event ID so replay records actual D1 results rather
    // than an empty script from an unrelated cache HIT.
    const fresh = scenario.kinds.normal(2, "row-proxy-replay");
    if (fresh.setup) await target.exec(fresh.setup);
    const replay = await target.recordForReplay(fresh);
    assert.equal(replay.d1PerQueryRows.reduce((a, b) => a + b, 0), replay.d1RowsReturned);
    assert.ok(replay.script.length > 0, "replay preserves actual DB/R2 results");
  } finally {
    await target.close();
  }
});

test("MIG-0639: cold recorder has a fresh application module graph after parent warm requests", async () => {
  const plan = { adminToken: "cold-module-graph" };
  const scenario = buildScenarios(plan).find((candidate) => candidate.id === "RH-031");
  const target = await createInprocTarget(plan);
  const countClocks = (record) => record.script.filter((entry) => entry.identity.includes("input.Date.now")).length;
  try {
    const spec = scenario.kinds.normal(0, "cold-module-graph");
    const fixture = scenario.prepareKind.normal;
    for (const [key, body] of Object.entries(fixture.r2Objects)) await target.setR2(body, key);
    if (spec.setup) await target.exec(spec.setup);
    await target.recordForReplay(spec);
    const warm = await target.recordForReplay(spec);
    assert.equal(warm.status, 200);
    const first = await target.recordFirstRequest(spec, fixture);
    const second = await target.recordFirstRequest(spec, fixture);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(countClocks(warm), 3, "video-only parent uses the steady operation-mode cache");
    assert.equal(countClocks(first), 4, "fresh recorder retains every native first-request clock input");
    assert.equal(countClocks(second), 4, "creating a second recorder must not reuse the first module graph");
    assert.equal(first.coldRecorder.requestOrdinal, 1);
    assert.equal(second.coldRecorder.requestOrdinal, 1);
    assert.notEqual(first.coldRecorder.threadId, second.coldRecorder.threadId);
    assert.equal(target.requestOrdinal, 2, "cold recordings do not dispatch in the warmed parent");
    assert.deepEqual(first.d1PerQueryRows, second.d1PerQueryRows);
    assert.equal(first.d1, second.d1);
    await assert.rejects(target.recordFirstRequest({ ...spec, setup: [{ sql: "SELECT * FROM missing_fixture_table", params: [] }] }, fixture),
      /bench cold recorder failed:.*missing_fixture_table/);
    const recovered = await target.recordFirstRequest(spec, fixture);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.coldRecorder.requestOrdinal, 1, "failed setup terminates its context and releases the parent guard");
  } finally { await target.close(); }
});

test("MIG-0639: cold multipart recording preserves the exact wire headers/body used by workerd", async () => {
  const plan = { adminToken: "cold-multipart" };
  const scenario = buildScenarios(plan).find((candidate) => candidate.id === "SA-105");
  const target = await createInprocTarget(plan);
  try {
    const spec = scenario.kinds.normal(0, "cold-wire");
    const originalEntries = [...spec.body.entries()];
    const record = await target.recordFirstRequest(spec, scenario.prepareKind?.normal);
    assert.equal(record.status, 200, "the real cold Hono upload executes its authorization and writes");
    assert.equal(record.coldRecorder.requestOrdinal, 1);
    assert.ok(record.coldRequest.body instanceof Uint8Array);
    const headers = new Headers(record.coldRequest.headers);
    assert.match(headers.get("content-type"), /^multipart\/form-data; boundary=/);
    const wire = new Request("http://bench.local" + record.coldRequest.path, {
      method: record.coldRequest.method, headers, body: record.coldRequest.body,
    });
    const actualEntries = [...(await wire.formData()).entries()];
    assert.equal(actualEntries.length, originalEntries.length);
    for (let i = 0; i < originalEntries.length; i += 1) {
      const [name, original] = originalEntries[i];
      const [actualName, actual] = actualEntries[i];
      assert.equal(actualName, name);
      if (typeof original === "string") assert.equal(actual, original);
      else {
        assert.equal(actual.name, original.name);
        assert.equal(actual.type, original.type);
        assert.deepEqual(new Uint8Array(await actual.arrayBuffer()), new Uint8Array(await original.arrayBuffer()));
      }
    }
    assert.ok(record.script.some((entry) => entry.identity.includes("r2.put")));
    assert.ok(record.script.some((entry) => entry.identity.includes("input.randomUUID")));
  } finally { await target.close(); }
});

test("MIG-0639: cold worker retains module loaders but excludes parent eval/input-type flags", () => {
  const moduleUrl = new URL("./benchmark-api-cpu.mjs", import.meta.url).href;
  const preload = "data:text/javascript," + encodeURIComponent(`
    import { isMainThread, threadId } from "node:worker_threads";
    if (!isMainThread) console.log("BENCH_COLD_ARGV " + JSON.stringify({ threadId, args: process.execArgv }));
  `);
  const loaderArgs = ["--import", preload, "--conditions=flamenode-cold-regression", "--experimental-strip-types", "--enable-source-maps"];
  const program = `
    const { createInprocTarget } = await import(${JSON.stringify(moduleUrl)});
    const target = await createInprocTarget({ adminToken: "cold-cli-regression" });
    try {
      const result = await target.recordFirstRequest({ method: "GET", path: "/api/health", expect: [200] });
      console.log("BENCH_COLD_RESULT " + JSON.stringify({ status: result.status, recorder: result.coldRecorder }));
    } finally { await target.close(); }
  `;
  const child = spawnSync(process.execPath, [...loaderArgs, "--input-type=module", "--eval", program], {
    encoding: "utf8", timeout: 45_000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const line = (prefix) => JSON.parse(child.stdout.split(/\r?\n/).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? "null");
  const result = line("BENCH_COLD_RESULT ");
  const worker = line("BENCH_COLD_ARGV ");
  assert.equal(result?.status, 200, "the real fresh recorder must run when its parent uses --input-type=module");
  assert.equal(result?.recorder.requestOrdinal, 1);
  assert.equal(worker?.threadId, result.recorder.threadId, "the retained preload executes inside the actual recorder");
  assert.deepEqual(worker?.args, loaderArgs, "loader/runtime flags survive, while parent-only eval and input-type flags do not");
});

test("MIG-0639: cold wire preserves URLSearchParams, Blob, File and offset byte bodies and rejects streams", async () => {
  const plan = { adminToken: "cold-wire-body-kinds" };
  const scenario = buildScenarios(plan).find((candidate) => candidate.id === "SA-004");
  const base = scenario.kinds.normal(0, "wire-body-kinds");
  const jsonBody = JSON.stringify({ ...JSON.parse(base.body), title: "cold-wire-body 日本語" });
  const bytes = new TextEncoder().encode(jsonBody);
  const backing = new Uint8Array(bytes.length + 4);
  backing.fill(255);
  backing.set(bytes, 2);
  const params = new URLSearchParams([["title", "日本語 + space"], ["title", "duplicate"], ["body", "a&b"]]);
  const cases = [
    { name: "string", body: jsonBody, expected: bytes, type: "text/plain;charset=UTF-8", status: 200 },
    { name: "Blob", body: new Blob([bytes], { type: "application/json" }), expected: bytes, type: "application/json", status: 200 },
    { name: "File", body: new File([bytes], "fixture.json", { type: "application/json" }), expected: bytes, type: "application/json", status: 200 },
    { name: "ArrayBuffer", body: bytes.buffer, expected: bytes, type: null, status: 200 },
    { name: "offset Uint8Array", body: backing.subarray(2, 2 + bytes.length), expected: bytes, type: null, status: 200 },
    { name: "offset DataView", body: new DataView(backing.buffer, 2, bytes.length), expected: bytes, type: null, status: 200 },
    { name: "URLSearchParams", body: params, expected: new TextEncoder().encode(params.toString()), type: "application/x-www-form-urlencoded;charset=UTF-8", status: 400 },
    { name: "undefined", body: undefined, expected: undefined, type: null, status: 400 },
    { name: "null", body: null, expected: undefined, type: null, status: 400 },
  ];
  const headers = { ...base.headers };
  delete headers["content-type"];
  const target = await createInprocTarget(plan);
  try {
    for (const item of cases) {
      const result = await target.recordFirstRequest({ ...base, headers, body: item.body });
      assert.equal(result.status, item.status, item.name + " reaches the real JSON handler without changing its body");
      assert.equal(result.coldRecorder.requestOrdinal, 1);
      assert.deepEqual(result.coldRequest.body, item.expected, item.name + " keeps exactly its standard Request bytes");
      assert.equal(new Headers(result.coldRequest.headers).get("content-type"), item.type, item.name + " preserves the inferred content type");
      if (item.status === 200) assert.ok(result.script.some((entry) => entry.identity.includes("cold-wire-body 日本語")), item.name + " reaches actual D1 binds");
    }
    await assert.rejects(target.recordFirstRequest({ ...base, body: new ReadableStream() }), /duplex option is required/);
    const recovered = await target.recordFirstRequest(base);
    assert.equal(recovered.status, 200, "unsupported stream rejection releases the parent request guard");
    assert.equal(recovered.coldRecorder.requestOrdinal, 1);
    assert.equal(target.requestOrdinal, 0, "all successful recordings stay out of the parent app graph");
  } finally { await target.close(); }
});

test("MIG-0639: RH-013 cold recording restores all 500-video/50000-member fixtures after warm seeding", async () => {
  const plan = { adminToken: "cold-rh013-complete-fixture" };
  const scenario = buildScenarios(plan).find((candidate) => candidate.id === "RH-013");
  const target = await createInprocTarget(plan);
  const expectedRows = [1, 500, 0, 50_000, 0, 0, 0, 0];
  try {
    const initial = scenario.kinds.normal(0, "warm-initial");
    assert.equal(initial.setup.length, 3, "normal generation supplies its one-time event/video/member seed");
    await target.exec(initial.setup);
    const warm = await target.recordForReplay(initial);
    assert.equal(warm.status, 200);
    assert.deepEqual(warm.d1PerQueryRows, expectedRows);
    const afterWarm = scenario.kinds.normal(1, "after-warm");
    assert.deepEqual(afterWarm.setup, [], "the warm generator retains its seed-once behavior");
    const first = await target.recordFirstRequest(afterWarm, scenario.prepareKind?.normal);
    const afterFirstCold = scenario.kinds.normal(2, "after-first-cold");
    assert.deepEqual(afterFirstCold.setup, []);
    const second = await target.recordFirstRequest(afterFirstCold, scenario.prepareKind?.normal);
    for (const cold of [first, second]) {
      assert.equal(cold.status, 200, "each fresh application/DB must receive the complete scenario fixture after the parent is seeded");
      assert.equal(cold.d1, 8);
      assert.deepEqual(cold.d1PerQueryRows, expectedRows, "each cold must exercise 500 videos and 50,000 members, not an empty 404 path");
      assert.equal(cold.coldRecorder.requestOrdinal, 1);
    }
    assert.notEqual(first.coldRecorder.threadId, second.coldRecorder.threadId);
    assert.deepEqual(scenario.prepareKind.normal.coldSetup, initial.setup, "same SQL and counts, without a smaller cold workload");
    assert.deepEqual(scenario.prepareKind.limit.coldSetup, initial.setup, "explicit first-limit diagnostics also retain the complete fixture");
    assert.equal(first.coldRequest.path, afterWarm.path);
    assert.equal(second.coldRequest.path, afterFirstCold.path);
    assert.deepEqual(scenario.kinds.normal(3, "still-warm").setup, [], "cold recording never resets the parent seed flag");
  } finally { await target.close(); }
});

test("percentile uses nearest rank on an ascending array", () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(sorted, 50), 50);
  assert.equal(percentile(sorted, 95), 95);
  assert.equal(percentile(sorted, 99), 99);
  assert.equal(percentile(sorted, 100), 100);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([7], 99), 7);
});

test("summarize sorts, drops non-finite values and reports max", () => {
  const s = summarize([5, 1, Number.NaN, 3, undefined, 100]);
  assert.deepEqual(s, { n: 4, p50: 3, p95: 100, p99: 100, max: 100 });
  assert.deepEqual(summarize([]), { n: 0, p50: null, p95: null, p99: null, max: null });
});

test("MIG-0639: malformed per-request CPU cannot be admitted with 50 valid rows", () => {
  const ok = WARM_KINDS.flatMap(kind =>
    Array.from({length:MIN_SAMPLES}, () => ({kind,cpuMs:1,status:200})));
  const baseline = {id:"BASELINE",runtimeClass:"S2",samples:ok};
  for (const bad of [-1,Number.NaN,Number.POSITIVE_INFINITY,undefined]) {
    const samples = [...ok,{kind:"normal",cpuMs:bad,status:200}];
    const rows = [{id:"RH-020",runtimeClass:"S2",samples},baseline];
    applyBudgetVerdicts(rows,{resolutionMs:0});
    assert.equal(rows[0].agg.kinds.normal.n,MIN_SAMPLES);
    assert.equal(rows[0].agg.kinds.normal.invalidCpuSamples,1);
    assert.equal(rows[0].agg.kinds.normal.meetsMinSamples,false);
    assert.equal(rows[0].agg.verdict,"STOP_SAMPLES");
  }
  assert.equal(judge(-1,7),"NOT_MEASURED");
  assert.equal(judge(Number.NaN,7),"NOT_MEASURED");
  assert.equal(judge(1,7,{resolutionMs:-0.1}),"NOT_MEASURED");
  assert.equal(judge(1,7,{noiseMs:Number.NaN}),"NOT_MEASURED");
  assert.deepEqual(summarize([-1,Number.NaN,2]),{n:1,p50:2,p95:2,p99:2,max:2});
  const cold = Array.from({length:MIN_SAMPLES}, () => ({
    kind:"cold",cpuMs:1,status:200,isFirstIsolateRequest:true,
  }));
  const badCold = [...cold,{kind:"cold",cpuMs:Number.NaN,isFirstIsolateRequest:true}];
  const accepted = [
    {id:"RH-020",runtimeClass:"S2",samples:[...ok,...badCold]},
    {id:"BASELINE",runtimeClass:"S2",samples:[...ok,...cold]},
  ];
  applyBudgetVerdicts(accepted,{resolutionMs:0});
  const gate = enforceCpuMeasurementEnvironment(accepted,{
    mode:"wrangler",d1:"replay",platform:"linux",only:null,
    skipCold:false,coldSamples:MIN_SAMPLES,warmup:10,
  });
  assert.equal(gate.stopReason,"STOP_COLD",
    "even 50 certified cold observations cannot hide one malformed cold CPU row");
  assert.equal(accepted[0].agg.verdict,"STOP_COLD");
});

test("one heavy sample fails the budget even when p95 is far below it", () => {
  const samples = [
    ...Array.from({ length: 99 }, () => ({ kind: "normal", cpuMs: 1 })),
    { kind: "normal", cpuMs: 7.5 },
  ];
  const agg = aggregate(samples, { runtimeClass: "S2", resolutionMs: 0.1 });
  assert.equal(agg.kinds.normal.p95, 1);
  assert.equal(agg.kinds.normal.max, 7.5);
  assert.equal(agg.verdict, "FAIL");
});

test("judge: S2/S3 are strictly below the budget, S4 is at most", () => {
  assert.equal(judge(6.8, BUDGETS_MS.S2, { resolutionMs: 0.1 }), "PASS");
  assert.equal(judge(7, BUDGETS_MS.S2), "FAIL");
  assert.equal(judge(2, BUDGETS_MS.S4, { kind: "le" }), "PASS");
  assert.equal(judge(2.01, BUDGETS_MS.S4, { kind: "le" }), "FAIL");
  assert.equal(judge(null, BUDGETS_MS.S3), "NOT_MEASURED");
});

test("judge: clock resolution blocks a PASS that could really be over budget", () => {
  // integer-ms clock: a reported 6 may be 6.99, and 6 + 1 is not below 7
  assert.equal(judge(6, 7, { resolutionMs: 1 }), "INCONCLUSIVE");
  assert.equal(judge(5, 7, { resolutionMs: 1 }), "PASS");
});

test("judge: noise floor can excuse an over-budget reading but never a PASS", () => {
  assert.equal(judge(9, 7, { noiseMs: 5 }), "INCONCLUSIVE");
  assert.equal(judge(9, 7, { noiseMs: 1 }), "FAIL");
  assert.equal(judge(3, 7, { noiseMs: 5 }), "PASS");
});

test("MIG-0639: Node proxy, non-Linux, sim, partial and cold-skip never report formal CPU PASS", () => {
  const warm = WARM_KINDS.flatMap((kind) =>
    Array.from({length: MIN_SAMPLES}, () => ({kind, cpuMs: 0.5, status: 200})));
  // This fixture supplies hypothetical first-request evidence; it is not
  // evidence that an actual local or deployed measurement passed.
  const cold = Array.from({length: MIN_SAMPLES}, () => ({
    kind:"cold", cpuMs: 10, status: 200, isFirstIsolateRequest: true,
  }));
  const getResults = () => [
    {id:"RH-020", runtimeClass:"S2", samples:[...warm,...cold]},
    {id:"BASELINE", runtimeClass:"S2", samples:[...warm,...cold]},
  ];
  const accepted = {mode:"wrangler", d1:"replay", platform:"linux", only:null,
    skipCold:false, coldSamples:MIN_SAMPLES, warmup:10};
  const matrix = [
    [{...accepted, mode:"inproc"}, "STOP_PROXY"],
    [{...accepted, platform:"win32"}, "STOP_PLATFORM"],
    [{...accepted, d1:"sim"}, "STOP_D1_SIM"],
    [{...accepted, only:["RH-020"]}, "STOP_PARTIAL"],
    [{...accepted, skipCold:true}, "STOP_COLD"],
    [{...accepted, coldSamples:49}, "STOP_COLD"],
    [{...accepted, warmup:0}, "STOP_WARMUP"],
  ];
  for (const [opts, reason] of matrix) {
    const rows = getResults();
    applyBudgetVerdicts(rows, {resolutionMs:0});
    assert.equal(rows[0].agg.verdict,"PASS","control samples pass warm math");
    const gate = enforceCpuMeasurementEnvironment(rows, opts);
    assert.deepEqual(gate,{eligible:false,stopReason:reason});
    assert.equal(rows[0].agg.verdict,reason);
    assert.equal(rows[1].agg.verdict,"NOISE_FLOOR");
  }
  const full = getResults();
  applyBudgetVerdicts(full, {resolutionMs:0});
  assert.deepEqual(enforceCpuMeasurementEnvironment(full,accepted),
    {eligible:true,stopReason:null});
  assert.equal(full[0].agg.verdict,"PASS");
  // A qualifying platform flag alone cannot hide missing or anomalous cold
  // samples. Remove a REAL cold observation and re-aggregate: mutating only
  // agg.kinds.cold.n would leave the new meetsMinSamples gate unchanged.
  const removedColdAt = full[0].samples.findIndex((sample) => sample.kind === "cold");
  assert.ok(removedColdAt >= 0);
  full[0].samples.splice(removedColdAt, 1);
  applyBudgetVerdicts(full, {resolutionMs:0});
  assert.equal(full[0].agg.kinds.cold.n,MIN_SAMPLES-1);
  assert.equal(full[0].agg.kinds.cold.meetsMinSamples,false);
  assert.equal(full[0].agg.kinds.cold.verifiedIsolateStarts,MIN_SAMPLES-1);
  assert.deepEqual(enforceCpuMeasurementEnvironment(full,accepted),
    {eligible:false,stopReason:"STOP_COLD"});
  assert.equal(full[0].agg.verdict,"STOP_COLD");
  const baselineFail=getResults();
  baselineFail[1].samples=WARM_KINDS.flatMap((kind) =>
    Array.from({length:MIN_SAMPLES},()=>({kind,cpuMs:4,status:200}))).concat(cold);
  applyBudgetVerdicts(baselineFail,{resolutionMs:0});
  enforceCpuMeasurementEnvironment(baselineFail,{...accepted,mode:"inproc"});
  assert.equal(baselineFail[0].agg.verdict,"STOP_BASELINE","preserve stricter baseline STOP");
});

test("MIG-0639 RH-013: scheduled/realtime warm maximum is budgeted and both modes are required", () => {
  const rows = (ms, kind) => Array.from({ length: MIN_SAMPLES },
    () => ({ kind, cpuMs: ms, status: 200 }));
  const baseline = WARM_KINDS.flatMap(kind => rows(1,kind)).concat(rows(300,"cold"));
  const standard = WARM_KINDS.flatMap(kind => rows(2,kind));
  const extra = [
    ...rows(12,"scheduled-warm"), ...rows(3,"realtime-warm"), ...rows(400,"cold"),
  ];
  const mk = (samples) => [
    {id:"RH-013",runtimeClass:"S2",expectedWarmKinds:["scheduled-warm","realtime-warm"],samples},
    {id:"BASELINE",runtimeClass:"S2",samples:baseline},
  ];
  const full = mk([...standard,...extra]);
  const gate = applyBudgetVerdicts(full,{resolutionMs:0});
  assert.equal(gate.noiseFloorMs,1,"cold 300ms cannot contaminate warm baseline");
  assert.equal(full[0].agg.overallMax,12,"scheduled-warm over budget must enter warm maximum");
  assert.equal(full[0].agg.coldMax,400,"cold remains separately diagnostic");
  assert.equal(full[0].agg.verdict,"FAIL","12ms-1ms warm noise exceeds S2 <7ms");
  assert.equal(full[0].agg.kinds["realtime-warm"].n,MIN_SAMPLES);
  assert.match(renderMarkdown(full,{digits:1,label:"RH-013 test"}),/\| RH-013.*\| 12\.0 \| 400\.0 \| FAIL \|/);
  const missing = mk([...standard,...rows(12,"scheduled-warm"),...rows(400,"cold")]);
  applyBudgetVerdicts(missing,{resolutionMs:0});
  assert.equal(missing[0].agg.verdict,"STOP_SAMPLES",
    "a missing named warm mode must not yield PASS/FAIL acceptance");
  const incomplete = mk([...standard,...rows(2,"scheduled-warm").slice(1),...rows(2,"realtime-warm")]);
  applyBudgetVerdicts(incomplete,{resolutionMs:0});
  assert.equal(incomplete[0].agg.verdict,"STOP_SAMPLES",
    "49 valid special-warm samples cannot qualify");
  const anomalous = mk([...standard,...rows(2,"scheduled-warm"),
    ...rows(2,"realtime-warm").map((sample,i) => ({...sample,unexpected:i===0}))]);
  applyBudgetVerdicts(anomalous,{resolutionMs:0});
  assert.equal(anomalous[0].agg.verdict,"STOP_SAMPLES",
    "unexpected cache/body-reuse semantics block acceptance");
});

test("MIG-0639: invalid V8 profiler calibration must never generate CPU PASS", () => {
  const fixture = (idle,light,heavy) => [
    {route:"burn",iters:0,profilerBusyMs:idle},
    {route:"burn",iters:2_000_000,profilerBusyMs:light},
    {route:"burn",iters:20_000_000,profilerBusyMs:heavy},
  ];
  assert.deepEqual(validateCpuProfilerCalibration(fixture(0.2,20,240)),
    {idleMs:0.2,lightMs:20,heavyMs:240});
  for (const rows of [
    fixture(0,0,0), // an attached inspector returning no samples
    fixture(0,0,200), // a broken 2M sampling step
    fixture(0,9,9), // the 10x larger burn does not scale
    fixture(0,2,9), // profiler cannot reliably resolve even 10ms
    fixture(150,20,160), // heavy CPU indistinguishable from idle noise
    fixture(0,NaN,200),
    fixture(0,2,Infinity),
    fixture(0,2,-1),
    fixture(0,20,40), // strict 2× lower bound
    [],
  ]) {
    assert.throws(() => validateCpuProfilerCalibration(rows),
      /CPU profiler calibration failed/, "unreliable profiler must abort benchmark");
  }
});

test("MIG-0639: post-reload local probes cannot masquerade as isolate-first cold", async () => {
  const scenarios = [
    { id:"A", kinds: { normal: () => ({ method:"GET",path:"/a",expect:[200] }) } },
    { id:"B", kinds: { normal: () => ({ method:"GET",path:"/b",expect:[200] }) } },
  ];
  let reloads = 0, probes = 0;
  const target = {
    setR2: async () => {},
    exec: async () => {},
    record: async () => null,
    reload: async () => { reloads++; },
    run: async () => { probes++; return {status:200,cpuMs:1,d1:0,bytes:2}; },
  };
  const cold = await runCold(target,scenarios,{coldSamples:MIN_SAMPLES});
  assert.equal(reloads,2*MIN_SAMPLES,"each diagnostic request has its own reload");
  assert.equal(probes,2*MIN_SAMPLES);
  for (const route of scenarios) {
    const samples = cold.get(route.id);
    assert.equal(samples.length,MIN_SAMPLES);
    assert.ok(samples.every(r=>r.isFirstIsolateRequest===false),
      "ping/script warm-up and shared isolates prevent genuine first-call provenance");
  }
  const warm = WARM_KINDS.flatMap(kind => Array.from({length:MIN_SAMPLES},
    () => ({kind,cpuMs:1,status:200})));
  const rows = [
    {id:"A",runtimeClass:"S2",samples:[...warm,...cold.get("A")]},
    {id:"BASELINE",runtimeClass:"S2",samples:[
      ...warm,...cold.get("B")]},
  ];
  applyBudgetVerdicts(rows,{resolutionMs:0});
  assert.equal(rows[0].agg.kinds.cold.n,MIN_SAMPLES);
  assert.equal(rows[0].agg.kinds.cold.verifiedIsolateStarts,0);
  const opts={mode:"wrangler",d1:"replay",platform:"linux",coldSamples:MIN_SAMPLES,
    warmup:10,skipCold:false,only:null};
  const gate=enforceCpuMeasurementEnvironment(rows,opts);
  assert.deepEqual(gate,{eligible:false,stopReason:"STOP_COLD"});
  assert.equal(rows[0].agg.verdict,"STOP_COLD");
});

test("MIG-0639: generated cold worker seeds replay before its first fetch and counts harness requests", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const coldScript = [{
    identity: replayIdentity(["d1.first", "SELECT", [], []]),
    result: { id: "cold-result" },
  }];
  const make = (generation) => loadReplayWorker(generation, coldScript,
    'return Response.json(await env.DB.prepare("SELECT").first());');
  try {
    const fresh = await make("fresh-first");
    assert.deepEqual(globalThis.__flamenodeBenchIdentity, { build: "fresh-first", requests: 0 });
    const response = await fresh.fetch(new Request("http://bench.local/probe", {
      headers: { "x-bench-script": "cold" },
    }), {}, {});
    assert.deepEqual(await response.json(), { id: "cold-result" });
    assert.equal(response.headers.get("x-bench-build"), "fresh-first");
    assert.equal(response.headers.get("x-bench-request"), "1");
    assert.equal(response.headers.get("x-bench-replay-complete"), "1");
    assert.equal(response.headers.get("x-bench-d1"), "1");
    assert.equal(response.headers.get("x-bench-returned-rows"), "1");
    assert.equal(response.headers.get("x-bench-query-rows"), "1");
    const warmed = await make("warmed-by-ping");
    await warmed.fetch(new Request("http://bench.local/__bench/ping"), {}, {});
    const afterPing = await warmed.fetch(new Request("http://bench.local/probe", {
      headers: { "x-bench-script": "cold" },
    }), {}, {});
    assert.equal(afterPing.headers.get("x-bench-request"), "2", "a setup request invalidates cold provenance");
    assert.equal(afterPing.headers.get("x-bench-replay-complete"), "1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
  }
});

test("MIG-0639: cold runner uses the isolated recorder fixture and identical serialized request", async () => {
  const fixture = { r2Objects: { "selected.json": "selected fixture" } };
  const spec = { method: "POST", path: "/cold", expect: [200], setup: [{ sql: "fixture SQL", params: [] }], body: "input", clearCache: true };
  const coldRequest = { ...spec, body: new Uint8Array([105, 110, 112, 117, 116]), headers: [["content-type", "text/plain;charset=UTF-8"]] };
  const record = { script: [], coldRequest, coldRecorder: { threadId: 123, requestOrdinal: 1 } };
  let cacheCleared = 0;
  const unexpected = async () => { throw new Error("warmed recorder/setup must not serve a cold replay"); };
  const inproc = { exec: unexpected, setR2: unexpected, recordForReplay: unexpected,
    recordFirstRequest: async (actualSpec, actualFixture) => {
      assert.equal(cacheCleared, 1, "persistent Cache API data is cleared through the previous worker before recording");
      assert.equal(actualSpec, spec);
      assert.equal(actualFixture, fixture);
      return record;
    }, close: async () => {},
  };
  const wr = { cpuSource: "local D1/R2 SIMULATOR CPU INCLUDED (--d1 sim)", close: async () => {}, clearCache: async () => { cacheCleared += 1; },
    runFirstRequest: async (actualSpec, actualRecord) => {
      assert.equal(actualSpec, coldRequest);
      assert.equal(actualRecord, record);
      return { status: 200, cpuMs: 1, bytes: 2, isFirstIsolateRequest: true, requestOrdinal: 1 };
    },
  };
  const samples = await runCold(createReplayTarget(inproc, wr), [{ id: "fixture", prepareKind: { normal: fixture }, kinds: { normal: () => spec } }], { coldSamples: 1 });
  const result = samples.get("fixture")[0];
  assert.equal(result.unexpected, false);
  assert.deepEqual(result.coldRecorder, record.coldRecorder);
  assert.deepEqual(aggregate([result], { runtimeClass: "S2", resolutionMs: 0.1 }).kinds.cold.coldStarts[0].recorder, record.coldRecorder);
});

test("MIG-0639: replay target preserves live workerd CPU profiler quantum", async () => {
  let quantumMs = 0.1;
  let closedWr = false;
  let closedInproc = false;
  const wr = {
    name: "wrangler",
    get resolutionMs() { return quantumMs; },
    cpuSource: "V8 profiler local D1/R2 SIMULATOR CPU INCLUDED (--d1 sim)",
    close: async () => { closedWr = true; },
    run: async () => ({ cpuMs: 6 }),
  };
  const inproc = {
    exec: async () => {},
    setR2: async () => {},
    recordForReplay: async () => ({ script: [] }),
    close: async () => { closedInproc = true; },
  };
  const replay = createReplayTarget(inproc, wr);
  assert.equal(replay.resolutionMs, 0.1, "startup resolution is the initial quantum");
  assert.match(replay.cpuSource, /--d1 replay/);
  quantumMs = 2.5; // Later requests reveal a coarse 2.5ms sampler tick.
  assert.equal(replay.resolutionMs, 2.5, "spread must not freeze the getter at 0.1ms");
  assert.equal(judge(6, 7, { resolutionMs: replay.resolutionMs }), "INCONCLUSIVE",
    "6ms with 2.5ms uncertainty cannot claim a strict <7ms S2 PASS");
  const warm = (ms) => WARM_KINDS.flatMap(kind =>
    Array.from({ length: MIN_SAMPLES }, () => ({ kind, cpuMs: ms, status: 200 })));
  const samples = [
    { id: "RH-020", runtimeClass: "S2", samples: warm(2) },
    { id: "BASELINE", runtimeClass: "S2", samples: warm(2) },
  ];
  const gate = applyBudgetVerdicts(samples, { resolutionMs: replay.resolutionMs });
  assert.equal(gate.baselineUpperBoundMs, 4.5);
  assert.equal(gate.quietBaseline, false, "baseline 2+2.5 cannot prove strict <4ms");
  assert.equal(samples[0].agg.verdict, "STOP_BASELINE");
  await replay.close();
  assert.equal(closedWr, true);
  assert.equal(closedInproc, true);
});

test("MIG-0639: strict quiet BASELINE includes profiler sampling resolution", () => {
  const warm = (ms) => WARM_KINDS.flatMap(kind =>
    Array.from({length:MIN_SAMPLES}, () => ({kind,cpuMs:ms,status:200})));
  const run = (baselineMs) => [
    {id:"RH-020",runtimeClass:"S2",samples:warm(2)},
    {id:"BASELINE",runtimeClass:"S2",samples:warm(baselineMs)},
  ];
  const atBoundary = run(3.5);
  const gate = applyBudgetVerdicts(atBoundary,{resolutionMs:0.5});
  assert.equal(gate.noiseFloorMs,3.5);
  assert.equal(gate.baselineUpperBoundMs,4);
  assert.equal(gate.quietBaseline,false,"3.5+0.5 equals 4ms: cannot prove <4");
  assert.equal(atBoundary[0].agg.verdict,"STOP_BASELINE");
  const safe = run(3.4);
  const accepted = applyBudgetVerdicts(safe,{resolutionMs:0.5});
  assert.ok(Math.abs(accepted.baselineUpperBoundMs-3.9)<1e-9);
  assert.equal(accepted.quietBaseline,true);
  assert.equal(safe[0].agg.verdict,"PASS");
  const invalid = run(1);
  const rejected = applyBudgetVerdicts(invalid,{resolutionMs:Number.NaN});
  assert.equal(rejected.baselineUpperBoundMs,null);
  assert.equal(rejected.quietBaseline,false);
  assert.equal(invalid[0].agg.verdict,"STOP_BASELINE");
});

test("Issue #732: cold baseline never masks a warm over-budget failure", () => {
  const warm = (ms) => WARM_KINDS.flatMap((kind) =>
    Array.from({ length: MIN_SAMPLES }, () => ({ kind, cpuMs: ms, status: 200 })));
  const baseline = [...warm(1), ...Array.from({ length: MIN_SAMPLES }, () => ({
    kind: "cold", cpuMs: 80, status: 200,
  }))];
  const routeWarm = warm(12);
  const routeCold = [...routeWarm, ...Array.from({ length: MIN_SAMPLES }, () => ({
    kind: "cold", cpuMs: 2, status: 200,
  }))];
  const withCold = [
    { id: "S2-ROUTE", runtimeClass: "S2", samples: routeCold },
    { id: "BASELINE", runtimeClass: "S2", samples: baseline },
  ];
  const withoutCold = [
    { id: "S2-ROUTE", runtimeClass: "S2", samples: routeWarm },
    { id: "BASELINE", runtimeClass: "S2", samples: warm(1) },
  ];
  const a = applyBudgetVerdicts(withCold, { resolutionMs: 0 });
  const b = applyBudgetVerdicts(withoutCold, { resolutionMs: 0 });
  assert.equal(QUIET_BASELINE_MAX_MS, 4);
  assert.deepEqual([a.noiseFloorMs, a.baselineColdMaxMs, a.quietBaseline], [1, 80, true]);
  assert.deepEqual([b.noiseFloorMs, b.baselineColdMaxMs, b.quietBaseline], [1, null, true]);
  assert.equal(withCold[0].agg.overallMax, 12);
  assert.equal(withCold[0].agg.coldMax, 2);
  assert.equal(withCold[0].agg.noiseMs, 1);
  assert.equal(withCold[0].agg.verdict, "FAIL", "12 - warm noise 1 >= S2 budget 7");
  assert.equal(withoutCold[0].agg.verdict, "FAIL", "--skip-cold must not change warm verdict");
  assert.equal(withCold[1].agg.verdict, "NOISE_FLOOR");
  assert.equal(judge(12, 7, { noiseMs: 80 }), "INCONCLUSIVE",
    "reproduce the former masked failure with cold-inclusive noise");
});

test("Issue #732: cold CPU has no role in warm pass or strict quiet-host STOP", () => {
  const warm = (ms) => WARM_KINDS.flatMap((kind) =>
    Array.from({ length: MIN_SAMPLES }, () => ({ kind, cpuMs: ms, status: 200 })));
  const ready = [
    { id: "S2-ROUTE", runtimeClass: "S2", samples: [...warm(2), { kind: "cold", cpuMs: 1000 }] },
    { id: "BASELINE", runtimeClass: "S2", samples: [...warm(1), { kind: "cold", cpuMs: 80 }] },
  ];
  applyBudgetVerdicts(ready, { resolutionMs: 0 });
  assert.equal(ready[0].agg.verdict, "PASS", "high cold CPU must not fail warm budget");
  assert.equal(ready[0].agg.overallMax, 2);
  assert.equal(ready[0].agg.coldMax, 1000);
  const badBaseline = [
    { id: "S2-ROUTE", runtimeClass: "S2", samples: warm(2) },
    { id: "BASELINE", runtimeClass: "S2", samples: warm(4) },
  ];
  const blocked = applyBudgetVerdicts(badBaseline, { resolutionMs: 0 });
  assert.equal(blocked.quietBaseline, false, "warm baseline must be strictly below 4ms");
  assert.equal(badBaseline[0].agg.verdict, "STOP_BASELINE");
  const insufficient = [
    { id: "S2-ROUTE", runtimeClass: "S2", samples: warm(2).slice(0, 2) },
    { id: "BASELINE", runtimeClass: "S2", samples: warm(1) },
  ];
  applyBudgetVerdicts(insufficient, { resolutionMs: 0 });
  assert.equal(insufficient[0].agg.verdict, "STOP_SAMPLES", "each warm kind requires 50 samples");
});

test("aggregate reports per-kind stats, sample-count adequacy and unexpected statuses", () => {
  const samples = [];
  for (const kind of ["normal", "limit", "invalid"]) {
    for (let i = 0; i < MIN_SAMPLES; i += 1) samples.push({ kind, cpuMs: i / 10, status: 200, bytes: 10 + i, d1: 3 });
  }
  samples.push({ kind: "cold", cpuMs: 4, status: 500, bytes: 5, d1: 1, unexpected: true });
  const agg = aggregate(samples, { runtimeClass: "S3", resolutionMs: 0.1 });
  assert.deepEqual(Object.keys(agg.kinds), [...KINDS]);
  assert.equal(agg.kinds.normal.meetsMinSamples, true);
  assert.equal(agg.kinds.cold.meetsMinSamples, false);
  assert.equal(agg.kinds.cold.unexpectedStatus, 1);
  assert.equal(agg.kinds.normal.maxBytes, 10 + MIN_SAMPLES - 1);
  assert.equal(agg.overallMax, 4.9);
  assert.equal(agg.budgetMs, 8);
  assert.equal(agg.verdict, "PASS");
});

test("aggregation is deterministic: same samples, same bytes", () => {
  const samples = Array.from({ length: 60 }, (_, i) => ({ kind: "normal", cpuMs: (i * 37) % 11, status: 200, bytes: 1, d1: 1 }));
  const a = JSON.stringify(aggregate(samples, { runtimeClass: "S2", resolutionMs: 1 }));
  const b = JSON.stringify(aggregate([...samples].reverse(), { runtimeClass: "S2", resolutionMs: 1 }));
  assert.equal(a, b);
});

test("parseArgs defaults to wrangler/replay with >= 50 samples and rejects junk", () => {
  const o = parseArgs([]);
  assert.equal(o.mode, "wrangler");
  assert.equal(o.d1, "replay");
  assert.ok(o.samples >= MIN_SAMPLES && o.coldSamples >= MIN_SAMPLES);
  assert.equal(parseArgs(["--mode", "inproc", "--samples", "60"]).samples, 60);
  assert.throws(() => parseArgs(["--mode", "remote"]), /--mode/);
  assert.throws(() => parseArgs(["--remote"]), /Unsupported/);
  assert.throws(() => parseArgs(["--samples", "-1"]), /non-negative/);
  assert.throws(() => parseArgs(["--d1"]), /requires a value/);
});

test("scenarios cover the measurable endpoints, three request kinds each, with expected statuses", () => {
  const scenarios = buildScenarios({ adminToken: "t" });
  const ids = scenarios.filter((s) => !s.baseline).map((s) => s.id);
  assert.deepEqual(
    ids.slice(0, 14),
    ["RH-018", "RH-017", "RH-026", "RH-029", "SA-004", "SA-005", "SA-006", "SA-007", "SA-008", "RH-013", "RH-020", "RH-021", "RH-022", "S4"],
  );
  assert.equal(scenarios.at(-1).id, "BASELINE", "BASELINE stays last so its noise floor is read from the same run");
  assert.equal(new Set(ids).size, ids.length, "scenario ids are unique");
  for (const sc of scenarios) {
    assert.deepEqual(Object.keys(sc.kinds), ["normal", "limit", "invalid"], sc.id);
    for (const kind of Object.keys(sc.kinds)) {
      const spec = sc.kinds[kind](1, "tag");
      assert.ok(Array.isArray(spec.expect) && spec.expect.length > 0, `${sc.id}/${kind} has expected statuses`);
      assert.ok(spec.path.startsWith("/"), `${sc.id}/${kind} path`);
    }
    assert.ok(sc.runtimeClass in BUDGETS_MS);
  }
});

// The authoritative list of main Hono methods, generated from `app.routes` (OPTIONS included) when MIG-0639
// was built. A route added to apps/api/src/app.ts that is in neither this list nor a named scenario fails the
// live check below (it compares against app.routes), so a method cannot be silently left out of the CPU table.
const MAIN_HONO_METHODS = new Set([
  "GET /api/health", "GET /api/health/deep", "GET /api/operation-mode/banner", "GET /api/public/about-stats",
  "OPTIONS /api/public/events/:id/staff", "GET /api/public/events/:id/staff", "GET /api/software/suggestions",
  "POST /api/personal/terms/accept", "POST /api/personal/onboarding/terms", "POST /api/personal/onboarding/complete",
  "GET /api/personal/session", "GET /api/personal/dashboard", "GET /api/personal/library", "GET /api/personal/settings",
  "GET /api/personal/onboarding", "GET /api/personal/entry", "GET /api/personal/entry/slotted", "GET /api/personal/entry/unslotted",
  "GET /api/personal/edit/:id/permissions", "GET /api/personal/edit/:id/form-options", "GET /api/personal/edit/:id",
  "GET /api/admin-read/cost-guard-banner", "GET /api/admin-read/users/:id/edit", "GET /api/admin-read/users", "GET /api/admin-read/users/:id",
  "GET /api/admin-read/videos", "GET /api/admin-read/videos/:id/members", "GET /api/admin-read/videos/:id",
  "GET /api/admin-read/event-groups", "GET /api/admin-read/event-groups/:id", "GET /api/admin-read/events/templates",
  "GET /api/admin-read/events/new", "GET /api/admin-read/events", "GET /api/admin-read/moderation", "GET /api/admin-read/x-link-requests",
  "GET /api/admin-read/x-id-merges", "GET /api/admin-read/announcements", "GET /api/admin-read/announcements/:id",
  "GET /api/admin-read/rules", "GET /api/admin-read/rules/:id", "GET /api/admin-read/permissions/simulator", "GET /api/admin-read/api-endpoints",
  "GET /api/admin-read/audit-settings", "GET /api/admin-read/audit", "GET /api/admin-read/audit/restore", "GET /api/admin-read/audit/:id",
  "GET /api/admin-read/audit/:id/payload/:field", "GET /api/admin-read/ops/notifications", "GET /api/admin-read/ops/health",
  "GET /api/admin-read/ops/integrity", "GET /api/admin-read/ops/static-builds", "GET /api/admin-read/ops/workers", "GET /api/admin-read/ops/security",
  "GET /api/admin-read/ops/youtube-playlists", "GET /api/admin-read/ops/youtube-quota", "GET /api/admin-read/ops/top",
  "GET /api/admin-read/ops/cost-guard", "GET /api/admin-read/ops/youtube-sync", "GET /api/manage/navigation",
  "POST /api/manage/events/:id/owner-transfer",
  "POST /api/manage/events/:id/staff/csv",
  "POST /api/manage/events/:id/staff",
  "PUT /api/manage/events/:id/staff/:staffId",
  "DELETE /api/manage/events/:id/staff/:staffId",
  "GET /api/manage/events/:id/staff", "GET /api/manage/events/:id/slots", "GET /api/manage/events/:id/edit",
  "GET /api/manage/events/:id/videos/:videoId", "GET /api/manage/events/:id/videos", "GET /api/manage/events/:id/youtube-playlist",
  "POST /api/manage/events/:id/youtube-playlist/sync", "PUT /api/manage/events/:id/youtube-playlist", "GET /api/manage/events/:id/audience",
  "GET /api/manage/events/:id", "GET /api/manage/notifications", "GET /api/manage/x-link-requests", "GET /api/manage",
  "GET /api/admin/event-groups/event-options", "POST /api/admin/event-groups",
  "PATCH /api/admin/event-groups/:id", "DELETE /api/admin/event-groups/:id",
  "DELETE /api/admin/event-groups/:id/events/:eventId", "POST /api/admin/event-groups/:id/events",
  "POST /api/xid/active", "PATCH /api/xid/:xUserId/profile", "DELETE /api/xid/:xUserId",
  "PUT /api/xid/:xUserId/icon", "POST /api/xid/:xUserId/icon/upload",
  "POST /api/xid/requests", "POST /api/xid/requests/:id/cancel", "POST /api/xid/merge-revert-requests",
  "PUT /api/admin/permissions/editable-fields", "POST /api/admin/terms",
  "PATCH /api/admin/terms/:id", "POST /api/admin/terms/:id/publish",
  "POST /api/admin/terms/:id/reaccept-broadcast", "POST /api/admin/terms/:id/archive",
  "POST /api/admin/notifications/retry-failed", "POST /api/admin/notifications/:id/retry",
  "POST /api/admin/notifications/:id/cancel", "POST /api/admin/notifications/:id/force-resend",
  "POST /api/admin/static-builds/backfill",
  "POST /api/admin/static-builds/queue/:queueId/retry",
  "POST /api/admin/static-builds/retry-failed",
  "POST /api/admin/static-builds/rebuild",
  "POST /api/admin/static-builds/shared-inputs/rebuild",
  "POST /api/admin/visibility-repair",
  "POST /api/admin/youtube-sync/videos/:videoId/resync",
  "GET /api/admin/spreadsheet/data", "GET /api/admin/spreadsheet/export", "GET /api/admin/spreadsheet/tables", "GET /api/admin/event-templates",
  "POST /api/admin/announcements", "PUT /api/admin/announcements/:id", "DELETE /api/admin/announcements/:id",
  "POST /api/admin/api-endpoints", "PATCH /api/admin/api-endpoints/:id", "POST /api/admin/audit/settings", "POST /api/admin/audit/dry-run",
  "POST /api/admin/cost-guard/mode", "POST /api/admin/cost-guard/maintenance", "POST /api/admin/cost-guard/override",
  "POST /api/admin/cost-guard/disabled-features", "POST /api/admin/cost-guard/override/clear",
  "POST /api/admin/users/:userId/role", "POST /api/admin/users/:userId/banned", "POST /api/admin/users/:userId/notifications",
  "POST /api/admin/users/:userId/can-create-events", "POST /api/admin/x-users/:xUserId/icon-refresh",
  "POST /api/admin/event-templates", "DELETE /api/admin/event-templates/:id",
  "GET /api/live/events/:id/slots", "GET /api/live/events/:id/submissions", "GET /api/live/events/:id/summary",
  "GET /api/events/:id/slots/viewer-overlay", "GET /api/events", "GET /api/event-endpoints/:id", "GET /api/event-endpoints/:id/release",
  "GET /api/videos", "GET /api/videos/:id/viewer-overlay", "GET /api/videos/:id",
  "POST /api/videos/:videoId/chapters", "POST /api/videos/:videoId/chapters/bulk", "PUT /api/videos/chapters/:chapterId",
  "DELETE /api/videos/chapters/:chapterId", "POST /api/videos/:videoId/interaction", "GET /api/account/summary",
  "GET /api/google-drive-image/:id", "GET /api/youtube-thumbnail/:id/:size", "GET /api/media/manage-x-icon/*",
  "GET /api/media/slot-submission-icon/:slotId", "GET /api/media/*", "GET /api/internal/x-users/search",
]);

test("RH-013 cache clear targets the exact server-core public event-export Cache API URLs", () => {
  const urls = eventExportCacheRequestUrls();
  assert.equal(urls.length, 8, "both formats × all four supported refresh intervals");
  assert.ok(urls.includes("https://flamenode.internal/public-json/public-event-export%3A9%3Abench-export-event%3Av5%3A15"));
  assert.ok(urls.includes("https://flamenode.internal/public-json/public-event-export%3A9%3Abench-export-event%3Alegacy%3A1440"));
  assert.equal(new Set(urls).size, 8);
  assert.ok(urls.every((url) => url.startsWith("https://flamenode.internal/public-json/")));
  assert.equal(eventExportCacheRequestUrls("event / 1").length, 8, "event IDs are encoded before cache-key encoding");
});

test("MIG-0639 SEC-575: RH-013 exposes distinct scheduled and realtime warm-cache scenarios", () => {
  const rh013 = buildScenarios({ adminToken: "t" }).find((scenario) => scenario.id === "RH-013");
  assert.ok(rh013);
  assert.deepEqual(Object.keys(rh013.warmModes), ["scheduled-warm", "realtime-warm"]);
  assert.match(rh013.warmModes["scheduled-warm"].path, /update=scheduled/);
  assert.match(rh013.warmModes["realtime-warm"].path, /update=realtime/);
  assert.equal(rh013.warmModes["scheduled-warm"].expectCache, "HIT");
  assert.equal(rh013.warmModes["realtime-warm"].expectCache, "BYPASS");
  assert.equal(rh013.warmModes["scheduled-warm"].verifyBodyReuse, true);
  assert.equal(rh013.warmModes["realtime-warm"].verifyBodyReuse, true);
  assert.ok(rh013.warmModes["scheduled-warm"].path.includes("refresh=15"));
});

test("MIG-0639 T01: every main Hono method has exactly one scenario (named or inventory)", () => {
  const scenarios = buildScenarios({ adminToken: "t" }).filter((s) => !s.baseline && s.id !== "S4");
  const titles = scenarios.map((s) => s.title.replace(/ \(.*\)$/, ""));
  assert.equal(new Set(titles).size, titles.length, "no method has two scenarios");
  assert.deepEqual([...MAIN_HONO_METHODS].filter((m) => !titles.includes(m)), [], "methods without a scenario");
  assert.deepEqual(titles.filter((t) => !MAIN_HONO_METHODS.has(t)), [], "scenarios for methods that are not mounted");
  assert.equal(MAIN_HONO_METHODS.size, 153);
});

test("MIG-0639 T01: the method list equals the routes mounted in apps/api/src/app.ts", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const mounted = new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`));
  assert.deepEqual([...MAIN_HONO_METHODS].filter((m) => !mounted.has(m)), [], "listed but no longer mounted");
  assert.deepEqual([...mounted].filter((m) => !MAIN_HONO_METHODS.has(m)), [], "mounted but not benchmarked (add a scenario)");
});

test("MIG-0639: 11 newly mounted SA-025..030/098/102..105 routes have genuine bounded fixtures", async () => {
  const scenarios = new Map(buildScenarios({ adminToken: "bench" }).map(s => [s.id, s]));
  const ids = ["SA-025","SA-026","SA-027","SA-028","SA-029","SA-030","SA-098","SA-102","SA-103","SA-104","SA-105"];
  for (const id of ids) {
    const s = scenarios.get(id);
    assert.ok(s, id + " missing");
    assert.deepEqual(Object.keys(s.kinds), ["normal","limit","invalid"], id);
    assert.equal(s.kinds.normal(0,"qa").expect[0], 200, id);
  }
  const created = scenarios.get("SA-026").kinds.normal(0,"qa");
  assert.equal(JSON.parse(created.body).visibility_status,"private");
  assert.equal(JSON.parse(scenarios.get("SA-026").kinds.limit(0,"qa").body).name.length,120);
  assert.equal(JSON.parse(scenarios.get("SA-029").kinds.limit(0,"qa").body).eventIds.length,80);
  assert.equal(scenarios.get("SA-030").kinds.normal(0,"qa").setup.length,2);
  assert.equal(scenarios.get("SA-025").kinds.normal(0,"qa").path.includes("groupId=bench-group"),true);
  assert.equal(JSON.parse(scenarios.get("SA-102").kinds.limit(0,"qa").body).profile_text.length,2000);
  for(const id of ["SA-102","SA-103","SA-104","SA-105"]) {
    const s=scenarios.get(id).kinds.normal(0,"qa");
    assert.match(s.path,/\/api\/xid\/bench_x/);
    assert.ok(s.setup.some(row=>row.sql.includes("x_user_account_links")),id+" must seed real linked X");
  }
  const upload=scenarios.get("SA-105").kinds.normal(0,"qa");
  assert.ok(upload.body instanceof FormData);
  assert.equal(upload.headers["content-type"],undefined);
  assert.equal(upload.body.get("x_user_id"),"bench_x");
  assert.ok(upload.body.get("icon_file") instanceof File);
  assert.ok(upload.body.get("icon_file").size >= 100, "valid 64x64 PNG fixture, not the 1x1 media stub");
  assert.equal(scenarios.get("SA-105").kinds.invalid(0,"qa").expect[0],400);
});

// Exercise the REAL mounted Hono handlers against migrated SQLite and an isolated
// per-route DB. A mere inventory declaration or known HTTP denial is NOT CPU evidence.
for (const id of ["SA-025","SA-026","SA-027","SA-028","SA-029","SA-030",
                  "SA-098","SA-102","SA-103","SA-104","SA-105"]) {
  test(`MIG-0639 ${id}: genuine handler normal/limit/invalid responses on local migrated D1`, async () => {
    const scenario = buildScenarios({adminToken:"benchmark"}).find(s => s.id === id);
    assert.ok(scenario);
    const target = await createInprocTarget({adminToken:"benchmark"});
    try {
      for (const kind of ["normal","limit","invalid"]) {
        const spec = scenario.kinds[kind](1, `smoke_${id}_${kind}`);
        if (spec.setup) await target.exec(spec.setup);
        const actual = await target.run(spec);
        assert.ok(spec.expect.includes(actual.status),
          `${id}/${kind}: real handler HTTP ${actual.status}, expected ${JSON.stringify(spec.expect)}`);
      }
    } finally {
      await target.close();
    }
  });
}

test("MIG-0639 SA-045..048, SA-049, SA-051..055, SA-099..101: all newly mounted write routes have seeded local probes", () => {
  const scenarios = new Map(buildScenarios({ adminToken: "t" }).map((s) => [s.id, s]));
  const ids = ["SA-045", "SA-046", "SA-047", "SA-048", "SA-049", "SA-051", "SA-052", "SA-053", "SA-054", "SA-055", "SA-099", "SA-100", "SA-101"];
  for (const id of ids) {
    const scenario = scenarios.get(id);
    assert.ok(scenario, id + " missing");
    assert.deepEqual(Object.keys(scenario.kinds), ["normal", "limit", "invalid"]);
    assert.ok(scenario.kinds.normal(1, "safe").path.startsWith("/api/"));
    assert.deepEqual(scenario.kinds.normal(1, "safe").expect, [200]);
  }
  for (const id of ["SA-045", "SA-046", "SA-047", "SA-048"]) {
    const normal = scenarios.get(id).kinds.normal(1, "safe");
    assert.equal(normal.setup.length, 1);
    assert.match(normal.setup[0].sql, /notification_outbox/);
  }
  assert.equal(JSON.parse(scenarios.get("SA-046").kinds.limit(1, "safe").body).reason.length, 500);
  const retryBulk = scenarios.get("SA-048").kinds.limit(1, "safe");
  assert.equal(retryBulk.setup.length, 10, "SA-048 limit must seed BULK_RETRY_MAX failures");
  assert.equal(new Set(retryBulk.setup.map((row) => row.params[0])).size, 10, "bulk retry rows must have unique IDs");

  for (const id of ["SA-052", "SA-053", "SA-054", "SA-055"]) {
    const normal = scenarios.get(id).kinds.normal(1, "safe");
    assert.ok(normal.setup.some((row) => /terms_versions/.test(row.sql)), id + " needs a terms fixture");
    if (id === "SA-054") assert.equal(normal.setup.length, 2, "published major version and actor acceptance");
  }
  assert.equal(JSON.parse(scenarios.get("SA-054").kinds.normal(1, "safe").body).confirm, "TERMS");
  const createTermsLimit = JSON.parse(scenarios.get("SA-051").kinds.limit(1, "safe").body);
  const updateTermsLimit = JSON.parse(scenarios.get("SA-052").kinds.limit(1, "safe").body);
  assert.equal(createTermsLimit.version_label.length, 80, "terms version max per draftSchema");
  assert.equal(createTermsLimit.body_markdown.length, 40000, "terms markdown max per draftSchema");
  assert.equal(updateTermsLimit.version_label.length, 80);
  assert.equal(updateTermsLimit.body_markdown.length, 40000);
  assert.equal(JSON.parse(scenarios.get("SA-054").kinds.limit(1, "safe").body).content.length, 1000, "reaccept broadcast content cap");
  const xRequestLimit = JSON.parse(scenarios.get("SA-099").kinds.limit(1, "safe").body).x_id;
  const xRequestNormal = JSON.parse(scenarios.get("SA-099").kinds.normal(1, "safe").body).x_id;
  assert.match(xRequestLimit, /^[a-z0-9_]{20}$/i, "SA-099 limit must reach the accepted 20-character X handle boundary");
  assert.ok(xRequestNormal.length < 20, "SA-099 normal case must be distinguishable from limit");
  assert.notEqual(xRequestLimit, JSON.parse(scenarios.get("SA-099").kinds.limit(2, "safe").body).x_id, "each sample must use its own handle");

  for (const id of ["SA-100", "SA-101"]) {
    assert.ok(scenarios.get(id).kinds.normal(1, "safe").setup.some((row) => /x_identity_requests/.test(row.sql)), id + " needs a request fixture");
  }
  assert.equal(JSON.parse(scenarios.get("SA-101").kinds.normal(1, "safe").body).parent_request_id, "bench-xreq-safe-1");
});


test("MIG-0639 mounted SA-031..034 and MIG-0643 writes have real bounded D1 probes", () => {
  const scenarios = new Map(buildScenarios({ adminToken:"t" }).map(s=>[s.id,s]));
  const ids = ["SA-034","SA-032","SA-031-CREATE","SA-031-UPDATE","SA-033","SA-069","SA-070","SA-073","SA-071","SA-072","SA-050","SA-106"];
  for (const id of ids) {
    const s=scenarios.get(id);
    assert.ok(s, id+" missing");
    assert.deepEqual(Object.keys(s.kinds),["normal","limit","invalid"]);
    assert.equal(s.kinds.normal(1,"qa").expect[0],200,id);
    assert.equal(s.kinds.limit(1,"qa").expect[0],200,id);
  }
  for(const id of ["SA-034","SA-032","SA-031-CREATE","SA-031-UPDATE","SA-033","SA-070","SA-073","SA-050"]) {
    assert.ok(scenarios.get(id).kinds.normal(1,"qa").setup?.length,id+" needs real D1 fixture");
  }
  const csvSeed=scenarios.get("SA-032").kinds.normal(1,"qa").setup;
  assert.ok(csvSeed.some(row=>/event_staff/.test(row.sql) && row.params.includes("owner")), "CSV must retain an operable event owner");
  assert.ok(csvSeed.some(row=>/x_user_account_links/.test(row.sql)), "CSV owner must have an approved owner link");
  assert.ok(csvSeed.some(row=>row.params.includes("bst_csv_owner")), "CSV owner must not reuse transfer scenario X subject");
  assert.ok(scenarios.get("SA-071").kinds.normal(1,"qa").setup.some(row=>/DELETE FROM static_rebuild_queue/.test(row.sql)), "rebuild samples must not become queue no-ops");
  assert.ok(scenarios.get("SA-072").kinds.normal(1,"qa").setup.some(row=>/DELETE FROM static_rebuild_queue/.test(row.sql)), "shared rebuild samples must not become queue no-ops");
  assert.ok(scenarios.get("SA-106").kinds.normal(1,"qa").setup.some(row=>/DELETE FROM video_youtube_metadata/.test(row.sql)), "resync samples must not degrade into already_pending");
  assert.equal(JSON.parse(scenarios.get("SA-071").kinds.limit(1,"qa").body).reason.length,500);
  assert.equal(JSON.parse(scenarios.get("SA-031-CREATE").kinds.limit(1,"qa").body).display_name.length,80);
  assert.equal(scenarios.get("SA-073").kinds.invalid(1,"qa").headers.origin,"https://evil.invalid");
  assert.equal(scenarios.get("SA-072").kinds.invalid(1,"qa").headers.origin,"https://evil.invalid");
});

test("MIG-0639: migrated SQLite accepts the new staff and failed-queue fixture rows", async () => {
  const db=await migratedDb();
  try {
    run(db,SEED("t"));
    const scenarios=new Map(buildScenarios({adminToken:"t"}).map(s=>[s.id,s]));
    for(const id of ["SA-034","SA-032","SA-031-CREATE","SA-031-UPDATE","SA-033","SA-070","SA-073"]) {
      assert.doesNotThrow(()=>run(db,scenarios.get(id).kinds.normal(2,"qa").setup),id);
    }
    assert.ok(count(db,"SELECT COUNT(*) AS n FROM event_staff WHERE event_id='bench-evt'")>=2);
    assert.ok(count(db,"SELECT COUNT(*) AS n FROM static_rebuild_queue WHERE status='failed'")>=1);
  } finally { db.close(); }
});

test("MIG-0639: inventory specs are well formed (session, origin, JSON body, fail-closed invalid kind)", () => {
  const byId = new Map(ROUTE_INVENTORY.map((r) => [r[0], r]));
  assert.equal(byId.size, ROUTE_INVENTORY.length, "inventory ids are unique");
  let checked = 0;
  for (const sc of buildScenarios({ adminToken: "t" })) {
    const row = byId.get(sc.id);
    if (!row) continue;
    checked += 1;
    const [, method, pattern, access] = row;
    for (const kind of ["normal", "limit", "invalid"]) {
      const spec = sc.kinds[kind](2, "tg");
      assert.equal(spec.method, method, `${sc.id}/${kind}`);
      assert.ok(!spec.path.includes(":") && !spec.path.includes("*"), `${sc.id}/${kind} path placeholders are filled: ${spec.path}`);
      assert.ok(spec.headers["cf-connecting-ip"], `${sc.id}/${kind} has a distinct client key (public rate limiters)`);
      if (access === "w") {
        assert.equal(spec.headers.origin, kind === "invalid" && row[4]?.invalidOrigin ? "https://evil.invalid" : "https://bench.flamenode.invalid", `${sc.id}/${kind} sends the configured origin`);
        assert.ok(spec.headers.cookie, `${sc.id}/${kind} carries a session`);
        if (spec.body instanceof FormData) {
          // The Request must supply a matching multipart boundary itself.
          assert.equal(spec.headers["content-type"], undefined, `${sc.id}/${kind}: never hardcode a multipart boundary`);
          assert.equal(spec.body.get("x_user_id"), "bench_x", `${sc.id}/${kind}: genuine linked-X upload`);
          assert.ok(spec.body.get("icon_file") instanceof File, `${sc.id}/${kind}: real file part`);
        } else {
          assert.equal(spec.headers["content-type"], "application/json");
          if (spec.body !== undefined) JSON.parse(spec.body);
        }
      }
      if (access === "s" || access === "a") {
        assert.equal(Boolean(spec.headers.cookie), kind !== "invalid", `${sc.id}/${kind} session only on normal/limit`);
      }
      if (access === "p") {
        const viewer = Boolean(row[4]?.session) && kind !== "invalid";
        assert.equal(Boolean(spec.headers.cookie), viewer, `${sc.id}/${kind} is anonymous unless it is a viewer-overlay with a session`);
      }
    }
    if (access === "p" && pattern.includes(":id")) {
      assert.equal(sc.kinds.invalid(0, "t").path.split("?")[0].split("/").some((seg) => seg.length === 129), true, `${sc.id} invalid uses a 129-char id`);
    }
  }
  assert.equal(checked, ROUTE_INVENTORY.length);
});

test("MIG-0639: upper-bound fixtures are really at the documented bounds", () => {
  const sc = Object.fromEntries(buildScenarios({ adminToken: "t" }).map((s) => [s.id, s]));
  // RH-012 (MIG-0631 T17): 500 videos x 100 members per EVENT_RELEASE_MAX_*.
  const normal = JSON.parse(sc["RH-012"].prepareKind.normal.r2Objects["events/bench-evt/release.v1.json"]);
  const limit = JSON.parse(sc["RH-012"].prepareKind.limit.r2Objects["events/bench-evt/release.v1.json"]);
  assert.equal(normal.videos.length, 1);
  assert.equal(limit.videos.length, 500);
  assert.ok(limit.videos.every((v) => v.members.length === 100));
  assert.equal(limit.total, 500);
  // public staff cap 100 (PUBLIC_EVENT_STAFF_MAX_ITEMS)
  assert.equal(JSON.parse(sc["RH-028"].prepareKind.limit.r2Objects["events/bench-evt/base.v1.json"]).public_staff.length, 100);
  // spreadsheet: more rows than the 50-row page / 99-row export caps
  assert.match(sc["RH-003"].kinds.limit(0, "t").setup[0].sql, /n < 60/);
  assert.match(sc["RH-007"].kinds.limit(0, "t").setup[0].sql, /n < 120/);
  assert.equal(sc["RH-003"].kinds.normal(0, "t").setup, undefined);
  // audit payload: a 24,000-char column read as the second 12,000-char chunk
  assert.match(sc["HONO-AR-26"].kinds.limit(0, "t").path, /\?offset=12000$/);
  // chapter bulk: MAX_CHAPTER_BULK_ROWS = 8 rows
  assert.equal(JSON.parse(sc["SA-015"].kinds.limit(0, "t").body).csv.split("\n").length, 8);
});

test("MIG-0639: template normal/limit fixtures and exact response checks survive warm resets and cold recording", async () => {
  const plan = { adminToken: "template-fixtures" };
  const scenarios = buildScenarios(plan).filter(sc => ["HONO-AR-10", "HONO-AR-11"].includes(sc.id));
  assert.equal(scenarios.length, 2);
  const target = await createInprocTarget(plan);
  const headers = new Headers({ "cache-control": "private, no-store", "content-type": "application/json; charset=UTF-8" });
  try {
    for (const sc of scenarios) {
      for (const kind of ["normal", "limit", "normal"]) {
        const spec = sc.kinds[kind](0, "template");
        assert.ok(spec.setup && spec.expectTemplates);
        // A prior benchmark write with a higher timestamp must not survive.
        await target.exec([{ sql: "INSERT OR REPLACE INTO event_templates (id,name,settings_json,created_by_user_id,created_at,updated_at) VALUES ('poison-template','poison','{}','bench-admin',10,9000000000)", params: [] }]);
        await target.exec(spec.setup);
        const expected = spec.expectTemplates;
        const count = kind === "limit" ? 100 : 1;
        assert.equal(expected.templates.length, count);
        assert.equal(spec.setup[1].params[0], kind === "limit" ? 101 : 1);
        assert.equal(expected.templates[0].id, "bench-ar-template-001");
        assert.equal(expected.templates.at(-1).id, kind === "limit" ? "bench-ar-template-100" : "bench-ar-template-001");
        if (kind === "limit") {
          assert.ok(expected.templates.every(row => row.name.length === 120 && row.description.length === 500));
        }
        if (sc.id === "HONO-AR-11") {
          assert.equal(new URL(spec.path, "http://bench.local").searchParams.get("template"), expected.templateId);
          assert.equal(Buffer.byteLength(expected.templateSettingsJson), kind === "limit" ? 65536 : 7);
        } else {
          assert.equal(spec.path, "/api/admin-read/events/templates");
          assert.equal(Object.hasOwn(expected, "templateSettingsJson"), false);
        }
        const rows = [1, 1, count];
        const result = await target.run(spec);
        assert.equal(result.status, 200);
        assert.equal(result.responseBodyMismatch, false, sc.id + "/" + kind);
        assert.equal(result.bytes, Buffer.byteLength(JSON.stringify(expected)));
        assert.equal(result.d1, 3);
        assert.deepEqual(result.d1PerQueryRows, rows);
        const rec = await target.recordForReplay(spec);
        assert.equal(rec.status, 200);
        assert.equal(rec.responseBodyMismatch, false);
        assert.deepEqual(rec.d1PerQueryRows, rows);
        const cold = await target.recordFirstRequest(spec, sc.prepareKind?.[kind]);
        assert.equal(cold.status, 200);
        assert.equal(cold.responseBodyMismatch, false);
        assert.deepEqual(cold.d1PerQueryRows, rows);
        assert.equal(cold.coldRecorder.requestOrdinal, 1);
        const body = JSON.stringify(expected);
        assert.equal(templateResponseMismatch(spec, body, headers, 3, rows), false);
        for (const wrong of [{ ...expected, guardOk: false }, { ...expected, templates: [] }, { ...expected, templates: [...expected.templates, expected.templates[0]] }]) {
          assert.equal(templateResponseMismatch(spec, JSON.stringify(wrong), headers, 3, rows), true);
        }
        assert.equal(templateResponseMismatch(spec, body, new Headers(), 3, rows), true);
        assert.equal(templateResponseMismatch(spec, body, headers, 2, rows), true);
        assert.equal(templateResponseMismatch(spec, body, headers, 3, [1, 1, 0]), true);
        if (sc.id === "HONO-AR-11") assert.equal(templateResponseMismatch(spec, JSON.stringify({ ...expected, templateSettingsJson: null }), headers, 3, rows), true);
      }
      const invalid = sc.kinds.invalid(0, "template");
      assert.equal(invalid.setup, undefined);
      assert.equal(invalid.expectTemplates, undefined);
      assert.equal(invalid.headers.cookie, undefined);
      assert.equal((await target.run(invalid)).status, 401);
    }
  } finally { await target.close(); }
});

test("MIG-0639: template body/row evidence is mandatory even for successful warm and cold HTTP responses", async () => {
  const sc = buildScenarios({ adminToken: "t" }).find(sc => sc.id === "HONO-AR-11");
  const result = { status: 200, cpuMs: 1, bytes: 2, d1: 3 };
  const target = { exec: async () => {}, record: async () => null, run: async spec => spec.expectTemplates ? result : { status: 401, cpuMs: 1, bytes: 2, d1: 0 }, reload: async () => {} };
  for (const check of [undefined, true, false]) {
    result.responseBodyMismatch = check;
    const warm = await runScenario(target, sc, { warmup: 0, samples: 1 }, { tagSeq: 0 });
    assert.deepEqual(warm.map(sample => sample.unexpected), [check !== false, check !== false, false]);
    const cold = await runCold(target, [sc], { coldSamples: 1 });
    assert.equal(cold.get(sc.id)[0].unexpected, check !== false);
  }
});

test("MIG-0639: per-sample fixtures never reuse an id (DELETE scenarios would turn into 404 otherwise)", () => {
  const sc = Object.fromEntries(buildScenarios({ adminToken: "t" }).map((s) => [s.id, s]));
  for (const id of ["SA-036", "SA-014"]) {
    const a = sc[id].kinds.normal(1, "k1");
    const b = sc[id].kinds.normal(2, "k1");
    const c = sc[id].kinds.normal(1, "k2");
    assert.notEqual(a.path, b.path);
    assert.notEqual(a.path, c.path);
    assert.equal(a.setup.length, 1);
    assert.equal(sc[id].kinds.invalid(1, "k1").setup, undefined, "invalid DELETE must not seed the row it deletes");
  }
});

test("exact-limit specs really sit on the validation limits (title 200, body 8000, event_id 128, 64KiB)", () => {
  const sc = Object.fromEntries(buildScenarios({ adminToken: "t" }).map((s) => [s.id, s]));
  const ann = JSON.parse(sc["SA-004"].kinds.limit(0, "t").body);
  assert.equal(ann.title.length, 200);
  assert.equal(ann.body.length, 8000);
  const ep = JSON.parse(sc["SA-007"].kinds.limit(3, "tag").body);
  assert.equal(ep.event_id.length, 128);
  const stats = sc["RH-026"].prepareKind.limit.r2;
  assert.equal(Buffer.byteLength(stats), 64 * 1024);
  assert.equal(JSON.parse(stats).schema_version, 1);
});

test("markdown rendering is stable and labels the verdict basis", () => {
  const samples = Array.from({ length: 50 }, () => ({ kind: "normal", cpuMs: 1, status: 200, bytes: 9, d1: 2 }));
  const results = [{ id: "X", title: "t", runtimeClass: "S2", agg: aggregate(samples, { runtimeClass: "S2", resolutionMs: 0.1 }) }];
  const a = renderMarkdown(results, { digits: 2, label: "unit test" });
  assert.equal(a, renderMarkdown(results, { digits: 2, label: "unit test" }));
  assert.match(a, /Warm-only budget verdict by max \(unit test\)/);
  assert.match(a, /\| scenario \| class \| budget \| warm max \(ms\) \| cold max \(ms\) \| verdict \|/);
  assert.match(a, /\| X t \| S2 \| normal \| 50 \|/);
});


test("MIG-0639: RH-020/022 seed 6000 slots and prevent cached-event reuse", () => {
  const byId = Object.fromEntries(buildScenarios({ adminToken: "t" }).map((s) => [s.id, s]));
  for (const [id, suffix] of [["RH-020", "slots"], ["RH-022", "summary"]]) {
    const scenario = byId[id];
    assert.equal(scenario.runtimeClass, "S2");
    const normal = scenario.kinds.normal(1, "k1");
    const limit = scenario.kinds.limit(1, "k1");
    assert.equal(limit.method, "GET");
    assert.equal(limit.path, "/api/live/events/live-" + suffix + "-k1-1/" + suffix);
    assert.notEqual(limit.path, scenario.kinds.limit(2, "k1").path);
    assert.notEqual(limit.path, scenario.kinds.limit(1, "k2").path);
    assert.ok(normal.setup[1].sql.includes("n < 1"), "normal fixture has one slot");
    assert.ok(limit.setup[1].sql.includes("n < 6000"), "limit fixture has exactly 6000 slots");
    assert.deepEqual(limit.setup[1].params, [limit.path.split("/")[4], limit.path.split("/")[4]]);
    assert.deepEqual(limit.expect, [200]);
    const invalid = scenario.kinds.invalid(0, "ki");
    assert.equal(invalid.method, "GET");
    assert.equal(invalid.expect[0], 400);
    assert.equal(invalid.path.split("/")[4].length, 129);
    assert.equal(invalid.setup, undefined, "invalid requests must not seed rows");
  }
});

test("MIG-0639: RH-021 limit seeds 50 public videos and 50 event memberships", () => {
  const s = buildScenarios({ adminToken: "t" }).find((x) => x.id === "RH-021");
  const limit = s.kinds.limit(3, "tag");
  assert.equal(limit.path, "/api/live/events/live-submissions-tag-3/submissions");
  assert.equal(limit.setup.length, 3);
  assert.match(limit.setup[1].sql, /n < 50/);
  assert.match(limit.setup[1].sql, /INSERT INTO videos/);
  assert.match(limit.setup[2].sql, /n < 50/);
  assert.match(limit.setup[2].sql, /INSERT INTO video_events/);
  assert.ok(limit.setup[1].sql.includes("'public'"), "fixture videos must be visible");
  assert.deepEqual(limit.expect, [200]);
  assert.equal(s.kinds.invalid(0, "t").expect[0], 400);
});


// Runs every fixture SQL against the REAL schema (the repo migrations, materialized exactly like the harness does),
// not hand-written tables, so a column/NOT NULL/CHECK drift in a migration fails here instead of at measurement time.
async function migratedDb() {
  const mig = await materializeD1CompatibleMigrations(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"));
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync(mig.outputDir).filter((n) => n.endsWith(".sql")).sort()) db.exec(fs.readFileSync(path.join(mig.outputDir, f), "utf8"));
  fs.rmSync(mig.workspace, { recursive: true, force: true });
  return db;
}
const run = (db, steps) => { for (const step of steps) db.prepare(step.sql).run(...step.params); };
const count = (db, sql, ...p) => db.prepare(sql).get(...p).n;

test("MIG-0639: boundary fixture SQL executes on the migrated D1 schema and seeds exact row counts", async () => {
  const db = await migratedDb();
  try {
    run(db, SEED("t"));
    const scenarios = Object.fromEntries(buildScenarios({ adminToken: "t" }).map((x) => [x.id, x]));
    for (const id of ["RH-020", "RH-021", "RH-022"]) run(db, scenarios[id].kinds.limit(0, "sqlite").setup);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM slots WHERE event_id = ?", "live-slots-sqlite-0"), 6000);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM slots WHERE event_id = ?", "live-summary-sqlite-0"), 6000);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM videos WHERE id LIKE 'live-submissions-sqlite-0-v-%'"), 50);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM video_events WHERE event_id = ?", "live-submissions-sqlite-0"), 50);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM videos WHERE id LIKE 'live-submissions-sqlite-0-v-%' AND visibility_status = 'public'"), 50);
    // spreadsheet max page / export fixtures
    run(db, scenarios["RH-007"].kinds.limit(0, "x").setup);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM events WHERE id LIKE 'sp-%'"), 120);
    run(db, scenarios["RH-007"].kinds.limit(1, "y").setup);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM events WHERE id LIKE 'sp-%'"), 120, "spreadsheet rows are idempotent (no table growth per sample)");
  } finally {
    db.close();
  }
});

test("MIG-0639: shared fixtures and per-sample setup rows insert on the migrated schema", async () => {
  const db = await migratedDb();
  try {
    run(db, SEED("t"));
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE id = 'bench-audit' AND length(before_json) > 24000"), 1, "audit payload is two chunks");
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM \"user\" WHERE id = 'bench-admin' AND active_x_user_id = 'bench-x'"), 1);
    const scenarios = Object.fromEntries(buildScenarios({ adminToken: "t" }).map((x) => [x.id, x]));
    for (const id of ["SA-036", "SA-014", "SA-019"]) run(db, scenarios[id].kinds.normal(3, "z").setup);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM event_templates WHERE id = 'tpl-z-3'"), 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM video_chapters WHERE id = 'ch-z-3'"), 1);
  } finally {
    db.close();
  }
});

test("MIG-0639 SA-045..055 and SA-100..101: each local write fixture executes on migrated D1 schema", async () => {
  const db = await migratedDb();
  try {
    run(db, SEED("t"));
    const scenarios = new Map(buildScenarios({ adminToken: "t" }).map((sc) => [sc.id, sc]));
    const fixtureIds = ["SA-045", "SA-046", "SA-047", "SA-048", "SA-052", "SA-053", "SA-054", "SA-055", "SA-100", "SA-101"];
    for (const id of fixtureIds) {
      const spec = scenarios.get(id).kinds.normal(2, "sqlite");
      assert.ok(spec.setup?.length, id + " must have a local seed");
      assert.doesNotThrow(() => run(db, spec.setup), id + " fixture must match migrated schema");
    }
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM notification_outbox WHERE id='bench-notif-sqlite-2'"), 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM terms_versions WHERE id='bench-terms-sqlite-2'"), 1);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM x_identity_requests WHERE id='bench-xreq-sqlite-2'"), 1);
  } finally {
    db.close();
  }
});

test("MIG-0639: new write scenarios return their declared normal status on local Hono + migrated D1", async () => {
  const scenarios = new Map(buildScenarios({ adminToken: "t" }).map((sc) => [sc.id, sc]));
  const ids = ["SA-045", "SA-046", "SA-047", "SA-048", "SA-049", "SA-051", "SA-052", "SA-053", "SA-054", "SA-055", "SA-099", "SA-100", "SA-101"];
  const failures = [];
  for (const id of ids) {
    const target = await createInprocTarget({ adminToken: "t" });
    try {
      const spec = scenarios.get(id).kinds.normal(7, "smoke" + id);
      if (spec.setup) await target.exec(spec.setup);
      const result = await target.run(spec);
      if (!spec.expect.includes(result.status)) failures.push(id + ": expected " + spec.expect.join("/") + " but got " + result.status);
    } catch (error) {
      failures.push(id + ": " + (error instanceof Error ? error.message : String(error)));
    } finally {
      await target.close();
    }
  }
  assert.deepEqual(failures, [], "all mounted write benchmarks must follow actual route behavior");
});

test("MIG-0639: all 13 new write routes reject invalid inputs with their declared local Hono statuses", async () => {
  const scenarios = new Map(buildScenarios({ adminToken: "t" }).map((sc) => [sc.id, sc]));
  const ids = ["SA-045", "SA-046", "SA-047", "SA-048", "SA-049", "SA-051", "SA-052", "SA-053", "SA-054", "SA-055", "SA-099", "SA-100", "SA-101"];
  const failures = [];
  for (const id of ids) {
    const target = await createInprocTarget({ adminToken: "t" });
    try {
      const spec = scenarios.get(id).kinds.invalid(8, "bad" + id);
      assert.equal(spec.setup, undefined, id + " invalid request must not seed a legitimate target");
      const result = await target.run(spec);
      if (!spec.expect.includes(result.status)) failures.push(id + ": expected " + spec.expect.join("/") + ", got " + result.status);
    } catch (error) {
      failures.push(id + ": " + (error instanceof Error ? error.message : String(error)));
    } finally {
      await target.close();
    }
  }
  assert.deepEqual(failures, [], "every invalid write scenario must exercise a real Hono rejection outcome");
});

test("MIG-0639: 13 newly mounted write routes respect declared limit-case responses", async () => {
  const scenarios = new Map(buildScenarios({ adminToken: "t" }).map((sc) => [sc.id, sc]));
  const ids = ["SA-045", "SA-046", "SA-047", "SA-048", "SA-049", "SA-051", "SA-052", "SA-053", "SA-054", "SA-055", "SA-099", "SA-100", "SA-101"];
  const failures = [];
  for (const id of ids) {
    const target = await createInprocTarget({ adminToken: "t" });
    try {
      const spec = scenarios.get(id).kinds.limit(9, "limit" + id);
      if (spec.setup) await target.exec(spec.setup);
      const result = await target.run(spec);
      if (!spec.expect.includes(result.status)) failures.push(id + ": expected " + spec.expect.join("/") + ", got " + result.status);
    } catch (error) {
      failures.push(id + ": " + (error instanceof Error ? error.message : String(error)));
    } finally {
      await target.close();
    }
  }
  assert.deepEqual(failures, [], "limit-case CPU probes must actually exercise accepted bounded inputs");
});


// These smoke tests exercise actual local Hono handlers on the migrated D1
// database, rather than treating 401/403 guard-only responses as CPU evidence.
test("MIG-0639: all 12 MIG-0654/MIG-0643 write routes execute normal and boundary probes", async () => {
  const scenarios=new Map(buildScenarios({adminToken:"t"}).map(s=>[s.id,s]));
  const ids=["SA-034","SA-032","SA-031-CREATE","SA-031-UPDATE","SA-033","SA-069","SA-070","SA-073","SA-071","SA-072","SA-050","SA-106"];
  const failures=[];
  for(const id of ids) for(const kind of ["normal","limit","invalid"]) {
    const target=await createInprocTarget({adminToken:"t"});
    try {
      const spec=scenarios.get(id).kinds[kind](7,"smoke"+id);
      if(spec.setup) await target.exec(spec.setup);
      const r=await target.run(spec);
      if(!spec.expect.includes(r.status)) failures.push(id+"/"+kind+": expected "+spec.expect.join("/")+" got "+r.status);
    } catch(e) { failures.push(id+"/"+kind+": "+String(e)); }
    finally { await target.close(); }
  }
  assert.deepEqual(failures,[]);
});

test("MIG-0639 / PR #457: mounted RH-013 has one bounded named scenario, never a duplicate pending entry", async () => {
  const scenarios = buildScenarios({ adminToken: "t" });
  const rh13 = scenarios.filter((x) => x.id === "RH-013");
  assert.equal(rh13.length, 1, "exactly one mounted RH-013 scenario");
  assert.equal(rh13[0].pending, undefined);
  assert.equal(scenarios.at(-1).id, "BASELINE");
  assert.match(rh13[0].kinds.limit(0, "test").path, /format=legacy&update=scheduled&refresh=1440/, "the mounted upper-bound probe is a scheduled legacy export");
  assert.match(rh13[0].kinds.normal(0, "test").path, /format=v5&update=scheduled&refresh=15/);
  // RH-013 intentionally seeds its 50,000 member rows once per process. Earlier tests
  // may consume that one-time setup; assert its source contract, not a stale setup array.
  const source = fs.readFileSync(fileURLToPath(new URL("./benchmark-api-cpu.mjs", import.meta.url)), "utf8");
  assert.match(source, /const RH013_VIDEOS = 500;/);
  assert.match(source, /const RH013_MEMBERS_PER_VIDEO = 100;/);
  assert.match(source, /params: \[RH013_VIDEOS - 1, RH013_EVENT_ID\]/);
  assert.match(source, /params: \[Math\.max\(RH013_VIDEOS, RH013_MEMBERS_PER_VIDEO\) - 1, RH013_VIDEOS, RH013_MEMBERS_PER_VIDEO\]/);
  assert.equal(buildPendingScenarios().length, 0);
  assert.equal(buildScenarios({ adminToken: "t" }, { includePending: true }).filter((x) => x.id === "RH-013").length, 1);
  assert.equal(parseArgs(["--include-pending"]).includePending, true);
  assert.equal(parseArgs([]).includePending, false);
  const { app } = await import("../apps/api/src/app.ts");
  assert.equal(app.routes.some((r) => r.method === "GET" && r.path === "/api/event-endpoints/:id"), true,
    "RH-013 must remain mounted before its CPU scenario is eligible");
});

test("MIG-0639: repeated X-ID and terms write scenarios stay isolated on one shared migrated DB", async () => {
  const scenarios = new Map(buildScenarios({ adminToken: "t" }).map((s) => [s.id, s]));
  const target = await createInprocTarget({ adminToken: "t" });
  const failures = [];
  try {
    // Run >5 samples per kind (past X_ID_PENDING_REQUEST_LIMIT=5) in one shared target
    // and ensure SA-053/SA-054 never poison subsequent writes with 403 tos_reaccept_required.
    for (const id of ["SA-099", "SA-100", "SA-101", "SA-052", "SA-053", "SA-054", "SA-055", "SA-048"]) {
      const sc = scenarios.get(id);
      for (const kind of ["normal", "limit", "invalid"]) {
        for (let i = 0; i < 6; i += 1) {
          const spec = sc.kinds[kind](i, `multi-${id}-${kind}`);
          if (spec.setup) await target.exec(spec.setup);
          const r = await target.run(spec);
          if (!spec.expect.includes(r.status)) {
            failures.push(`${id}/${kind}#${i}: expected ${spec.expect.join("/")} got ${r.status}`);
          }
        }
      }
    }
    // Re-running SA-053 after SA-054 simulates the rotated cold-round order.
    const coldTerms = scenarios.get("SA-053").kinds.normal(0, "cold-after-054");
    await target.exec(coldTerms.setup);
    const coldRes = await target.run(coldTerms);
    if (!coldTerms.expect.includes(coldRes.status)) {
      failures.push(`SA-053/cold-after-054: expected ${coldTerms.expect.join("/")} got ${coldRes.status}`);
    }
  } finally {
    await target.close();
  }
  assert.deepEqual(failures, []);
});


test("MIG-0639: typed replay identity distinguishes SQL, bind types, methods, batch order and R2 bytes/options", () => {
  const identity = replayIdentity;
  assert.equal(identity(["d1.first", "SELECT ?", [1], []]), identity(["d1.first", "SELECT ?", [1], []]));
  assert.notEqual(identity(["d1.first", "SELECT ?", [1], []]), identity(["d1.first", "SELECT ?", ["1"], []]));
  assert.notEqual(identity(["d1.first", "SELECT ?", [1], []]), identity(["d1.all", "SELECT ?", [1], []]));
  assert.notEqual(identity(["d1.first", "SELECT 1", [], []]), identity(["d1.first", "SELECT 2", [], []]));
  assert.notEqual(identity(["d1.batch", [["SELECT 1", [1]], ["SELECT 2", [2]]]]),
    identity(["d1.batch", [["SELECT 2", [2]], ["SELECT 1", [1]]]]));
  assert.notEqual(identity(["r2.get", "expected", [{ type: "json" }]]),
    identity(["r2.get", "actual", [{ type: "json" }]]));
  assert.notEqual(identity(["r2.get", "expected", [{ type: "json" }]]),
    identity(["r2.get", "expected", [{ type: "text" }]]));
  assert.notEqual(identity(["r2.put", "asset", new Uint8Array([1, 2]), []]),
    identity(["r2.put", "asset", new Uint8Array([1, 3]), []]));
  assert.notEqual(identity([null]), identity([undefined]));
  assert.notEqual(identity([-0]), identity([0]));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => identity(cyclic), /cyclic/);
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => identity(accessor), /accessor/);
  assert.throws(() => identity(Number.NaN), /unsupported/);
  assert.throws(() => identity("x".repeat(262145)), /too large/);
});

test("MIG-0639: replay input scope calls native RNG and clock and restores them after success and caught errors", async () => {
  const uuidDescriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  const nowDescriptor = Object.getOwnPropertyDescriptor(Date, "now");
  const nativeUUID = crypto.randomUUID, nativeNow = Date.now, nativeDate = Date, nativePerf = performance.now;
  let uuidCalls = 0, nowCalls = 0, throwUUID = false, failures = 0;
  const recorded = [], replayNative = [];
  const spyUUID = function (...args) {
    uuidCalls += 1;
    const value = Reflect.apply(nativeUUID, this, args);
    if (throwUUID) throw new Error("native RNG failure");
    return value;
  };
  const spyNow = function (...args) { nowCalls += 1; return Reflect.apply(nativeNow, this, args); };
  Object.defineProperty(crypto, "randomUUID", { configurable: true, writable: true, value: spyUUID });
  Object.defineProperty(Date, "now", { ...nowDescriptor, value: spyNow });
  try {
    const scope = createReplayInputScope();
    const capture = (kind, args, value) => { recorded.push({ kind, args, value }); return value; };
    const first = await scope.run(capture, () => { failures += 1; }, async () => [crypto.randomUUID(), Date.now(), crypto.randomUUID()]);
    let at = 0;
    const second = await scope.run((kind, args, value) => {
      replayNative.push(value);
      const entry = recorded[at++];
      assert.equal(kind, entry.kind);
      assert.deepEqual(args, entry.args);
      return entry.value;
    }, () => { failures += 1; }, async () => [crypto.randomUUID(), Date.now(), crypto.randomUUID()]);
    assert.deepEqual(second, first);
    assert.notEqual(replayNative[0], first[0], "replay still generated a fresh native UUID before returning the recorded input");
    assert.notEqual(replayNative[2], first[2]);
    assert.equal(uuidCalls, 4);
    assert.equal(nowCalls, 2);
    assert.equal(failures, 0);
    assert.equal(crypto.randomUUID, spyUUID);
    assert.equal(Date.now, spyNow);
    assert.equal(Date, nativeDate);
    assert.equal(performance.now, nativePerf);
    throwUUID = true;
    await scope.run(capture, () => { failures += 1; }, async () => {
      try { crypto.randomUUID(); } catch {}
    });
    assert.equal(failures, 1, "a native error caught by the app must invalidate its trace");
    assert.equal(uuidCalls, 5);
    assert.equal(crypto.randomUUID, spyUUID);
    assert.equal(Date.now, spyNow);
    await assert.rejects(scope.run(capture, () => { failures += 1; }, async () => {
      throw new Error("request failure");
    }), /request failure/);
    assert.equal(crypto.randomUUID, spyUUID);
    assert.equal(Date.now, spyNow);
    const defineProperty = Object.defineProperty;
    Object.defineProperty = function (object, key, descriptor) {
      if (object === Date && key === "now" && descriptor.value !== spyNow) throw new Error("clock hook installation failure");
      return defineProperty(object, key, descriptor);
    };
    try {
      await assert.rejects(scope.run(capture, () => { failures += 1; }, async () => {
        assert.fail("request must not run after partial installation");
      }), /clock hook installation failure/);
    } finally { Object.defineProperty = defineProperty; }
    assert.equal(crypto.randomUUID, spyUUID, "partial installation restores the already installed UUID method");
    assert.equal(Date.now, spyNow);
  } finally {
    if (uuidDescriptor) Object.defineProperty(crypto, "randomUUID", uuidDescriptor);
    else delete crypto.randomUUID;
    Object.defineProperty(Date, "now", nowDescriptor);
  }
});

test("MIG-0639: real recorded RNG and clock inputs preserve strict SQL order in warm and cold replay", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch, originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const nativeUUID = crypto.randomUUID, nativeNow = Date.now;
  const target = await createInprocTarget({ adminToken: "input-transcript" });
  const probe = async (request, env) => {
    const id = crypto.randomUUID(), now = Date.now();
    const first = await env.DB.prepare("SELECT ? AS id, ? AS now").bind(id, now).first();
    const later = Date.now(), other = crypto.randomUUID();
    const batch = await env.DB.batch([env.DB.prepare("SELECT ? AS other").bind(other), env.DB.prepare("SELECT ? AS later").bind(later)]);
    return Response.json({ first, batch });
  };
  let observed;
  app.fetch = async (...args) => {
    const response = await probe(...args);
    observed = await response.clone().json();
    return response;
  };
  try {
    const spec = { method: "GET", path: "/inputs" };
    const recorded = await target.recordForReplay(spec);
    const expected = observed;
    assert.equal(recorded.status, 200);
    assert.equal(recorded.d1, 3);
    assert.equal(recorded.script.length, 6, "four native inputs plus two D1 calls share one ordered transcript");
    assert.equal(recorded.script[0].identity, replayIdentity(["input.randomUUID", []]));
    assert.equal(recorded.script[1].identity, replayIdentity(["input.Date.now", []]));
    assert.equal(recorded.script[2].identity, replayIdentity(["d1.first", "SELECT ? AS id, ? AS now", [expected.first.id, expected.first.now], []]));
    for (const mode of ["warm", "cold"]) {
      const worker = await loadReplayWorker(`inputs-${mode}`, mode === "cold" ? recorded.script : null,
        `return (${probe.toString()})(request, env);`);
      if (mode === "warm") {
        const registration = await worker.fetch(new Request("http://bench.local/__bench/script", {
          method: "POST", body: JSON.stringify({ id: mode, script: recorded.script }),
        }), {}, {});
        assert.equal(registration.status, 200);
      }
      const response = await worker.fetch(new Request("http://bench.local/inputs", { headers: { "x-bench-script": mode } }), {}, {});
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
      assert.equal(replayEvidenceMismatch(recorded, response.headers), false);
      assert.equal(crypto.randomUUID, nativeUUID);
      assert.equal(Date.now, nativeNow);
    }
    const fresh = await target.recordForReplay(spec);
    assert.notEqual(fresh.script[0].result, recorded.script[0].result, "later recordings generate their own inputs, never a fixed UUID");
  } finally {
    app.fetch = originalAppFetch;
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
    await target.close();
  }
});

test("MIG-0639: result snapshots preserve D1 column order, BLOBs, data keys and full large fixtures", () => {
  const row = Object.create(null);
  row.z = 2;
  row.a = 1;
  row.blob = new Uint8Array([0, 1, 255]);
  row.__proto__ = { data: true };
  const shared = { value: 7 };
  const value = {
    row, left: shared, right: shared,
    slots: Array.from({ length: 6000 }, (_, i) => ({ id: i })),
    members: Array.from({ length: 500 }, (_, i) => Array.from({ length: 100 }, (_, j) => i * 100 + j)),
  };
  const snapshot = snapshotReplayResult(value);
  assert.deepEqual(Object.keys(snapshot.row), ["z", "a", "blob", "__proto__"]);
  assert.equal(Object.getPrototypeOf(snapshot.row), Object.prototype);
  assert.equal(Object.hasOwn(snapshot.row, "__proto__"), true);
  assert.deepEqual(snapshot.row.__proto__, { data: true });
  assert.deepEqual(snapshot.row.blob, [0, 1, 255]);
  assert.notEqual(snapshot.left, snapshot.right, "shared acyclic objects are copied as JSON data");
  assert.equal(snapshot.slots.length, 6000);
  assert.equal(snapshot.slots[5999].id, 5999);
  assert.equal(snapshot.members.length, 500);
  assert.equal(snapshot.members[499].length, 100);
  assert.equal(snapshot.members[499][99], 49999);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  row.blob[0] = 9;
  shared.value = 8;
  assert.deepEqual(snapshot.row.blob, [0, 1, 255]);
  assert.equal(snapshot.left.value, 7);
});

test("MIG-0639: result snapshots reject lossy values without calling getters or toJSON", () => {
  let accessorCalls = 0;
  const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { accessorCalls += 1; return 1; } });
  const arrayAccessor = Object.defineProperty([1], "0", { enumerable: true, get() { accessorCalls += 1; return 1; } });
  const toJSON = { toJSON() { accessorCalls += 1; return {}; } };
  const cyclic = {};
  cyclic.self = cyclic;
  const invalid = [
    NaN, Infinity, -Infinity, -0, undefined, 1n, Symbol("x"), () => {},
    new Date(0), new Map(), new ArrayBuffer(1), new Int16Array([1]),
    { value: undefined }, { value: -0 }, accessor, arrayAccessor, toJSON,
    Array(2), Object.assign([1], { extra: 2 }), cyclic,
    { [Symbol("key")]: 1 }, Object.defineProperty({}, "hidden", { value: 1 }),
  ];
  for (const value of invalid) assert.throws(() => snapshotReplayResult(value), /replay result/);
  assert.equal(accessorCalls, 0);
  for (const script of [null, {}, [{}], [{ identity: "x" }], [{ identity: 1, result: null }]]) {
    assert.throws(() => snapshotReplayScript(script), /invalid replay script/);
  }
});

test("MIG-0639: real SQLite recording and warm/cold replay agree on requests, rows and normalized results", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch;
  const originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const target = await createInprocTarget({ adminToken: "result-codec" });
  const probe = async (request, env) => {
    env.DB.prepare("SELECT ? AS unused").bind(41).bind(42);
    env.DB.prepare("SELECT 0 AS unused");
    if (new URL(request.url).pathname === "/unused") return Response.json({ unused: true });
    const originalStatement = env.DB.prepare('SELECT ? AS z, 1 AS a, X\'0001ff\' AS blob, 7 AS "__proto__"').bind(1);
    const statement = originalStatement.bind(2);
    const first = await statement.first();
    const keys = Object.keys(first);
    const plain = Object.getPrototypeOf(first) === Object.prototype;
    const ownProto = Object.hasOwn(first, "__proto__");
    first.blob[0] = 9;
    const second = await originalStatement.first();
    const all = await statement.all();
    const run = await statement.run();
    const raw = await statement.raw();
    const unbound = await env.DB.prepare("SELECT 9 AS n").first();
    const batch = await env.DB.batch([env.DB.prepare("SELECT 9 AS n"), env.DB.prepare("SELECT ? AS n").bind(10)]);
    const slots = await env.DB.prepare("WITH RECURSIVE slots(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM slots WHERE id < 6000) SELECT id FROM slots").all();
    return Response.json({ keys, plain, ownProto, first, second, all, run, raw, unbound, batch, slots });
  };
  let nodeResult;
  app.fetch = async (...args) => {
    const response = await probe(...args);
    nodeResult = await response.clone().json();
    return response;
  };
  try {
    const unused = await target.recordForReplay({ method: "GET", path: "/unused" });
    assert.deepEqual(unused, { script: [], status: 200, d1: 0, d1RowsReturned: 0, d1PerQueryRows: [] });
    const spec = { method: "GET", path: "/probe" };
    const recorded = await target.recordForReplay(spec);
    assert.equal(recorded.d1, 9, "each execution call counts once; two submitted batch entries count twice");
    assert.equal(recorded.d1RowsReturned, 6008);
    assert.deepEqual(recorded.d1PerQueryRows, [1, 1, 1, 1, 1, 1, 1, 1, 6000]);
    assert.deepEqual(nodeResult.keys, ["z", "a", "blob", "__proto__"]);
    assert.equal(nodeResult.plain, true);
    assert.equal(nodeResult.ownProto, true);
    assert.equal(nodeResult.first.z, 2, "rebind replaces parameters without executing or mutating the original statement");
    assert.equal(nodeResult.second.z, 1, "the earlier bound statement retains its own parameters");
    assert.deepEqual(nodeResult.first.blob, [9, 1, 255]);
    assert.deepEqual(recorded.script[0].result.blob, [0, 1, 255], "app mutations cannot rewrite recorded results");
    assert.deepEqual(nodeResult.raw, [[2, 1, [0, 1, 255], 7]]);
    assert.equal(nodeResult.slots.results.length, 6000);
    const expected = nodeResult;
    const direct = await target.run(spec);
    assert.equal(direct.d1, 9);
    assert.deepEqual(nodeResult, expected, "non-recording Node calls receive the same normalized results");
    for (const mode of ["warm", "cold"]) {
      const worker = await loadReplayWorker(`results-${mode}`, mode === "cold" ? recorded.script : null,
        `return (${probe.toString()})(request, env);`);
      if (mode === "warm") {
        const registration = await worker.fetch(new Request("http://bench.local/__bench/script", {
          method: "POST", body: JSON.stringify({ id: mode, script: recorded.script }),
        }), {}, {});
        assert.equal(registration.status, 200);
      }
      const response = await worker.fetch(new Request("http://bench.local/probe", {
        headers: { "x-bench-script": mode },
      }), {}, {});
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected, `${mode} replay preserves the complete Node-observed value`);
      assert.equal(replayEvidenceMismatch(recorded, response.headers), false);
      assert.equal(response.headers.get("x-bench-request"), mode === "cold" ? "1" : "2");
    }
  } finally {
    app.fetch = originalAppFetch;
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
    await target.close();
  }
});

test("MIG-0639: recording latches result errors caught by the app and counts failed execution requests", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch;
  const originalPrepare = DatabaseSync.prototype.prepare;
  const target = await createInprocTarget({ adminToken: "result-errors" });
  let injected, caught = 0;
  app.fetch = async (request, env) => {
    try {
      if (new URL(request.url).pathname === "/batch") {
        await env.DB.batch([env.DB.prepare("SELECT missing_column"), env.DB.prepare("SELECT 1")]);
      } else {
        await env.DB.prepare(new URL(request.url).pathname === "/nonfinite" ? "SELECT 1e999 AS value" : "SELECT injected_result").first();
      }
    } catch { caught += 1; }
    return new Response("caught errors remain an HTTP 200");
  };
  try {
    await assert.rejects(target.recordForReplay({ method: "GET", path: "/nonfinite" }), /recording invalid/);
    assert.equal(caught, 1, "actual SQLite Infinity is rejected before the app can observe a changed value");
    const batch = await target.run({ method: "GET", path: "/batch" });
    assert.equal(batch.status, 200);
    assert.equal(batch.d1, 2, "both submitted batch requests count even when the first one fails");
    await assert.rejects(target.recordForReplay({ method: "GET", path: "/batch" }), /recording invalid/);
    DatabaseSync.prototype.prepare = function (sql) {
      return sql === "SELECT injected_result" ? { get: () => injected } : originalPrepare.call(this, sql);
    };
    const cyclic = {};
    cyclic.self = cyclic;
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get() { throw new Error("getter must not run"); } });
    for (injected of [{ value: undefined }, { value: 1n }, { value: -0 }, new Date(0), Array(2), cyclic, accessor]) {
      const before = caught;
      await assert.rejects(target.recordForReplay({ method: "GET", path: "/injected" }), /recording invalid/);
      assert.equal(caught, before + 1);
    }
    const failed = await target.run({ method: "GET", path: "/injected" });
    assert.equal(failed.d1, 1);
  } finally {
    app.fetch = originalAppFetch;
    DatabaseSync.prototype.prepare = originalPrepare;
    await target.close();
  }
});

test("MIG-0639: simulator counts execution attempts and submitted batch entries, never prepare/bind", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const native = new Set();
  const prepare = (sql) => {
    const result = (value) => { if (sql === "fail") throw new Error("simulated D1 failure"); return value; };
    const statement = {
      sql, bind: () => prepare(sql),
      first: async () => result({ id: 1 }), all: async () => result({ results: [{ id: 1 }] }),
      run: async () => result({ results: [] }), raw: async () => result([[1]]),
    };
    native.add(statement);
    return statement;
  };
  const env = { DB: { prepare, batch: async (list) => {
    assert.ok(list.every((statement) => native.has(statement)), "batch receives native prepared statements");
    if (list.some((statement) => statement.sql === "fail")) throw new Error("simulated batch failure");
    return list.map(() => ({ results: [{ id: 1 }] }));
  } } };
  try {
    const worker = await loadReplayWorker("sim-request-count", null, `
      env.DB.prepare("unused").bind(1).bind(2);
      if (pathname === "/unused") return new Response("unused");
      const bound = env.DB.prepare("query").bind(1).bind(2);
      await bound.first(); await bound.first(); await bound.all(); await bound.run(); await bound.raw();
      await env.DB.batch([env.DB.prepare("unbound"), bound]);
      try { await env.DB.prepare("fail").first(); } catch {}
      try { await env.DB.batch([env.DB.prepare("fail"), bound]); } catch {}
      return new Response("done");`);
    const unused = await worker.fetch(new Request("http://bench.local/unused"), env, {});
    assert.equal(unused.headers.get("x-bench-d1"), "0");
    const response = await worker.fetch(new Request("http://bench.local/probe"), env, {});
    assert.equal(response.headers.get("x-bench-d1"), "10");
    assert.equal(response.headers.get("x-bench-returned-rows"), "6");
    assert.equal(response.headers.get("x-bench-query-rows"), "1,1,1,0,1,1,1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
  }
});

test("MIG-0639: registration rejects non-finite JSON results and malformed scripts before replay", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  try {
    const worker = await loadReplayWorker("invalid-registration", null, 'return new Response("must not run");');
    for (const script of ['[{"identity":"x","result":1e999}]', '[{"identity":"x","result":-0}]', '[{"identity":"x"}]', 'null']) {
      const response = await worker.fetch(new Request("http://bench.local/__bench/script", {
        method: "POST", body: `{"id":"bad","script":${script}}`,
      }), {}, {});
      assert.equal(response.status, 400);
      const missing = await worker.fetch(new Request("http://bench.local/probe", {
        headers: { "x-bench-script": "bad" },
      }), {}, {});
      assert.equal(missing.status, 503);
      assert.equal(missing.headers.get("x-bench-replay-complete"), "0");
    }
    assert.throws(() => workerSource("invalid-cold", [{ identity: "x", result: Infinity }]), /replay result/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
  }
});

test("MIG-0639: generated workerd replay fails closed on wrong SQL, exhausted/trailing scripts, R2 key/bytes, batch order and missing scripts", async () => {
  const originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const load = (generation, script, body) => loadReplayWorker(generation, script,
    `try { ${body} } catch { return new Response("caught"); }`);
  const invoke = (worker, pathname, scriptId = "cold") =>
    worker.fetch(new Request("http://bench.local" + pathname, { headers: { "x-bench-script": scriptId } }), {}, {});
  const sqlEntry = {
    identity: replayIdentity(["d1.first", "SELECT expected", [1], []]),
    result: { id: "expected" },
  };
  try {
    const wrongSqlWorker = await load("wrong-sql", [sqlEntry],
      'if (pathname === "/probe") { await env.DB.prepare("SELECT actual").bind(1).first(); return new Response("unexpected"); } return new Response("unused");');
    const wrongSql = await invoke(wrongSqlWorker, "/probe");
    assert.equal(wrongSql.status, 200);
    assert.equal(wrongSql.headers.get("x-bench-replay-complete"), "0");
    assert.equal(wrongSql.headers.get("x-bench-d1"), "1", "failed calls still count as execution requests");

    const exhaustedWorker = await load("exhausted", [],
      'if (pathname === "/probe") { await env.DB.prepare("SELECT expected").bind(1).first(); return new Response("unexpected"); } return new Response("unused");');
    const exhausted = await invoke(exhaustedWorker, "/probe");
    assert.equal(exhausted.headers.get("x-bench-replay-complete"), "0");

    const trailingWorker = await load("trailing", [sqlEntry, sqlEntry],
      'if (pathname === "/probe") { await env.DB.prepare("SELECT expected").bind(1).first(); return new Response("unexpected"); } return new Response("unused");');
    const trailing = await invoke(trailingWorker, "/probe");
    assert.equal(trailing.headers.get("x-bench-replay-complete"), "0");

    const batchEntry = {
      identity: replayIdentity(["d1.batch", [["SELECT two", [2]], ["SELECT one", [1]]]]),
      result: [{ results: [] }, { results: [] }],
    };
    const batchWorker = await load("batch-order", [batchEntry],
      'if (pathname === "/probe") { await env.DB.batch([env.DB.prepare("SELECT one").bind(1), env.DB.prepare("SELECT two").bind(2)]); return new Response("unexpected"); } return new Response("unused");');
    const batch = await invoke(batchWorker, "/probe");
    assert.equal(batch.headers.get("x-bench-replay-complete"), "0");
    assert.equal(batch.headers.get("x-bench-d1"), "2");

    const r2Entry = {
      identity: replayIdentity(["r2.get", "expected-key", [{ type: "json" }]]),
      result: { size: 2, text: "{}", etag: "bench" },
    };
    const r2Worker = await load("r2-key", [r2Entry],
      'if (pathname === "/probe") { await env.BUCKET.get("actual-key", { type: "json" }); return new Response("unexpected"); } return new Response("unused");');
    const r2 = await invoke(r2Worker, "/probe");
    assert.equal(r2.headers.get("x-bench-replay-complete"), "0");

    const putEntry = {
      identity: replayIdentity(["r2.put", "asset", new Uint8Array([1, 3]), [{ httpMetadata: { contentType: "image/png" } }]]),
      result: { etag: "bench" },
    };
    const putWorker = await load("r2-bytes", [putEntry],
      'if (pathname === "/probe") { await env.BUCKET.put("asset", new Uint8Array([1, 2]), { httpMetadata: { contentType: "image/png" } }); return new Response("unexpected"); } return new Response("unused");');
    const put = await invoke(putWorker, "/probe");
    assert.equal(put.headers.get("x-bench-replay-complete"), "0");

    const nativeUUID = crypto.randomUUID, nativeNow = Date.now;
    const uuidEntry = { identity: replayIdentity(["input.randomUUID", []]), result: crypto.randomUUID() };
    const timeEntry = { identity: replayIdentity(["input.Date.now", []]), result: Date.now() };
    const inputCases = [
      ["extra-input", [], 'crypto.randomUUID(); return new Response("caught input");'],
      ["missing-input", [uuidEntry], 'return new Response("unused input");'],
      ["input-order", [uuidEntry, timeEntry], 'Date.now(); crypto.randomUUID(); return new Response("wrong order");'],
      ["input-d1-order", [uuidEntry, sqlEntry], 'await env.DB.prepare("SELECT expected").bind(1).first(); crypto.randomUUID(); return new Response("wrong order");'],
      ["input-r2-order", [uuidEntry, r2Entry], 'await env.BUCKET.get("expected-key", {type:"json"}); crypto.randomUUID(); return new Response("wrong order");'],
      ["invalid-uuid", [{ ...uuidEntry, result: "not-a-uuid" }], 'crypto.randomUUID(); return new Response("bad UUID");'],
      ["invalid-time-type", [{ ...timeEntry, result: "123" }], 'Date.now(); return new Response("bad time");'],
      ["invalid-time-value", [{ ...timeEntry, result: -1 }], 'Date.now(); return new Response("bad time");'],
    ];
    for (const [name, script, body] of inputCases) {
      const worker = await load(name, script, body);
      const response = await invoke(worker, "/probe");
      assert.equal(response.headers.get("x-bench-replay-complete"), "0", name + " cannot pass even if the app catches the error");
      assert.equal(crypto.randomUUID, nativeUUID, name + " restores crypto");
      assert.equal(Date.now, nativeNow, name + " restores the clock");
    }

    const missingWorker = await load("missing", null, 'return new Response("unexpected");');
    const missing = await invoke(missingWorker, "/probe", "missing-id");
    assert.equal(missing.status, 503);
    assert.equal(missing.headers.get("x-bench-replay-complete"), "0");

    const noopWorker = await load("noop-replay", [], 'return new Response("unused");');
    const replayNoop = await invoke(noopWorker, "/__bench/noop");
    assert.equal(replayNoop.status, 200);
    assert.equal(replayNoop.headers.get("x-bench-replay-complete"), "1");
    assert.equal(replayNoop.headers.get("x-bench-d1"), "0");
    assert.equal(replayNoop.headers.get("x-bench-returned-rows"), "0");
    assert.equal(replayNoop.headers.get("x-bench-query-rows"), "");
    const simNoop = await noopWorker.fetch(new Request("http://bench.local/__bench/noop"), {}, {});
    assert.equal(simNoop.status, 200);
    assert.equal(simNoop.headers.get("x-bench-d1"), null, "non-replay noop remains outside counting wrapper");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
  }
});

test("MIG-0639: overlapping recorder, ordinary, simulator and control requests fail closed without leaking host hooks", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch, originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const nativeUUID = crypto.randomUUID, nativeNow = Date.now;
  const target = await createInprocTarget({ adminToken: "input-concurrency" });
  const other = await createInprocTarget({ adminToken: "other-input-concurrency" });
  let release, enter;
  try {
    for (const firstMode of ["record", "run"]) {
      const held = new Promise((resolve) => { release = resolve; });
      const entered = new Promise((resolve) => { enter = resolve; });
      app.fetch = async () => {
        crypto.randomUUID(); Date.now(); enter(); await held;
        return new Response("first request");
      };
      const first = firstMode === "record"
        ? target.recordForReplay({ method: "GET", path: "/first" })
        : target.run({ method: "GET", path: "/first" });
      const rejectedFirst = assert.rejects(first, /concurrent in-process request/);
      await entered;
      await assert.rejects(other.recordForReplay({ method: "GET", path: "/other" }), /concurrent in-process request/);
      await assert.rejects(target.run({ method: "GET", path: "/other" }), /concurrent in-process request/);
      await assert.rejects(other.exec([]), /concurrent in-process request/);
      release();
      await rejectedFirst;
      assert.equal(crypto.randomUUID, nativeUUID);
      assert.equal(Date.now, nativeNow);
    }
    // app.fetch has resolved and the native-method hooks are restored, but the
    // recorder's counters/script still belong to the response until it drains.
    let controller;
    const draining = new Promise((resolve) => { enter = resolve; });
    app.fetch = async () => new Response(new ReadableStream({
      start(value) { controller = value; },
      pull() { enter(); },
    }));
    const streamed = target.recordForReplay({ method: "GET", path: "/stream" });
    const rejectedStream = assert.rejects(streamed, /concurrent in-process request/);
    await draining;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(crypto.randomUUID, nativeUUID, "streaming does not extend native interception");
    assert.equal(Date.now, nativeNow);
    await assert.rejects(other.recordForReplay({ method: "GET", path: "/stream-overlap" }), /concurrent in-process request/);
    await assert.rejects(target.run({ method: "GET", path: "/stream-overlap" }), /concurrent in-process request/);
    await assert.rejects(other.setR2("fixture"), /concurrent in-process request/);
    controller.close();
    await rejectedStream;
    for (const firstMode of ["replay", "sim"]) {
      const script = [{ identity: replayIdentity(["input.randomUUID", []]), result: crypto.randomUUID() }];
      globalThis.__flamenodeReplayBarrier = new Promise((resolve) => { release = resolve; });
      const entered = new Promise((resolve) => { globalThis.__flamenodeReplayEntered = resolve; });
      const worker = await loadReplayWorker("concurrent-" + firstMode, firstMode === "replay" ? script : null,
        'crypto.randomUUID(); globalThis.__flamenodeReplayEntered(); await globalThis.__flamenodeReplayBarrier; return new Response("first");');
      const firstRequest = new Request("http://bench.local/probe", firstMode === "replay" ? { headers: { "x-bench-script": "cold" } } : {});
      const simRequest = new Request("http://bench.local/probe");
      const controlRequest = new Request("http://bench.local/__bench/script", { method: "POST", body: JSON.stringify({ id: "other", script: [] }) });
      const first = worker.fetch(firstRequest, {}, {});
      const rejectedFirst = assert.rejects(first, /concurrent worker request/);
      await entered;
      await assert.rejects(worker.fetch(simRequest, {}, {}), /concurrent worker request/);
      await assert.rejects(worker.fetch(controlRequest, {}, {}), /concurrent worker request/);
      release();
      await rejectedFirst;
      assert.equal(crypto.randomUUID, nativeUUID);
      assert.equal(Date.now, nativeNow);
      const recovered = await worker.fetch(new Request("http://bench.local/__bench/ping"), {}, {});
      assert.equal(recovered.status, 200);
      assert.equal(recovered.headers.get("x-bench-request"), "4", "every fetch counts, including rejected overlaps");
    }
  } finally {
    release?.();
    delete globalThis.__flamenodeReplayBarrier;
    delete globalThis.__flamenodeReplayEntered;
    app.fetch = originalAppFetch;
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
    await target.close();
    await other.close();
  }
});

test("MIG-0639: replay evidence compares actual statements, returned rows and ordered query vector", () => {
  const rec = { d1: 2, d1RowsReturned: 3, d1PerQueryRows: [1, 2] };
  const good = new Headers({
    "x-bench-replay-complete": "1",
    "x-bench-d1": "2",
    "x-bench-returned-rows": "3",
    "x-bench-query-rows": "1,2",
  });
  assert.equal(replayEvidenceMismatch(rec, good), false);
  const wrongOrder = new Headers({
    "x-bench-replay-complete": "1",
    "x-bench-d1": "2",
    "x-bench-returned-rows": "3",
    "x-bench-query-rows": "2,1",
  });
  assert.equal(replayEvidenceMismatch(rec, wrongOrder), true);
  assert.equal(replayEvidenceMismatch(rec, new Headers()), true);
  good.set("x-bench-replay-complete", "0");
  assert.equal(replayEvidenceMismatch(rec, good), true);
});

test("MIG-0639: failed R2/cache-clear control responses stop benchmark setup", () => {
  assert.doesNotThrow(() => requireBenchmarkControl(new Response("ok"), "r2"));
  assert.throws(
    () => requireBenchmarkControl(new Response("unavailable", { status: 503 }), "cache-clear"),
    /benchmark cache-clear failed: HTTP 503/,
  );
  const source = fs.readFileSync(fileURLToPath(new URL("./benchmark-api-cpu.mjs", import.meta.url)), "utf8");
  assert.match(source, /requireBenchmarkControl\(response, "r2"\)/);
  assert.match(source, /requireBenchmarkControl\(await post\("\/__bench\/cache-clear"\), "cache-clear"\)/);
});

test("MIG-0639: R2 HEAD records metadata/null without a GET and replays warm/cold with the same bytes", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch, originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const target = await createInprocTarget({ adminToken: "head-transcript" });
  const body = JSON.stringify({ message: "投影🙂" });
  const probe = async (request, env) => {
    const head = await env.BUCKET.head("head-fixture");
    const metadata = { ...head };
    head.size = -1; // App mutation must not rewrite the recorded result.
    const missing = await env.BUCKET.head("missing");
    const object = await env.BUCKET.get("head-fixture");
    return Response.json({ metadata, missing, headKeys: Object.keys(head), size: object.size, etag: object.etag, text: await object.text() });
  };
  let observed;
  app.fetch = async (...args) => {
    const response = await probe(...args);
    observed = await response.clone().json();
    return response;
  };
  try {
    await target.setR2(body, "head-fixture");
    const recorded = await target.recordForReplay({ method: "GET", path: "/head" });
    const expected = observed;
    assert.equal(recorded.d1, 0);
    assert.deepEqual(recorded.script.map((entry) => entry.identity), [
      replayIdentity(["r2.head", "head-fixture", []]), replayIdentity(["r2.head", "missing", []]), replayIdentity(["r2.get", "head-fixture", []]),
    ], "HEAD is one independent metadata operation, never an internal GET/body read");
    assert.deepEqual(recorded.script[0].result, { size: Buffer.byteLength(body), etag: expected.etag });
    assert.equal(recorded.script[1].result, null);
    assert.deepEqual([...expected.headKeys].sort(), ["etag", "size"]);
    assert.equal(expected.size, expected.metadata.size);
    assert.equal(expected.text, body);
    for (const mode of ["warm", "cold"]) {
      const worker = await loadReplayWorker(`head-${mode}`, mode === "cold" ? recorded.script : null, `return (${probe.toString()})(request, env);`);
      if (mode === "warm") {
        const registered = await worker.fetch(new Request("http://bench.local/__bench/script", {
          method: "POST", body: JSON.stringify({ id: mode, script: recorded.script }),
        }), {}, {});
        assert.equal(registered.status, 200);
      }
      const response = await worker.fetch(new Request("http://bench.local/head", { headers: { "x-bench-script": mode } }), {}, {});
      assert.deepEqual(await response.json(), expected);
      assert.equal(replayEvidenceMismatch(recorded, response.headers), false);
    }
    app.fetch = async (request, env) => {
      try { await env.BUCKET.head("head-fixture", { unsupported: () => {} }); } catch {}
      return new Response("caught");
    };
    await assert.rejects(target.recordForReplay({ method: "GET", path: "/head" }), /replay recording invalid/,
      "caught unsupported HEAD input invalidates the recorder too");
  } finally {
    app.fetch = originalAppFetch;
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
    await target.close();
  }
});

test("MIG-0639: recorded R2 PUT preserves JSON and binary bytes through GET/HEAD and strict replay", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch, originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const target = await createInprocTarget({ adminToken: "r2-byte-fidelity" });
  const probe = async (request, env) => {
    const json = JSON.stringify({ message: "日本語🙂" });
    await env.BUCKET.put("roundtrip.json", json);
    const object = await env.BUCKET.get("roundtrip.json");
    const jsonHead = await env.BUCKET.head("roundtrip.json");
    const input = new Uint8Array([9, 0, 255, 128, 65, 0, 9]);
    await env.BUCKET.put("binary", input.subarray(1, 6));
    input.fill(7); // The provider must retain the bytes as written.
    const binary = await env.BUCKET.get("binary");
    const binaryHead = await env.BUCKET.head("binary");
    await env.BUCKET.put("empty", "");
    const empty = await env.BUCKET.get("empty");
    return Response.json({
      json: await object.json(), text: await object.text(), size: object.size, headSize: jsonHead.size,
      jsonBytes: [...new Uint8Array(await object.arrayBuffer())],
      binary: [...new Uint8Array(await binary.arrayBuffer())], binaryText: await binary.text(),
      binarySize: binary.size, binaryHeadSize: binaryHead.size,
      empty: { size: empty.size, text: await empty.text(), bytes: (await empty.arrayBuffer()).byteLength },
    });
  };
  let observed;
  app.fetch = async (...args) => {
    const response = await probe(...args);
    observed = await response.clone().json();
    return response;
  };
  try {
    const recorded = await target.recordForReplay({ method: "GET", path: "/r2-roundtrip" });
    const expectedText = JSON.stringify({ message: "日本語🙂" });
    assert.deepEqual(observed.json, { message: "日本語🙂" });
    assert.equal(observed.text, expectedText);
    assert.equal(observed.size, Buffer.byteLength(expectedText));
    assert.equal(observed.headSize, observed.size);
    assert.deepEqual(observed.jsonBytes, [...Buffer.from(expectedText)]);
    assert.deepEqual(observed.binary, [0, 255, 128, 65, 0]);
    assert.equal(observed.binaryText, new TextDecoder().decode(new Uint8Array([0, 255, 128, 65, 0])));
    assert.equal(observed.binarySize, 5);
    assert.equal(observed.binaryHeadSize, 5);
    assert.deepEqual(observed.empty, { size: 0, text: "", bytes: 0 });
    assert.equal(recorded.d1, 0);
    assert.equal(recorded.script.find((entry) => entry.identity === replayIdentity(["r2.get", "roundtrip.json", []])).result.bodyBase64,
      undefined, "existing UTF-8 GET transcript representation is retained");
    for (const mode of ["warm", "cold"]) {
      const worker = await loadReplayWorker(`r2-bytes-${mode}`, mode === "cold" ? recorded.script : null,
        `return (${probe.toString()})(request, env);`);
      if (mode === "warm") {
        const registered = await worker.fetch(new Request("http://bench.local/__bench/script", {
          method: "POST", body: JSON.stringify({ id: mode, script: recorded.script }),
        }), {}, {});
        assert.equal(registered.status, 200);
      }
      const response = await worker.fetch(new Request("http://bench.local/r2-roundtrip", {
        headers: { "x-bench-script": mode },
      }), {}, {});
      assert.deepEqual(await response.json(), observed);
      assert.equal(replayEvidenceMismatch(recorded, response.headers), false);
    }
  } finally {
    app.fetch = originalAppFetch;
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
    await target.close();
  }
});

test("MIG-0639: HEAD replay retains strict key/options/method/order identity and sticky caught failures", async () => {
  const originalFetch = globalThis.fetch, originalIdentity = globalThis.__flamenodeBenchIdentity;
  const entry = { identity: replayIdentity(["r2.head", "manifest", [{ onlyIf: { etagMatches: "A" } }]]), result: { size: 12, etag: "A" } };
  const correct = 'await env.BUCKET.head("manifest", { onlyIf: { etagMatches: "A" } });';
  const cases = [
    ["head-key", [entry], 'await env.BUCKET.head("other", { onlyIf: { etagMatches: "A" } });'],
    ["head-options", [entry], 'await env.BUCKET.head("manifest", { onlyIf: { etagMatches: "B" } });'],
    ["head-options-type", [entry], 'await env.BUCKET.head("manifest", { onlyIf: { etagMatches: 1 } });'],
    ["head-method", [entry], 'await env.BUCKET.get("manifest", { onlyIf: { etagMatches: "A" } });'],
    ["head-order", [{ identity: replayIdentity(["r2.get", "playlist", []]), result: { size: 2, text: "{}", etag: "P" } }, entry], correct],
    ["head-exhausted", [], correct],
    ["head-trailing", [entry, entry], correct],
  ];
  try {
    for (const [name, script, operation] of cases) {
      const worker = await loadReplayWorker(name, script, `try { ${operation} } catch {} return new Response("caught");`);
      const response = await worker.fetch(new Request("http://bench.local/probe", { headers: { "x-bench-script": "cold" } }), {}, {});
      assert.equal(response.headers.get("x-bench-replay-complete"), "0", name);
      assert.equal(response.headers.get("x-bench-d1"), "0", "HEAD is not a D1 execution");
    }
    const worker = await loadReplayWorker("head-caught-then-consumed", [entry],
      `try { await env.BUCKET.head("wrong"); } catch {} ${correct} return new Response("caught then consumed");`);
    const response = await worker.fetch(new Request("http://bench.local/probe", { headers: { "x-bench-script": "cold" } }), {}, {});
    assert.equal(response.headers.get("x-bench-replay-complete"), "0", "consuming every entry after a caught mismatch cannot restore validity");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
  }
});

test("MIG-0639: benchmark guard selection accepts only explicit modes and preserves the shared env", () => {
  const env = Object.freeze({ PUBLIC_VISIBILITY_GUARD_MODE: "observe", DB: {} });
  const originalHeaders = { "x-existing": "kept" };
  assert.equal(benchmarkRequestEnv(env, benchmarkRequestHeaders({ headers: originalHeaders })), env);
  for (const mode of ["off", "observe", "enforce"]) {
    const headers = benchmarkRequestHeaders({ headers: originalHeaders, visibilityGuardMode: mode });
    const selected = benchmarkRequestEnv(env, headers);
    assert.notEqual(selected, env);
    assert.equal(selected.DB, env.DB);
    assert.equal(selected.PUBLIC_VISIBILITY_GUARD_MODE, mode);
    assert.equal(headers.get("x-existing"), "kept");
  }
  assert.deepEqual(originalHeaders, { "x-existing": "kept" });
  assert.equal(env.PUBLIC_VISIBILITY_GUARD_MODE, "observe");
  for (const invalid of [undefined, null, "", "ENFORCE", " enforce ", 0, {}, []]) {
    assert.throws(() => benchmarkRequestHeaders({ visibilityGuardMode: invalid }), /invalid visibility guard mode/);
  }
  assert.throws(() => benchmarkRequestHeaders({ headers: { "x-bench-visibility-guard-mode": "enforce" } }), /reserved/);
  assert.throws(() => benchmarkRequestEnv(env, new Headers({ "x-bench-visibility-guard-mode": "invalid" })), /invalid visibility guard mode/);
});

test("MIG-0639: guard mode is request-local in the real recorder and sim/replay dispatch after success or throw", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch, originalFetch = globalThis.fetch;
  const originalIdentity = globalThis.__flamenodeBenchIdentity;
  const target = await createInprocTarget({ adminToken: "guard-mode" });
  const seen = [];
  app.fetch = async (request, env) => {
    seen.push(env);
    if (new URL(request.url).pathname === "/throw") throw new Error("guard probe failure");
    return Response.json({ mode: env.PUBLIC_VISIBILITY_GUARD_MODE ?? null });
  };
  try {
    await target.recordForReplay({ method: "GET", path: "/mode", visibilityGuardMode: "enforce" });
    await target.run({ method: "GET", path: "/mode" });
    await assert.rejects(target.recordForReplay({ method: "GET", path: "/throw", visibilityGuardMode: "off" }), /guard probe failure/);
    await target.recordForReplay({ method: "GET", path: "/mode" });
    assert.deepEqual(seen.map((env) => env.PUBLIC_VISIBILITY_GUARD_MODE), ["enforce", undefined, "off", undefined]);
    assert.equal(seen[1], seen[3], "the unspecified shared env is unchanged after success and throw");
    assert.notEqual(seen[0], seen[1]);
    assert.notEqual(seen[2], seen[1]);
    for (const mode of ["sim", "replay", "cold"]) {
      const worker = await loadReplayWorker(`guard-${mode}`, mode === "cold" ? [] : null,
        'if (pathname === "/throw") throw new Error("guard probe failure"); return Response.json({mode: env.PUBLIC_VISIBILITY_GUARD_MODE ?? null});');
      const env = Object.freeze({ PUBLIC_VISIBILITY_GUARD_MODE: "observe", DB: {} });
      let first = true;
      const invoke = async (pathname, selected) => {
        const spec = { ...(selected === undefined ? {} : { visibilityGuardMode: selected }) };
        const headers = benchmarkRequestHeaders(spec);
        if (mode === "cold" && first) headers.set("x-bench-script", "cold");
        else if (mode !== "sim") {
          const registration = await worker.fetch(new Request("http://bench.local/__bench/script", {
            method: "POST", body: JSON.stringify({ id: "next", script: [] }),
          }), env, {});
          assert.equal(registration.status, 200);
          headers.set("x-bench-script", "next");
        }
        first = false;
        return worker.fetch(new Request(`http://bench.local${pathname}`, { headers }), env, {});
      };
      const initial = await invoke("/mode", "enforce");
      assert.deepEqual(await initial.json(), { mode: "enforce" });
      if (mode === "cold") assert.equal(initial.headers.get("x-bench-request"), "1", "cold mode selection needs no setup fetch");
      assert.deepEqual(await (await invoke("/mode")).json(), { mode: "observe" });
      await assert.rejects(invoke("/throw", "off"), /guard probe failure/);
      assert.deepEqual(await (await invoke("/mode")).json(), { mode: "observe" });
      assert.equal(env.PUBLIC_VISIBILITY_GUARD_MODE, "observe");
      await assert.rejects(worker.fetch(new Request("http://bench.local/mode", {
        headers: { "x-bench-visibility-guard-mode": "invalid" },
      }), env, {}), /invalid visibility guard mode/);
      assert.deepEqual(await (await invoke("/mode")).json(), { mode: "observe" });
    }
  } finally {
    app.fetch = originalAppFetch;
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
    await target.close();
  }
});

test("MIG-0639: explicit playlist fixtures retain default 155/video-only input and exercise canonical raw 500/501 bounds", async () => {
  const { normalizeStaticEventPlaylist } = await import("../packages/server-core/src/publicData/eventPlaylistCore.ts");
  const { normalizePublicVisibilityBlockedEntitiesManifest } = await import("../packages/server-core/src/visibility/manifestCore.ts");
  const defaults = buildScenarios({ adminToken: "t" });
  const selected = buildScenarios({ adminToken: "t" }, { includeEventPlaylist: true });
  assert.equal(defaults.length, 155);
  assert.equal(selected.length, 156);
  assert.deepEqual(selected.filter((sc) => sc.id !== "RH-031-PLAYLIST").map((sc) => sc.id), defaults.map((sc) => sc.id));
  assert.equal(selected.at(-1).id, "BASELINE");
  const original = defaults.find((sc) => sc.id === "RH-031");
  assert.equal(original.kinds.normal(0, "fixture").path, "/api/videos/bench-vid/viewer-overlay");
  assert.deepEqual(Object.keys(original.prepareKind.normal.r2Objects), ["videos/bench-vid.json"]);
  assert.ok(defaults.every((sc) => Object.values(sc.kinds).every((make) => !Object.hasOwn(make(0, "fixture"), "visibilityGuardMode"))));
  const variant = selected.find((sc) => sc.id === "RH-031-PLAYLIST");
  for (const [kind, count] of Object.entries({ normal: 3, limit: 500, invalid: 501 })) {
    const spec = variant.kinds[kind](0, "fixture");
    assert.equal(spec.path, "/api/videos/bench-playlist-video/viewer-overlay?playlist=bench-playlist-event");
    assert.equal(spec.visibilityGuardMode, "enforce");
    const objects = variant.prepareKind[kind].r2Objects;
    const artifact = JSON.parse(objects["events/bench-playlist-event/playlist.v1.json"]);
    const manifest = normalizePublicVisibilityBlockedEntitiesManifest(JSON.parse(objects["visibility/blocked-entities.v1.json"]));
    assert.ok(manifest);
    assert.equal(manifest.entities[0].entity_id, "bp-v1");
    assert.equal(artifact.items.length, count);
    assert.equal(artifact.complete, true);
    const normalized = normalizeStaticEventPlaylist(artifact, "bench-playlist-event");
    if (kind === "invalid") assert.equal(normalized, null, "raw 501 rows stay invalid even though one would be fenced away");
    else assert.equal(normalized.items.length, count);
    assert.equal(spec.expectPlaylist.ids.length, kind === "invalid" ? 0 : count - 1);
    assert.ok(!spec.expectPlaylist.ids.includes("bp-v1"));
    const response = { loggedIn: true, authUnavailable: false, playlistLabel: spec.expectPlaylist.label,
      playlistItems: kind === "invalid" ? [] : artifact.items.filter((item) => item.id !== "bp-v1").map(({ scheduled_time, ...item }) => item) };
    assert.equal(playlistResponseMismatch(spec, JSON.stringify(response)), false, "valid 500-row fixture does not rely on optional 64 KiB suppression");
  }
});

test("MIG-0639: playlist body checks reject empty/leaked/reordered/degraded/oversized 200 responses after recording", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const originalAppFetch = app.fetch;
  const target = await createInprocTarget({ adminToken: "playlist-body" });
  const variant = buildScenarios({ adminToken: "t" }, { includeEventPlaylist: true }).find((sc) => sc.id === "RH-031-PLAYLIST");
  const spec = variant.kinds.normal(0, "body");
  const good = { loggedIn: true, authUnavailable: false, playlistLabel: spec.expectPlaylist.label,
    playlistItems: spec.expectPlaylist.ids.map((id) => ({ id })) };
  const failures = [
    { ...good, playlistItems: [] },
    { ...good, playlistItems: [...good.playlistItems, { id: "bp-v1" }] },
    { ...good, playlistItems: [...good.playlistItems].reverse() },
    { ...good, loggedIn: false }, { ...good, authUnavailable: true },
    { ...good, playlistLabel: "再生リスト" }, { ...good, padding: "x".repeat(64 * 1024) },
  ];
  try {
    await target.exec(spec.setup);
    let seed;
    app.fetch = async (request, env) => {
      seed = await env.DB.prepare("SELECT v.id AS video_id, e.id AS event_id FROM videos v INNER JOIN events e ON e.id = v.primary_event_id WHERE v.id = ?")
        .bind("bench-playlist-video").first();
      return Response.json(good);
    };
    assert.equal((await target.recordForReplay(spec)).responseBodyMismatch, false);
    assert.deepEqual(seed, { video_id: "bench-playlist-video", event_id: "bench-playlist-event" }, "the isolated fixture executes on the real migrated schema");
    assert.equal(playlistResponseMismatch(spec, "not json"), true);
    assert.equal(playlistResponseMismatch({}, "unchanged default response"), false);
    for (const response of [good, ...failures]) {
      app.fetch = async () => Response.json(response);
      const recorded = await target.recordForReplay(spec);
      assert.equal(recorded.status, 200);
      assert.equal(recorded.responseBodyMismatch, response !== good);
    }
  } finally {
    app.fetch = originalAppFetch;
    await target.close();
  }
});

test("MIG-0639: warm/cold samples reject body mismatches and cold requests reapply their own manifest", async () => {
  const variant = buildScenarios({ adminToken: "t" }, { includeEventPlaylist: true }).find((sc) => sc.id === "RH-031-PLAYLIST");
  const objects = new Map();
  const result = { status: 200, cpuMs: 1, bytes: 2, d1: 0, responseBodyMismatch: true };
  const target = { setR2: async (body, key) => objects.set(key, body), exec: async () => {}, record: async () => null,
    run: async () => result, reload: async () => {} };
  const warm = await runScenario(target, variant, { warmup: 0, samples: 1 }, { tagSeq: 0 });
  assert.ok(warm.every((sample) => sample.unexpected), "HTTP 200 cannot hide a failed playlist body contract");
  delete result.responseBodyMismatch;
  const unchecked = await runScenario(target, variant, { warmup: 0, samples: 1 }, { tagSeq: 0 });
  assert.ok(unchecked.every((sample) => sample.unexpected), "missing body verification cannot qualify the opt-in variant");
  result.responseBodyMismatch = true;
  const key = "visibility/blocked-entities.v1.json";
  const scenarios = ["A", "B"].map((id) => ({
    id, prepareKind: { normal: { r2Objects: { [key]: id } } },
    kinds: { normal: () => ({ method: "GET", path: `/${id}`, expect: [200], marker: id }) },
  }));
  const visited = [];
  target.record = async (spec) => {
    assert.equal(objects.get(key), spec.marker, "each cold transcript records its selected manifest, not the last scenario's fixture");
    visited.push(spec.marker);
    return null;
  };
  const cold = await runCold(target, scenarios, { coldSamples: 2 });
  assert.deepEqual(visited, ["A", "B", "A", "B"]);
  assert.ok([...cold.values()].flat().every((sample) => sample.unexpected));
});

test("MIG-0639: ordered GET/playlist/HEAD replay preserves changed or missing ETags for a fail-closed consumer", async () => {
  const originalFetch = globalThis.fetch, originalIdentity = globalThis.__flamenodeBenchIdentity;
  const manifest = "visibility/blocked-entities.v1.json", playlist = "events/bench-playlist-event/playlist.v1.json";
  const body = JSON.stringify({ items: [{ id: "visible-1" }, { id: "visible-2" }] });
  const before = { identity: replayIdentity(["r2.get", manifest, []]), result: { size: 2, text: "{}", etag: "A" } };
  const artifact = { identity: replayIdentity(["r2.get", playlist, []]), result: { size: Buffer.byteLength(body), text: body, etag: "P" } };
  // This is a harness consumer probe, not #723 integration evidence: main does
  // not contain that runtime change. Root separately diagnoses the attested
  // combined Hono candidate with these same distinguishable GET/HEAD inputs.
  const probe = `const before = await env.BUCKET.get(${JSON.stringify(manifest)});
    const artifact = await env.BUCKET.get(${JSON.stringify(playlist)});
    const after = await env.BUCKET.head(${JSON.stringify(manifest)});
    return Response.json({ items: before.etag === after?.etag ? (await artifact.json()).items : [] });`;
  try {
    for (const [name, metadata, count] of [["stable", { size: 2, etag: "A" }, 2], ["changed", { size: 2, etag: "B" }, 0], ["missing", null, 0]]) {
      const script = [before, artifact, { identity: replayIdentity(["r2.head", manifest, []]), result: metadata }];
      const worker = await loadReplayWorker(`head-race-${name}`, script, probe);
      const response = await worker.fetch(new Request("http://bench.local/probe", { headers: { "x-bench-script": "cold" } }), {}, {});
      assert.equal((await response.json()).items.length, count, name);
      assert.equal(response.headers.get("x-bench-replay-complete"), "1", "all three operations match even when the consumer denies the playlist");
      assert.equal(response.headers.get("x-bench-d1"), "0");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalIdentity === undefined) delete globalThis.__flamenodeBenchIdentity;
    else globalThis.__flamenodeBenchIdentity = originalIdentity;
  }
});

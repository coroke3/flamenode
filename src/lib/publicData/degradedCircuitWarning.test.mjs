import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// CURRENT imports Next/server-only. Execute its actual functions and constants
// with value-retaining synthetic KV and a deterministic clock, not stubbed counters.
const source = await readFile(new URL("./degradedCircuitBreaker.ts", import.meta.url), "utf8");
const core = await readFile(new URL("./degradedCircuitBreakerCore.ts", import.meta.url), "utf8");
const withoutImportsAndExports = text => text.replace(/^import\b[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const program = stripTypeScriptTypes(withoutImportsAndExports(core) + "\n" + withoutImportsAndExports(source), { mode: "strip" });
function runtime(getOperationModeKv, Date, setTimeout, console) {
  return runInNewContext(program + `
    ;({
      miss: recordDegradedCircuitR2Miss,
      hit: recordDegradedCircuitR2Hit,
      isOpen: isDegradedD1CircuitOpen,
      seed: s => { missAccumulator = s; },
      snapshot: () => ({ pending: missAccumulator?.pending, open: localCircuitState.open,
        known: openMarkerKnown, stage: openRepair?.stage ?? null, inflight: openRepairInFlight }),
    })
  `, { getOperationModeKv, Date, setTimeout, console });
}

function createFixture(runtime, { initial = 19, fault = null, badLogger = false } = {}) {
  let now = 60000;
  const faults = Array.isArray(fault) ? [...fault] : fault === null ? [] : [fault];
  const openKey = "public:degraded_circuit:open";
  const hitKey = "public:degraded_circuit:hit_streak";
  const missKey = "public:degraded_circuit:miss:1";
  const values = new Map([[missKey, String(initial)], [hitKey, "2"]]);
  const writes = [], warnings = [], writeTimes = [], rateViolations = [];
  const expirations = new Map();
  let gate = null;
  let reached = null;
  let release = null;
  const lastWrite = new Map();
  function recordWrite(op, key, value) {
    writes.push(value === undefined ? [op, key] : [op, key, value]);
    writeTimes.push([op, key, now]);
    if (now - (lastWrite.get(key) ?? -Infinity) < 1000) {
      rateViolations.push([op, key, now]);
      throw new Error("test rate limit");
    }
    lastWrite.set(key, now);
  }
  const kv = {
    async get(key) {
      if (now >= (expirations.get(key) ?? Infinity)) values.delete(key);
      return values.get(key) ?? null;
    },
    async put(key, value, options) {
      recordWrite("put", key, value);
      if (gate && key === openKey) { reached(); await gate; gate = null; }
      if ((faults[0] === "marker" && key === openKey) ||
        (faults[0] === "counter" && key === missKey)) {
        faults.shift();
        throw new Error("synthetic PUT failure");
      }
      values.set(key, value);
      if (options?.expirationTtl !== undefined) expirations.set(key, now + options.expirationTtl * 1000);
    },
    async delete(key) {
      recordWrite("delete", key);
      if (faults[0] === "cleanup" && key === hitKey) {
        faults.shift();
        throw new Error("synthetic DELETE failure");
      }
      values.delete(key);
      expirations.delete(key);
    },
  };
  const api = runtime(() => kv, { now: () => now },
    (resolve, ms) => { now += ms; resolve(); }, {
      warn(message) { warnings.push(JSON.parse(message)); if (badLogger) throw new Error("logger"); },
    });
  return { ...api, values, writes, warnings, writeTimes, rateViolations, openKey, hitKey, missKey,
    get: key => kv.get(key),
    tick(ms) { now += ms; }, now: () => now,
    pauseMarker() {
      const started = new Promise(resolve => { reached = resolve; });
      gate = new Promise(resolve => { release = resolve; });
      return { started, resume: () => release() };
    }
  };
}

function registerTests(test, equal, runtime) {
  const make = options => createFixture(runtime, options);
  test("SEC-796: logger failure does not re-credit acknowledged misses", async () => {
    const f = make({badLogger:true});
    await f.miss(f.now());
    equal(f.values.get(f.missKey), "20");
    equal(f.snapshot().pending, 0);
    equal(f.snapshot().stage, null);
    equal(f.snapshot().inflight, false);
    equal(f.warnings.length, 1);
    f.tick(1000); await f.miss(f.now());
    equal(f.values.get(f.missKey), "20");
    equal(f.writes.filter(x=>x[1]===f.missKey).length, 1);
  });
  test("SEC-796: healthy OPEN diagnostic keeps fixed fields", async () => {
    const f = make();
    await f.miss(f.now());
    equal(JSON.stringify(f.warnings), JSON.stringify([{service:"degraded-circuit", result:"opened", miss_count:20, threshold:20, window_sec:60}]));
    equal(f.values.get(f.openKey), "1");
    equal(f.values.has(f.hitKey), false);
    equal(f.snapshot().pending, 0);
  });
  test("SEC-798: committed miss is never recredited when marker PUT fails", async () => {
    const f = make({fault:"marker"});
    await f.miss(f.now());
    equal(f.values.get(f.missKey), "20");
    equal(f.snapshot().pending, 0);
    equal(f.snapshot().stage, "marker");
    equal(f.snapshot().known, false);
    equal(await f.isOpen(), true);
    f.tick(100); await f.miss(f.now());
    equal(f.writes.filter(x=>x[1]===f.openKey).length, 1);
    f.tick(900); await f.miss(f.now());
    equal(f.values.get(f.missKey), "20");
    equal(f.values.get(f.openKey), "1");
    equal(f.values.has(f.hitKey), false);
    equal(f.snapshot().stage, null);
    equal(f.writes.filter(x=>x[1]===f.missKey).length, 1);
  });
  test("SEC-798: cleanup retry does not reopen marker or replay counter", async () => {
    const f = make({fault:"cleanup"});
    await f.miss(f.now());
    equal(f.snapshot().stage, "cleanup");
    equal(f.values.get(f.missKey), "20");
    equal(f.snapshot().pending, 0);
    equal(f.values.get(f.openKey), "1");
    equal(f.values.get(f.hitKey), "2");
    equal(f.warnings.length, 0);
    f.tick(1000); await f.miss(f.now());
    equal(f.values.get(f.missKey), "20");
    equal(f.values.has(f.hitKey), false);
    equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length, 1);
    equal(f.warnings.length, 1);
    equal(f.snapshot().stage, null);
  });
  test("SEC-798: unacknowledged counter PUT retains legitimate pending count", async () => {
    const f = make({fault:"counter"});
    await f.miss(f.now());
    equal(f.values.get(f.missKey), "19");
    equal(f.snapshot().pending, 1);
    equal(f.snapshot().stage, null);
    equal(f.snapshot().open, false);
    f.tick(1000); await f.miss(f.now());
    equal(f.values.get(f.missKey), "21");
    equal(f.snapshot().pending, 0);
    equal(f.values.get(f.openKey), "1");
  });
  test("SEC-798: marker repair survives minute rollover", async () => {
    const f = make({fault:"marker"});
    await f.miss(f.now());
    f.tick(60000); await f.miss(f.now());
    equal(f.values.get(f.missKey), "20");
    equal(f.values.get(f.openKey), "1");
    equal(f.snapshot().stage, null);
    equal(f.values.has("public:degraded_circuit:miss:2"), false);
  });
  test("SEC-798: local threshold marker retry remains independent of minute accumulator", async () => {
    const f = make({initial:18,fault:"marker"});
    f.seed({bucket:1,observed:19,pending:0,lastFlushAt:59000});
    await f.miss(f.now());
    equal(f.snapshot().stage, "marker");
    equal(f.snapshot().open, true);
    equal(f.snapshot().pending, 1);
    equal(f.values.get(f.missKey), "18");
    f.tick(60000); await f.miss(f.now());
    equal(f.values.get(f.openKey), "1");
    equal(f.values.get(f.missKey), "18");
    equal(f.snapshot().stage, null);
    equal(f.warnings.length, 0);
  });
  test("SEC-798: expired repair cannot resurrect an old OPEN", async () => {
    const f = make({fault:"marker"});
    await f.miss(f.now());
    f.tick(90000); await f.miss(f.now());
    equal(f.values.get(f.missKey), "20");
    equal(f.values.has(f.openKey), false);
    equal(f.snapshot().stage, null);
    equal(f.snapshot().open, false);
    equal(f.values.get("public:degraded_circuit:miss:2"), "1");
  });
  test("SEC-798: acknowledged marker subsequently absent is not reopened by cleanup", async () => {
    const f = make({fault:"cleanup"});
    await f.miss(f.now());
    f.values.delete(f.openKey);
    f.tick(1000); await f.miss(f.now());
    equal(f.values.has(f.openKey), false);
    equal(f.snapshot().stage, null);
    equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length, 1);
  });
  test("SEC-798: three genuine hits cancel failed-marker repair", async () => {
    const f = make({fault:"marker"});
    await f.miss(f.now());
    await f.hit(); await f.hit(); await f.hit();
    equal(f.snapshot().open, false);
    equal(f.snapshot().stage, null);
    equal(f.values.has(f.openKey), false);
    f.tick(60000); await f.miss(f.now());
    equal(f.values.has(f.openKey), false);
    equal(f.values.get("public:degraded_circuit:miss:2"), "1");
  });
  test("SEC-798: same-isolate close waits for in-flight marker repair", async () => {
    const f = make({fault:"marker"});
    await f.miss(f.now());
    f.tick(1000);
    const pause = f.pauseMarker();
    const repair = f.miss(f.now());
    await pause.started;
    await f.hit(); await f.hit(); await f.hit();
    equal(f.snapshot().inflight, true);
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 0);
    pause.resume(); await repair;
    equal(f.values.get(f.openKey), "1");
    f.tick(1000); await f.hit(); await f.hit(); await f.hit();
    equal(f.values.has(f.openKey), false);
    equal(f.snapshot().open, false);
    equal(f.snapshot().stage, null);
    equal(f.values.get(f.missKey), "20");
  });
  test("SEC-798: late acknowledged marker has its own cleanup deadline", async () => {
    const f = make({fault:["marker", "cleanup"]});
    await f.miss(f.now());
    equal(f.snapshot().stage, "marker");
    f.tick(89000); await f.miss(f.now());
    equal(f.snapshot().stage, "cleanup");
    equal(f.values.get(f.hitKey), "2");
    f.tick(1000); await f.miss(f.now());
    equal(f.snapshot().stage, null);
    equal(f.values.has(f.hitKey), false);
    equal(f.values.get(f.openKey), "1");
    equal(f.values.get(f.missKey), "20");
    equal(f.writes.filter(x=>x[1]===f.missKey).length, 1);
    equal(f.warnings.length, 1);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: cleanup does not run after the acknowledged marker TTL expires", async () => {
    const f = make({fault:["marker", "cleanup"]});
    await f.miss(f.now());
    f.tick(89000); await f.miss(f.now());
    equal(f.snapshot().stage, "cleanup");
    f.tick(90000);
    equal(await f.get(f.openKey), null);
    await f.miss(f.now());
    equal(f.snapshot().stage, null);
    equal(f.values.get(f.hitKey), "2");
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.hitKey).length, 1);
    equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length, 2);
  });
  test("SEC-798: immediate three-hit close respects the shared cleanup write interval", async () => {
    const f = make();
    await f.miss(f.now());
    await f.hit(); await f.hit(); await f.hit();
    equal(f.snapshot().open, false);
    equal(f.values.has(f.openKey), false);
    equal(f.rateViolations.length, 0);
    const deletes = f.writeTimes.filter(x=>x[0]==="delete"&&x[1]===f.hitKey);
    equal(deletes.length, 2);
    equal(deletes[1][2]-deletes[0][2] >= 1000, true);
  });
  test("SEC-798: acknowledged close is not reopened by cleanup failure", async () => {
    const f = make({fault:["marker", "cleanup", "cleanup"]});
    await f.miss(f.now());
    f.tick(1000); await f.miss(f.now());
    equal(f.snapshot().stage, "cleanup");
    await f.hit(); await f.hit(); await f.hit();
    equal(f.snapshot().open, false);
    equal(f.snapshot().stage, null);
    equal(f.values.has(f.openKey), false);
    equal(f.values.get(f.missKey), "20");
    equal(f.rateViolations.length, 0);
  });
}

registerTests(test, assert.equal, runtime);

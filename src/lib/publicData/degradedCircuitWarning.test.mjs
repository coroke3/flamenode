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
  let gatedOp = null, gatedKey = null;
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
  async function pauseIfSelected(op, key) {
    if (gate && gatedOp === op && gatedKey === key) {
      const pendingGate = gate;
      gate = null;
      reached();
      await pendingGate;
    }
  }
  const kv = {
    async get(key) {
      if (now >= (expirations.get(key) ?? Infinity)) values.delete(key);
      const value = values.get(key) ?? null;
      await pauseIfSelected("get", key);
      return value;
    },
    async put(key, value, options) {
      recordWrite("put", key, value);
      await pauseIfSelected("put", key);
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
      await pauseIfSelected("delete", key);
      if (faults[0] === "cleanup" && key === hitKey) {
        faults.shift();
        throw new Error("synthetic DELETE failure");
      }
      values.delete(key);
      expirations.delete(key);
    },
  };
  const api = runtime(() => kv, { now: () => now },
    (resolve, ms) => {
      const finish = () => { now += ms; resolve(); };
      if (gate && gatedOp === "wait" && gatedKey === openKey) {
        void pauseIfSelected("wait", openKey).then(finish);
      } else finish();
    }, {
      warn(message) { warnings.push(JSON.parse(message)); if (badLogger) throw new Error("logger"); },
    });
  return { ...api, values, writes, warnings, writeTimes, rateViolations, openKey, hitKey, missKey,
    get: key => kv.get(key),
    tick(ms) { now += ms; }, now: () => now,
    pauseMarker() { return this.pause("put", openKey); },
    pause(op, key) {
      gatedOp = op; gatedKey = key;
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
    // The three hits above suffice; the repair request finishes the close.
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 1);
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
  test("SEC-798: threshold immediately opens locally during counter PUT", async () => {
    const f = make({initial:0});
    f.seed({bucket:1,observed:18,pending:0,lastFlushAt:-Infinity});
    const pause = f.pause("put", f.missKey);
    const flushing = f.miss(f.now());
    await pause.started;
    await f.miss(f.now());
    equal(await f.isOpen(), true);
    equal(f.snapshot().stage, "marker");
    equal(f.snapshot().pending, 1);
    equal(f.values.has(f.openKey), false);
    pause.resume(); await flushing;
    equal(f.values.get(f.openKey), "1");
    equal(f.values.get(f.missKey), "1");
    equal(f.snapshot().pending, 1);
    f.tick(1000); await f.miss(f.now());
    equal(f.values.get(f.missKey), "2");
    equal(f.snapshot().pending, 0);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: concurrent threshold while counter reads remote state survives stale closed read", async () => {
    const f = make({initial:0});
    f.seed({bucket:1,observed:18,pending:0,lastFlushAt:-Infinity});
    const pause = f.pause("get", f.openKey);
    const flushing = f.miss(f.now());
    await pause.started;
    await f.miss(f.now());
    equal(await f.isOpen(), true);
    pause.resume(); await flushing;
    equal(f.values.get(f.openKey), "1");
    equal(f.snapshot().open, true);
    equal(f.snapshot().pending, 1);
  });
  test("SEC-798: delayed closed probe cannot erase newly opened circuit", async () => {
    const f = make();
    const pause = f.pause("get", f.openKey);
    const probing = f.isOpen();
    await pause.started;
    await f.miss(f.now());
    equal(f.values.get(f.openKey), "1");
    pause.resume();
    equal(await probing, true);
    equal(f.snapshot().open, true);
    equal(f.snapshot().known, true);
  });
  test("SEC-798: delayed open probe cannot resurrect acknowledged close", async () => {
    const f = make({initial:0});
    f.values.set(f.openKey, "1");
    const pause = f.pause("get", f.openKey);
    const probing = f.isOpen();
    await pause.started;
    await f.hit(); await f.hit(); await f.hit();
    equal(f.values.has(f.openKey), false);
    pause.resume();
    equal(await probing, false);
    equal(f.snapshot().open, false);
  });
  test("SEC-798: delayed old counter acknowledgement does not open next minute", async () => {
    const f = make();
    f.tick(59900);
    const pause = f.pause("put", f.missKey);
    const old = f.miss(f.now());
    await pause.started;
    f.tick(100); await f.miss(f.now());
    equal(f.snapshot().pending, 1);
    pause.resume(); await old;
    equal(f.values.get(f.missKey), "20");
    equal(f.values.get("public:degraded_circuit:miss:2"), "1");
    equal(f.snapshot().pending, 0);
    equal(f.snapshot().stage, null);
    equal(f.values.has(f.openKey), false);
    equal(f.snapshot().open, false);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: failed old counter expires without recrediting new bucket", async () => {
    const f = make({fault:"counter"});
    f.tick(59900);
    const pause = f.pause("put", f.missKey);
    const old = f.miss(f.now());
    await pause.started;
    f.tick(100); await f.miss(f.now());
    pause.resume(); await old;
    equal(f.values.get(f.missKey), "19");
    equal(f.values.get("public:degraded_circuit:miss:2"), "1");
    equal(f.snapshot().pending, 0);
    equal(f.snapshot().open, false);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: expired counter read cannot initiate an old PUT", async () => {
    const f = make();
    f.tick(59900);
    const pause = f.pause("get", f.missKey);
    const old = f.miss(f.now());
    await pause.started;
    f.tick(100); await f.miss(f.now());
    pause.resume(); await old;
    equal(f.values.get(f.missKey), "19");
    equal(f.writes.filter(x=>x[1]===f.missKey).length, 0);
    equal(f.values.get("public:degraded_circuit:miss:2"), "1");
    equal(f.snapshot().open, false);
  });
  test("SEC-798: delayed scheduled miss cannot replace newer bucket", async () => {
    const f = make({initial:0});
    const oldNow = f.now();
    f.tick(60000); await f.miss(f.now());
    f.tick(100); await f.miss(f.now());
    equal(f.snapshot().pending, 1);
    await f.miss(oldNow);
    equal(f.snapshot().pending, 1);
    equal(f.writes.filter(x=>x[1]===f.missKey).length, 0);
    f.tick(900); await f.miss(f.now());
    equal(f.values.get("public:degraded_circuit:miss:2"), "3");
    equal(f.snapshot().pending, 0);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: expired delayed marker read cannot renew an old OPEN", async () => {
    const f = make({fault:"marker"});
    await f.miss(f.now());
    f.tick(89000);
    f.values.set(f.openKey, "1");
    const pause = f.pause("get", f.openKey);
    const repairing = f.miss(f.now());
    await pause.started;
    f.tick(1000);
    f.values.delete(f.openKey);
    pause.resume(); await repairing;
    equal(f.snapshot().stage, null);
    equal(await f.isOpen(), false);
    equal(f.values.has(f.openKey), false);
    equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length, 1);
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.hitKey).length, 0);
  });
  test("SEC-798: hits at original deadline survive outstanding marker PUT", async () => {
    const f = make({fault:"marker"});
    await f.miss(f.now());
    f.tick(89000);
    const pause = f.pauseMarker();
    const repairing = f.miss(f.now());
    await pause.started;
    f.tick(1000);
    await f.hit(); await f.hit(); await f.hit();
    equal(await f.isOpen(), true);
    equal(f.snapshot().stage, "marker");
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 0);
    pause.resume(); await repairing;
    equal(f.values.has(f.openKey), false);
    equal(f.snapshot().open, false);
    equal(f.snapshot().stage, null);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: acknowledgement beyond write-start TTL needs a fresh probe", async () => {
    const f = make();
    const pause = f.pauseMarker();
    const repairing = f.miss(f.now());
    await pause.started;
    f.tick(90000);
    await f.hit(); await f.hit(); await f.hit();
    pause.resume(); await repairing;
    equal(f.snapshot().known, false);
    equal(f.snapshot().stage, null);
    equal(f.values.get(f.openKey), "1");
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 0);
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.hitKey).length, 0);
    equal(await f.isOpen(), true);
  });
  test("SEC-798: delayed cold hit read cannot cancel newer local threshold", async () => {
    const f = make({initial:0});
    f.seed({bucket:1,observed:19,pending:0,lastFlushAt:-Infinity});
    const pause = f.pause("get", f.openKey);
    const hitting = f.hit();
    await pause.started;
    await f.miss(f.now());
    equal(await f.isOpen(), true);
    equal(f.snapshot().stage, "marker");
    pause.resume(); await hitting;
    equal(f.values.get(f.openKey), "1");
    equal(f.snapshot().open, true);
    equal(f.snapshot().stage, null);
    equal(f.snapshot().pending, 1);
  });
  test("SEC-798: newer threshold during old close cleanup propagates after cleanup", async () => {
    const f = make();
    await f.miss(f.now());
    await f.hit(); await f.hit();
    f.tick(1000);
    const pause = f.pause("delete", f.hitKey);
    const closing = f.hit();
    await pause.started;
    f.seed({bucket:1,observed:19,pending:0,lastFlushAt:-Infinity});
    await f.miss(f.now());
    equal(await f.isOpen(), true);
    equal(f.snapshot().stage, "marker");
    equal(f.values.has(f.openKey), false);
    pause.resume(); await closing;
    equal(f.values.get(f.openKey), "1");
    equal(f.snapshot().open, true);
    equal(f.snapshot().stage, null);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: three hits during pending counter flush close without a fourth hit", async () => {
    const f = make({initial:0});
    f.values.set(f.openKey, "1");
    equal(await f.isOpen(), true);
    f.seed({bucket:1,observed:1,pending:1,lastFlushAt:-Infinity});
    const pause = f.pause("put", f.missKey);
    const flushing = f.miss(f.now());
    await pause.started;
    await f.hit(); await f.hit(); await f.hit();
    equal(f.values.get(f.openKey), "1");
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 0);
    pause.resume(); await flushing;
    equal(f.values.get(f.missKey), "1");
    equal(f.snapshot().pending, 0);
    equal(f.values.has(f.openKey), false);
    equal(f.snapshot().open, false);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: fewer than three hits during counter flush leave OPEN intact", async () => {
    const f = make({initial:0});
    f.values.set(f.openKey, "1");
    equal(await f.isOpen(), true);
    f.seed({bucket:1,observed:1,pending:1,lastFlushAt:-Infinity});
    const pause = f.pause("put", f.missKey);
    const flushing = f.miss(f.now());
    await pause.started;
    await f.hit(); await f.hit();
    pause.resume(); await flushing;
    equal(f.values.get(f.missKey), "1");
    equal(f.snapshot().pending, 0);
    equal(f.values.get(f.openKey), "1");
    equal(f.snapshot().open, true);
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 0);
    await f.hit();
    equal(f.values.has(f.openKey), false);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: three hits on newer OPEN during stale cold hit read finish close", async () => {
    const f = make({initial:0});
    f.seed({bucket:1,observed:19,pending:0,lastFlushAt:-Infinity});
    const pause = f.pause("get", f.openKey);
    const hitting = f.hit();
    await pause.started;
    await f.miss(f.now());
    equal(f.snapshot().stage, "marker");
    await f.hit(); await f.hit(); await f.hit();
    equal(await f.isOpen(), true);
    pause.resume(); await hitting;
    equal(f.snapshot().stage, null);
    equal(f.snapshot().open, false);
    equal(f.values.has(f.openKey), false);
    equal(f.writes.filter(x=>x[1]===f.openKey).length, 0);
    equal(f.snapshot().pending, 1);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: three hits on newer OPEN during old close cleanup finish close", async () => {
    const f = make();
    await f.miss(f.now());
    await f.hit(); await f.hit();
    f.tick(1000);
    const pause = f.pause("delete", f.hitKey);
    const closing = f.hit();
    await pause.started;
    f.seed({bucket:1,observed:19,pending:0,lastFlushAt:-Infinity});
    await f.miss(f.now());
    equal(f.snapshot().stage, "marker");
    await f.hit(); await f.hit(); await f.hit();
    pause.resume(); await closing;
    equal(f.snapshot().stage, null);
    equal(f.snapshot().open, false);
    equal(f.values.has(f.openKey), false);
    equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length, 1);
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 1);
    equal(f.snapshot().pending, 1);
    equal(f.rateViolations.length, 0);
  });
  for (const point of ["wait", "delete"]) {
    for (const newerHits of [0, 3]) {
      test("SEC-798: expired old OPEN close " + point + " cannot erase newer repair (" + newerHits + " hits)", async () => {
        const f = make();
        await f.miss(f.now());
        await f.hit(); await f.hit();
        if (point === "delete") f.tick(1000);
        const pause = f.pause(point, f.openKey);
        const closing = f.hit();
        await pause.started;
        // Both the original remote marker and the close's local TTL expire.
        // A fresh probe releases the old OPEN; a new bucket crosses threshold
        // while the old close still owns its asynchronous write lock.
        f.tick(90001);
        equal(await f.isOpen(), false);
        f.seed({bucket:Math.floor(f.now()/60000),observed:19,pending:0,lastFlushAt:-Infinity});
        await f.miss(f.now());
        equal(f.snapshot().stage, "marker");
        equal(await f.isOpen(), true);
        for (let i=0; i<newerHits; i++) await f.hit();
        pause.resume(); await closing;
        equal(f.snapshot().stage, null);
        equal(f.snapshot().pending, 1);
        equal(f.snapshot().open, newerHits === 0);
        equal(f.values.has(f.openKey), newerHits === 0);
        // Initial OPEN cleanup is the only streak delete; stale close must
        // neither erase the new intent nor clean up its hit bookkeeping.
        equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.hitKey).length, 1);
        equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, point === "delete" ? 1 : 0);
        equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length, newerHits === 0 ? 2 : 1);
        equal(f.rateViolations.length, 0);
      });
    }
  }
  for (const markerPhase of ["existing GET", "missing GET", "missing PUT"]) {
    for (const priorHits of [0, 1, 2]) {
      for (const earnedHits of [0, 1, 2, 3]) {
        test("SEC-798: " + markerPhase + " keeps only post-miss hits (" + priorHits + " prior, " + earnedHits + " earned)", async () => {
          const f = make({initial:0});
          f.values.set(f.openKey, "1");
          equal(await f.isOpen(), true);
          for (let i=0; i<priorHits; i++) await f.hit();
          if (markerPhase !== "existing GET") f.values.delete(f.openKey);
          f.seed({bucket:1,observed:1,pending:1,lastFlushAt:-Infinity});
          const pause = f.pause(markerPhase === "missing PUT" ? "put" : "get", f.openKey);
          const flushing = f.miss(f.now());
          await pause.started;
          for (let i=0; i<earnedHits; i++) await f.hit();
          pause.resume(); await flushing;
          equal(f.values.get(f.missKey), "1");
          equal(f.snapshot().pending, 0);
          equal(f.snapshot().open, earnedHits < 3);
          equal(f.values.has(f.openKey), earnedHits < 3);
          equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length,
            markerPhase === "existing GET" ? 0 : 1);
          if (earnedHits < 3) {
            for (let i=earnedHits; i<2; i++) await f.hit();
            equal(f.values.has(f.openKey), true);
            await f.hit();
          }
          equal(f.values.has(f.openKey), false);
          equal(f.snapshot().open, false);
          equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 1);
          equal(f.rateViolations.length, 0);
        });
      }
    }
  }
  test("SEC-798: expired missing-marker read cannot start a new OPEN PUT", async () => {
    const f = make({initial:0});
    f.values.set(f.openKey, "1");
    equal(await f.isOpen(), true);
    f.tick(89999);
    f.values.delete(f.openKey);
    f.seed({bucket:2,observed:1,pending:1,lastFlushAt:-Infinity});
    const pause = f.pause("get", f.openKey);
    const flushing = f.miss(f.now());
    await pause.started;
    f.tick(2);
    pause.resume(); await flushing;
    equal(f.values.has(f.openKey), false);
    equal(f.writes.filter(x=>x[0]==="put"&&x[1]===f.openKey).length, 0);
    equal(f.snapshot().pending, 1);
    f.tick(1000);
    await f.miss(f.now());
    equal(f.values.get("public:degraded_circuit:miss:2"), "2");
    equal(f.snapshot().pending, 0);
    equal(f.snapshot().open, false);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: stale missing-marker PUT receipt requires a fresh closed-state probe", async () => {
    const f = make({initial:0});
    f.values.set(f.openKey, "1");
    equal(await f.isOpen(), true);
    f.tick(89999);
    f.values.delete(f.openKey);
    f.seed({bucket:2,observed:1,pending:1,lastFlushAt:-Infinity});
    const pause = f.pauseMarker();
    const flushing = f.miss(f.now());
    await pause.started;
    f.tick(2);
    equal(await f.isOpen(), false);
    pause.resume(); await flushing;
    equal(f.values.get(f.openKey), "1");
    equal(f.values.get("public:degraded_circuit:miss:2"), "1");
    equal(f.snapshot().pending, 0);
    equal(f.snapshot().open, false);
    equal(f.snapshot().known, false);
    equal(await f.isOpen(), true);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: expired OPEN read cannot resurrect a newer closed generation", async () => {
    const f = make({initial:0});
    f.values.set(f.openKey, "1");
    equal(await f.isOpen(), true);
    f.tick(89999);
    f.seed({bucket:2,observed:1,pending:1,lastFlushAt:-Infinity});
    const pause = f.pause("get", f.openKey);
    const flushing = f.miss(f.now());
    await pause.started;
    f.tick(2);
    f.values.delete(f.openKey);
    equal(await f.isOpen(), false);
    pause.resume(); await flushing;
    equal(f.snapshot().open, false);
    equal(f.snapshot().pending, 0);
    equal(f.values.get("public:degraded_circuit:miss:2"), "1");
    equal(f.writes.filter(x=>x[1]===f.openKey).length, 0);
    equal(f.rateViolations.length, 0);
  });
  test("SEC-798: stale closed marker read preserves newer probe OPEN and its hits", async () => {
    const f = make({initial:0});
    const pause = f.pause("get", f.openKey);
    const flushing = f.miss(f.now());
    await pause.started;
    f.values.set(f.openKey, "1");
    equal(await f.isOpen(), true);
    await f.hit(); await f.hit(); await f.hit();
    pause.resume(); await flushing;
    equal(f.snapshot().pending, 0);
    equal(f.values.get(f.missKey), "1");
    equal(f.snapshot().open, false);
    equal(f.values.has(f.openKey), false);
    equal(f.writes.filter(x=>x[0]==="delete"&&x[1]===f.openKey).length, 1);
    equal(f.rateViolations.length, 0);
  });
}

registerTests(test, assert.equal, runtime);

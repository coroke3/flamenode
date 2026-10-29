import test from "node:test";
import assert from "node:assert/strict";
import {
  BUDGETS_MS, KINDS, MIN_SAMPLES, aggregate, buildScenarios, judge, parseArgs, percentile, renderMarkdown, summarize,
} from "./benchmark-api-cpu.mjs";

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
  assert.deepEqual(
    scenarios.filter((s) => !s.baseline).map((s) => s.id),
    ["RH-018", "RH-017", "RH-026", "RH-029", "SA-004", "SA-005", "SA-006", "SA-007", "SA-008", "RH-020", "RH-021", "RH-022", "S4"],
  );
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
  assert.match(a, /Budget verdict by max \(unit test\)/);
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

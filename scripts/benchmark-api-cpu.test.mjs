import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { materializeD1CompatibleMigrations } from "./d1-migration-compat.mjs";
import {
  BUDGETS_MS, KINDS, MIN_SAMPLES, ROUTE_INVENTORY, SEED, aggregate, buildPendingScenarios, buildScenarios, judge, parseArgs, percentile, renderMarkdown, summarize,
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
  "GET /api/manage/events/:id/staff", "GET /api/manage/events/:id/slots", "GET /api/manage/events/:id/edit",
  "GET /api/manage/events/:id/videos/:videoId", "GET /api/manage/events/:id/videos", "GET /api/manage/events/:id/youtube-playlist",
  "POST /api/manage/events/:id/youtube-playlist/sync", "PUT /api/manage/events/:id/youtube-playlist", "GET /api/manage/events/:id/audience",
  "GET /api/manage/events/:id", "GET /api/manage/notifications", "GET /api/manage/x-link-requests", "GET /api/manage",
  "GET /api/admin/spreadsheet/data", "GET /api/admin/spreadsheet/export", "GET /api/admin/spreadsheet/tables", "GET /api/admin/event-templates",
  "POST /api/admin/announcements", "PUT /api/admin/announcements/:id", "DELETE /api/admin/announcements/:id",
  "POST /api/admin/api-endpoints", "PATCH /api/admin/api-endpoints/:id", "POST /api/admin/audit/settings", "POST /api/admin/audit/dry-run",
  "POST /api/admin/cost-guard/mode", "POST /api/admin/cost-guard/maintenance", "POST /api/admin/cost-guard/override",
  "POST /api/admin/cost-guard/disabled-features", "POST /api/admin/cost-guard/override/clear",
  "POST /api/admin/users/:userId/role", "POST /api/admin/users/:userId/banned", "POST /api/admin/users/:userId/notifications",
  "POST /api/admin/users/:userId/can-create-events", "POST /api/admin/x-users/:xUserId/icon-refresh",
  "POST /api/admin/event-templates", "DELETE /api/admin/event-templates/:id",
  "GET /api/live/events/:id/slots", "GET /api/live/events/:id/submissions", "GET /api/live/events/:id/summary",
  "GET /api/events/:id/slots/viewer-overlay", "GET /api/events", "GET /api/event-endpoints/:id/release",
  "GET /api/videos", "GET /api/videos/:id/viewer-overlay", "GET /api/videos/:id",
  "POST /api/videos/:videoId/chapters", "POST /api/videos/:videoId/chapters/bulk", "PUT /api/videos/chapters/:chapterId",
  "DELETE /api/videos/chapters/:chapterId", "POST /api/videos/:videoId/interaction", "GET /api/account/summary",
  "GET /api/google-drive-image/:id", "GET /api/youtube-thumbnail/:id/:size", "GET /api/media/manage-x-icon/*",
  "GET /api/media/slot-submission-icon/:slotId", "GET /api/media/*", "GET /api/internal/x-users/search",
]);

test("MIG-0639 T01: every main Hono method has exactly one scenario (named or inventory)", () => {
  const scenarios = buildScenarios({ adminToken: "t" }).filter((s) => !s.baseline && s.id !== "S4");
  const titles = scenarios.map((s) => s.title.replace(/ \(.*\)$/, ""));
  assert.equal(new Set(titles).size, titles.length, "no method has two scenarios");
  assert.deepEqual([...MAIN_HONO_METHODS].filter((m) => !titles.includes(m)), [], "methods without a scenario");
  assert.deepEqual(titles.filter((t) => !MAIN_HONO_METHODS.has(t)), [], "scenarios for methods that are not mounted");
  assert.equal(MAIN_HONO_METHODS.size, 116);
});

test("MIG-0639 T01: the method list equals the routes mounted in apps/api/src/app.ts", async () => {
  const { app } = await import("../apps/api/src/app.ts");
  const mounted = new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`));
  assert.deepEqual([...MAIN_HONO_METHODS].filter((m) => !mounted.has(m)), [], "listed but no longer mounted");
  assert.deepEqual([...mounted].filter((m) => !MAIN_HONO_METHODS.has(m)), [], "mounted but not benchmarked (add a scenario)");
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
        assert.equal(spec.headers.origin, "https://bench.flamenode.invalid", `${sc.id}/${kind} sends the configured origin`);
        assert.ok(spec.headers.cookie, `${sc.id}/${kind} carries a session`);
        assert.equal(spec.headers["content-type"], "application/json");
        if (spec.body !== undefined) JSON.parse(spec.body);
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

test("MIG-0639 / PR #457: RH-013 upper bound is owned here, excluded until MIG-0632 mounts the route", async () => {
  assert.equal(buildScenarios({ adminToken: "t" }).some((x) => x.id === "RH-013"), false, "not measured while unmounted");
  const withPending = buildScenarios({ adminToken: "t" }, { includePending: true });
  const rh13 = withPending.find((x) => x.id === "RH-013");
  assert.equal(rh13.pending, "MIG-0632");
  assert.equal(withPending.at(-1).id, "BASELINE");
  assert.equal(JSON.parse(rh13.prepareKind.limit.r2Objects["events/bench-evt/release.v1.json"]).videos.length, 500);
  assert.equal(buildPendingScenarios().length, 1);
  assert.equal(parseArgs(["--include-pending"]).includePending, true);
  assert.equal(parseArgs([]).includePending, false);
  const { app } = await import("../apps/api/src/app.ts");
  assert.equal(app.routes.some((r) => r.method === "GET" && r.path === "/api/event-endpoints/:id"), false,
    "RH-013 is now mounted: move its entry from buildPendingScenarios() into ROUTE_INVENTORY and update MAIN_HONO_METHODS");
});

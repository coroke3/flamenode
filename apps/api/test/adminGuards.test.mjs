// MIG-0602 U02 fix round: S3 D1 budget (<= 3 pre-reads + 1 batch), 64KB body
// cap, origin-before-session, contracts schemas, generalized write guard
// (requiredRole / activeX) mounted as writeGuardMiddleware({ requiredRole, activeX }).
import test from "node:test";
import assert from "node:assert/strict";
import * as schema from "@flamenode/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  ApiEndpointSetActiveBodySchema,
  AnnouncementWriteBodySchema,
} from "@flamenode/contracts";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { MAX_ADMIN_JSON_BODY_BYTES } from "../src/routes/admin/body.ts";
import { costGuardMiddleware } from "../src/middleware/costGuard.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null };
const VALID = { title: "T", body: "B", severity: "info", target_audience: "all", is_published: 1 };

const SESSION_TOKEN = "mig-0689-fixture-token";
function seedCookieSession(sqlite) {
  sqlite.exec('CREATE TABLE "session" ("sessionToken" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "expires" INTEGER NOT NULL)');
  sqlite.prepare('INSERT INTO "session" VALUES (?, ?, ?)').run(SESSION_TOKEN, ADMIN.id, Date.now() + 3_600_000);
}
function setup({ cookieSession = false } = {}) {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const reads = [];
  if (cookieSession) {
    seedCookieSession(d1.sqlite);
    const prepare = d1.db.prepare.bind(d1.db);
    d1.db.prepare = (sql) => {
      const statement = prepare(sql);
      return {
        ...statement,
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            ...bound,
            first: async (...args) => {
              reads.push({ sql, values });
              return bound.first(...args);
            },
          };
        },
      };
    };
  }
  const hono = new Hono();
  hono.route("/api/admin", cookieSession ? createAdminRoutes() : createAdminRoutes({
    session: async (c, next) => {
      c.set("user", ADMIN);
      c.set("sessionState", "user");
      await next();
    },
  }));
  const request = (method, path, body, headers = { Origin: SITE }, raw) =>
    hono.request(cookieSession ? SITE + path : path, {
      method,
      headers: { "content-type": "application/json", ...(cookieSession ? { cookie: "__Secure-authjs.session-token=" + SESSION_TOKEN } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  return { ...d1, request, hono, reads };
}

// ---------------- B2: D1 budget ----------------

test("S3 budget: real-cookie routes use <= 3 pre-reads and exactly 1 batch", async () => {
  const cases = [
    ["POST", "/api/admin/announcements", { ...VALID, id: "a-b" }, null, 1],
    ["PUT", "/api/admin/announcements/a-b", { ...VALID, title: "N", base_updated_at: 100 }, (s) => s.prepare("INSERT INTO announcements VALUES ('a-b','O','B','info',0,NULL,NULL,'all','x',50,100)").run(), 2],
    ["DELETE", "/api/admin/announcements/a-b", undefined, (s) => s.prepare("INSERT INTO announcements VALUES ('a-b','O','B','info',0,NULL,NULL,'all','x',50,100)").run(), 2],
    ["POST", "/api/admin/api-endpoints", { event_id: "ev-1" }, (s) => seedEvent(s), 2],
    ["PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: false }, (s) => seedEvent(s, { public_api_enabled: 1 }), 2],
  ];
  for (const [method, path, body, seed, expectedReads] of cases) {
    const { sqlite, request, stats, reads } = setup({ cookieSession: true });
    if (seed) seed(sqlite);
    const res = await request(method, path, body);
    assert.equal(res.status, 200, `${method} ${path}`);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.ok(stats.reads <= 3, `${method} ${path}: reads ${stats.reads}`);
    assert.equal(stats.reads, expectedReads + 1, `${method} ${path} including session read`);
    assert.equal(reads.length, stats.reads);
    assert.match(reads[0].sql, /FROM "session" s/);
    assert.match(reads[1].sql, /LEFT JOIN "system_settings" s/);
    const expectedBinds = [[SESSION_TOKEN], [ADMIN.id]];
    if (expectedReads === 2) expectedBinds.push([path.includes("/announcements") ? "a-b" : "ev-1"]);
    assert.deepEqual(reads.map((read) => read.values), expectedBinds);
    assert.equal(stats.batches, 1, `${method} ${path} batches`);
  }
});

test("MIG-0689: warm real-cookie writes refresh admission and preserve CAS rollback budget", async () => {
  const { sqlite, db, request, stats, reads } = setup({ cookieSession: true });
  const id = "cas-1";
  const path = "/api/admin/announcements/" + id;
  sqlite.prepare("INSERT INTO announcements VALUES (?, 'Old', 'B', 'info', 0, NULL, NULL, 'all', 'x', 50, 100)").run(id);
  const getRow = () => ({ ...sqlite.prepare("SELECT * FROM announcements WHERE id = ?").get(id) });
  const effects = () => ({
    audits: sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
    queue: sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all(),
  });
  const batchTrace = [];
  let race = false;
  const originalBatch = db.batch.bind(db);
  db.batch = async (statements) => {
    batchTrace.push(statements.map((s) => ({ sql: s._sql, binds: s._params })));
    if (race) {
      // An independent writer changes the version after the resource read,
      // before the mutation's atomic batch (not a D1 read by this request).
      race = false;
      sqlite.prepare("UPDATE announcements SET updated_at = updated_at + 1 WHERE id = ?").run(id);
    }
    return originalBatch(statements);
  };
  const mark = () => ({ reads: stats.reads, traces: reads.length, batches: stats.batches, batchTraces: batchTrace.length });
  const verify = (before, count, batches, base) => {
    assert.equal(stats.reads - before.reads, count);
    assert.equal(reads.length - before.traces, count);
    assert.equal(stats.batches - before.batches, batches);
    assert.equal(batchTrace.length - before.batchTraces, batches);
    const trace = reads.slice(before.traces);
    assert.match(trace[0].sql, /FROM "session" s/);
    assert.match(trace[1].sql, /LEFT JOIN "system_settings" s/);
    if (count === 3) assert.match(trace[2].sql, /FROM announcements/);
    assert.deepEqual(trace.map((r) => r.values), [[SESSION_TOKEN], [ADMIN.id], ...(count === 3 ? [[id]] : [])]);
    if (batches) {
      const statements = batchTrace.at(-1);
      assert.ok(count + statements.length <= 50);
      assert.ok(statements.every((s) => Array.isArray(s.binds) && s.binds.length <= 100));
      const update = statements.find((s) => /UPDATE announcements\s+SET/.test(s.sql));
      assert.ok(update);
      assert.deepEqual(update.binds.slice(-2), [id, base]);
      assert.ok(statements.some((s) => /INSERT INTO audit_logs/i.test(s.sql)));
    }
  };
  const initial = getRow();
  const emptyEffects = effects();
  let before = mark();
  const stale = await request("PUT", path, { ...VALID, title: "Stale", base_updated_at: 99 });
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await stale.json(), { ok: false, message: "他の操作で更新されています。再読み込みして確認してください。" });
  verify(before, 3, 0);
  assert.deepEqual(getRow(), initial);
  assert.deepEqual(effects(), emptyEffects);

  // Same Hono instance and same cookie: permission/config cannot be cached.
  sqlite.exec("UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'");
  before = mark();
  const denied = await request("PUT", path, { ...VALID, title: "Denied", base_updated_at: 100 });
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  assert.equal((await denied.json()).reason, "maintenance_mode");
  verify(before, 2, 0);
  assert.deepEqual(getRow(), initial);
  assert.deepEqual(effects(), emptyEffects);

  sqlite.exec("UPDATE system_settings SET operation_mode = 'normal', audit_normal_retention_days = 45 WHERE id = 'default'");
  sqlite.prepare('UPDATE "user" SET name = ? WHERE id = ?').run("Fresh actor", ADMIN.id);
  before = mark();
  const allowed = await request("PUT", path, { ...VALID, title: "Committed", base_updated_at: 100 });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await allowed.json(), { ok: true, id });
  verify(before, 3, 1, 100);
  const committed = getRow();
  assert.equal(committed.title, "Committed");
  const committedEffects = effects();
  assert.equal(committedEffects.audits.length, 1);
  assert.equal(committedEffects.audits[0].expires_at - committedEffects.audits[0].created_at, 45 * 86400);
  assert.equal(JSON.parse(committedEffects.audits[0].actor_snapshot_json).discord_name, "Fresh actor");
  assert.ok(committedEffects.queue.length > 0);

  before = mark();
  race = true;
  const raced = await request("PUT", path, { ...VALID, title: "Lost", base_updated_at: committed.updated_at });
  assert.equal(raced.status, 500);
  assert.equal(raced.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await raced.json(), { ok: false, message: "保存に失敗しました。再読み込みして、もう一度お試しください。" });
  verify(before, 3, 1, committed.updated_at);
  assert.equal(race, false, "race reached the actual atomic batch");
  assert.deepEqual(getRow(), { ...committed, updated_at: committed.updated_at + 1 });
  assert.deepEqual(effects(), committedEffects);
});

test("missing CostGuard settings row preserves the authenticated user and fails as maintenance", async () => {
  const { sqlite, request, stats } = setup({ cookieSession: true });
  sqlite.prepare("DELETE FROM system_settings WHERE id = 'default'").run();
  const response = await request("POST", "/api/admin/announcements", { ...VALID, id: "missing-settings" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "maintenance_mode");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(stats.reads, 2, "session plus one joined admission read");
  assert.equal(stats.batches, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 0);
});

test("shared admission reuses the latest major and projects the strict ToS flag", async () => {
  const { loadTosState } = await import("../src/middleware/writeOrigin.ts");
  const cases = [
    { flag: 1, mirror: "major-old", consent: null, accepted: 1, reaccept: 1, reason: "tos_reaccept_required" },
    { flag: 1, mirror: "major-new", consent: null, accepted: 1, reaccept: 0, reason: null },
    { flag: 1, mirror: "minor-new", consent: null, accepted: 1, reaccept: 0, reason: null },
    { flag: 1, mirror: null, consent: "major-new", accepted: 1, reaccept: 0, reason: null },
    // CURRENT termsReacceptRequiredCondition and the Personal read CASE treat
    // a selected timestamp-zero major as no reaccept requirement. Do not
    // filter it out before selecting the latest major (negative older row).
    { flag: 1, mirror: null, consent: null, olderAt: -1, newestAt: 0, accepted: 1, reaccept: 0, reason: null },
    { flag: 1, mirror: null, consent: null, olderAt: 0, newestAt: 0, accepted: 1, reaccept: 0, reason: null },
    { flag: 0, mirror: null, consent: null, olderAt: -1, newestAt: 0, accepted: 0, reaccept: 0, reason: "tos_required" },
    { flag: 1, mirror: null, consent: null, olderAt: -2, newestAt: -1, accepted: 1, reaccept: 1, reason: "tos_reaccept_required" },
    { flag: 1, mirror: "major-old", consent: null, olderAt: 0, newestAt: 1, accepted: 1, reaccept: 1, reason: "tos_reaccept_required" },
    { flag: "x".repeat(100000), mirror: "major-new", consent: null, accepted: 0, reaccept: 0, reason: "tos_required" },
    { flag: Buffer.from([49]), mirror: "major-new", consent: null, accepted: 0, reaccept: 0, reason: "tos_required" },
  ];
  for (const [i, fixture] of cases.entries()) {
    const { sqlite, db, request, stats, reads } = setup({ cookieSession: true });
    sqlite.exec(`INSERT INTO terms_versions VALUES
      ('major-old', 'major', 100, 1), ('major-new', 'major', 100, 2),
      ('minor-new', 'minor', 200, 3), ('unpublished', 'major', NULL, 4)`);
    if (fixture.newestAt !== undefined) {
      sqlite.prepare("UPDATE terms_versions SET published_at = CASE id WHEN 'major-new' THEN ? WHEN 'major-old' THEN ? END WHERE id IN ('major-new', 'major-old')")
        .run(fixture.newestAt, fixture.olderAt);
    }
    sqlite.prepare('UPDATE "user" SET is_tos_accepted = ?, accepted_terms_version_id = ? WHERE id = ?')
      .run(fixture.flag, fixture.mirror, ADMIN.id);
    if (fixture.consent) {
      sqlite.prepare("INSERT INTO user_tos_consents VALUES (?, ?, ?)")
        .run("consent", ADMIN.id, fixture.consent);
    }
    const standalone = await loadTosState(db, ADMIN.id);
    assert.equal(standalone.is_tos_accepted, fixture.accepted);
    assert.equal(standalone.terms_reaccept_required, fixture.reaccept);
    assert.equal(stats.reads, 1);
    const standaloneRead = reads[0];
    const rawStandalone = sqlite.prepare(standaloneRead.sql).get(...standaloneRead.values);
    assert.equal(rawStandalone.is_tos_accepted, fixture.accepted);
    assert.equal(rawStandalone.terms_reaccept_required, fixture.reaccept);
    const response = await request("POST", "/api/admin/announcements", { ...VALID, id: "tos-" + i });
    assert.equal(response.status, fixture.reason ? 403 : 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (fixture.reason) assert.equal((await response.json()).reason, fixture.reason);
    assert.equal(stats.reads, 3, "one standalone fixture read, then session + admission");
    assert.equal(stats.batches, fixture.reason ? 0 : 1);
    const admission = reads[2];
    assert.equal((admission.sql.match(/FROM "terms_versions"\s+WHERE "severity" = 'major'/g) ?? []).length, 1);
    // Replay only in the test fixture, outside the actual Hono/D1 accounting.
    const raw = sqlite.prepare(admission.sql).get(...admission.values);
    assert.equal(raw.is_tos_accepted, fixture.accepted);
    assert.equal(raw.terms_reaccept_required, fixture.reaccept);
  }
});

test("S3 budget parity: guard-fed audit equals audit that reads settings/actor itself", async () => {
  const { sqlite, request } = setup();
  sqlite.prepare("UPDATE system_settings SET audit_normal_retention_days = 45").run();
  sqlite.prepare("UPDATE \"user\" SET image = 'https://img/u.png'").run();
  await request("POST", "/api/admin/announcements", { ...VALID, id: "a-p" });
  const a = sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(a.expires_at - a.created_at, 45 * 86400);
  assert.equal(JSON.parse(a.actor_snapshot_json).icon_url, "https://img/u.png");
});


// The SQL receipt is lossless for CostGuard's decision inputs, not a new policy.
// Use the existing mounted SQLite-backed Hono suite with the actual HTTPS cookie reader.
test("MIG-0689: joined feature-list receipts stay bounded and preserve CostGuard decisions", async () => {
  const { evaluateCostGuardCore, WRITE_FEATURE_KEYS } = await import("@flamenode/domain/admin");
  const { compactWriteFeatureListSql, evaluateCostGuardSnapshot, loadCostGuardSettingsRow } = await import("../src/middleware/costGuard.ts");
  const { loadTosState } = await import("../src/middleware/writeOrigin.ts");
  const feature = "admin_announcement_broadcast";
  const now = Math.floor(Date.now() / 1000);
  const allow = JSON.stringify([feature]);
  const padded = "[ " + " ".repeat(100000) + JSON.stringify(feature) + "]";
  const malformed = "!" + "x".repeat(100000);
  const duplicates = JSON.stringify(Array(100).fill("reserve_slot"));
  const overflowCount = JSON.stringify(Array(101).fill("reserve_slot"));
  const expiryPad = " \t\r\n\v\f".repeat(18000);
  const impossibleExpiries = [
    expiryPad + "not-a-number" + expiryPad,
    "x".repeat(180_000),
    "garbage".repeat(30_000),
  ];
  const cases = [
    ["normal", null, null, null],
    ["normal", " ", null, null],
    ["normal", null, null, " "],
    ["maintenance", null, null, " "],
    ["economy", null, null, null],
    ["read_only", null, null, null],
    ["static_only", null, null, null],
    ["NORMAL", null, null, null],
    ["x".repeat(100000), null, null, null],
    ["x".repeat(100000), malformed, now + 3600, allow],
    ["normal", JSON.stringify(WRITE_FEATURE_KEYS), null, null],
    ["normal", padded, null, null],
    ["normal", duplicates, null, null],
    ["normal", overflowCount, null, null],
    ["normal", '["admin_announcement_broadcas\\u0074"]', null, null],
    ["normal", '["admin_announcement_broadcast\\u0000"]', null, null],
    ["normal", allow + "\u0000garbage", null, null],
    ["normal", '["admin_announcement_broadcast",]', null, null],
    ["normal", '["unknown"]', null, null],
    ["maintenance", malformed, null, null],
    ["maintenance", malformed, now + 3600, padded],
    ["normal", malformed, now - 60, allow],
    ["normal", null, now + 3600, JSON.stringify(WRITE_FEATURE_KEYS)],
    ["normal", null, now + 3600, '["unknown"]'],
    ["maintenance", null, now + 3600, malformed],
    // INTEGER affinity preserves hex and malformed numeric TEXT. Do not CAST:
    // JS compares a whitespace-padded hexadecimal expiry as its numeric value.
    ["maintenance", malformed, expiryPad + "0xFFFFFFFF" + expiryPad, allow],
    ...impossibleExpiries.map((expiry) => ["maintenance", null, expiry, allow]),
    // A large valid radix literal may coerce to Infinity. Do not replace it.
    ["maintenance", malformed, "0x" + "F".repeat(18_000), allow],
    ["maintenance", malformed, expiryPad + "+Infinity" + expiryPad, allow],
  ];
  // Empty means zero bytes, even under a non-binary column collation.
  // RTRIM otherwise treats a malformed space-only JSON string as empty.
  const projectionDb = createAdminD1().sqlite;
  for (const column of ['s."disabled_features_json"', 's."cost_guard_exception_features_json"']) {
    const alias = column.slice(2);
    const query = `SELECT ${compactWriteFeatureListSql(column)} AS receipt FROM (SELECT CAST(? AS TEXT) COLLATE RTRIM AS ${alias}) s`;
    for (const [raw, receipt] of [[null, null], ["", null], [" ", "!"], ["   ", "!"], ["\t", "!"], ["\u0000", "!"], ["[]", "[]"]]) {
      assert.equal(projectionDb.prepare(query).get(raw).receipt, receipt);
    }
  }
  const maxBytes = Buffer.byteLength(JSON.stringify(WRITE_FEATURE_KEYS));
  for (const [operationMode, disabledFeaturesJson, exceptionUntil, exceptionFeaturesJson] of cases) {
    const app = setup({ cookieSession: true });
    app.sqlite.prepare("UPDATE system_settings SET operation_mode=?, disabled_features_json=?, cost_guard_exception_until=?, cost_guard_exception_features_json=? WHERE id='default'")
      .run(operationMode, disabledFeaturesJson, exceptionUntil, exceptionFeaturesJson);
    const expected = evaluateCostGuardCore({ feature, operationMode, disabledFeaturesJson, exceptionUntil, exceptionFeaturesJson, now });
    const state = await loadTosState(app.db, "admin-1", undefined, true);
    assert.ok(state?.cost_guard_settings);
    const expectedMode = operationMode == null || ["normal", "economy", "read_only", "static_only", "maintenance"].includes(operationMode) ? operationMode : "!";
    assert.equal(state.cost_guard_settings.operation_mode, expectedMode);
    if (impossibleExpiries.includes(exceptionUntil)) {
      assert.equal(state.cost_guard_settings.cost_guard_exception_until, "!");
    } else if (typeof exceptionUntil === "string" && exceptionUntil.startsWith(expiryPad)) {
      const compact = state.cost_guard_settings.cost_guard_exception_until;
      assert.equal(compact, exceptionUntil.trim());
      assert.ok(Buffer.byteLength(compact) <= 12);
    } else {
      assert.equal(state.cost_guard_settings.cost_guard_exception_until, exceptionUntil);
    }
    assert.ok(Buffer.byteLength(state.cost_guard_settings.operation_mode ?? "") <= 11);
    for (const value of [state.cost_guard_settings.disabled_features_json, state.cost_guard_settings.cost_guard_exception_features_json]) {
      assert.ok(Buffer.byteLength(value ?? "") <= maxBytes);
    }
    const denied = expected.blocked ? (expected.reason === "mode" ? "maintenance_mode" : "cost_guard_blocked") : null;
    assert.equal(evaluateCostGuardSnapshot({ row: state.cost_guard_settings }, feature, now).denied, denied);
    assert.equal(app.stats.reads, 1);
    const response = await app.request("POST", "/api/admin/announcements", { ...VALID, id: "compact-receipt" });
    assert.equal(response.status, denied ? 503 : 200);
    if (denied) assert.equal((await response.json()).reason, denied);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(app.stats.reads, 3, "one direct read plus session and joined admission reads for mounted request");
    assert.equal(app.stats.batches, denied ? 0 : 1);
    assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, denied ? 0 : 1);
    assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, denied ? 0 : 1);
    const standalone = await loadCostGuardSettingsRow(app.db);
    assert.ok(standalone);
    assert.deepEqual({ ...standalone }, state.cost_guard_settings, "both read paths emit the same settings");
    assert.equal(evaluateCostGuardSnapshot({ row: standalone }, feature, now).denied, denied);
    assert.equal(app.stats.reads, 4, "standalone projection costs one additional read");
  }
});

test("MIG-0689: invalid audit settings receipts never earn a preload read credit", async () => {
  const { isValidPreloadedAuditSettings } = await import("@flamenode/server-core/audit/logger");
  const { mapAuditSettings } = await import("@flamenode/server-core/audit/settings");
  const { loadCostGuardSettingsRow, evaluateCostGuardSnapshot } = await import("../src/middleware/costGuard.ts");
  const { loadTosState } = await import("../src/middleware/writeOrigin.ts");
  const feature = "admin_announcement_broadcast";
  const columns = [
    "audit_normal_retention_days", "audit_restorable_retention_days",
    "audit_long_retention_days", "audit_max_payload_bytes", "audit_compact_after_days",
  ];
  const wideText = "0x1e" + " ".repeat(180_000);
  const wideBlob = Buffer.alloc(180_000, 1);
  for (const column of columns) {
    for (const raw of [wideText, wideBlob]) {
      const app = setup({ cookieSession: true });
      app.sqlite.prepare(`UPDATE system_settings SET "${column}" = ? WHERE id = 'default'`).run(raw);
      const authoritative = app.sqlite.prepare("SELECT * FROM system_settings WHERE id='default'").get();
      assert.equal(isValidPreloadedAuditSettings(mapAuditSettings(authoritative)), false);
      const state = await loadTosState(app.db, ADMIN.id, undefined, true);
      const standalone = await loadCostGuardSettingsRow(app.db);
      assert.ok(state?.cost_guard_settings);
      assert.ok(standalone);
      assert.deepEqual({ ...standalone }, state.cost_guard_settings);
      assert.equal(standalone[column], null, column + " invalid marker, not a numeric/default value");
      assert.ok(Buffer.byteLength(JSON.stringify(standalone), "utf8") < 2048);
      const cost = evaluateCostGuardSnapshot({ row: standalone }, feature);
      assert.equal(cost.denied, null);
      assert.equal(isValidPreloadedAuditSettings(cost.auditSettings), false);
      assert.equal(app.stats.reads, 2);
      // An earlier denial must not trigger the authoritative audit fallback.
      app.sqlite.exec("UPDATE system_settings SET operation_mode='maintenance'");
      const denied = await app.request("POST", "/api/admin/announcements", VALID);
      assert.equal(denied.status, 503);
      assert.equal((await denied.json()).reason, "maintenance_mode");
      assert.equal(app.stats.reads, 4);
      assert.equal(app.stats.batches, 0);
      assert.equal(app.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
    }
  }

  // compact_after_days is not used to build an ordinary audit row. Invalid
  // preload data must still execute the existing authoritative settings read,
  // retain the other settings, and never be treated as a valid cached snapshot.
  const app = setup({ cookieSession: true });
  app.sqlite.prepare("UPDATE system_settings SET audit_normal_retention_days=45, audit_compact_after_days=?").run(wideText);
  const first = await app.request("POST", "/api/admin/announcements", { ...VALID, title: "Invalid preload fallback" });
  assert.equal(first.status, 200);
  assert.equal(app.stats.reads, 3, "session + admission + authoritative audit settings");
  assert.equal(app.stats.batches, 1);
  const firstAudit = app.sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(firstAudit.expires_at - firstAudit.created_at, 45 * 86400);
  assert.equal(app.sqlite.prepare("SELECT audit_compact_after_days FROM system_settings").get().audit_compact_after_days, wideText);

  app.sqlite.exec("UPDATE system_settings SET audit_compact_after_days=30");
  const second = await app.request("POST", "/api/admin/announcements", { ...VALID, title: "Fresh valid preload" });
  assert.equal(second.status, 200);
  assert.equal(app.stats.reads, 5, "the next request uses a fresh valid preload (two reads)");
  assert.equal(app.stats.batches, 2);
  const rows = app.sqlite.prepare("SELECT * FROM audit_logs").all();
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.expires_at - row.created_at, 45 * 86400);
});

// ---------------- B3: body cap ----------------

test("B3: Content-Length over 64KB -> 413 without reading", async () => {
  const { request, sqlite } = setup();
  const res = await request("POST", "/api/admin/announcements", undefined, { Origin: SITE, "content-length": String(MAX_ADMIN_JSON_BODY_BYTES + 1) }, "{}");
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, message: "リクエストが大きすぎます。" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("B3: actual body bytes over 64KB (no/lying Content-Length) -> 413 on every body route", async () => {
  const big = JSON.stringify({ ...VALID, body: "x".repeat(MAX_ADMIN_JSON_BODY_BYTES) });
  for (const [method, path] of [["POST", "/api/admin/announcements"], ["PUT", "/api/admin/announcements/a1"], ["POST", "/api/admin/api-endpoints"], ["PATCH", "/api/admin/api-endpoints/ev-1"]]) {
    const { request } = setup();
    const res = await request(method, path, undefined, { Origin: SITE }, big);
    assert.equal(res.status, 413, `${method} ${path}`);
    assert.equal((await res.json()).ok, false);
  }
});

test("B3: exactly 64KB passes the cap (then fails on domain validation, not 413)", async () => {
  const { request } = setup();
  const pad = "x".repeat(MAX_ADMIN_JSON_BODY_BYTES - JSON.stringify({ title: "", body: "" }).length);
  const raw = JSON.stringify({ title: "", body: pad });
  assert.equal(new TextEncoder().encode(raw).length, MAX_ADMIN_JSON_BODY_BYTES);
  const res = await request("POST", "/api/admin/announcements", undefined, { Origin: SITE }, raw);
  assert.equal(res.status, 400);
});

test("B3: non-JSON / array body -> 400", async () => {
  const { request } = setup();
  assert.equal((await request("POST", "/api/admin/announcements", undefined, { Origin: SITE }, "not json")).status, 400);
  assert.equal((await request("POST", "/api/admin/announcements", undefined, { Origin: SITE }, "[]")).status, 400);
});

// ---------------- non-blockers ----------------

test("apiEndpoints preflight read failure -> JSON 500 (not an unhandled error)", async () => {
  const { request, sqlite } = setup();
  seedEvent(sqlite);
  sqlite.exec("ALTER TABLE events RENAME TO events_gone");
  const original = console.error;
  console.error = () => {};
  try {
    const res = await request("POST", "/api/admin/api-endpoints", { event_id: "ev-1" });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, message: "更新が競合したか監査記録に失敗しました。" });
  } finally {
    console.error = original;
  }
});

test("public_api_enabled accepts JSON booleans, numbers and legacy strings", async () => {
  for (const [input, expected] of [[true, 1], [false, 0], [1, 1], [0, 0], ["1", 1], ["0", 0], [null, 0], [undefined, 0]]) {
    const parsed = ApiEndpointSetActiveBodySchema.parse(input === undefined ? {} : { public_api_enabled: input });
    assert.equal(parsed.public_api_enabled, expected, String(input));
  }
  assert.equal(ApiEndpointSetActiveBodySchema.safeParse({ public_api_enabled: "yes" }).success, false);
  assert.equal(ApiEndpointSetActiveBodySchema.safeParse({ public_api_enabled: {} }).success, false);
  const { request, sqlite } = setup();
  seedEvent(sqlite);
  assert.equal((await request("PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: true })).status, 200);
  assert.equal(sqlite.prepare("SELECT public_api_enabled FROM events").get().public_api_enabled, 1);
  const bad = await request("PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: "yes" });
  assert.equal(bad.status, 400);
});

test("contracts announcement body schema rejects wrong-typed fields", () => {
  assert.equal(AnnouncementWriteBodySchema.safeParse({ title: 1 }).success, false);
  assert.equal(AnnouncementWriteBodySchema.safeParse({ title: "a", is_published: true }).success, true);
});

// ---------------- LOW-1: origin before session ----------------

test("LOW-1: invalid-origin request with a session cookie costs zero D1 prepares and never runs session", async () => {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const before = d1.stats.prepares;
  let sessionRan = false;
  const hono = new Hono();
  hono.route("/api/admin", createAdminRoutes({
    session: async (c, next) => {
      sessionRan = true;
      await d1.db.prepare("SELECT 1").bind().first();
      await next();
    },
  }));
  const res = await hono.request("/api/admin/announcements", {
    method: "POST",
    headers: { Origin: "https://evil.example", cookie: "authjs.session-token=abc", "content-type": "application/json" },
    body: JSON.stringify(VALID),
  }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "invalid_origin");
  assert.equal(sessionRan, false);
  assert.equal(d1.stats.prepares - before, 0);
  // unconfigured site URL is also decided before any D1 access
  const res2 = await hono.request("/api/admin/announcements", { method: "POST", headers: { Origin: SITE } }, { DB: d1.db });
  assert.equal(res2.status, 503);
  assert.equal((await res2.json()).reason, "origin_verification_unavailable");
  assert.equal(sessionRan, false);
});

test("write-only checks skip GET/HEAD: a future admin read mounted under /api/admin is not blocked", async () => {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const admin = createAdminRoutes({ session: async (c, next) => { c.set("user", ADMIN); c.set("sessionState", "user"); await next(); } });
  admin.get("/ping", (c) => c.json({ pong: true }));
  const hono = new Hono();
  hono.route("/api/admin", admin);
  const res = await hono.request("/api/admin/ping", { method: "GET" }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  assert.equal(res.status, 200);
  assert.equal(d1.stats.reads, 0);
  const post = await hono.request("/api/admin/announcements", { method: "POST", headers: { Origin: "https://evil.example" } }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  assert.equal(post.status, 403);
});

// ---------------- generalized guard: requiredRole / activeX ----------------

function guardApp({ user, requiredRole, activeX: activeXOptions, settings = "normal", seed, mountCostGuard = true }) {
  const activeX = activeXOptions ? { feature: "manage_event_update", ...activeXOptions } : undefined;
  const d1 = createAdminD1();
  seedBase(d1.sqlite, { settings });
  d1.sqlite.exec("UPDATE \"user\" SET id = 'u-1', role = '" + user.role + "', active_x_user_id = " + (user.active_x_user_id ? "'" + user.active_x_user_id + "'" : "NULL"));
  if (seed) seed(d1.sqlite);
  const options = { loadSiteUrl: () => SITE, allowLocalPreview: () => false, requiredRole, activeX };
  const hono = new Hono();
  hono.use("*", originGuardMiddleware(options));
  hono.use("*", async (c, next) => {
    c.set("user", { ...user, id: "u-1" });
    c.set("sessionState", "user");
    await next();
  });
  hono.use("*", writeGuardMiddleware(options));
  if (mountCostGuard) hono.use("*", costGuardMiddleware("manage_event_update"));
  hono.post("/w", (c) => c.json({ ok: true, activeX: c.get("activeX") ?? null }));
  const post = () => hono.request("/w", { method: "POST", headers: { Origin: SITE } }, { DB: d1.db });
  return { ...d1, post };
}
const U = (role, x = null) => ({ name: "n", email: null, image: null, role, is_banned: 0, active_x_user_id: x });

test("combined admission read fallback preserves ToS and CostGuard failure classes", async () => {
  const run = async (failure) => {
    const d1 = createAdminD1();
    seedBase(d1.sqlite);
    seedCookieSession(d1.sqlite);
    if (failure === "banned") d1.sqlite.exec('UPDATE "user" SET is_banned = 1');
    if (failure === "disabled" || failure === "active-exception") {
      const padded = "[ " + " ".repeat(100000) + JSON.stringify("admin_announcement_broadcast") + " ]";
      const exception = failure === "active-exception";
      d1.sqlite.prepare("UPDATE system_settings SET operation_mode=?, disabled_features_json=?, cost_guard_exception_until=?, cost_guard_exception_features_json=? WHERE id='default'")
        .run(exception ? "maintenance" : "normal", exception ? "!" : padded,
          exception ? Math.floor(Date.now() / 1000) + 3600 : null, exception ? padded : null);
    }
    const attempts = [];
    const originalPrepare = d1.db.prepare.bind(d1.db);
    const db = {
      ...d1.db,
      prepare(query) {
        const statement = originalPrepare(query);
        return {
          ...statement,
          bind(...values) {
            const bound = statement.bind(...values);
            return {
              ...bound,
              first: async (...args) => {
                attempts.push({ query, values });
                if (query.includes('LEFT JOIN "system_settings" s')) {
                  throw new Error("combined admission provider failure");
                }
                if (failure === "tos" && query.includes('FROM "user" u')) {
                  throw new Error("tos provider failure");
                }
                if (failure === "cost" && query.includes("FROM system_settings")) {
                  throw new Error("cost guard provider failure");
                }
                return bound.first(...args);
              },
            };
          },
        };
      },
    };
    const app = new Hono();
    app.route("/api/admin", createAdminRoutes());
    const response = await app.request(SITE + "/api/admin/announcements", {
      method: "POST",
      headers: { Origin: SITE, cookie: "__Secure-authjs.session-token=" + SESSION_TOKEN, "content-type": "application/json" },
      body: JSON.stringify({ ...VALID, id: "fallback-admission" }),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
    const allowed = failure === "none" || failure === "active-exception";
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(d1.stats.batches, allowed ? 1 : 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, allowed ? 1 : 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, allowed ? 1 : 0);
    assert.match(attempts[0].query, /FROM "session" s/);
    assert.match(attempts[1].query, /LEFT JOIN "system_settings" s/);
    assert.match(attempts[2].query, /FROM "user" u/);
    assert.doesNotMatch(attempts[2].query, /LEFT JOIN "system_settings"/);
    if (attempts.length === 4) assert.match(attempts[3].query, /FROM system_settings/);
    assert.deepEqual(attempts.map((entry) => entry.values),
      [[SESSION_TOKEN], [ADMIN.id], [ADMIN.id], ...(attempts.length === 4 ? [["default"]] : [])]);
    return { response, reads: d1.stats.reads, attempts: attempts.length };
  };

  const recovered = await run("none");
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.reads, 3, "session and two source-specific fallback reads");
  assert.equal(recovered.attempts, 4, "include failed joined-read attempt; not S3 acceptance");

  const disabled = await run("disabled");
  assert.equal(disabled.response.status, 503);
  assert.equal((await disabled.response.json()).reason, "cost_guard_blocked");
  assert.equal(disabled.reads, 3);
  assert.equal(disabled.attempts, 4);

  const activeException = await run("active-exception");
  assert.equal(activeException.response.status, 200);
  assert.equal(activeException.reads, 3);
  assert.equal(activeException.attempts, 4);

  const tosFailure = await run("tos");
  assert.equal(tosFailure.response.status, 503);
  assert.equal((await tosFailure.response.json()).reason, "db_unavailable");
  assert.equal(tosFailure.reads, 1);
  assert.equal(tosFailure.attempts, 3);

  const costFailure = await run("cost");
  assert.equal(costFailure.response.status, 503);
  assert.equal((await costFailure.response.json()).reason, "cost_guard_blocked");
  assert.equal(costFailure.reads, 2);
  assert.equal(costFailure.attempts, 4);

  const identityFailure = await run("banned");
  assert.equal(identityFailure.response.status, 403);
  assert.equal((await identityFailure.response.json()).reason, "banned");
  assert.equal(identityFailure.reads, 2, "session and ToS; no CostGuard fallback after identity denial");
  assert.equal(identityFailure.attempts, 3);
});

test("requiredRole default is admin (moderator denied); null allows any authenticated user", async () => {
  assert.equal((await guardApp({ user: U("user") }).post()).status, 403);
  assert.equal((await guardApp({ user: U("moderator") }).post()).status, 403);
  assert.equal((await guardApp({ user: U("admin") }).post()).status, 200);
  assert.equal((await guardApp({ user: U("admin"), requiredRole: "admin" }).post()).status, 200);
  assert.equal((await guardApp({ user: U("moderator"), requiredRole: "admin" }).post()).status, 403);
  assert.equal((await guardApp({ user: U("user"), requiredRole: null }).post()).status, 200);
  assert.equal((await guardApp({ user: U("moderator"), requiredRole: null }).post()).status, 200);
});

test("requiredRole null still enforces banned / TOS before role", async () => {
  const g = guardApp({ user: { ...U("user"), is_banned: 1 }, requiredRole: null });
  const res = await g.post();
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "banned");
  const t = guardApp({ user: U("user"), requiredRole: null });
  t.sqlite.exec("UPDATE \"user\" SET is_tos_accepted = 0");
  assert.equal((await (await t.post()).json()).reason, "tos_required");
});

const ACTIVE_MESSAGES = {
  active_x_required: "X ID を選択してから操作してください。",
  active_x_rejected: "選択中の X ID は却下されています。別の X ID を選択してください。",
  active_x_not_approved: "承認済みの X ID が必要です。",
};

test("activeX.requireActiveXId: none -> 403 active_x_required; pending ok; rejected -> 403 active_x_rejected", async () => {
  const none = await guardApp({ user: U("admin"), activeX: { requireActiveXId: true } }).post();
  assert.equal(none.status, 403);
  assert.deepEqual(await none.json(), { ok: false, reason: "active_x_required", message: ACTIVE_MESSAGES.active_x_required });
  // active X id set but no x_users row -> approval status null -> required
  const orphan = await guardApp({ user: U("admin", "x1"), activeX: { requireActiveXId: true } }).post();
  assert.equal((await orphan.json()).reason, "active_x_required");
  const pending = guardApp({ user: U("admin", "x1"), activeX: { requireActiveXId: true }, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'pending')") });
  assert.equal((await pending.post()).status, 200);
  const rejected = guardApp({ user: U("admin", "x1"), activeX: { requireActiveXId: true }, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'rejected')") });
  const r = await rejected.post();
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { ok: false, reason: "active_x_rejected", message: ACTIVE_MESSAGES.active_x_rejected });
});

test("activeX.requireApprovedActiveXId: pending -> active_x_not_approved; approved but unlinked -> not approved; approved+linked -> ok", async () => {
  const opts = { requireApprovedActiveXId: true };
  const pending = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'pending')") });
  const p = await pending.post();
  assert.equal(p.status, 403);
  assert.deepEqual(await p.json(), { ok: false, reason: "active_x_not_approved", message: ACTIVE_MESSAGES.active_x_not_approved });
  const unlinked = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved')") });
  assert.equal((await (await unlinked.post()).json()).reason, "active_x_not_approved");
  const other = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('someone-else', 'x1')") });
  assert.equal((await (await other.post()).json()).reason, "active_x_not_approved");
  const ok = guardApp({ user: U("admin", "x1"), activeX: opts, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x1'), ('u-1', 'x1')") });
  const res = await ok.post();
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).activeX, { activeXId: "x1", approvedXIds: ["x1"] });
  const none = await guardApp({ user: U("admin"), activeX: opts }).post();
  assert.equal((await none.json()).reason, "active_x_required");
});

test("shared admission bounds active X approval status without changing guard decisions", async () => {
  const { loadTosState } = await import("../src/middleware/writeOrigin.ts");
  const { evaluateActiveXWriteAccess } = await import("@flamenode/domain/admin");
  const cases = [
    null, "", "approved", "rejected", "pending", "approved ", "REJECTED",
    "approved\u0000" + "x".repeat(100000),
    "rejected\u0000" + "x".repeat(100000),
    "pending\u0000" + "x".repeat(100000),
    "界".repeat(40000), Buffer.from("approved"),
    { rawText: Buffer.alloc(9, 0xff) },
  ];
  for (const requireApprovedActiveXId of [false, true]) {
    const activeX = { requireActiveXId: true, requireApprovedActiveXId };
    const g = guardApp({
      user: U("admin", "x1"),
      activeX,
      seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'pending'); INSERT INTO x_user_account_links VALUES ('u-1', 'x1')"),
    });
    const setStatus = g.sqlite.prepare("UPDATE x_users SET approval_status = ? WHERE id = 'x1'");
    const setRawStatus = g.sqlite.prepare("UPDATE x_users SET approval_status = CAST(? AS TEXT) WHERE id = 'x1'");
    const readStatus = g.sqlite.prepare("SELECT approval_status FROM x_users WHERE id = 'x1'");
    const isApproved = g.sqlite.prepare("SELECT 1 AS ok FROM x_users WHERE id = 'x1' AND approval_status = 'approved'");
    for (const value of cases) {
      if (value?.rawText) setRawStatus.run(value.rawText);
      else setStatus.run(value);
      const approvalStatus = readStatus.get().approval_status;
      const approvedXIds = requireApprovedActiveXId && isApproved.get() ? ["x1"] : [];
      const expected = evaluateActiveXWriteAccess({ ...activeX, activeXId: "x1", approvalStatus, approvedXIds });
      for (const joined of [false, true]) {
        const before = g.stats.reads;
        const state = await loadTosState(g.db, "u-1", activeX, joined);
        assert.ok(state?.active_x);
        const receipt = state.active_x.approvalStatus;
        assert.ok(receipt === null || Buffer.byteLength(receipt) <= 9);
        assert.ok(receipt === null || ["approved", "rejected", "approved\u0000", "rejected\u0000", "!"].includes(receipt));
        assert.deepEqual(state.active_x.approvedXIds, approvedXIds);
        assert.equal(evaluateActiveXWriteAccess({ ...activeX, ...state.active_x }), expected);
        assert.equal(g.stats.reads - before, 1);
      }
      const before = g.stats.reads;
      const response = await g.post();
      assert.equal(response.status, expected ? 403 : 200);
      const body = await response.json();
      if (expected) assert.equal(body.reason, expected);
      else assert.deepEqual(body.activeX, { activeXId: "x1", approvedXIds });
      assert.equal(g.stats.reads - before, 1);
    }
  }
});

test("activeX check runs AFTER CostGuard (CURRENT order) and adds no D1 read", async () => {
  const blocked = guardApp({ user: U("admin"), activeX: { requireApprovedActiveXId: true }, settings: "maintenance" });
  const res = await blocked.post();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "maintenance_mode");
  const plain = guardApp({ user: U("admin") });
  await plain.post();
  const withX = guardApp({ user: U("admin", "x1"), activeX: { requireApprovedActiveXId: true }, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x1')") });
  await withX.post();
  assert.equal(withX.stats.reads, plain.stats.reads);
});

test("fail closed: activeX route WITHOUT costGuardMiddleware still denies (and still checks CostGuard first)", async () => {
  const noX = guardApp({ user: U("admin"), activeX: { requireActiveXId: true }, mountCostGuard: false });
  const r1 = await noX.post();
  assert.equal(r1.status, 403);
  assert.equal((await r1.json()).reason, "active_x_required");
  const maint = guardApp({ user: U("admin"), activeX: { requireActiveXId: true }, settings: "maintenance", mountCostGuard: false });
  const r2 = await maint.post();
  assert.equal(r2.status, 503);
  assert.equal((await r2.json()).reason, "maintenance_mode");
  const ok = guardApp({ user: U("admin", "x1"), activeX: { requireApprovedActiveXId: true }, mountCostGuard: false, seed: (s) => s.exec("INSERT INTO x_users (id, approval_status) VALUES ('x1', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x1')") });
  assert.equal((await ok.post()).status, 200);
  // activeX without a feature (misconfiguration) fails closed
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const hono = new Hono();
  const options = { loadSiteUrl: () => SITE, allowLocalPreview: () => false, activeX: { requireActiveXId: true } };
  hono.use("*", async (c, next) => { c.set("user", { ...U("admin"), id: "admin-1" }); c.set("sessionState", "user"); await next(); });
  hono.use("*", writeGuardMiddleware(options));
  hono.post("/w", (c) => c.json({ ok: true }));
  const res = await hono.request("/w", { method: "POST", headers: { Origin: SITE } }, { DB: d1.db });
  assert.equal(res.status, 503);
});

test("approved X IDs are bounded (LIMIT 100) and oversized JSON fails closed", async () => {
  const many = guardApp({
    user: U("admin", "x0"),
    activeX: { requireApprovedActiveXId: true },
    seed: (s) => {
      for (let i = 0; i < 150; i++) {
        s.exec(`INSERT INTO x_users (id, approval_status) VALUES ('x${i}', 'approved'); INSERT INTO x_user_account_links VALUES ('u-1', 'x${i}')`);
      }
    },
  });
  const res = await many.post();
  assert.equal(res.status, 200);
  assert.ok((await res.json()).activeX.approvedXIds.length <= 100);
  // Legacy IDs may contain Unicode; preserve the existing JS code-unit limit.
  const legacy = Array.from({ length: 22 }, (_, i) => String(i).padStart(2, "0") + "\u65e5".repeat(126));
  const seedLinked = (ids) => (s) => {
    for (const id of ids) {
      s.prepare("INSERT INTO x_users (id, approval_status) VALUES (?, ?)").run(id, "approved");
      s.prepare("INSERT INTO x_user_account_links VALUES (?, ?)").run("u-1", id);
    }
  };
  const captureReceipts = (app) => {
    const receipts = [];
    const prepare = app.db.prepare.bind(app.db);
    app.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!sql.includes("AS approved_x_ids_json")) return statement;
      return {
        ...statement,
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            ...bound,
            first: async (...args) => {
              const row = await bound.first(...args);
              receipts.push(row?.approved_x_ids_json);
              return row;
            },
          };
        },
      };
    };
    return receipts;
  };
  const unicode = guardApp({ user: U("admin", "x0"), activeX: { requireApprovedActiveXId: true }, seed: seedLinked(["x0", ...legacy]) });
  const unicodeReceipts = captureReceipts(unicode);
  const unicodeResponse = await unicode.post();
  assert.equal(unicodeResponse.status, 200);
  assert.deepEqual(new Set((await unicodeResponse.json()).activeX.approvedXIds), new Set(["x0", ...legacy]));
  assert.equal(unicodeReceipts.length, 1);
  assert.ok(unicodeReceipts[0].startsWith("~"));
  assert.ok(unicodeReceipts[0].length <= 49153);
  const unicodeReceipt = Buffer.from(unicodeReceipts[0].slice(1), "hex").toString("utf8");
  assert.ok(Buffer.byteLength(unicodeReceipt) > 8192);
  assert.ok(unicodeReceipt.length <= 8192);
  assert.equal(unicode.stats.reads, 1);

  const ordinary = guardApp({ user: U("admin", "x0"), activeX: { requireApprovedActiveXId: true }, seed: seedLinked(["x0", "x1"]) });
  const ordinaryReceipts = captureReceipts(ordinary);
  const ordinaryResponse = await ordinary.post();
  assert.equal(ordinaryResponse.status, 200);
  assert.equal(ordinaryReceipts.length, 1);
  assert.deepEqual(new Set(JSON.parse(ordinaryReceipts[0])), new Set(["x0", "x1"]));
  assert.equal(ordinary.stats.reads, 1);

  // One large ID, an aggregate of medium IDs, and escaped JSON expansion
  // fail closed without transferring an oversized JSON array.
  const excessiveLists = [
    ["x0", "a".repeat(100000)],
    ["x0", "a".repeat(9000)],
    ["x0", ...Array.from({ length: 99 }, (_, i) => String(i) + "\u65e5".repeat(500))],
    ["x0", ...Array.from({ length: 99 }, (_, i) => String(i) + "\u0001".repeat(400))],
  ];
  for (const ids of excessiveLists) {
    const oversized = guardApp({ user: U("admin", "x0"), activeX: { requireApprovedActiveXId: true }, seed: seedLinked(ids) });
    const oversizedReceipts = captureReceipts(oversized);
    const oversizedResponse = await oversized.post();
    assert.equal(oversizedResponse.status, 503);
    assert.equal((await oversizedResponse.json()).reason, "db_unavailable");
    assert.equal(oversizedResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(oversizedReceipts, ["!", "!"], "both joined and ToS fallback D1 receipts are bounded");
    assert.equal(oversized.stats.reads, 2);
    assert.equal(oversized.stats.batches, 0);
  }

  // Existing JS code-unit cap before JSON.parse: a lying/huge column value -> 503
  const huge = { prepare: () => ({ bind: () => ({ first: async () => ({ is_tos_accepted: 1, terms_reaccept_required: 0, discord_id: null, discord_name: null, active_x_user_id: "x1", user_image: null, x_name: null, x_icon_url: null, x_approval_status: "approved", approved_x_ids_json: JSON.stringify(["a".repeat(9000)]) }) }) }) };
  const hono = new Hono();
  const options = { loadSiteUrl: () => SITE, allowLocalPreview: () => false, activeX: { feature: "manage_event_update", requireApprovedActiveXId: true } };
  hono.use("*", async (c, next) => { c.set("user", { ...U("admin"), id: "u-1" }); c.set("sessionState", "user"); await next(); });
  hono.use("*", writeGuardMiddleware(options));
  hono.post("/w", (c) => c.json({ ok: true }));
  const r = await hono.request("/w", { method: "POST", headers: { Origin: SITE } }, { DB: huge });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reason, "db_unavailable");
});

// ---------------- default read guard for safe methods ----------------

function readApp({ user, sessionState = "user" }) {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  const admin = createAdminRoutes({ session: async (c, next) => { c.set("user", user); c.set("sessionState", sessionState); await next(); } });
  admin.get("/ping", (c) => c.json({ pong: true }));
  const hono = new Hono();
  hono.route("/api/admin", admin);
  const get = (method = "GET") => hono.request("/api/admin/ping", { method }, { DB: d1.db, NEXT_PUBLIC_SITE_URL: SITE });
  return { ...d1, get };
}

test("default read guard: GET denied unless authenticated admin (CURRENT requireRouteUser reasons), private no-store", async () => {
  const cases = [
    [{ user: null }, 401, "unauthorized"],
    [{ user: null, sessionState: "unavailable" }, 503, "database_unavailable"],
    [{ user: { ...ADMIN, is_banned: 1 } }, 403, "account_disabled"],
    [{ user: { ...ADMIN, role: "moderator" } }, 403, "forbidden"],
    [{ user: { ...ADMIN, role: "user" } }, 403, "forbidden"],
  ];
  for (const [input, status, error] of cases) {
    const app = readApp(input);
    const res = await app.get();
    assert.equal(res.status, status, error);
    assert.deepEqual(await res.json(), { error });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(app.stats.reads, 0);
  }
  const ok = readApp({ user: ADMIN });
  assert.equal((await ok.get()).status, 200);
  assert.equal((await ok.get("HEAD")).status, 200);
  assert.equal(ok.stats.reads, 0);
});

// ---------------- preload vs self-read audit rows ----------------

test("audit rows are identical whether settings/actor are preloaded by guards or self-read", async () => {
  const { mutateWithAudit } = await import("@flamenode/server-core/audit/mutate");
  const { actorSnapshotFromRow } = await import("@flamenode/server-core/audit/logger");
  const { sql } = await import("@flamenode/server-core/sql");
  const originalNow = Date.now;
  const originalUuid = globalThis.crypto.randomUUID;
  const run = async (preloadedFrom) => {
    let n = 0;
    Date.now = () => 1_800_000_000_000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const d1 = createAdminD1();
    seedBase(d1.sqlite);
    d1.sqlite.exec("UPDATE system_settings SET audit_normal_retention_days = 45, audit_max_payload_bytes = 90000");
    d1.sqlite.exec("INSERT INTO x_users (id, x_name, icon_url, approval_status) VALUES ('x1', 'XN', 'https://i/x.png', 'approved'); UPDATE \"user\" SET active_x_user_id = 'x1', image = 'https://i/u.png'");
    const audits = [{ table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1", t: "日本語" }, actor_user_id: "admin-1", retention_class: "normal" }];
    const db = drizzle(d1.db, { schema });
    const statement = db.run(sql`INSERT INTO announcements (id, title, body, created_at, updated_at) VALUES (${"a1"}, ${"t"}, ${"b"}, ${1}, ${1})`);
    let preloaded;
    if (preloadedFrom === "guards") {
      const { evaluateCostGuardSnapshot } = await import("../src/middleware/costGuard.ts");
      const { loadTosState } = await import("../src/middleware/writeOrigin.ts");
      const admission = await loadTosState(d1.db, "admin-1", undefined, true);
      assert.ok(admission);
      const cost = evaluateCostGuardSnapshot({ row: admission.cost_guard_settings ?? null }, "admin_announcement_broadcast");
      preloaded = { settings: cost.auditSettings, actorSnapshotJsonById: { "admin-1": admission.actor_snapshot_json } };
    }
    const before = d1.stats.reads;
    await mutateWithAudit(db, { mutationStatements: [statement], expectedMutationChanges: [1], audits, preloaded });
    return { rows: d1.sqlite.prepare("SELECT * FROM audit_logs").all(), reads: d1.stats.reads - before };
  };
  try {
    const self = await run("self");
    const guards = await run("guards");
    assert.equal(self.reads, 2);
    assert.equal(guards.reads, 0);
    assert.equal(self.rows.length, 1);
    assert.equal(JSON.stringify(guards.rows), JSON.stringify(self.rows));
    assert.equal(self.rows[0].expires_at - self.rows[0].created_at, 45 * 86400);
  } finally {
    Date.now = originalNow;
    globalThis.crypto.randomUUID = originalUuid;
  }
});

test("shared admission does not transfer a shadowed actor image", async () => {
  const { loadTosState } = await import("../src/middleware/writeOrigin.ts");
  const { actorSnapshotFromRow } = await import("@flamenode/server-core/audit/logger");
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  d1.sqlite.exec("INSERT INTO x_users (id, x_name, approval_status) VALUES ('x1', 'XN', 'approved'); UPDATE \"user\" SET active_x_user_id = 'x1'");
  const setImage = d1.sqlite.prepare('UPDATE "user" SET image = ? WHERE id = ?');
  const setIcon = d1.sqlite.prepare("UPDATE x_users SET icon_url = ? WHERE id = 'x1'");
  const canonical = d1.sqlite.prepare(
    'SELECT u.discord_id, u.name AS discord_name, u.active_x_user_id, u.image AS user_image, x.x_name, x.icon_url AS x_icon_url FROM "user" u LEFT JOIN x_users x ON x.id = u.active_x_user_id WHERE u.id = ?'
  );
  const rows = [];
  const prepare = d1.db.prepare.bind(d1.db);
  const db = {
    ...d1.db,
    prepare(query) {
      const statement = prepare(query);
      return {
        ...statement,
        bind(...values) {
          const bound = statement.bind(...values);
          return {
            ...bound,
            first: async (...args) => {
              const row = await bound.first(...args);
              rows.push(row);
              return row;
            },
          };
        },
      };
    },
  };
  for (const icon of [null, "", "https://i/x.png", "\u0000hidden", "a\u0000tail", "\u65e5\ud83d\ude00"]) {
    const image = icon === "https://i/x.png" ? "u".repeat(100000) : "https://i/u.png";
    setImage.run(image, "admin-1");
    setIcon.run(icon);
    const oldRow = canonical.get("admin-1");
    for (const joined of [false, true]) {
      const before = d1.stats.reads;
      const snapshot = await loadTosState(db, "admin-1", undefined, joined);
      assert.ok(snapshot);
      assert.equal(snapshot.actor_snapshot_json, JSON.stringify(actorSnapshotFromRow(oldRow)));
      assert.equal(d1.stats.reads - before, 1);
      assert.equal(rows.at(-1).user_image,
        oldRow.x_icon_url ? null : oldRow.user_image);
    }
  }
});

test("identity denies win over active X denies (banned before active_x_required)", async () => {
  const g = guardApp({ user: { ...U("admin"), is_banned: 1 }, activeX: { requireActiveXId: true } });
  assert.equal((await (await g.post()).json()).reason, "banned");
});

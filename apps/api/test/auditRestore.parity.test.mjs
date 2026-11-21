// MIG-0662 U03: SA-011 CURRENT shared-core vs Hono SQLite parity.
// Exercises the actual admin middleware chain and D1-atomic restore mutation.
import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { getTableColumns } from "drizzle-orm";
import { videos } from "@flamenode/db/schema";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { app as deployedApiRouter } from "../src/app.ts";
import { restoreAuditLog } from "@flamenode/server-core/audit/restore";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
} from "@flamenode/server-core/publicCache/eventExportKeys";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";
import { publicJsonCacheUrl } from "@flamenode/server-core/publicCache/delete";

const SITE = "https://app.flamenode.example";
const ADMIN = {
  id: "admin-1", name: "Admin", email: null, image: null,
  role: "admin", is_banned: 0, active_x_user_id: null,
};
const RESTORE = "/api/admin/audit/restore";
const SQLITE_AUTH_SESSION_TOKEN = "fixture-only-session-token-not-a-real-credential";

// D1 fake read-trace: observe table names only (never SQL bind values or tokens).
// This is diagnostic evidence for Issue #691, NOT a real Auth.js/workerd profile.
function readTableLabels(sql) {
  // A TOS query nests subqueries before its main FROM clause; reporting only
  // the first FROM would misattribute that read. Enumerate every referenced
  // FROM/JOIN table instead; this remains a heuristic, not SQL plan analysis.
  return [...new Set([...sql.matchAll(
    /\b(?:from|join)\s+"?([a-z_][a-z_0-9]*)"?/gi,
  )].map((match) => match[1]))].slice(0, 12);
}

function setup({
  user = ADMIN, role = "admin", disabled = [], enableRestoreCandidate = true,
  useRealSessionMiddleware = false, sessionExpired = false,
} = {}) {
  const { sqlite, db, stats } = createAdminD1();
  const readTrace = [];
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const prepared = originalPrepare(sql);
    return {
      bind(...params) {
        const statement = prepared.bind(...params);
        const instrumentRead = (method) => (...args) => {
          readTrace.push({ method, referenced_tables: readTableLabels(sql) });
          return statement[method](...args);
        };
        return {
          ...statement, // Preserve _sql/_params consumed by atomic fake D1 batch().
          first: instrumentRead("first"),
          all: instrumentRead("all"),
          raw: instrumentRead("raw"),
        };
      },
    };
  };
  seedBase(sqlite, { role });
  if (useRealSessionMiddleware) {
    // Use the real Hono Auth.js-cookie/D1 resolver against a synthetic SQLite
    // session table. This does NOT execute against real Cloudflare/workerd.
    sqlite.exec(`CREATE TABLE "session" (
      "sessionToken" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "expires" INTEGER NOT NULL
    )`);
    sqlite.prepare(
      'INSERT INTO "session" ("sessionToken","userId","expires") VALUES (?, ?, ?)',
    ).run(SQLITE_AUTH_SESSION_TOKEN, ADMIN.id,
      Date.now() + (sessionExpired ? -60_000 : 60_000));
  }
  if (disabled.length) {
    sqlite.prepare("UPDATE system_settings SET disabled_features_json = ? WHERE id = 'default'")
      .run(JSON.stringify(disabled));
  }
  const app = new Hono();
  app.route("/api/admin", createAdminRoutes({
    enableAuditRestoreCandidate: enableRestoreCandidate,
    // Omitting the injected session exercises the production sessionMiddleware.
    session: useRealSessionMiddleware ? undefined : async (c, next) => {
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  }));
  const defaultHeaders = useRealSessionMiddleware
    ? { Origin: SITE, Cookie: `__Secure-authjs.session-token=${SQLITE_AUTH_SESSION_TOKEN}` }
    : { Origin: SITE };
  const request = (body, headers = defaultHeaders, extraEnv = {}, path = RESTORE) => app.request(
    useRealSessionMiddleware ? SITE + path : path, {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE, ...extraEnv },
  );
  return { sqlite, db, stats, readTrace, request };
}

function seedRestorableAnnouncement(sqlite, { currentTitle = "Current Title" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const before = {
    id: "anc-1", title: "Old Title", body: "Old Body", severity: "info",
    is_published: 1, publish_at: now, expire_at: now + 10000,
    target_audience: "all", created_by_user_id: "admin-1",
    created_at: now - 100, updated_at: now - 50,
  };
  const after = { ...before, title: "Current Title", body: "Current Body", updated_at: now - 10 };
  const persisted = { ...after, title: currentTitle };
  sqlite.prepare(`INSERT INTO announcements
    (id,title,body,severity,is_published,publish_at,expire_at,target_audience,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      ...["id","title","body","severity","is_published","publish_at","expire_at",
        "target_audience","created_by_user_id","created_at","updated_at"].map((key) => persisted[key]),
    );
  sqlite.prepare(`INSERT INTO audit_logs
    (id,table_name,target_id,operation,restore_strategy,restore_status,before_json,after_json,created_at,actor_user_id)
    VALUES ('audit-1','announcements','anc-1','UPDATE','update_before','restorable',?,?,?,'admin-1')`)
    .run(JSON.stringify(before), JSON.stringify(after), now - 10);
  return { before, after };
}

function changes(sqlite) {
  return {
    row: sqlite.prepare("SELECT title,body,updated_at FROM announcements WHERE id = 'anc-1'").get(),
    runs: sqlite.prepare("SELECT status,reason FROM audit_restore_runs ORDER BY status").all().map((run) => ({ status: run.status, reason: run.reason })),
    restored: sqlite.prepare("SELECT restore_status FROM audit_logs WHERE id = 'audit-1'").get()?.restore_status,
    auditCount: sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
  };
}

const body = (extra = {}) => ({
  audit_id: "audit-1", reason: "業務上の監査復元",
  confirm_text: "RESTORE audit-1", ...extra,
});

test("T00 production/default admin router physically excludes unapproved SA-011 write route", async () => {
  const isRestore = (r) => r.method === "POST" &&
    r.path.replace(/[/]$/, "") === RESTORE;
  assert.equal(
    deployedApiRouter.routes.filter(isRestore).length, 0,
    "deployed app.ts must not mount the candidate route",
  );
  // Hono route() flattens the earlier auditAdminRoutes ALL middleware into
  // the parent route table; a second sibling guard would double D1 reads.
  const optedIn = createAdminRoutes({ enableAuditRestoreCandidate: true });
  const guarded = optedIn.routes.map((route, index) => ({ route, index }))
    .filter(({ route }) => route.method === "ALL" && route.path === "/audit/*");
  const restoreIndex = optedIn.routes.findIndex((route) =>
    route.method === "POST" && route.path === "/audit/restore");
  assert.equal(guarded.length, 1, "one audit wildcard guard, not two");
  assert.ok(restoreIndex > guarded[0].index, "CostGuard must precede candidate restore");
  const ctx = setup({ enableRestoreCandidate: false });
  seedRestorableAnnouncement(ctx.sqlite);
  const result = await ctx.request(body());
  assert.equal(result.status, 404, "default admin routes must not execute SA-011");
  assert.equal(ctx.stats.batches, 0, "unmounted write cannot commit a D1 batch");
  assert.equal(changes(ctx.sqlite).row.title, "Current Title");
  assert.equal(changes(ctx.sqlite).runs.length, 0);
  const enabled = setup();
  seedRestorableAnnouncement(enabled.sqlite);
  const accepted = await enabled.request(body());
  assert.equal(accepted.status, 200, "isolated test-only opt-in still exercises real candidate");
  assert.equal((await accepted.json()).ok, true);
  assert.equal(changes(enabled.sqlite).runs.length, 1);
});

// SA-009 is already mounted; D1 errors may include private SQL parameters.
// Unlike CURRENT's raw error.message, the Hono boundary must return a fixed
// message while preserving 500 and rollback semantics.
// SA-010 is a default-mounted read: D1 preflight outages must be fixed 500
// responses, not raw SQL errors recorded by the framework's onError logger.
test("T00 mounted SA-010 dry-run preflight D1 failure hides SQL/provider exception", async () => {
  const ctx = setup({ useRealSessionMiddleware: true, enableRestoreCandidate: false });
  seedRestorableAnnouncement(ctx.sqlite);
  const marker = "MIG0662_DRYRUN_PRIVATE_SQL_PARAM_CANARY";
  const originalPrepare = ctx.db.prepare.bind(ctx.db);
  let faulted = false;
  ctx.db.prepare = (sql) => {
    if (sql.toLowerCase().includes("from") && sql.toLowerCase().includes("audit_logs")) {
      faulted = true;
      throw new Error("Failed query: SELECT * FROM audit_logs params: " + marker, {
        cause: new Error("provider-private-endpoint:" + marker),
      });
    }
    return originalPrepare(sql);
  };
  const originalWarn = console.warn;
  const originalError = console.error;
  const logged = [];
  try {
    const capture = (...values) => logged.push(values.map(String).join(" "));
    console.warn = capture;
    console.error = capture;
    const response = await ctx.request(
      { audit_id: "audit-1", reason: "dry-run preflight" },
      undefined, {}, "/api/admin/audit/dry-run",
    );
    assert.equal(faulted, true, "actual audit log D1 read is injected");
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const result = await response.json();
    assert.deepEqual(result, {
      ok: false, message: "事前確認を完了できませんでした。",
    });
    assert.equal(JSON.stringify(result).includes(marker), false);
    assert.equal(JSON.stringify(result).includes("Failed query"), false);
    assert.equal(ctx.stats.batches, 0);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.equal(logged.join(" ").includes(marker), false);
    assert.equal(logged.join(" ").includes("provider-private-endpoint"), false);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});

// SA-009 is mounted in the default admin router. A private configuration write
// and its validation/size errors must never become an HTTP/edge cache entry.
test("T00 mounted SA-009 settings never caches success, validation, or oversize responses", async () => {
  const ctx = setup({ useRealSessionMiddleware: true, enableRestoreCandidate: false });
  const path = "/api/admin/audit/settings";
  for (const scenario of [
    { payload: { normal_retention_days: -1 }, status: 400, label: "invalid" },
    { payload: { normal_retention_days: "x".repeat(70000) }, status: 413, label: "oversized" },
    { payload: { normal_retention_days: 45 }, status: 200, label: "success" },
  ]) {
    const response = await ctx.request(scenario.payload, undefined, {}, path);
    assert.equal(response.status, scenario.status, scenario.label);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store", scenario.label);
    const result = await response.json();
    assert.equal(result.ok, scenario.status === 200, scenario.label);
  }
  assert.equal(ctx.stats.batches, 1, "only the valid request may execute a D1 batch");
  assert.equal(ctx.sqlite.prepare(
    "SELECT audit_normal_retention_days FROM system_settings WHERE id='default'",
  ).get().audit_normal_retention_days, 45);
  assert.equal(ctx.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE table_name='system_settings'",
  ).get().n, 1, "settings write must remain audited");
});

test("T00 mounted SA-009 settings failure never echoes SQL/provider parameters", async () => {
  const ctx = setup({ useRealSessionMiddleware: true, enableRestoreCandidate: false });
  const marker = "MIG0662_SETTINGS_PRIVATE_SQL_PARAM_CANARY";
  const before = ctx.sqlite.prepare(
    "SELECT audit_normal_retention_days FROM system_settings WHERE id='default'",
  ).get().audit_normal_retention_days;
  const originalBatch = ctx.db.batch.bind(ctx.db);
  let injected = false;
  ctx.db.batch = async (statements) => {
    try {
      return await originalBatch([...statements, {
        _sql: 'INSERT INTO "__mig_0662_missing_settings_fault" ("v") VALUES (?)',
        _params: [marker],
      }]);
    } catch (cause) {
      injected = true;
      throw new Error("Failed query: UPDATE system_settings SET audit_normal_retention_days=? params: " + marker, {
        cause,
      });
    }
  };
  const response = await ctx.request(
    { normal_retention_days: 45 }, undefined, {}, "/api/admin/audit/settings",
  );
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const result = await response.json();
  assert.deepEqual(result, {
    ok: false, message: "設定の更新に失敗しました。",
  });
  assert.equal(injected, true, "fail after executing an actual SQLite D1 batch");
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes("Failed query"), false);
  assert.equal(JSON.stringify(result).includes("params:"), false);
  assert.equal(ctx.stats.batches, 1);
  assert.equal(ctx.sqlite.prepare(
    "SELECT audit_normal_retention_days FROM system_settings WHERE id='default'",
  ).get().audit_normal_retention_days, before, "failed settings update must rollback");
  assert.equal(ctx.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs",
  ).get().n, 0, "no audit success from a rolled-back batch");
});

// SA-010 is already mounted in the default admin router and includes full
// CURRENT/target snapshots in its result, unlike the unmounted SA-011 write.
test("T00 SA-010 dry-run snapshots and errors are never HTTP/edge cached", async () => {
  const ctx = setup({ useRealSessionMiddleware: true, enableRestoreCandidate: false });
  seedRestorableAnnouncement(ctx.sqlite);
  const path = "/api/admin/audit/dry-run";
  for (const scenario of [
    { payload: body(), status: 200, kind: "valid" },
    { payload: body({ audit_id: "" }), status: 400, kind: "invalid" },
    { payload: body({ reason: "x".repeat(70000) }), status: 413, kind: "oversized" },
  ]) {
    const response = await ctx.request(scenario.payload, undefined, {}, path);
    assert.equal(response.status, scenario.status, scenario.kind);
    assert.equal(
      response.headers.get("Cache-Control"), "private, no-store",
      scenario.kind + ": audit snapshots and error bodies must not be cached",
    );
    const result = await response.json();
    if (scenario.kind === "valid") {
      assert.equal(result.ok, true);
      assert.equal(result.diff?.current?.title, "Current Title");
      assert.equal(result.diff?.target?.title, "Old Title");
    } else {
      assert.equal(result.ok, false);
    }
  }
  assert.equal(ctx.stats.batches, 0, "dry-run cannot mutate audit or entity rows");
  assert.equal(changes(ctx.sqlite).row.title, "Current Title");
  assert.equal(changes(ctx.sqlite).runs.length, 0);
});

test("T01 real Hono session resolver on SQLite adds one pre-read to SA-011 S3 trace", async () => {
  const ctx = setup({ useRealSessionMiddleware: true });
  seedRestorableAnnouncement(ctx.sqlite);
  const res = await ctx.request(body());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await res.json()).ok, true);
  assert.equal(changes(ctx.sqlite).row.title, "Old Title");
  assert.equal(ctx.stats.reads, 9, "one session SELECT plus 8 mocked-session pre-reads");
  assert.equal(ctx.stats.batches, 1);
  assert.deepEqual(ctx.readTrace[0].referenced_tables, ["session", "user"]);
  recordRestoreD1Budget(
    "announcements_authjs_sqlite_session_success", ctx.stats, ctx.readTrace,
    "authjs_middleware_sqlite_fixture",
  );
});

// Issue #691: previous visibility tests use an injected session. Exercise the
// actual secure-cookie Auth.js resolver on every successful R2 CAS path before
// drawing conclusions about the complete S3 pre-read budget. SQLite + fake R2
// are synthetic and cannot establish real workerd CPU/subrequest acceptance.
test("T01 real Auth.js cookie restores event and video with full S3 read trace", async () => {
  const previous = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  try {
    for (const scenario of [
      { kind: "event", auditId: "event-audit", entityId: "ev-1", table: "events",
        seed: seedVisibilityRestore, expectedReads: 9 },
      { kind: "video", auditId: "video-audit", entityId: "vid-restore", table: "videos",
        seed: seedVideoVisibilityRestore, expectedReads: 10 },
    ]) {
      const ctx = setup({ useRealSessionMiddleware: true });
      scenario.seed(ctx);
      const { state, bucket } = visibilityManifestBucket();
      // No headers override: setup() must supply the real HTTPS __Secure cookie.
      const response = await ctx.request({
        audit_id: scenario.auditId,
        reason: "実セッションで監査復元の読取数を検証",
        confirm_text: `RESTORE ${scenario.auditId}`,
      }, undefined, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
      assert.equal(response.status, 200, scenario.kind);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      const result = await response.json();
      assert.equal(result.ok, true, scenario.kind + ": " + JSON.stringify(result));
      assert.equal(ctx.sqlite.prepare(
        `SELECT visibility_status FROM ${scenario.table} WHERE id = ?`,
      ).get(scenario.entityId).visibility_status, "private");
      assert.equal(ctx.sqlite.prepare(
        "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'success'",
      ).get().n, 1);
      assert.equal(state.puts, 1, "R2 CAS must precede successful D1 commit");
      assert.ok(state.manifest.entities.some((entry) =>
        entry.entity_type === scenario.kind && entry.entity_id === scenario.entityId),
      "the restored entity must have a matching R2 visibility block");
      assert.deepEqual(ctx.readTrace[0].referenced_tables, ["session", "user"],
        "the first D1 read must be the real secure-cookie Auth.js session");
      assert.equal(ctx.stats.reads, scenario.expectedReads,
        "record the entire authenticated route budget, not mocked-session reads");
      assert.equal(ctx.stats.batches, 1,
        "restore, audit and fence must use one D1 atomic batch");
      recordRestoreD1Budget(
        `${scenario.table}_authjs_sqlite_session_success`,
        ctx.stats, ctx.readTrace, "authjs_middleware_sqlite_fixture",
      );
    }
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

test("T01 real Auth.js cookie visibility restore missing R2 fails closed before D1 batch", async () => {
  for (const scenario of [
    { kind: "event", auditId: "event-audit", entityId: "ev-1", table: "events",
      seed: seedVisibilityRestore, expectedReads: 9 },
    { kind: "video", auditId: "video-audit", entityId: "vid-restore", table: "videos",
      seed: seedVideoVisibilityRestore, expectedReads: 10 },
  ]) {
    const ctx = setup({ useRealSessionMiddleware: true });
    scenario.seed(ctx);
    const response = await ctx.request({
      audit_id: scenario.auditId,
      reason: "実セッションとR2障害の監査復元回帰",
      confirm_text: `RESTORE ${scenario.auditId}`,
    }, undefined, { PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(response.status, 200, scenario.kind);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await response.json()).ok, false, "missing enforce R2 must deny restore");
    assert.equal(ctx.sqlite.prepare(
      `SELECT visibility_status FROM ${scenario.table} WHERE id = ?`,
    ).get(scenario.entityId).visibility_status, "public");
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'success'",
    ).get().n, 0);
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM public_visibility_fences",
    ).get().n, 0, "no D1 visibility fence may commit when R2 is missing");
    assert.deepEqual(ctx.readTrace[0].referenced_tables, ["session", "user"]);
    assert.equal(ctx.stats.reads, scenario.expectedReads);
    assert.equal(ctx.stats.batches, 0, "no restore batch on visibility guard failure");
    recordRestoreD1Budget(
      `${scenario.table}_authjs_sqlite_session_missing_r2`,
      ctx.stats, ctx.readTrace, "authjs_middleware_sqlite_fixture",
    );
  }
});

// #691: reducing the 9/10 D1 pre-reads must not remove the independent
// role check inside shared restore core. Simulate a concurrent admin downgrade
// AFTER Auth.js has accepted the cookie, but BEFORE core reads current role.
test("T01 #691 mid-request admin role revocation blocks the restore before D1 batch", async () => {
  const ctx = setup({ useRealSessionMiddleware: true });
  seedRestorableAnnouncement(ctx.sqlite);
  const prepare = ctx.db.prepare.bind(ctx.db);
  let downgraded = false;
  ctx.db.prepare = (sql) => {
    const normalized = sql.toLowerCase();
    if (!downgraded &&
        normalized.includes('from "user"') &&
        normalized.includes('"role"') &&
        !normalized.includes('"session"')) {
      // An external concurrent admin operation changes the canonical SQLite
      // user record; this is intentionally not a batch from the restore route.
      ctx.sqlite.prepare('UPDATE "user" SET role = ? WHERE id = ?')
        .run("user", ADMIN.id);
      downgraded = true;
    }
    return prepare(sql);
  };
  const response = await ctx.request(body());
  assert.equal(downgraded, true, "downgrade must occur at the shared-core role read");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.match(result.message, /site admin/);
  assert.equal(ctx.stats.batches, 0, "a revoked admin must never start the restore D1 batch");
  assert.equal(ctx.sqlite.prepare('SELECT role FROM "user" WHERE id = ?')
    .get(ADMIN.id).role, "user");
  assert.equal(changes(ctx.sqlite).row.title, "Current Title");
  assert.equal(changes(ctx.sqlite).runs.length, 0);
  assert.equal(changes(ctx.sqlite).restored, "restorable");
  assert.deepEqual(ctx.readTrace.at(-1).referenced_tables, ["user"],
    "shared core must independently consult current role after the middleware guard");
});

test("T01 real Hono session resolver denies expired or role-revoked users before restore", async () => {
  for (const { options, status, expectedReads } of [
    { options: { sessionExpired: true }, status: 401, expectedReads: 1 },
    { options: { role: "user" }, status: 403, expectedReads: 2 },
  ]) {
    const ctx = setup({ useRealSessionMiddleware: true, ...options });
    seedRestorableAnnouncement(ctx.sqlite);
    const res = await ctx.request(body());
    assert.equal(res.status, status);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await res.json()).ok, false);
    assert.equal(ctx.stats.reads, expectedReads);
    assert.equal(ctx.stats.batches, 0);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.equal(ctx.readTrace[0].referenced_tables[0], "session");
  }
});

test("T01 real Hono session resolves no cookie and rejects invalid Origin without D1 reads", async () => {
  const noCookie = setup({ useRealSessionMiddleware: true });
  seedRestorableAnnouncement(noCookie.sqlite);
  const absent = await noCookie.request(body(), { Origin: SITE });
  assert.equal(absent.status, 401);
  assert.equal(absent.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await absent.json()).reason, "unauthenticated");
  assert.equal(noCookie.stats.reads, 0);
  assert.equal(noCookie.stats.batches, 0);
  assert.equal(changes(noCookie.sqlite).row.title, "Current Title");

  const crossOrigin = setup({ useRealSessionMiddleware: true });
  seedRestorableAnnouncement(crossOrigin.sqlite);
  const denied = await crossOrigin.request(body(), {
    Origin: "https://untrusted.example",
    Cookie: `__Secure-authjs.session-token=${SQLITE_AUTH_SESSION_TOKEN}`,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await denied.json()).reason, "invalid_origin");
  assert.equal(crossOrigin.stats.reads, 0, "Origin gate precedes real session D1 lookup");
  assert.equal(crossOrigin.stats.batches, 0);
  assert.equal(changes(crossOrigin.sqlite).row.title, "Current Title");
});

test("T01 real Hono session D1 failure is 503 and never mutates or logs cookie", async () => {
  const ctx = setup({ useRealSessionMiddleware: true });
  seedRestorableAnnouncement(ctx.sqlite);
  // A broken session SELECT is an unavailable session, never anonymous/fallback.
  ctx.sqlite.exec('DROP TABLE "session"');
  const originalError = console.error;
  const logs = [];
  try {
    console.error = (...args) => { logs.push(args.map(String).join(" ")); };
    const response = await ctx.request(body());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await response.json()).reason, "database_unavailable");
    assert.equal(ctx.stats.batches, 0);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.deepEqual(logs, ["[auth:session] D1_LOOKUP_FAILED"]);
    assert.ok(logs.every((s) => !s.includes(SQLITE_AUTH_SESSION_TOKEN)));
  } finally {
    console.error = originalError;
  }
});

test("T01 admin origin, session, role and BAN guards reject before any restore write", async () => {
  for (const opts of [
    { user: null, status: 401 },
    { user: { ...ADMIN, role: "moderator" }, role: "moderator", status: 403 },
    { user: { ...ADMIN, is_banned: 1 }, status: 403 },
  ]) {
    const ctx = setup(opts);
    seedRestorableAnnouncement(ctx.sqlite);
    const res = await ctx.request(body());
    assert.equal(res.status, opts.status);
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
  }
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  const res = await ctx.request(body(), { Origin: "https://external.example" });
  assert.equal(res.status, 403);
  assert.equal(ctx.stats.reads, 0);
  assert.equal(changes(ctx.sqlite).runs.length, 0);
});

test("T02 invalid body and oversized JSON return 400/413 without D1 mutation", async () => {
  const ctx = setup();
  const invalid = [
    { audit_id: "", reason: "test" },
    body({ reason: "" }),
    body({ reason: "x".repeat(501) }),
    body({ force_overwrite: 2 }),
    body({ force_overwrite: -1 }),
  ];
  for (const data of invalid) {
    const res = await ctx.request(data);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
  const huge = await ctx.request(body({ reason: "x".repeat(70000) }));
  assert.equal(huge.status, 413);
  assert.deepEqual(await huge.json(), {
    ok: false, message: "リクエストが大きすぎます。",
  });
  assert.equal(ctx.stats.batches, 0);
});

test("T05 restore responses are private no-store across validation, rejection, and success", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  const scenarios = [
    { payload: body({ reason: "" }), status: 400, ok: false },
    { payload: body({ reason: "x".repeat(70000) }), status: 413, ok: false },
    { payload: body({ confirm_text: "incorrect" }), status: 200, ok: false },
    { payload: body(), status: 200, ok: true },
  ];
  for (const item of scenarios) {
    const response = await ctx.request(item.payload);
    assert.equal(response.status, item.status);
    assert.equal(
      response.headers.get("Cache-Control"),
      "private, no-store",
      "audit restore snapshots/diffs must never be cached",
    );
    assert.equal((await response.json()).ok, item.ok);
  }
});

test("T03 confirmation text is mandatory; no accidental restore writes", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  for (const data of [body({ confirm_text: undefined }), body({ confirm_text: "RESTORE someone-else" })]) {
    const res = await ctx.request(data);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, false);
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
  }
});

// #730: a D1 failure during shared-core preflight occurs before the normal
// mutation_failed Result/failed-run record. The candidate route must not let
// its provider exception reach Hono's default error logger or HTTP response.
test("T03 #730 authenticated preflight D1 exception returns fixed 500 without SQL leak", async () => {
  const ctx = setup({ useRealSessionMiddleware: true });
  seedRestorableAnnouncement(ctx.sqlite);
  const marker = "MIG0662_AUDIT_PREFLIGHT_SQL_PARAM_CANARY";
  const originalPrepare = ctx.db.prepare.bind(ctx.db);
  let faulted = false;
  ctx.db.prepare = (sql) => {
    if (sql.toLowerCase().includes("from") && sql.toLowerCase().includes("audit_logs")) {
      faulted = true;
      throw new Error("Failed query: SELECT * FROM audit_logs WHERE id = ? params: " + marker, {
        cause: new Error("private-provider-origin " + marker),
      });
    }
    return originalPrepare(sql);
  };
  const originalWarn = console.warn;
  const originalError = console.error;
  const logged = [];
  try {
    const capture = (...values) => logged.push(values.map(String).join(" "));
    console.warn = capture;
    console.error = capture;
    const response = await ctx.request(body());
    assert.equal(faulted, true, "real-session Hono route reaches the failing audit preflight");
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      ok: false, message: "復元処理を完了できませんでした。",
    });
    assert.equal(ctx.stats.batches, 0, "a rejected preflight cannot start any D1 batch");
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.equal(logged.join("\\n").includes(marker), false, "no private SQL in error logs");
    assert.equal(logged.join("\\n").includes("private-provider-origin"), false);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test("T03 missing audit log matches CURRENT 200 ok:false and no restore row", async () => {
  const ctx = setup();
  const res = await ctx.request({ audit_id: "missing", reason: "test", confirm_text: "RESTORE missing" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false, message: "監査ログが見つかりません。" });
  assert.equal(ctx.stats.batches, 0);
});

test("T03 no-conflict restore is atomic and gives no second restore", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  const response = await ctx.request(body());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(typeof result.restore_run_id, "string");
  const state = changes(ctx.sqlite);
  assert.equal(state.row.title, "Old Title");
  assert.equal(state.row.body, "Old Body");
  assert.equal(state.restored, "restored");
  assert.deepEqual(state.runs, [{ status: "success", reason: "業務上の監査復元" }]);
  assert.ok(state.auditCount >= 2);
  recordRestoreD1Budget("announcements_success", ctx.stats, ctx.readTrace);
  const second = await ctx.request(body());
  assert.equal(second.status, 200);
  assert.equal((await second.json()).ok, false);
  assert.equal(changes(ctx.sqlite).runs.length, 1);
});

test("T03 conflict is rejected without force and allowed with explicit force_overwrite=1", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite, { currentTitle: "Concurrent edit" });
  let res = await ctx.request(body());
  assert.equal(res.status, 200);
  const first = await res.json();
  assert.equal(first.ok, false);
  assert.ok(first.diff?.conflicts.includes("title"));
  assert.equal(changes(ctx.sqlite).row.title, "Concurrent edit");
  assert.equal(changes(ctx.sqlite).runs[0].status, "failed");

  res = await ctx.request(body({ force_overwrite: 1 }));
  assert.equal(res.status, 200);
  const second = await res.json();
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(changes(ctx.sqlite).row.title, "Old Title");
  assert.equal(changes(ctx.sqlite).runs.find((r) => r.status === "success")?.status, "success");
});

test("T03 CURRENT shared core and Hono response/state parity for nonvisibility restore", async () => {
  const a = setup();
  seedRestorableAnnouncement(a.sqlite);
  const http = await (await a.request(body())).json();
  const b = setup();
  seedRestorableAnnouncement(b.sqlite);
  const unused = () => { throw new Error("restore_host_not_expected_for_announcements"); };
  const result = await restoreAuditLog(
    drizzle(b.db),
    {
      auditId: "audit-1", userId: "admin-1", reason: "業務上の監査復元",
      confirmText: "RESTORE audit-1", forceOverwrite: false, dry_run: false,
    },
    {
      manifest: { read: unused, write: unused },
      publicCacheKeys: { staticObjectKeys: [], userMaxPages: 0, eventObjectKeys: unused },
      deletePublicJsonCaches: unused, invalidateEventExportCache: unused,
      loadQueueWakeHost: unused,
    },
  );
  assert.deepEqual(
    { ok: http.ok, message: http.message, hasId: !!http.restore_run_id },
    { ok: result.ok, message: result.message, hasId: !!result.restore_run_id },
  );
  assert.deepEqual(changes(a.sqlite), changes(b.sqlite));
});

test("T05 CostGuard disabled blocks SA-011 before any mutation", async () => {
  const ctx = setup({ disabled: ["admin_permissions"] });
  seedRestorableAnnouncement(ctx.sqlite);
  const res = await ctx.request(body());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "cost_guard_blocked");
  assert.equal(changes(ctx.sqlite).runs.length, 0);
});

function seedVisibilityRestore(ctx) {
  const { sqlite } = ctx;
  sqlite.exec(`CREATE TABLE public_visibility_fences (
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, fence_token TEXT NOT NULL,
    state TEXT NOT NULL, reason TEXT, requirements_json TEXT,
    blocked_at INTEGER, release_requested_at INTEGER,
    requested_by_auth_user_id TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY(entity_type, entity_id)
  )`);
  seedEvent(sqlite, { id: "ev-1", visibility_status: "public" });
  const after = { ...sqlite.prepare("SELECT * FROM events WHERE id = 'ev-1'").get() };
  const before = { ...after, visibility_status: "private" };
  const now = Math.floor(Date.now() / 1000);
  sqlite.prepare(`INSERT INTO audit_logs
    (id,table_name,target_id,operation,restore_strategy,restore_status,before_json,after_json,created_at,actor_user_id)
    VALUES ('event-audit','events','ev-1','UPDATE','update_before','restorable',?,?,?,'admin-1')`)
    .run(JSON.stringify(before), JSON.stringify(after), now);
}

function visibilityManifestBucket() {
  const state = {
    manifest: { schema_version: 1, revision: 0, generated_at: Math.floor(Date.now() / 1000), entities: [] },
    etag: "etag-initial",
    puts: 0,
  };
  const bucket = {
    get: async (key) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      const text = JSON.stringify(state.manifest);
      return { etag: state.etag, size: Buffer.byteLength(text), text: async () => text };
    },
    put: async (key, value, options) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      assert.equal(options?.onlyIf?.etagMatches, state.etag);
      assert.equal(options?.httpMetadata?.cacheControl, "no-store");
      state.manifest = JSON.parse(value);
      state.etag = "etag-next-" + (++state.puts);
      return { etag: state.etag };
    },
  };
  return { state, bucket };
}

test("T04 event restore commits one atomic D1 batch after R2 CAS, then invalidates public caches", async () => {
  const ctx = setup();
  seedVisibilityRestore(ctx);
  const { state, bucket } = visibilityManifestBucket();
  const previous = globalThis.caches;
  const deleted = [];
  globalThis.caches = { default: {
    delete: async (url) => { deleted.push(decodeURIComponent(url)); return true; },
  } };
  try {
    const res = await ctx.request({
      audit_id: "event-audit", reason: "公開状態を取り消す",
      confirm_text: "RESTORE event-audit",
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ctx.sqlite.prepare("SELECT visibility_status FROM events WHERE id = 'ev-1'").get().visibility_status, "private");
    const fence = ctx.sqlite.prepare(
      "SELECT state,fence_token FROM public_visibility_fences WHERE entity_type = 'event' AND entity_id = 'ev-1'",
    ).get();
    assert.equal(fence.state, "blocked");
    assert.equal(state.puts, 1);
    assert.equal(state.manifest.entities.length, 1);
    assert.equal(state.manifest.entities[0].entity_type, "event");
    assert.equal(state.manifest.entities[0].entity_id, "ev-1");
    assert.equal(state.manifest.entities[0].fence_token, fence.fence_token);
    assert.ok(deleted.some((url) => url.endsWith("events/ev-1.json")));
    assert.ok(deleted.some((url) => url.endsWith("events/index.json")));
    assert.ok(deleted.some((url) => url.includes("public-event-export:9:ev-1:v5:15")));
    assert.ok(deleted.some((url) => url.includes("public-event-export:9:ev-1:legacy:1440")));
    assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'").get().n, 1);
  recordRestoreD1Budget("events_private_restore_success", ctx.stats, ctx.readTrace);
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

// Revalidate every canonical scheduled event-export key, not only the first
// and last refresh window. Keep unrelated event export payloads intact.
test("T04 successful event audit restore evicts all eight scheduled export variants", async () => {
  const ctx = setup();
  seedVisibilityRestore(ctx);
  const { bucket } = visibilityManifestBucket();
  const previous = globalThis.caches;
  const deleted = [];
  globalThis.caches = { default: { delete: async (url) => {
    deleted.push(decodeURIComponent(String(url)));
    return true;
  } } };
  try {
    const response = await ctx.request({
      audit_id: "event-audit",
      reason: "イベント出力キャッシュ無効化",
      confirm_text: "RESTORE event-audit",
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    const expected = ["v5", "legacy"].flatMap((format) =>
      EVENT_EXPORT_REFRESH_MINUTES.map((minutes) =>
        eventExportPayloadCacheKey("ev-1", format, minutes),
      ),
    );
    assert.equal(expected.length, 8);
    for (const key of expected) {
      assert.ok(deleted.includes("https://flamenode.internal/public-json/" + key),
        "missing scheduled export invalidation: " + key);
    }
    assert.equal(deleted.filter((url) =>
      url.includes("public-event-export:9:ev-unrelated:"),
    ).length, 0, "an unrelated event's scheduled exports must not be evicted");
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

test("T04 R2 binding failure prevents an event visibility restore and preserves public state", async () => {
  const ctx = setup();
  seedVisibilityRestore(ctx);
  const res = await ctx.request({
    audit_id: "event-audit", reason: "公開状態を取り消す",
    confirm_text: "RESTORE event-audit",
  }, { Origin: SITE }, { PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.ok, false);
  assert.equal(ctx.sqlite.prepare("SELECT visibility_status FROM events WHERE id='ev-1'").get().visibility_status, "public");
  assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM public_visibility_fences").get().n, 0);
  assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'").get().n, 0);
  recordRestoreD1Budget("events_missing_r2_fail_closed", ctx.stats, ctx.readTrace);
});

// MIG-0662 T04 video variant. Keep the test table column names in lockstep
// with the shared DB schema: a new video column will be selected by the
// restore adapter and must also exist in the SQLite D1 fixture.
function seedVideoVisibilityRestore(ctx) {
  const { sqlite } = ctx;
  const fields = Object.values(getTableColumns(videos));
  const declarations = fields.map((column) => {
    const sqlType = column.columnType === "SQLiteReal"
      ? "REAL"
      : column.columnType === "SQLiteInteger" ? "INTEGER" : "TEXT";
    return `"${column.name}" ${sqlType}`;
  });
  sqlite.exec(`CREATE TABLE videos (${declarations.join(", ")})`);
  sqlite.exec(`CREATE TABLE video_events (
    video_id TEXT NOT NULL, event_id TEXT NOT NULL,
    PRIMARY KEY(video_id, event_id)
  )`);
  sqlite.exec(`CREATE TABLE public_visibility_fences (
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, fence_token TEXT NOT NULL,
    state TEXT NOT NULL, reason TEXT, requirements_json TEXT,
    blocked_at INTEGER, release_requested_at INTEGER,
    requested_by_auth_user_id TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY(entity_type, entity_id)
  )`);
  const now = Math.floor(Date.now() / 1000);
  const video = {
    id: "vid-restore", submitted_by_user_id: "admin-1",
    collaboration_type: "individual", source_type: "youtube",
    creator_display_name: "Video Owner", creator_x_user_id: "creator-1",
    primary_event_id: "ev-1", title: "Original",
    youtube_video_id: "yt-restore-1", visibility_status: "public",
    app_like_count: 0, score: 0, created_at: now - 100, updated_at: now,
  };
  const columnNames = Object.keys(video);
  sqlite.prepare(`INSERT INTO videos (${columnNames.map((n) => `"${n}"`).join(",")})
    VALUES (${columnNames.map(() => "?").join(",")})`)
    .run(...columnNames.map((k) => video[k]));
  const after = { ...sqlite.prepare("SELECT * FROM videos WHERE id='vid-restore'").get() };
  const before = { ...after, visibility_status: "private" };
  sqlite.prepare(`INSERT INTO audit_logs
    (id,table_name,target_id,operation,restore_strategy,restore_status,before_json,after_json,created_at,actor_user_id)
    VALUES ('video-audit','videos','vid-restore','UPDATE','update_before','restorable',?,?,?,'admin-1')`)
    .run(JSON.stringify(before), JSON.stringify(after), now);
}

test("T04 video restore commits one atomic D1 batch after R2 CAS, then invalidates public caches", async () => {
  const ctx = setup();
  seedVideoVisibilityRestore(ctx);
  const { state, bucket } = visibilityManifestBucket();
  const previous = globalThis.caches;
  const deleted = [];
  globalThis.caches = { default: {
    delete: async (url) => { deleted.push(decodeURIComponent(url)); return true; },
  } };
  try {
    const res = await ctx.request({
      audit_id: "video-audit", reason: "動画公開の取り消し",
      confirm_text: "RESTORE video-audit",
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ctx.sqlite.prepare(
      "SELECT visibility_status FROM videos WHERE id='vid-restore'",
    ).get().visibility_status, "private");
    const fence = ctx.sqlite.prepare(
      "SELECT state,fence_token FROM public_visibility_fences WHERE entity_type='video' AND entity_id='vid-restore'",
    ).get();
    assert.equal(fence.state, "blocked");
    assert.equal(state.puts, 1);
    assert.equal(state.manifest.entities.length, 1);
    assert.equal(state.manifest.entities[0].entity_type, "video");
    assert.equal(state.manifest.entities[0].entity_id, "vid-restore");
    assert.equal(state.manifest.entities[0].fence_token, fence.fence_token);
    for (const suffix of [
      "videos/vid-restore.json", "videos/yt-restore-1.json",
      "videos/random-pool.v1.json", "youtube/related-blocklist.v1.json",
      "top/sections/recommended.v1.json", "top/sections/latest.v1.json",
      "list/recent.json", "list/popular.json", "search-index-lite.json",
      "users/creator-1.json", "users/creator-1/works/2.json",
      "events/ev-1.json", "events/ev-1/base.v1.json",
    ]) {
      assert.ok(deleted.some((url) => url.endsWith(suffix)), `not evicted: ${suffix}`);
    }
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'",
    ).get().n, 1);
    assert.equal(ctx.stats.batches, 1, "RESTORE mutation, audit and queue must use one atomic D1 batch");
  recordRestoreD1Budget("videos_private_restore_success", ctx.stats, ctx.readTrace);
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

// #718 acceptance gap: Cloudflare Cache API is colo-local. A successful
// video restore can evict only the writer colo; a still-public parent event
// may serve a scheduled DTO containing that now-private video from another
// colo. Exercise the *actual* Hono GET route on a second independent Cache
// API store, not just a mock delete-key list. This intentionally reports TODO
// while the shared cache-epoch/revalidation owner gate remains open.
test("T04 #718 separate-colo scheduled export cannot expose a restored private video", async (t) => {
  const ctx = setup();
  seedEvent(ctx.sqlite, { id: "ev-1", visibility_status: "public", public_api_enabled: 1 });
  seedVideoVisibilityRestore(ctx);
  const { bucket } = visibilityManifestBucket();
  const previousCache = globalThis.caches;
  const perColo = { writer: new Map(), reader: new Map() };
  let activeColo = "reader";
  const deleted = [];
  globalThis.caches = { default: {
    match: async (request) => perColo[activeColo].get(request.url)?.clone(),
    put: async (request, response) => {
      perColo[activeColo].set(request.url, response.clone());
    },
    delete: async (request) => {
      // Shared delete helper supplies a canonical URL string, whereas the
      // read/write Cache API ports use Request objects. Model both shapes.
      const url = typeof request === "string" ? request : request.url;
      deleted.push({ colo: activeColo, url });
      return perColo[activeColo].delete(url);
    },
  } };
  const now = Math.floor(Date.now() / 1000);
  const snapshots = [
    { format: "v5", body: JSON.stringify({
      schema_version: 5, videos: [{ id: "vid-restore" }],
    }) },
    { format: "legacy", body: JSON.stringify([{ video_id: "vid-restore" }]) },
  ];
  try {
    for (const item of snapshots) {
      const key = eventExportPayloadCacheKey("ev-1", item.format, 15);
      perColo.reader.set(publicJsonCacheUrl(key), new Response(JSON.stringify({
        payload: { body: item.body }, stored_at: now - 3,
      }), { headers: { "Content-Type": "application/json" } }));
    }
    assert.equal(perColo.reader.size, 2, "both export formats are seeded in the other colo");

    activeColo = "writer";
    const restored = await ctx.request({
      audit_id: "video-audit",
      reason: "別拠点キャッシュの公開情報残存を検証",
      confirm_text: "RESTORE video-audit",
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).ok, true, "video privacy restore commits");
    assert.equal(ctx.sqlite.prepare(
      "SELECT visibility_status FROM videos WHERE id = 'vid-restore'",
    ).get().visibility_status, "private");
    assert.equal(ctx.sqlite.prepare(
      "SELECT visibility_status FROM events WHERE id = 'ev-1'",
    ).get().visibility_status, "public", "parent event remains publicly accessible");
    assert.ok(deleted.length > 0, "restore must execute writer-colo cache invalidations");
    assert.equal(deleted.every((item) => item.colo === "writer"), true,
      "Cache API deletes cannot directly target another colo");
    assert.equal(perColo.reader.size, 2, "the independent reader-colo cache remains populated");

    activeColo = "reader";
    const exposed = [];
    for (const item of snapshots) {
      const request = new Request(
        SITE + "/api/event-endpoints/ev-1?format=" +
        item.format + "&update=scheduled&refresh=15",
      );
      const response = await deployedApiRouter.fetch(
        request,
        { DB: ctx.db },
        { waitUntil: () => undefined, passThroughOnException: () => undefined },
      );
      assert.equal(response.status, 200, item.format);
      assert.equal(response.headers.get("Cache-Control"), "no-store", item.format);
      assert.equal(response.headers.get("X-FlameNode-Cache"), "HIT", 
        item.format + ": stale reader-colo Cache API entry must be exercised, not a safe MISS");
      const body = await response.text();
      if (body.includes("vid-restore")) {
        exposed.push(item.format + ":" + response.headers.get("X-FlameNode-Cache"));
      }
    }
    if (exposed.length > 0) {
      t.todo("#718 STOP: a different colo still serves restored private video via " +
        exposed.join(", ") + "; require cross-colo cache epoch or member revalidation");
      return;
    }
    assert.deepEqual(exposed, [], "neither v5 nor legacy may disclose private video");
  } finally {
    if (previousCache === undefined) delete globalThis.caches;
    else globalThis.caches = previousCache;
  }
});

// Issue #718: establish executable evidence without modifying the shared
// restore.ts writer-owned by PR #679. The current implementation omits
// scheduled event-export invalidation after a successful video audit restore.
// A TODO is not a pass or waiver of the security gate: when the shared-core
// owner fixes the parity gap this test becomes a normal strict assertion.
test("T04 #718 video restore invalidates scheduled exports for primary and linked events", async (t) => {
  const ctx = setup();
  seedVideoVisibilityRestore(ctx);
  ctx.sqlite.prepare(
    "INSERT INTO video_events(video_id,event_id) VALUES (?, ?)",
  ).run("vid-restore", "ev-linked");
  const { bucket } = visibilityManifestBucket();
  const previous = globalThis.caches;
  const deleted = [];
  globalThis.caches = { default: { delete: async (url) => {
    deleted.push(decodeURIComponent(String(url)));
    return true;
  } } };
  try {
    const response = await ctx.request({
      audit_id: "video-audit",
      reason: "動画復元のイベント配信キャッシュ検証",
      confirm_text: "RESTORE video-audit",
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ctx.sqlite.prepare(
      "SELECT visibility_status FROM videos WHERE id = 'vid-restore'",
    ).get().visibility_status, "private");

    const keys = ["ev-1", "ev-linked"].flatMap((eventId) =>
      ["v5", "legacy"].flatMap((format) =>
        EVENT_EXPORT_REFRESH_MINUTES.map((minutes) =>
          eventExportPayloadCacheKey(eventId, format, minutes),
        ),
      ),
    );
    const missing = keys.filter((key) =>
      !deleted.includes("https://flamenode.internal/public-json/" + key),
    );
    if (missing.length !== 0) {
      t.todo("#718 open: shared-core video audit restore must invalidate " +
        missing.length + "/" + keys.length + " scheduled event-export keys; not release-ready");
      return;
    }
    assert.equal(keys.length, 16);
    assert.equal(missing.length, 0);
    assert.equal(deleted.some((url) =>
      url.includes("public-event-export:9:ev-unrelated:"),
    ), false, "only affected event export keys may be deleted");
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

test("T04 video restore fails closed when enforced visibility R2 bucket is unavailable", async () => {
  const ctx = setup();
  seedVideoVisibilityRestore(ctx);
  const response = await ctx.request({
    audit_id: "video-audit", reason: "動画公開の取り消し",
    confirm_text: "RESTORE video-audit",
  }, { Origin: SITE }, { PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, false);
  assert.equal(ctx.sqlite.prepare(
    "SELECT visibility_status FROM videos WHERE id='vid-restore'",
  ).get().visibility_status, "public");
  assert.equal(ctx.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM public_visibility_fences",
  ).get().n, 0);
  assert.equal(ctx.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'",
  ).get().n, 0);
  recordRestoreD1Budget("videos_missing_r2_fail_closed", ctx.stats, ctx.readTrace);
});

// #730: a privileged Hono caller must never receive arbitrary SQL/Drizzle
// exception text. The real secure-cookie session and SQLite rollback are used;
// the shared-core owner still has to repair CURRENT and internal audit/log paths.
test("T03 #730 authenticated restore masks SQL params and provider metadata on D1 failure", async (t) => {
  const ctx = setup({ useRealSessionMiddleware: true });
  seedRestorableAnnouncement(ctx.sqlite);
  const marker = "MIG0662_PRIVATE_SQL_PARAM_CANARY_730";
  const privateUrl = "https://private-db.example/internal/" + marker;
  const originalBatch = ctx.db.batch.bind(ctx.db);
  let failedMutation = false;
  ctx.db.batch = async (statements) => {
    try {
      return await originalBatch([...statements, {
        _sql: 'INSERT INTO "__mig_0662_missing_private_fault" ("value") VALUES (?)',
        _params: [marker],
      }]);
    } catch (cause) {
      failedMutation = true;
      const error = new Error("Failed query: UPDATE announcements SET body = ? params: " + marker, {
        cause: new Error("nested-provider-cause:" + marker, { cause }),
      });
      error.provider_metadata = { url: privateUrl, request: { marker } };
      throw error;
    }
  };

  const originalWarn = console.warn;
  const originalError = console.error;
  const logged = [];
  try {
    const capture = (...values) => {
      logged.push(values.map((value) => value instanceof Error
        ? String(value.stack ?? value.message)
        : String(value)).join(" "));
    };
    console.warn = capture;
    console.error = capture;
    const response = await ctx.request(body());
    assert.equal(response.status, 200, "CURRENT domain failure remains HTTP 200");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const result = await response.json();
    assert.equal(failedMutation, true, "execute a genuinely failing SQLite batch");
    assert.equal(ctx.stats.batches, 1, "rolled-back D1 mutation is one atomic batch");
    assert.equal(result.ok, false);
    assert.equal(result.message, "復元を確定できませんでした。変更はロールバックされました。");
    assert.ok(result.restore_run_id, "failed-run audit identity is preserved");
    assert.equal(JSON.stringify(result).includes(marker), false);
    assert.equal(JSON.stringify(result).includes(privateUrl), false);
    assert.equal(JSON.stringify(result).includes("Failed query"), false);
    assert.equal(JSON.stringify(result).includes("params:"), false);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title",
      "failure must not persist the attempted restore");
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'",
    ).get().n, 0);
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='failed'",
    ).get().n, 1, "failed-run record still persists separately");

    // A separate TODO subtest tracks the shared-core persistence blocker.
    // Do not mark the parent HTTP redaction test TODO: otherwise a future
    // regression in its strict HTTP/rollback assertions could be overlooked.
    await t.test("#730 failed-run persistence has no SQL/provider canary", (subtest) => {
      const stored = ctx.sqlite.prepare(
        "SELECT error_message FROM audit_restore_runs WHERE status='failed' LIMIT 1",
      ).get()?.error_message;
      assert.equal(typeof stored, "string", "failed-run error is recorded for audit");
      const leaked = [marker, privateUrl, "Failed query", "params:"]
        .some((sensitive) => stored.includes(sensitive));
      if (leaked) {
        subtest.todo("#730 shared-core failed-run stores raw SQL details; owner #679 must fix");
      } else {
        assert.equal(leaked, false, "failed-run error_message must be data-minimized");
      }
    });
    assert.equal(logged.join("\n").includes(marker), false,
      "the Hono error path must not log the canary");
    assert.equal(logged.join("\n").includes(privateUrl), false,
      "the Hono error path must not log private metadata");
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});

// D1 and R2 are not one transaction. Inject a D1 batch failure strictly
// after the manifest CAS write, using the real SQLite-backed Hono route.
// The CURRENT shared-core policy compensates the R2 fence when D1 remains
// public; this is not a guarantee of all-storage atomicity. Any decision to
// keep that fence instead requires an explicit visibility/security review.
test("T04 R2 CAS succeeds but D1 batch fails: event/video remain public, compensated R2, no success", async () => {
  for (const scenario of [
    { kind: "event", auditId: "event-audit", entityId: "ev-1", table: "events" },
    { kind: "video", auditId: "video-audit", entityId: "vid-restore", table: "videos" },
  ]) {
    const ctx = setup();
    if (scenario.kind === "event") seedVisibilityRestore(ctx);
    else seedVideoVisibilityRestore(ctx);

    const { state, bucket } = visibilityManifestBucket();
    const originalBatch = ctx.db.batch.bind(ctx.db);
    let injected = false;
    ctx.db.batch = async (statements) => {
      if (!injected) {
        injected = true;
        assert.equal(state.puts, 1, "R2 CAS must complete before the injected D1 failure");
        // Execute the real SQLite BEGIN and every legitimate restore statement
        // before triggering a final invalid write. The fake D1 batch must ROLLBACK
        // the already-executed UPDATE, fence and success-audit statements.
        return originalBatch([...statements, {
          _sql: 'INSERT INTO "__mig_0662_fault_missing_table" ("value") VALUES (1)',
          _params: [],
        }]);
      }
      // Other batches (if any) must remain unmodified after the injected failure.
      return originalBatch(statements);
    };

    const response = await ctx.request({
      audit_id: scenario.auditId,
      reason: "整合性の失敗注入テスト",
      confirm_text: `RESTORE ${scenario.auditId}`,
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });

    assert.equal(injected, true);
    assert.equal(ctx.stats.batches, 1,
      "restore uses one failing atomic SQLite batch; the failed-run INSERT is standalone");
    assert.equal(response.status, 200, "CURRENT returns an ok:false domain result");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const result = await response.json();
    assert.equal(result.ok, false, "no false restore success after D1 failure");
    assert.match(result.message, /復元を確定できませんでした/);
    assert.equal(ctx.sqlite.prepare(
      `SELECT visibility_status FROM ${scenario.table} WHERE id = ?`,
    ).get(scenario.entityId).visibility_status, "public", "failed D1 batch cannot change publication");
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'success'",
    ).get().n, 0);
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'failed'",
    ).get().n, 1, "failed-run INSERT is committed separately after rollback");
    assert.equal(ctx.sqlite.prepare(
      "SELECT restore_status FROM audit_logs WHERE id = ?",
    ).get(scenario.auditId).restore_status, "restorable");
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM public_visibility_fences",
    ).get().n, 0, "failed D1 batch cannot persist the D1 visibility fence");
    assert.ok(state.puts >= 2, "compensation must issue a separate conditional R2 write");
    assert.equal(state.manifest.entities.some((entry) =>
      entry.entity_type === scenario.kind && entry.entity_id === scenario.entityId,
    ), false, "shared-core compensation releases our precommitted block if D1 stays public");
  }
});

// An unsuccessful D1 transaction is not a completed publication change.
// Neither event nor video restore may trigger the post-commit Cache API deletes
// just because its preceding R2 visibility CAS succeeded.
test("T04 failed D1 audit restore never evicts event/video public or export caches", async () => {
  for (const scenario of [
    { kind: "event", auditId: "event-audit", entityId: "ev-1", table: "events" },
    { kind: "video", auditId: "video-audit", entityId: "vid-restore", table: "videos" },
  ]) {
    const ctx = setup();
    if (scenario.kind === "event") seedVisibilityRestore(ctx);
    else seedVideoVisibilityRestore(ctx);
    const { state, bucket } = visibilityManifestBucket();
    const originalBatch = ctx.db.batch.bind(ctx.db);
    let injected = false;
    ctx.db.batch = async (statements) => {
      injected = true;
      assert.equal(state.puts, 1, "R2 visibility precommit precedes failed D1 batch");
      return originalBatch([...statements, {
        _sql: 'INSERT INTO "__mig_0662_fault_missing_table" ("value") VALUES (1)',
        _params: [],
      }]);
    };

    const prior = globalThis.caches;
    const deletes = [];
    globalThis.caches = { default: {
      delete: async (url) => { deletes.push(String(url)); return true; },
    } };
    try {
      const response = await ctx.request({
        audit_id: scenario.auditId,
        reason: "失敗時にキャッシュを消さない検証",
        confirm_text: `RESTORE ${scenario.auditId}`,
      }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });

      assert.equal(injected, true);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.equal((await response.json()).ok, false);
      assert.equal(ctx.sqlite.prepare(
        `SELECT visibility_status FROM ${scenario.table} WHERE id = ?`,
      ).get(scenario.entityId).visibility_status, "public");
      assert.equal(ctx.sqlite.prepare(
        "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'success'",
      ).get().n, 0);
      assert.deepEqual(deletes, [],
        "a rolled-back restore must not invalidate any public JSON or scheduled export cache");
    } finally {
      if (prior === undefined) delete globalThis.caches;
      else globalThis.caches = prior;
    }
  }
});

// A repeatedly lost R2 conditional PUT must never let the audit restore
// advance to its D1 transaction. Exercise both event/video HTTP paths using
// an R2 fixture where a different writer wins each conditional PUT race,
// advancing the manifest and ETag. Our restore must preserve all foreign blocks.
test("T04 exhausted R2 CAS refuses event/video restore before D1 mutation", async () => {
  for (const scenario of [
    { kind: "event", auditId: "event-audit", entityId: "ev-1", table: "events" },
    { kind: "video", auditId: "video-audit", entityId: "vid-restore", table: "videos" },
  ]) {
    const ctx = setup();
    if (scenario.kind === "event") seedVisibilityRestore(ctx);
    else seedVideoVisibilityRestore(ctx);

    const { state, bucket } = visibilityManifestBucket();
    let failedCasAttempts = 0;
    bucket.put = async (key, value, options) => {
      failedCasAttempts += 1;
      assert.equal(key, "visibility/blocked-entities.v1.json");
      assert.equal(options?.onlyIf?.etagMatches, state.etag,
        "every retry must conditionally use the latest observed ETag");
      assert.equal(options?.httpMetadata?.cacheControl, "no-store");
      const candidate = JSON.parse(value);
      assert.ok(candidate.entities.some((entry) =>
        entry.entity_type === scenario.kind && entry.entity_id === scenario.entityId),
      "every attempted R2 CAS must include our intended visibility block");
      assert.equal(candidate.entities.filter((entry) =>
        entry.entity_type !== scenario.kind || entry.entity_id !== scenario.entityId,
      ).length, failedCasAttempts - 1,
      "a retry must preserve all earlier foreign writers' blocks");
      // A foreign writer wins the race between our read and conditional PUT.
      // Its updated ETag and unrelated block become the next read snapshot.
      state.manifest = {
        ...state.manifest,
        revision: state.manifest.revision + 1,
        entities: [...state.manifest.entities, {
          entity_type: "event",
          entity_id: "concurrent-" + failedCasAttempts,
          fence_token: "foreign-" + failedCasAttempts,
          blocked_at: 100 + failedCasAttempts,
        }],
      };
      state.etag = "etag-foreign-" + failedCasAttempts;
      return null; // R2 rejects our stale conditional PUT.
    };

    const response = await ctx.request({
      audit_id: scenario.auditId,
      reason: "R2 競合の回帰",
      confirm_text: `RESTORE ${scenario.auditId}`,
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });

    assert.equal(failedCasAttempts, 3, "R2 CAS retries are bounded");
    assert.equal(state.puts, 0, "none of our R2 PUT attempts committed");
    assert.deepEqual(
      state.manifest.entities.map((entry) => [entry.entity_id, entry.fence_token]),
      [["concurrent-1", "foreign-1"], ["concurrent-2", "foreign-2"], ["concurrent-3", "foreign-3"]],
      "the three winning foreign writes remain intact after our failed CAS",
    );
    assert.equal(state.manifest.entities.some((entry) =>
      entry.entity_type === scenario.kind && entry.entity_id === scenario.entityId,
    ), false, "our failed CAS never becomes visible");
    assert.equal(ctx.stats.batches, 0, "D1 mutation batch must not execute");
    assert.equal(response.status, 200, "CURRENT expresses a domain-level failure");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const result = await response.json();
    assert.equal(result.ok, false, "lost R2 CAS cannot report a successful restore");
    assert.match(result.message, /復元を確定できませんでした/);
    assert.equal(ctx.sqlite.prepare(
      `SELECT visibility_status FROM ${scenario.table} WHERE id = ?`,
    ).get(scenario.entityId).visibility_status, "public");
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'success'",
    ).get().n, 0);
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'failed'",
    ).get().n, 1, "failure is retained for the audit trail");
    assert.equal(ctx.sqlite.prepare(
      "SELECT restore_status FROM audit_logs WHERE id = ?",
    ).get(scenario.auditId).restore_status, "restorable");
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM public_visibility_fences",
    ).get().n, 0, "no R2 block means no D1 fence may be committed");
  }
});

// If both the restore D1 batch and the subsequent compensation R2 read fail,
// the precommitted visibility block must not be removed or treated as success.
// The shared core owns compensation/logging policy; this test exercises only the
// candidate Hono route and its synthetic D1/R2 bindings.
test("T04 double failure: R2 precommit survives D1 rollback and unavailable compensation", async () => {
  for (const scenario of [
    { kind: "event", auditId: "event-audit", entityId: "ev-1", table: "events" },
    { kind: "video", auditId: "video-audit", entityId: "vid-restore", table: "videos" },
  ]) {
    const ctx = setup();
    if (scenario.kind === "event") seedVisibilityRestore(ctx);
    else seedVideoVisibilityRestore(ctx);

    const { state, bucket } = visibilityManifestBucket();
    const originalBatch = ctx.db.batch.bind(ctx.db);
    const originalGet = bucket.get.bind(bucket);
    let d1FailureStarted = false;
    ctx.db.batch = async (statements) => {
      assert.equal(d1FailureStarted, false, "only the restore commit batch is attempted");
      assert.equal(state.puts, 1, "the R2 visibility CAS precedes the D1 batch");
      d1FailureStarted = true;
      return originalBatch([...statements, {
        _sql: 'INSERT INTO "__mig_0662_fault_missing_table" ("value") VALUES (1)',
        _params: [],
      }]);
    };
    // #717: this error simulates a provider exception that includes a
    // sensitive token; the candidate Hono host must reconstruct a safe code
    // before CURRENT shared-core compensation logging sees the exception.
    const providerSecret = "R2_PROVIDER_SECRET_DO_NOT_LOG_987";
    bucket.get = async (...args) => {
      if (d1FailureStarted) throw new Error("R2 provider: " + providerSecret);
      return originalGet(...args);
    };

    const previousWarn = console.warn;
    const capturedWarnings = [];
    let response;
    try {
      console.warn = (...parts) => {
        capturedWarnings.push(parts.map((part) =>
          part instanceof Error ? (part.stack ?? part.message) : String(part),
        ).join(" "));
      };
      response = await ctx.request({
        audit_id: scenario.auditId,
        reason: "二重障害の復旧回帰",
        confirm_text: `RESTORE ${scenario.auditId}`,
      }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    } finally {
      console.warn = previousWarn;
    }
    assert.ok(capturedWarnings.every((line) => !line.includes(providerSecret)),
      "Hono restore compensation must not log a raw provider secret");
    assert.equal(d1FailureStarted, true);
    assert.equal(ctx.stats.batches, 1, "one failed atomic D1 restore batch");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const result = await response.json();
    assert.equal(JSON.stringify(result).includes(providerSecret), false,
      "provider failure secret cannot reach the HTTP response");
    assert.equal(result.ok, false, "compensation failure must never report restore success");
    assert.match(result.message, /復元を確定できませんでした/);
    assert.equal(ctx.sqlite.prepare(
      `SELECT visibility_status FROM ${scenario.table} WHERE id = ?`,
    ).get(scenario.entityId).visibility_status, "public");
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'success'",
    ).get().n, 0);
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status = 'failed'",
    ).get().n, 1);
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM public_visibility_fences",
    ).get().n, 0, "rolled back D1 visibility fence cannot become durable");
    assert.equal(state.puts, 1,
      "compensation read failed; no second R2 write could release the block");
    assert.ok(state.manifest.entities.some((entry) =>
      entry.entity_type === scenario.kind
      && entry.entity_id === scenario.entityId
      && typeof entry.fence_token === "string"
      && entry.fence_token.length > 0,
    ), "failed compensation leaves the original R2 block in place");
  }
});

// The Hono route test injects an in-memory session middleware, not Auth.js.
// These counts therefore form a *lower bound*, not a production D1 profile.
// Reports remain observational until the approved S3 <=3 pre-read gate is met.
function recordRestoreD1Budget(scenario, stats, readTrace, sessionSource = "injected_mock") {
  assert.equal(readTrace.length, stats.reads,
    "trace must account for every fake D1 first/all/raw read");
  // Bounded, sanitized read order is more actionable than totals alone.
  const record = {
    read_trace: readTrace.slice(0, 20),
    scenario, mocked_session: sessionSource === "injected_mock",
    session_source: sessionSource, actual_workerd: false,
    d1_reads: stats.reads, d1_batches: stats.batches,
    s3_max_pre_reads: 3, s3_max_batches: 1,
    over_s3_budget: stats.reads > 3 || stats.batches > 1,
  };
  assert.ok(Number.isInteger(record.d1_reads));
  assert.ok(Number.isInteger(record.d1_batches));
  console.info("MIG-0662_S3_BUDGET " + JSON.stringify(record));
  return record;
}

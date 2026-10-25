// MIG-0629 U03: parity of the real CURRENT actions (src/lib/actions/audit-admin.ts
// updateAuditLogSettingsAction / getAuditLogDryRun) with the Hono routes
// POST /api/admin/audit/settings and POST /api/admin/audit/dry-run, on identically seeded
// SQLite databases. CURRENT uses "@/..." aliases and server-only, so (like auditParity.test.mjs)
// the file re-runs itself under tsx. CURRENT's requireAdminWrite is stubbed to return the admin
// and a drizzle db over the same node:sqlite database (drizzle sqlite-proxy driver, batch = one
// BEGIN/COMMIT like D1 batch).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const underTsx = process.env.FLAMENODE_ADMIN_AUDIT_CURRENT_PARITY === "1";

if (!underTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, FLAMENODE_ADMIN_AUDIT_CURRENT_PARITY: "1" },
    },
  );
  if (result.error) throw result.error;
  test("admin audit CURRENT parity (tsx child process)", () => {
    assert.equal(result.status, 0, "child tsx parity run must pass");
  });
} else {
  const { registerHooks } = await import("node:module");

  // CURRENT requireAdminWrite(feature) -> the admin, with the db the test set for this case.
  const GUARD_MODULE = `
export async function requireAdminWrite(feature) {
  const state = globalThis.__flamenodeAdminAuditCurrent;
  if (!state) throw new Error("requireAdminWrite called outside a CURRENT parity case");
  state.features.push(feature);
  return { ok: true, user: { id: state.userId }, db: state.db, activeXId: null, approvedXIds: [], hasPendingXRequest: false };
}
`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      if (specifier === "@/lib/auth/writeGuard") {
        return { url: `data:text/javascript,${encodeURIComponent(GUARD_MODULE)}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { DatabaseSync } = await import("node:sqlite");
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const actions = await import("../../../src/lib/actions/audit-admin.ts");
  const { Hono } = await import("hono");
  const { createAdminRoutes } = await import("../src/routes/admin/index.ts");
  const { createAdminD1, seedBase, SCHEMA } = await import("./helpers/sqliteD1.mjs");

  const NOW_S = 1_800_000_000;
  const NOW_MS = NOW_S * 1000;
  const SITE = "https://app.flamenode.example";
  const ADMIN = {
    id: "admin-1",
    name: "Admin",
    email: null,
    image: null,
    role: "admin",
    is_banned: 0,
    active_x_user_id: null,
  };

  /** Date.now and crypto.randomUUID frozen per side; each side starts its uuid counter at 1. */
  function freeze() {
    let n = 0;
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    Date.now = () => NOW_MS;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  }

  /** Result shape drizzle's sqlite-proxy session expects per method: run -> none, get -> one flat row, all/values -> rows as arrays. */
  function execute(sqlite, sql, params, method) {
    const statement = sqlite.prepare(sql);
    if (method === "run") {
      statement.run(...params);
      return [];
    }
    statement.setReturnArrays(true);
    if (method === "get") return statement.get(...params);
    return statement.all(...params);
  }

  /** CURRENT side: drizzle over node:sqlite. */
  function currentSide(seed) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(SCHEMA);
    seed(sqlite);
    const stats = { batches: 0 };
    const db = drizzle(
      async (sql, params, method) => ({ rows: execute(sqlite, sql, params, method) }),
      async (queries) => {
        stats.batches += 1;
        sqlite.exec("BEGIN");
        try {
          const results = queries.map(({ sql, params, method }) => ({
            rows: execute(sqlite, sql, params, method),
          }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    );
    return { sqlite, db, stats };
  }

  /** Runs one CURRENT action call as the admin, returning its result and the guard features it asked for. */
  async function runCurrent(side, call) {
    const state = { db: side.db, userId: ADMIN.id, features: [] };
    globalThis.__flamenodeAdminAuditCurrent = state;
    try {
      const result = await call();
      return { result: JSON.parse(JSON.stringify(result)), features: state.features };
    } finally {
      delete globalThis.__flamenodeAdminAuditCurrent;
    }
  }

  /** Hono side: the real admin route tree, with the admin as the session user. */
  function honoSide(seed) {
    const { db, sqlite, stats } = createAdminD1();
    seed(sqlite);
    const hono = new Hono();
    hono.route(
      "/api/admin",
      createAdminRoutes({
        session: async (c, next) => {
          c.set("user", { ...ADMIN });
          c.set("sessionState", "user");
          await next();
        },
      }),
    );
    const post = (path, body) =>
      hono.request(
        path,
        {
          method: "POST",
          headers: { "content-type": "application/json", Origin: SITE },
          body: JSON.stringify(body),
        },
        { DB: db, NEXT_PUBLIC_SITE_URL: SITE },
      );
    return { sqlite, stats, post };
  }

  const formOf = (fields) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    return form;
  };

  const seedDefault = (sqlite) => seedBase(sqlite);

  const settingsRows = (sqlite) =>
    sqlite.prepare("SELECT * FROM system_settings ORDER BY id").all().map((row) => ({ ...row }));
  const auditRows = (sqlite) =>
    sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all().map((row) => ({ ...row }));
  const announcementRows = (sqlite) =>
    sqlite.prepare("SELECT * FROM announcements ORDER BY id").all().map((row) => ({ ...row }));

  // ---------------- settings (SA-009) ----------------

  const PATCH = {
    normal_retention_days: 60,
    restorable_retention_days: 90,
    long_audit_retention_days: 730,
    max_payload_bytes: 250000,
    compact_after_days: 14,
  };

  /** Same values, as the form strings CURRENT receives and as the string-valued JSON Hono receives. */
  const PATCH_STRINGS = Object.fromEntries(Object.entries(PATCH).map(([k, v]) => [k, String(v)]));

  async function settingsBothSides({ currentFields, honoBody }) {
    const cur = currentSide(seedDefault);
    const restoreCurrent = freeze();
    let current;
    try {
      current = await runCurrent(cur, () => actions.updateAuditLogSettingsAction(formOf(currentFields)));
    } finally {
      restoreCurrent();
    }

    const hono = honoSide(seedDefault);
    const restoreHono = freeze();
    let res;
    try {
      res = await hono.post("/api/admin/audit/settings", honoBody);
    } finally {
      restoreHono();
    }
    return { cur, current, hono, status: res.status, honoJson: await res.json() };
  }

  test("CASE 1 settings success: CURRENT FormData and Hono JSON leave identical system_settings and audit_logs", async () => {
    const { cur, current, hono, status, honoJson } = await settingsBothSides({
      currentFields: PATCH_STRINGS,
      honoBody: PATCH,
    });

    assert.equal(status, 200);
    assert.deepStrictEqual(current.features, ["admin_permissions"]);
    assert.deepStrictEqual(current.result, { ok: true });
    assert.deepStrictEqual(honoJson, current.result);

    assert.equal(settingsRows(cur.sqlite)[0].audit_normal_retention_days, 60, "CURRENT wrote the settings row");
    assert.deepStrictEqual(settingsRows(hono.sqlite), settingsRows(cur.sqlite));
    assert.equal(auditRows(cur.sqlite).length, 1, "CURRENT wrote one audit row");
    assert.deepStrictEqual(auditRows(hono.sqlite), auditRows(cur.sqlite));

    // Reported, not asserted as a parity fact: the Hono D1 budget.
    assert.equal(hono.stats.reads, 3, `Hono reads (actual ${hono.stats.reads})`);
    assert.equal(hono.stats.batches, 1, `Hono batches (actual ${hono.stats.batches})`);
  });

  test("CASE 2 settings validation error: same message on both sides, no rows written", async () => {
    const { cur, current, hono, status, honoJson } = await settingsBothSides({
      currentFields: { normal_retention_days: "1" },
      honoBody: { normal_retention_days: 1 },
    });

    assert.equal(status, 400);
    assert.equal(current.result.ok, false);
    assert.equal(typeof current.result.message, "string");
    assert.deepStrictEqual(honoJson, current.result);

    assert.deepStrictEqual(auditRows(cur.sqlite), []);
    assert.deepStrictEqual(auditRows(hono.sqlite), []);
    assert.deepStrictEqual(settingsRows(hono.sqlite), settingsRows(cur.sqlite));
    assert.equal(settingsRows(cur.sqlite)[0].audit_normal_retention_days, 30, "settings row unchanged");
  });

  test("CASE 3 string-valued numbers in Hono JSON behave like CURRENT FormData", async () => {
    const { cur, current, hono, status, honoJson } = await settingsBothSides({
      currentFields: PATCH_STRINGS,
      honoBody: PATCH_STRINGS,
    });

    assert.equal(status, 200);
    assert.deepStrictEqual(current.result, { ok: true });
    assert.deepStrictEqual(honoJson, current.result);
    assert.deepStrictEqual(settingsRows(hono.sqlite), settingsRows(cur.sqlite));
    assert.deepStrictEqual(auditRows(hono.sqlite), auditRows(cur.sqlite));
  });

  test("CASE 3b partial patch: untouched fields keep their values, before/after snapshots match CURRENT", async () => {
    const { cur, current, hono, status, honoJson } = await settingsBothSides({
      currentFields: { compact_after_days: "7" },
      honoBody: { compact_after_days: 7 },
    });
    assert.equal(status, 200);
    assert.deepStrictEqual(honoJson, current.result);
    assert.equal(settingsRows(cur.sqlite)[0].audit_normal_retention_days, 30, "untouched field kept");
    assert.deepStrictEqual(settingsRows(hono.sqlite), settingsRows(cur.sqlite));
    assert.deepStrictEqual(auditRows(hono.sqlite), auditRows(cur.sqlite));
  });

  // No CASE for a missing system_settings row: Hono's CostGuard then fails closed (maintenance_mode)
  // before the route runs, while this harness stubs CURRENT's requireAdminWrite, so the two are not comparable here.

  // ---------------- dry run (SA-010) ----------------

  const BEFORE_JSON = {
    id: "anc-1", title: "Old Title", body: "Old Body", severity: "info", is_published: 1,
    publish_at: NOW_S, expire_at: NOW_S + 1000, target_audience: "all",
    created_by_user_id: "admin-1", created_at: NOW_S - 100, updated_at: NOW_S - 50,
  };
  const AFTER_JSON = {
    ...BEFORE_JSON, title: "Current Title", body: "Current Body", updated_at: NOW_S - 10,
  };

  /** Live announcement row. Defaults to the state AFTER_JSON recorded (no conflict). */
  function seedAnnouncement(sqlite, { title = "Current Title", body = "Current Body", updatedAt = NOW_S - 10 } = {}) {
    sqlite
      .prepare(
        `INSERT INTO announcements (id, title, body, severity, is_published, publish_at, expire_at, target_audience, created_by_user_id, created_at, updated_at)
         VALUES ('anc-1', ?, ?, 'info', 1, ?, ?, 'all', 'admin-1', ?, ?)`,
      )
      .run(title, body, NOW_S, NOW_S + 1000, NOW_S - 100, updatedAt);
  }

  function seedUpdateLog(sqlite, { id = "log-valid", expiresAt = null, createdAt = NOW_S - 10 } = {}) {
    sqlite
      .prepare(
        `INSERT INTO audit_logs (id, table_name, target_id, operation, restore_strategy, before_json, after_json, expires_at, created_at, actor_user_id)
         VALUES (?, 'announcements', 'anc-1', 'UPDATE', 'update_before', ?, ?, ?, ?, 'admin-1')`,
      )
      .run(id, JSON.stringify(BEFORE_JSON), JSON.stringify(AFTER_JSON), expiresAt, createdAt);
  }

  const DRY_RUN_CASES = {
    "no conflict": {
      seed(sqlite) {
        seedBase(sqlite);
        seedAnnouncement(sqlite);
        seedUpdateLog(sqlite);
      },
      auditId: "log-valid",
      expectOk: true,
      expectConflicts: 0,
    },
    "conflict (live row differs from after_json)": {
      seed(sqlite) {
        seedBase(sqlite);
        seedAnnouncement(sqlite, { title: "Edited Elsewhere", updatedAt: NOW_S - 5 });
        seedUpdateLog(sqlite);
      },
      auditId: "log-valid",
      expectOk: true,
      // title and updated_at both differ from after_json
      expectConflicts: 2,
    },
    "expired log": {
      seed(sqlite) {
        seedBase(sqlite);
        seedAnnouncement(sqlite);
        seedUpdateLog(sqlite, { expiresAt: NOW_S - 3600, createdAt: NOW_S - 3700 });
      },
      auditId: "log-valid",
      expectOk: false,
    },
    "already restored": {
      seed(sqlite) {
        seedBase(sqlite);
        seedAnnouncement(sqlite);
        seedUpdateLog(sqlite);
        sqlite
          .prepare(
            `INSERT INTO audit_restore_runs (id, audit_log_id, executed_by_user_id, reason, status, executed_at)
             VALUES ('run-prior', 'log-valid', 'admin-1', 'prior restore', 'success', ?)`,
          )
          .run(NOW_S - 10);
      },
      auditId: "log-valid",
      expectOk: false,
    },
    "unknown id": {
      seed(sqlite) {
        seedBase(sqlite);
        seedAnnouncement(sqlite);
        seedUpdateLog(sqlite);
      },
      auditId: "missing-log-id",
      expectOk: false,
    },
  };

  for (const [name, c] of Object.entries(DRY_RUN_CASES)) {
    test(`CASE 4 dry run ${name}: CURRENT getAuditLogDryRun body equals Hono body, no writes, no batch`, async () => {
      const reason = "testing dry run parity";

      const cur = currentSide(c.seed);
      const curAuditBefore = auditRows(cur.sqlite);
      const curTargetBefore = announcementRows(cur.sqlite);
      const restoreCurrent = freeze();
      let current;
      try {
        current = await runCurrent(cur, () => actions.getAuditLogDryRun(formOf({ audit_id: c.auditId, reason })));
      } finally {
        restoreCurrent();
      }

      const hono = honoSide(c.seed);
      const honoAuditBefore = auditRows(hono.sqlite);
      const honoTargetBefore = announcementRows(hono.sqlite);
      const restoreHono = freeze();
      let res;
      try {
        res = await hono.post("/api/admin/audit/dry-run", { audit_id: c.auditId, reason });
      } finally {
        restoreHono();
      }
      const honoBody = await res.json();

      assert.equal(res.status, 200);
      assert.deepStrictEqual(current.features, ["admin_permissions"]);
      assert.equal(current.result.ok, c.expectOk, `fixture must reach the intended path (CURRENT: ${current.result.message})`);
      if (c.expectConflicts !== undefined) {
        assert.equal(current.result.diff?.conflicts.length, c.expectConflicts, "fixture conflict count");
      }
      assert.deepStrictEqual(honoBody, current.result, "Hono body equals CURRENT return value (JSON wire form)");

      // Writes: none on either side; the dry run never starts a batch.
      assert.deepStrictEqual(auditRows(hono.sqlite), honoAuditBefore);
      assert.deepStrictEqual(announcementRows(hono.sqlite), honoTargetBefore);
      assert.deepStrictEqual(auditRows(cur.sqlite), curAuditBefore);
      assert.deepStrictEqual(announcementRows(cur.sqlite), curTargetBefore);
      assert.equal(hono.stats.batches, 0, "Hono dry run batches");
      assert.equal(cur.stats.batches, 0, "CURRENT dry run batches");
    });
  }
}

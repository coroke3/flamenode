import assert from "node:assert/strict";
import { test } from "node:test";
import { createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/adminReadSeed.mjs";

// MIG-0638 parity & atomicity suite: RH-004 PATCH /data, RH-005 POST /data,
// RH-006 DELETE /data, RH-008 POST /import, plus F-1 (/export?page=) and F-5.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      const resolved = nextResolve(specifier, context);
      if (resolved.url.endsWith("/src/lib/admin/spreadsheet/guard.ts")) {
        const stub =
          "export const isAdminSpreadsheetEnabled=()=>true;" +
          'export const requireAdminSpreadsheetApi=async()=>({ok:true,session:{userId:"u_root"}});' +
          'export const requireAdminSpreadsheetWriteApi=async()=>({ok:true,session:{userId:"u_root"}});';
        return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
      }
      return resolved;
    },
  });

  const { app } = await import("../src/app.ts");
  const { invalidateSpreadsheetCaches } = await import("../src/routes/admin/spreadsheet/catalog.ts");
  const { invalidateSpreadsheetWriteCaches } = await import("../src/routes/admin/spreadsheet/write.ts");
  const currentDiscovery = await import("../../../src/lib/admin/spreadsheet/discovery.ts");
  const currentColumns = await import("../../../src/lib/admin/spreadsheet/tableContext.ts");
  const currentDataRoute = await import("../../../app/api/admin/spreadsheet/data/route.ts");
  const currentImportRoute = await import("../../../app/api/admin/spreadsheet/import/route.ts");
  const contracts = await import("@flamenode/contracts");

  const SITE = "https://app.flamenode.example";
  const AUTH_SECRET = "test-auth-secret-mig-0638-parity";
  const PREVIEW_SECRET = "test-preview-secret-mig-0638-0123456789abcdef";

  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.SPREADSHEET_IMPORT_PREVIEW_SECRET = PREVIEW_SECRET;

  function createAtomicD1(sqlite) {
    const stats = { statements: 0, reads: 0, writes: 0, batches: 0, maxBinds: 0 };
    const READ_RE = /^\s*(SELECT|WITH|PRAGMA)\b/i;

    function execSync(sql, params, inBatch = false) {
      if (!inBatch) {
        if (READ_RE.test(sql)) {
          stats.reads += 1;
        } else {
          stats.writes += 1;
        }
      }
      stats.statements += 1;
      stats.maxBinds = Math.max(stats.maxBinds, params.length);
      const results = sqlite.prepare(sql).all(...params).map((row) => ({ ...row }));
      return { results, success: true, meta: {} };
    }

    function statement(sql, params) {
      const self = {
        bind(...values) {
          return statement(sql, values);
        },
        async all() {
          return execSync(sql, params);
        },
        async first() {
          return execSync(sql, params).results[0] ?? null;
        },
        async run() {
          return execSync(sql, params);
        },
        async raw() {
          stats.reads += 1;
          stats.statements += 1;
          stats.maxBinds = Math.max(stats.maxBinds, params.length);
          const prepared = sqlite.prepare(sql);
          prepared.setReturnArrays(true);
          try {
            return prepared.all(...params).map((row) => [...row]);
          } finally {
            prepared.setReturnArrays(false);
          }
        },
      };
      self.__sql = sql;
      self.__params = params;
      return self;
    }

    return {
      stats,
      prepare: (sql) => statement(sql, []),
      async batch(statements) {
        stats.batches += 1;
        sqlite.exec("BEGIN");
        try {
          const out = statements.map((s) => execSync(s.__sql, s.__params, true));
          sqlite.exec("COMMIT");
          return out;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function resetAllCaches() {
    invalidateSpreadsheetCaches();
    invalidateSpreadsheetWriteCaches();
    currentDiscovery.invalidateSpreadsheetTableCache();
    currentColumns.invalidateSpreadsheetColumnCache();
  }

  function createFixture() {
    const curSqlite = createSqlite();
    seed(curSqlite);
    const honoSqlite = createSqlite();
    seed(honoSqlite);

    // Ensure FK-clean software_catalog + slots rows exist in both DBs.
    for (const db of [curSqlite, honoSqlite]) {
      insert(db, "software_catalog", {
        id: "sw-base",
        name: "Base Soft",
        normalized_name: "base soft",
        created_at: 100,
        updated_at: 100,
      });
      insert(db, "slots", {
        id: "slot-base",
        event_id: "a-open",
        sort_order: 1,
        slot_label: "Slot 1",
        status: "available",
      });
    }

    const baseCurD1 = createAtomicD1(curSqlite);
    const curD1 = {
      stats: baseCurD1.stats,
      batch: baseCurD1.batch,
      prepare: (sql) =>
        baseCurD1.prepare(sql.replace("pragma_table_info(name)", "pragma_table_info(sqlite_master.name)")),
    };
    const honoD1 = createAtomicD1(honoSqlite);

    globalThis.__FLAMENODE_LOCAL_BINDINGS = {
      DB: curD1,
      BUCKET: { get: async () => null, put: async () => null, delete: async () => null },
      KV: { get: async () => null, put: async () => null, delete: async () => null },
      SPREADSHEET_IMPORT_PREVIEW_SECRET: PREVIEW_SECRET,
    };

    const honoEnv = {
      DB: honoD1,
      AUTH_SECRET,
      NEXT_PUBLIC_SITE_URL: SITE,
      ADMIN_SPREADSHEET_ENABLED: "1",
      SPREADSHEET_IMPORT_PREVIEW_SECRET: PREVIEW_SECRET,
    };

    async function callHono(method, path, body, { token = "root", headers = { Origin: SITE }, env = honoEnv } = {}) {
      const reqHeaders = {
        ...(token ? { cookie: `__Secure-authjs.session-token=tok-${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      };
      const res = await app.request(
        `${SITE}/api/admin/spreadsheet${path}`,
        {
          method,
          headers: reqHeaders,
          body: typeof body === "string" ? body : body !== undefined ? JSON.stringify(body) : undefined,
        },
        env,
      );
      const text = await res.text();
      let json = text;
      try {
        json = JSON.parse(text);
      } catch {
        /* text/csv */
      }
      return { status: res.status, headers: res.headers, text, body: json };
    }

    async function callCurrent(routeMod, method, path, body) {
      const req = new Request(`${SITE}/api/admin/spreadsheet${path}`, {
        method,
        headers: {
          Origin: SITE,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: typeof body === "string" ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
      const res = await routeMod[method](req);
      const text = await res.text();
      let json = text;
      try {
        json = JSON.parse(text);
      } catch {
        /* text */
      }
      return { status: res.status, headers: res.headers, text, body: json };
    }

    return { curSqlite, honoSqlite, curD1, honoD1, honoEnv, callHono, callCurrent };
  }

  function latestAudit(sqlite) {
    return sqlite.prepare("SELECT * FROM audit_logs ORDER BY rowid DESC LIMIT 1").get();
  }

  function allAudits(sqlite) {
    return sqlite.prepare("SELECT * FROM audit_logs ORDER BY rowid ASC").all();
  }

  function allQueueRows(sqlite) {
    return sqlite
      .prepare("SELECT target_type, target_id, reason, priority, status, requested_by_user_id FROM static_rebuild_queue ORDER BY rowid ASC")
      .all();
  }

  test("MIG-0638 guards: origin, ADMIN_SPREADSHEET_ENABLED=0, auth, role, CostGuard, preview secret", async () => {
    resetAllCaches();
    const { honoSqlite, honoD1, honoEnv, callHono } = createFixture();
    const writeTargets = [
      ["PATCH", "/data", { table: "software_catalog", primaryKey: { id: "sw-base" }, column: "name", value: "X" }],
      ["POST", "/data", { table: "software_catalog", row: { id: "sw-new", name: "N", normalized_name: "n", created_at: "1", updated_at: "1" } }],
      ["DELETE", "/data", { table: "software_catalog", primaryKey: { id: "sw-base" } }],
      ["POST", "/import", { table: "software_catalog", dryRun: true, rows: [{ id: "sw-i", name: "I", normalized_name: "i", created_at: "1", updated_at: "1" }] }],
    ];

    for (const [method, path, body] of writeTargets) {
      // 1. Cross-origin / missing origin -> 403 invalid_origin, 0 D1 reads/writes
      const beforeOrigin = honoD1.stats.statements;
      const badOrigin = await callHono(method, path, body, { headers: { Origin: "https://evil.invalid" } });
      assert.equal(badOrigin.status, 403, `${method} ${path} bad origin`);
      assert.equal(badOrigin.body.reason, "invalid_origin");
      assert.equal(honoD1.stats.statements, beforeOrigin, "bad origin must touch 0 D1 statements");

      // 2. Disabled flag -> 404 spreadsheet_disabled BEFORE session/auth (0 D1 reads)
      const beforeDisabled = honoD1.stats.statements;
      const disabledAnon = await callHono(method, path, body, {
        token: null,
        env: { ...honoEnv, ADMIN_SPREADSHEET_ENABLED: "0" },
      });
      assert.equal(disabledAnon.status, 404, `${method} ${path} disabled`);
      assert.deepEqual(disabledAnon.body, { error: "spreadsheet_disabled" });
      assert.equal(honoD1.stats.statements, beforeDisabled, "disabled must not read session/D1");

      // 3. Anonymous -> 401
      const anon = await callHono(method, path, body, { token: null });
      assert.equal(anon.status, 401, `${method} ${path} anon`);

      // 4. Non-admin / moderator / banned -> 403
      for (const tok of ["alice", "bob", "badmin"]) {
        const denied = await callHono(method, path, body, { token: tok });
        assert.equal(denied.status, 403, `${method} ${path} ${tok}`);
      }

      // 5. CostGuard maintenance -> 503
      honoSqlite.prepare("UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'").run();
      const maint = await callHono(method, path, body);
      assert.equal(maint.status, 503, `${method} ${path} maintenance`);
      assert.equal(maint.body.reason, "maintenance_mode");
      honoSqlite.prepare("UPDATE system_settings SET operation_mode = 'normal' WHERE id = 'default'").run();
    }

    // 6. Missing preview secret on /import -> 503 preview_unavailable
    const noSecret = await callHono("POST", "/import", writeTargets[3][2], {
      env: { ...honoEnv, SPREADSHEET_IMPORT_PREVIEW_SECRET: "short" },
    });
    assert.equal(noSecret.status, 503);
    assert.deepEqual(noSecret.body, { error: "preview_unavailable" });
    assert.equal(honoD1.stats.writes, 0);
  });

  test("MIG-0638 T01: CRUD parity + secret/readonly/blocklist/owner protection + audit byte parity", async () => {
    resetAllCaches();
    const { curSqlite, honoSqlite, callHono, callCurrent } = createFixture();

    // 1. POST /data (non-public table: software_catalog -> pendingPublicReflection: false)
    const postCatalog = {
      table: "software_catalog",
      row: { id: "sw-added", name: "Added Soft", normalized_name: "added soft", created_at: "200", updated_at: "200" },
    };
    const curPost = await callCurrent(currentDataRoute, "POST", "/data", postCatalog);
    const honoPost = await callHono("POST", "/data", postCatalog);
    assert.equal(curPost.status, 200);
    assert.equal(honoPost.status, 200);
    assert.deepEqual(honoPost.body, curPost.body);
    assert.equal(honoPost.body.pendingPublicReflection, false);

    // Audit byte parity on CREATE
    const curAuditPost = latestAudit(curSqlite);
    const honoAuditPost = latestAudit(honoSqlite);
    for (const field of [
      "table_name", "target_id", "operation", "before_json", "after_json",
      "changed_keys_json", "inverse_patch_json", "actor_user_id",
      "retention_class", "context", "payload_size_bytes",
    ]) {
      assert.equal(honoAuditPost[field], curAuditPost[field], `POST audit.${field}`);
    }
    assert.equal(honoAuditPost.expires_at - honoAuditPost.created_at, curAuditPost.expires_at - curAuditPost.created_at);

    // 2. PATCH /data (public table: x_users -> pendingPublicReflection: true + static_rebuild_queue)
    const patchXUser = {
      table: "x_users",
      primaryKey: { id: "orph_x" },
      column: "x_name",
      value: "Renamed Orphan",
    };
    const curPatch = await callCurrent(currentDataRoute, "PATCH", "/data", patchXUser);
    const honoPatch = await callHono("PATCH", "/data", patchXUser);
    assert.equal(curPatch.status, 200);
    assert.equal(honoPatch.status, 200);
    assert.deepEqual(honoPatch.body, curPatch.body);
    assert.equal(honoPatch.body.pendingPublicReflection, true);

    const curAuditPatch = latestAudit(curSqlite);
    const honoAuditPatch = latestAudit(honoSqlite);
    for (const field of [
      "table_name", "target_id", "operation", "before_json", "after_json",
      "changed_keys_json", "inverse_patch_json", "actor_user_id",
      "retention_class", "context", "payload_size_bytes",
    ]) {
      assert.equal(honoAuditPatch[field], curAuditPatch[field], `PATCH audit.${field}`);
    }
    assert.deepEqual(allQueueRows(honoSqlite), allQueueRows(curSqlite));

    // 3. DELETE /data (software_catalog)
    const delCatalog = { table: "software_catalog", primaryKey: { id: "sw-added" } };
    const curDel = await callCurrent(currentDataRoute, "DELETE", "/data", delCatalog);
    const honoDel = await callHono("DELETE", "/data", delCatalog);
    assert.equal(curDel.status, 200);
    assert.equal(honoDel.status, 200);
    assert.deepEqual(honoDel.body, curDel.body);
    const curAuditDel = latestAudit(curSqlite);
    const honoAuditDel = latestAudit(honoSqlite);
    for (const field of [
      "table_name", "target_id", "operation", "before_json", "after_json",
      "changed_keys_json", "inverse_patch_json", "actor_user_id",
      "retention_class", "context", "payload_size_bytes",
    ]) {
      assert.equal(honoAuditDel[field], curAuditDel[field], `DELETE audit.${field}`);
    }

    // 4. Policy protection parity: secret/readonly columns, readonly/blocklist tables, physical delete block, FK
    const policyCases = [
      // Readonly & secret tables
      ["PATCH", { table: "session", primaryKey: { sessionToken: "tok-root" }, column: "sessionToken", value: "new" }, 400, "table_readonly"],
      ["PATCH", { table: "account", primaryKey: { provider: "discord", providerAccountId: "d" }, column: "access_token", value: "x" }, 400, "table_readonly"],
      ["PATCH", { table: "user", primaryKey: { id: "u_alice" }, column: "role", value: "admin" }, 400, "table_readonly"],
      ["PATCH", { table: "event_staff", primaryKey: { id: "es-1" }, column: "permission_preset", value: "owner" }, 400, "table_readonly"],
      // Blocklisted / unknown tables
      ["PATCH", { table: "d1_migrations", primaryKey: { id: "1" }, column: "name", value: "x" }, 400, "unknown_table"],
      ["POST", { table: "static_artifacts", row: { key: "k" } }, 400, "unknown_table"],
      ["DELETE", { table: "sqlite_master", primaryKey: { name: "user" } }, 400, "unknown_table"],
      // visibility_status / approval_status column protection on PATCH and POST
      ["PATCH", { table: "events", primaryKey: { id: "a-open" }, column: "visibility_status", value: "private" }, 400, "column_not_editable"],
      ["PATCH", { table: "x_users", primaryKey: { id: "orph_x" }, column: "approval_status", value: "rejected" }, 400, "column_not_editable"],
      ["POST", { table: "events", row: { id: "ev-bad", title: "Bad", visibility_status: "public" } }, 400, "column_not_editable"],
      // Physical delete block (events, event_groups, system_settings, videos, x_users)
      ["DELETE", { table: "events", primaryKey: { id: "a-open" } }, 400, "physical_delete_requires_visibility_status"],
      ["DELETE", { table: "x_users", primaryKey: { id: "orph_x" } }, 400, "physical_delete_requires_visibility_status"],
      ["DELETE", { table: "videos", primaryKey: { id: "av-private" } }, 400, "physical_delete_requires_visibility_status"],
      // Row not found (404)
      ["PATCH", { table: "software_catalog", primaryKey: { id: "missing" }, column: "name", value: "X" }, 404, "row_not_found"],
      ["DELETE", { table: "software_catalog", primaryKey: { id: "missing" } }, 404, "row_not_found"],
      // Foreign key violation (400)
      ["PATCH", { table: "slots", primaryKey: { id: "slot-base" }, column: "event_id", value: "no-such-event" }, 400, "foreign_key_violation"],
      // Unknown column (400)
      ["PATCH", { table: "software_catalog", primaryKey: { id: "sw-base" }, column: "nope_col", value: "X" }, 400, "unknown_column"],
    ];

    const curCountBefore = allAudits(curSqlite).length;
    const honoCountBefore = allAudits(honoSqlite).length;
    for (const [method, payload, expectedStatus, expectedCode] of policyCases) {
      const curR = await callCurrent(currentDataRoute, method, "/data", payload);
      const honoR = await callHono(method, "/data", payload);
      assert.equal(curR.status, expectedStatus, `${method} ${payload.table} CUR`);
      assert.equal(honoR.status, expectedStatus, `${method} ${payload.table} HONO`);
      assert.deepEqual(honoR.body, { error: expectedCode }, `${method} ${payload.table}`);
      assert.deepEqual(curR.body, { error: expectedCode }, `${method} ${payload.table}`);
    }
    assert.equal(allAudits(curSqlite).length, curCountBefore);
    assert.equal(allAudits(honoSqlite).length, honoCountBefore);
  });

  test("MIG-0638 RH-004/006: CURRENT column policy and normalized PK validation precedence", async () => {
    resetAllCaches();
    const { curSqlite, honoSqlite, curD1, honoD1, callHono, callCurrent } = createFixture();
    const snapshot = db => ({
      catalog: db.prepare("SELECT * FROM software_catalog ORDER BY id").all(),
      events: db.prepare("SELECT * FROM events ORDER BY id").all(),
      audit: allAudits(db),
      queue: allQueueRows(db),
    });
    const beforeCur = snapshot(curSqlite);
    const beforeHono = snapshot(honoSqlite);
    const writesCur = curD1.stats.writes;
    const writesHono = honoD1.stats.writes;
    const batchesCur = curD1.stats.batches;
    const batchesHono = honoD1.stats.batches;
    const longKey = "x".repeat(100_001);
    const cases = [
      ["PATCH", { table: "software_catalog", primaryKey: {}, column: "nope_col", value: "X" }, 400, "unknown_column"],
      ["PATCH", { table: "events", primaryKey: {}, column: "visibility_status", value: "private" }, 400, "column_not_editable"],
      ["DELETE", { table: "events", primaryKey: {} }, 400, "physical_delete_requires_visibility_status"],
      ["PATCH", { table: "software_catalog", primaryKey: { id: longKey }, column: "name", value: "X" }, 400, "value_too_long"],
      ["DELETE", { table: "software_catalog", primaryKey: { id: longKey } }, 400, "value_too_long"],
      ["PATCH", { table: "software_catalog", primaryKey: { id: "" }, column: "name", value: "X" }, 400, "missing_primary_key"],
      ["PATCH", { table: "software_catalog", primaryKey: { id: "missing" }, column: "name", value: "X" }, 404, "row_not_found"],
      ["DELETE", { table: "software_catalog", primaryKey: { id: "missing" } }, 404, "row_not_found"],
    ];
    try {
      for (const [method, payload, status, error] of cases) {
        const current = await callCurrent(currentDataRoute, method, "/data", payload);
        const target = await callHono(method, "/data", payload);
        assert.equal(current.status, status, method + " CURRENT " + error);
        assert.deepEqual(current.body, { error });
        assert.equal(target.status, status, method + " TARGET " + error);
        assert.deepEqual(target.body, current.body);
        assert.match(target.headers.get("cache-control"), /private.*no-store/);
      }
      assert.equal(curD1.stats.writes, writesCur);
      assert.equal(honoD1.stats.writes, writesHono);
      assert.equal(curD1.stats.batches, batchesCur);
      assert.equal(honoD1.stats.batches, batchesHono);
      assert.deepEqual(snapshot(curSqlite), beforeCur);
      assert.deepEqual(snapshot(honoSqlite), beforeHono);
    } finally {
      resetAllCaches();
      curSqlite.close();
      honoSqlite.close();
    }
  });

  test("MIG-0638 T02: import dryRun + apply parity, nonce replay, and partial-failure full rollback", async () => {
    resetAllCaches();
    const { curSqlite, honoSqlite, callHono, callCurrent } = createFixture();

    const importRows = [
      { id: "sw-imp-1", name: "Imp 1", normalized_name: "imp 1", created_at: "10", updated_at: "10" },
      { id: "sw-imp-2", name: "Imp 2", normalized_name: "imp 2", created_at: "10", updated_at: "10" },
    ];

    // 1. Apply without previewToken -> 409 preview_required
    const noTokenCur = await callCurrent(currentImportRoute, "POST", "/import", {
      table: "software_catalog", mode: "insert", rows: importRows,
    });
    const noTokenHono = await callHono("POST", "/import", {
      table: "software_catalog", mode: "insert", rows: importRows,
    });
    assert.equal(noTokenCur.status, 409);
    assert.equal(noTokenHono.status, 409);
    assert.deepEqual(noTokenHono.body, { error: "preview_required" });

    // 2. Dry run on both CURRENT and Hono
    const dryCur = await callCurrent(currentImportRoute, "POST", "/import", {
      table: "software_catalog", mode: "insert", dryRun: true, rows: importRows,
    });
    const dryHono = await callHono("POST", "/import", {
      table: "software_catalog", mode: "insert", dryRun: true, rows: importRows,
    });
    assert.equal(dryCur.status, 200);
    assert.equal(dryHono.status, 200);
    contracts.AdminSpreadsheetImportDryRunResponseSchema.parse(dryHono.body);
    assert.equal(dryHono.body.rowCount, 2);
    assert.equal(dryHono.body.applyMaxRows, 7);

    // Tampered rows with valid token -> 409 preview_required before any table write
    const tampered = await callHono("POST", "/import", {
      table: "software_catalog",
      mode: "insert",
      previewToken: dryHono.body.previewToken,
      rows: [importRows[0], { ...importRows[1], name: "Tampered" }],
    });
    assert.equal(tampered.status, 409);
    assert.deepEqual(tampered.body, { error: "preview_required" });

    // 3. Valid apply on both
    const applyCur = await callCurrent(currentImportRoute, "POST", "/import", {
      table: "software_catalog", mode: "insert", previewToken: dryCur.body.previewToken, rows: importRows,
    });
    const applyHono = await callHono("POST", "/import", {
      table: "software_catalog", mode: "insert", previewToken: dryHono.body.previewToken, rows: importRows,
    });
    assert.equal(applyCur.status, 200);
    assert.equal(applyHono.status, 200);
    contracts.AdminSpreadsheetImportApplyResponseSchema.parse(applyHono.body);
    assert.deepEqual(applyHono.body, applyCur.body);
    assert.equal(applyHono.body.inserted, 2);
    assert.equal(applyHono.body.errors.length, 0);

    // 4. Nonce replay -> rejected (500 internal_error), no duplicate audit
    const auditBeforeReplay = allAudits(honoSqlite).length;
    const origErr = console.error;
    console.error = () => {};
    try {
      const replay = await callHono("POST", "/import", {
        table: "software_catalog", mode: "insert", previewToken: dryHono.body.previewToken, rows: importRows,
      });
      assert.equal(replay.status, 500);
      assert.deepEqual(replay.body, { error: "internal_error" });
    } finally {
      console.error = origErr;
    }
    assert.equal(allAudits(honoSqlite).length, auditBeforeReplay);

    // 5. T02 Partial failure FULL ROLLBACK:
    // Row 0 is brand new ("sw-rb-ok"), Row 1 collides with existing "sw-base" (UNIQUE constraint failed in batch)
    const partialRows = [
      { id: "sw-rb-ok", name: "Should Rollback", normalized_name: "should rollback", created_at: "10", updated_at: "10" },
      { id: "sw-base", name: "Collision", normalized_name: "collision", created_at: "10", updated_at: "10" },
    ];
    const dryRb = await callHono("POST", "/import", {
      table: "software_catalog", mode: "insert", dryRun: true, rows: partialRows,
    });
    assert.equal(dryRb.status, 200);
    const auditsBeforeRb = allAudits(honoSqlite).length;
    const failApply = await callHono("POST", "/import", {
      table: "software_catalog", mode: "insert", previewToken: dryRb.body.previewToken, rows: partialRows,
    });
    assert.equal(failApply.status, 400);
    assert.deepEqual(failApply.body, { error: "unique_violation" });
    assert.equal(
      honoSqlite.prepare("SELECT COUNT(*) AS n FROM software_catalog WHERE id = 'sw-rb-ok'").get().n,
      0,
      "partial failure must roll back row 0",
    );
    assert.equal(allAudits(honoSqlite).length, auditsBeforeRb, "partial failure must roll back all audits");
    const rbNonce = honoSqlite
      .prepare("SELECT consumed_at FROM spreadsheet_import_runs ORDER BY rowid DESC LIMIT 1")
      .get();
    assert.equal(rbNonce.consumed_at, null, "partial failure must roll back nonce consumption");

    // 6. T02 Upsert mixed insert + update + skip parity
    const upsertRows = [
      { id: "sw-imp-1", name: "Imp 1 Updated", normalized_name: "imp 1", created_at: "10", updated_at: "20" },
      { id: "sw-imp-3", name: "Imp 3", normalized_name: "imp 3", created_at: "10", updated_at: "10" },
      { id: "sw-imp-2" }, // PK-only -> skipped
    ];
    const dryUpCur = await callCurrent(currentImportRoute, "POST", "/import", {
      table: "software_catalog", mode: "upsert", dryRun: true, rows: upsertRows,
    });
    const dryUpHono = await callHono("POST", "/import", {
      table: "software_catalog", mode: "upsert", dryRun: true, rows: upsertRows,
    });
    const upCur = await callCurrent(currentImportRoute, "POST", "/import", {
      table: "software_catalog", mode: "upsert", previewToken: dryUpCur.body.previewToken, rows: upsertRows,
    });
    const upHono = await callHono("POST", "/import", {
      table: "software_catalog", mode: "upsert", previewToken: dryUpHono.body.previewToken, rows: upsertRows,
    });
    assert.equal(upHono.status, 200);
    assert.deepEqual(upHono.body, upCur.body);
    assert.equal(upHono.body.inserted, 1);
    assert.equal(upHono.body.updated, 1);
    assert.equal(upHono.body.skipped, 1);
    assert.equal(
      honoSqlite.prepare("SELECT name FROM software_catalog WHERE id = 'sw-imp-1'").get().name,
      curSqlite.prepare("SELECT name FROM software_catalog WHERE id = 'sw-imp-1'").get().name,
    );
  });

  test("MIG-0638 F-1 & F-5: /export?page= pagination and failure console.error logging with fixed 500 body", async () => {
    resetAllCaches();
    const { honoSqlite, honoD1, callHono } = createFixture();
    for (let i = 0; i < 130; i += 1) {
      insert(honoSqlite, "software_catalog", {
        id: `pg-${String(i).padStart(3, "0")}`,
        name: `Page ${i}`,
        normalized_name: `page ${i}`,
        created_at: 1,
        updated_at: 1,
      });
    }

    const beforeReads = honoD1.stats.reads;
    const page1 = await callHono("GET", "/export?table=software_catalog&page=1", undefined, { headers: {} });
    assert.equal(page1.status, 200);
    assert.equal(page1.headers.get("x-spreadsheet-truncated"), "1");
    assert.match(page1.headers.get("content-disposition"), /filename="software_catalog-partial\.csv"/);
    assert.equal(page1.text.split("\n").length, 1 + 99);
    assert.equal(honoD1.stats.reads - beforeReads, 3, "S2: session + catalog + export");

    const beforePage2 = honoD1.stats.reads;
    const page2 = await callHono("GET", "/export?table=software_catalog&page=2", undefined, { headers: {} });
    assert.equal(page2.status, 200);
    assert.equal(page2.headers.get("x-spreadsheet-truncated"), "0");
    assert.match(page2.headers.get("content-disposition"), /filename="software_catalog\.csv"/);
    assert.equal(page2.text.split("\n").length, 1 + 32, "131 total rows - 99 = 32 remaining rows");
    assert.equal(honoD1.stats.reads - beforePage2, 2, "S2 warm cache: session + export");

    // F-5: failure() logs a fixed diagnostic without provider details.
    const logs = [];
    const origError = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      honoSqlite.exec('DROP TABLE "software_catalog"');
      invalidateSpreadsheetCaches();
      const broken = await callHono("GET", "/export?table=software_catalog&page=2", undefined, { headers: {} });
      assert.equal(broken.status, 400);
      assert.deepEqual(broken.body, { error: "unknown_table" });

      // Trigger a runtime query error after cached context resolution
      const cached = await callHono("GET", "/data?table=x_users", undefined, { headers: {} });
      assert.equal(cached.status, 200);
      honoSqlite.exec('ALTER TABLE "x_users" RENAME TO "x_users_hidden"');
      const errRes = await callHono("GET", "/data?table=x_users", undefined, { headers: {} });
      assert.equal(errRes.status, 500);
      assert.deepEqual(errRes.body, { error: "internal_error" });
      assert.deepEqual(logs, ["[spreadsheet] READ_FAILED"]);
    } finally {
      console.error = origError;
    }
  });

  test("MIG-0638 F-5: GET data/export provider faults preserve fixed no-store responses and diagnostics", async () => {
    resetAllCaches();
    const { honoD1, callHono } = createFixture();
    const paths = ["/data?table=software_catalog", "/export?table=software_catalog&page=2"];
    const options = { headers: {} };
    for (const path of paths) {
      assert.equal((await callHono("GET", path, undefined, options)).status, 200);
    }
    const originalPrepare = honoD1.prepare;
    const originalError = console.error;
    const canary = "MIG0638_READ_PROVIDER_CANARY";
    const faults = [
      new Error("provider params: " + canary),
      Object.defineProperty(new Error(), "message", { get() { throw new Error(canary); } }),
      new Proxy({}, { getPrototypeOf() { throw new Error(canary); } }),
      { toString() { throw new Error(canary); } },
    ];
    const before = { ...honoD1.stats };
    const logs = [];
    let injected = 0;
    try {
      console.error = (...args) => logs.push(args);
      for (const fault of faults) {
        honoD1.prepare = (sql) => {
          if (sql.startsWith('SELECT * FROM "software_catalog" ORDER BY ')) {
            injected++;
            throw fault;
          }
          return originalPrepare(sql);
        };
        for (const path of paths) {
          const result = await callHono("GET", path, undefined, options);
          assert.equal(result.status, 500);
          assert.deepEqual(result.body, { error: "internal_error" });
          assert.match(result.headers.get("cache-control"), /private.*no-store/);
        }
      }
      assert.equal(injected, faults.length * paths.length);
      assert.deepEqual(logs, Array.from({ length: injected }, () => ["[spreadsheet] READ_FAILED"]));
      console.error = () => { throw new Error(canary); };
      for (const path of paths) {
        const result = await callHono("GET", path, undefined, options);
        assert.equal(result.status, 500);
        assert.deepEqual(result.body, { error: "internal_error" });
        assert.match(result.headers.get("cache-control"), /private.*no-store/);
      }
      assert.equal(injected, (faults.length + 1) * paths.length);
    } finally {
      honoD1.prepare = originalPrepare;
      console.error = originalError;
    }
    assert.equal(honoD1.stats.batches, before.batches);
    assert.equal(honoD1.stats.writes, before.writes);
    for (const path of paths) {
      assert.equal((await callHono("GET", path, undefined, options)).status, 200);
    }
  });

  test("MIG-0638 U02: write/import provider diagnostics never reflect forged column details", async () => {
    resetAllCaches();
    const { honoSqlite, honoD1, callHono, callCurrent } = createFixture();
    // Genuine RH-008 validation retains the detailed CURRENT error envelope.
    for (const [table, row, expected] of [
      ["software_catalog", { not_a_column: "x" }, "unknown_column:not_a_column"],
      ["events", { visibility_status: "private" }, "column_not_editable:visibility_status"],
    ]) {
      const body = { table, dryRun: true, rows: [row] };
      const current = await callCurrent(currentImportRoute, "POST", "/import", body);
      const target = await callHono("POST", "/import", body);
      assert.equal(current.status, 400);
      assert.equal(target.status, 400);
      assert.deepEqual(current.body, { error: expected });
      assert.deepEqual(target.body, current.body);
    }

    const beforeAudits = allAudits(honoSqlite);
    const beforeQueue = allQueueRows(honoSqlite);
    const beforeRows = honoSqlite.prepare("SELECT * FROM software_catalog ORDER BY id").all();
    const beforeBatches = honoD1.stats.batches;
    const beforeWrites = honoD1.stats.writes;
    const originalPrepare = honoD1.prepare;
    const originalError = console.error;
    const canary = "MIG0638_PROVIDER_CANARY";
    const hostileMessage = Object.defineProperty(new Error(), "message", {
      get() { throw new Error(canary); },
    });
    const hostilePrototype = new Proxy({}, {
      getPrototypeOf() { throw new Error(canary); },
    });
    const forged = [
      new Error("unknown_column:" + canary),
      new Error("column_not_editable:" + canary),
      new Error("provider params: " + canary),
      // A catalog SELECT cannot establish any of these client/constraint errors.
      new Error("preview_required"),
      new Error("row_not_found"),
      new Error("unknown_table"),
      new Error("db_unavailable"),
      new Error("batch_too_large"),
      new Error("UNIQUE constraint failed: " + canary),
      hostileMessage,
      hostilePrototype,
    ];
    const row = { id: "sw-redaction", name: "New", normalized_name: "new", created_at: "1", updated_at: "1" };
    const logs = [];
    let injected = 0;
    try {
      console.error = (...args) => logs.push(args);
      const stages = ["prepare", "bind", "all"];
      for (const fault of forged) {
        for (const stage of stages) {
          for (const [path, body] of [
            ["/data", { table: "software_catalog", row }],
            ["/import", { table: "software_catalog", dryRun: true, rows: [row] }],
          ]) {
            resetAllCaches();
            honoD1.prepare = (sql) => {
              if (!sql.includes("FROM pragma_table_xinfo(?) AS x")) return originalPrepare(sql);
              if (stage === "prepare") {
                injected++;
                throw fault;
              }
              const stmt = originalPrepare(sql);
              return {
                ...stmt,
                bind(...params) {
                  if (stage === "bind") {
                    injected++;
                    throw fault;
                  }
                  return {
                    ...stmt.bind(...params),
                    all: async () => {
                      injected++;
                      throw fault;
                    },
                  };
                },
              };
            };
            const result = await callHono("POST", path, body);
            assert.equal(result.status, 500, stage);
            assert.deepEqual(result.body, { error: "internal_error" });
            assert.match(result.headers.get("cache-control"), /private.*no-store/);
          }
        }
      }
      assert.equal(injected, forged.length * stages.length * 2);
      assert.deepEqual(logs, Array.from({ length: injected }, () => ["[spreadsheet] WRITE_FAILED"]));

      // Even a broken diagnostic sink must not replace the response.
      resetAllCaches();
      console.error = () => { throw new Error(canary); };
      const result = await callHono("POST", "/data", { table: "software_catalog", row });
      assert.equal(result.status, 500);
      assert.deepEqual(result.body, { error: "internal_error" });
      assert.match(result.headers.get("cache-control"), /private.*no-store/);
      assert.equal(injected, forged.length * stages.length * 2 + 1);
    } finally {
      honoD1.prepare = originalPrepare;
      console.error = originalError;
    }
    assert.equal(honoD1.stats.batches, beforeBatches);
    assert.equal(honoD1.stats.writes, beforeWrites);
    assert.deepEqual(allAudits(honoSqlite), beforeAudits);
    assert.deepEqual(allQueueRows(honoSqlite), beforeQueue);
    assert.deepEqual(honoSqlite.prepare("SELECT * FROM software_catalog ORDER BY id").all(), beforeRows);
  });

  test("MIG-0638 U01/U02: row, FK and UPSERT preflight provider errors are internal failures", async () => {
    resetAllCaches();
    const { honoSqlite, honoD1, callHono } = createFixture();
    const upsert = {
      table: "software_catalog", mode: "upsert",
      rows: [{ id: "sw-base", name: "After preflight", normalized_name: "base soft", created_at: "100", updated_at: "101" }],
    };
    const preview = await callHono("POST", "/import", { ...upsert, dryRun: true });
    assert.equal(preview.status, 200);
    contracts.AdminSpreadsheetImportDryRunResponseSchema.parse(preview.body);
    const apply = { ...upsert, previewToken: preview.body.previewToken };
    const rowRead = sql => sql.startsWith('SELECT * FROM "software_catalog" WHERE "id" = ? LIMIT ');
    const cases = [
      ["PATCH", "/data", { table: "software_catalog", primaryKey: { id: "sw-base" }, column: "name", value: "changed" }, rowRead],
      ["DELETE", "/data", { table: "software_catalog", primaryKey: { id: "sw-base" } }, rowRead],
      ["PATCH", "/data", { table: "slots", primaryKey: { id: "slot-base" }, column: "event_id", value: "a-open" },
        sql => sql.startsWith('SELECT "id" AS value FROM "events" WHERE "id" IN (')],
      ["POST", "/import", apply, sql => sql.startsWith('SELECT * FROM "software_catalog" WHERE ("id" = ?) LIMIT ')],
    ];
    const snapshot = () => ({
      rows: honoSqlite.prepare("SELECT * FROM software_catalog ORDER BY id").all(),
      slots: honoSqlite.prepare("SELECT * FROM slots ORDER BY id").all(),
      nonces: honoSqlite.prepare("SELECT * FROM spreadsheet_import_runs ORDER BY nonce").all(),
      audits: allAudits(honoSqlite),
      queue: allQueueRows(honoSqlite),
    });
    const before = snapshot();
    const beforeBatches = honoD1.stats.batches;
    const beforeWrites = honoD1.stats.writes;
    const originalPrepare = honoD1.prepare;
    const originalError = console.error;
    const faults = [
      new Error("preview_required"),
      new Error("row_not_found"),
      new Error("FOREIGN KEY constraint failed: PREFLIGHT_CANARY"),
      Object.defineProperty(new Error(), "message", { get() { throw new Error("PREFLIGHT_CANARY"); } }),
    ];
    const stages = ["prepare", "bind", "all"];
    const logs = [];
    let injected = 0;
    try {
      console.error = (...args) => logs.push(args);
      for (const [method, path, body, matches] of cases) {
        for (const fault of faults) {
          for (const stage of stages) {
            resetAllCaches();
            const prior = injected;
            honoD1.prepare = sql => {
              if (!matches(sql)) return originalPrepare(sql);
              if (stage === "prepare") { injected++; throw fault; }
              const stmt = originalPrepare(sql);
              return {
                ...stmt,
                bind(...params) {
                  if (stage === "bind") { injected++; throw fault; }
                  return {
                    ...stmt.bind(...params),
                    async all() { injected++; throw fault; },
                  };
                },
              };
            };
            const result = await callHono(method, path, body);
            assert.equal(injected, prior + 1, method + " " + path + " " + stage);
            assert.equal(result.status, 500);
            assert.deepEqual(result.body, { error: "internal_error" });
            assert.match(result.headers.get("cache-control"), /private.*no-store/);
          }
        }
      }
      assert.equal(injected, cases.length * faults.length * stages.length);
      assert.deepEqual(logs, Array.from({ length: injected }, () => ["[spreadsheet] WRITE_FAILED"]));
    } finally {
      honoD1.prepare = originalPrepare;
      console.error = originalError;
    }
    assert.equal(honoD1.stats.batches, beforeBatches);
    assert.equal(honoD1.stats.writes, beforeWrites);
    assert.deepEqual(snapshot(), before);

    // The same signed preview is still usable: failed reads must not consume
    // the nonce, create audits or prevent a legitimate retry.
    const recovered = await callHono("POST", "/import", apply);
    assert.equal(recovered.status, 200);
    contracts.AdminSpreadsheetImportApplyResponseSchema.parse(recovered.body);
    assert.equal(recovered.body.updated, 1);
    assert.equal(honoSqlite.prepare("SELECT name FROM software_catalog WHERE id = 'sw-base'").get().name, "After preflight");
    assert.equal(honoD1.stats.batches, beforeBatches + 1);
  });

  test("MIG-0638 U01/U02: release lookup rejects malformed receipts before mutation and nonce consumption", async () => {
    resetAllCaches();
    const { honoSqlite, honoD1, callHono } = createFixture();
    // The fixture already links av-pending-1 to a-open. A second link and
    // primary event exercise repeated video IDs and distinct event targets.
    insert(honoSqlite, "video_events", { video_id: "av-pending-1", event_id: "a-ended" });
    honoSqlite.prepare("UPDATE videos SET primary_event_id = 'a-ended' WHERE id = 'av-pending-1'").run();
    const patch = { table: "video_members", primaryKey: { id: "vm-1" }, column: "name", value: "Edited Member" };
    const upsert = { table: "video_members", mode: "upsert", rows: [{ id: "vm-1", name: "Imported Member" }] };
    const preview = await callHono("POST", "/import", { ...upsert, dryRun: true });
    assert.equal(preview.status, 200);
    contracts.AdminSpreadsheetImportDryRunResponseSchema.parse(preview.body);
    const apply = { ...upsert, previewToken: preview.body.previewToken };
    const snapshot = () => ({
      members: honoSqlite.prepare("SELECT * FROM video_members ORDER BY id").all(),
      audits: allAudits(honoSqlite),
      queue: allQueueRows(honoSqlite),
      nonces: honoSqlite.prepare("SELECT * FROM spreadsheet_import_runs ORDER BY nonce").all(),
    });
    const before = snapshot();
    const beforeWrites = honoD1.stats.writes;
    const beforeBatches = honoD1.stats.batches;
    const originalPrepare = honoD1.prepare;
    const originalError = console.error;
    const validRow = { videoId: "av-pending-1", eventId: "a-open", primaryEventId: "a-ended" };
    const invalid = [
      () => ({ success: true }),
      () => ({ success: false, results: [validRow] }),
      () => ({ success: true, results: null }),
      () => ({ success: true, results: "not-an-array" }),
      () => ({ success: true, results: [{ videoId: "av-pending-1", eventId: "a-open" }] }),
      () => ({ success: true, results: [{ ...validRow, videoId: "unrequested" }] }),
      () => ({ success: true, results: [{ ...validRow, eventId: 42 }] }),
      () => ({ success: true, results: [Object.create(validRow)] }),
      () => ({ success: true, results: [Object.defineProperty({ ...validRow }, "eventId", {
        get() { throw new Error("preview_required"); },
      })] }),
      () => Object.defineProperty({ success: true }, "results", {
        get() { throw new Error("row_not_found"); },
      }),
    ];
    const faults = [
      ...invalid.map(receipt => ({ stage: "all", receipt })),
      ...["prepare", "bind", "all"].map(stage => ({ stage, error: new Error("FOREIGN KEY constraint failed: RELEASE_CANARY") })),
    ];
    const logs = [];
    let injected = 0;
    try {
      console.error = (...args) => logs.push(args);
      for (const [method, path, body] of [["PATCH", "/data", patch], ["POST", "/import", apply]]) {
        for (const fault of faults) {
          resetAllCaches();
          const prior = injected;
          honoD1.prepare = sql => {
            if (!sql.includes('LEFT JOIN "video_events" ve ON ve."video_id" = v."id"')) return originalPrepare(sql);
            if (fault.stage === "prepare") { injected++; throw fault.error; }
            const stmt = originalPrepare(sql);
            return {
              ...stmt,
              bind(...params) {
                assert.deepEqual(params, ["av-pending-1"]);
                if (fault.stage === "bind") { injected++; throw fault.error; }
                return {
                  ...stmt.bind(...params),
                  async all() {
                    injected++;
                    if (fault.error) throw fault.error;
                    return fault.receipt();
                  },
                };
              },
            };
          };
          const response = await callHono(method, path, body);
          assert.equal(injected, prior + 1, method + " " + path + " " + fault.stage);
          assert.equal(response.status, 500);
          assert.deepEqual(response.body, { error: "internal_error" });
          assert.match(response.headers.get("cache-control"), /private.*no-store/);
        }
      }
      assert.equal(injected, faults.length * 2);
      assert.deepEqual(logs, Array.from({ length: injected }, () => ["[spreadsheet] WRITE_FAILED"]));
    } finally {
      honoD1.prepare = originalPrepare;
      console.error = originalError;
    }
    assert.equal(honoD1.stats.writes, beforeWrites);
    assert.equal(honoD1.stats.batches, beforeBatches);
    assert.deepEqual(snapshot(), before);

    // A legitimate retry with the same token must enqueue both release targets.
    const recovered = await callHono("POST", "/import", apply);
    assert.equal(recovered.status, 200);
    contracts.AdminSpreadsheetImportApplyResponseSchema.parse(recovered.body);
    assert.equal(recovered.body.updated, 1);
    assert.equal(honoD1.stats.batches, beforeBatches + 1);
    assert.equal(honoSqlite.prepare("SELECT name FROM video_members WHERE id = 'vm-1'").get().name, "Imported Member");
    const queue = allQueueRows(honoSqlite);
    for (const [type, id] of [["video", "av-pending-1"], ["users_index", "global"], ["event_release", "a-open"], ["event_release", "a-ended"]]) {
      assert.ok(queue.some(row => row.target_type === type && row.target_id === id), type + ":" + id);
    }
    assert.equal(queue.filter(row => row.target_type === "event_release").length, 2);

    // A genuine LEFT JOIN null row remains writable and adds no event target.
    const noLink = await callHono("PATCH", "/data", {
      table: "video_members", primaryKey: { id: "vm-ov-0" }, column: "name", value: "No linked event",
    });
    assert.equal(noLink.status, 200);
    assert.equal(honoD1.stats.batches, beforeBatches + 2);
    assert.deepEqual(allQueueRows(honoSqlite).filter(row => row.target_type === "event_release"),
      queue.filter(row => row.target_type === "event_release"));
  });

  test("MIG-0638 U01/U02: counted read receipt failures never authorize writes or masquerade as absence", async () => {
    resetAllCaches();
    const { honoSqlite, honoD1, callHono } = createFixture();
    const upsert = {
      table: "software_catalog", mode: "upsert",
      rows: [{ id: "sw-base", name: "After receipt check", normalized_name: "base soft", created_at: "100", updated_at: "101" }],
    };
    const preview = await callHono("POST", "/import", { ...upsert, dryRun: true });
    assert.equal(preview.status, 200);
    contracts.AdminSpreadsheetImportDryRunResponseSchema.parse(preview.body);
    const apply = { ...upsert, previewToken: preview.body.previewToken };
    const patch = { table: "software_catalog", primaryKey: { id: "sw-base" }, column: "name", value: "changed" };
    const rowRead = sql => sql.startsWith('SELECT * FROM "software_catalog" WHERE "id" = ? LIMIT ');
    const cases = [
      ["PATCH", "/data", patch, rowRead],
      ["DELETE", "/data", { table: "software_catalog", primaryKey: { id: "sw-base" } }, rowRead],
      ["PATCH", "/data", { table: "slots", primaryKey: { id: "slot-base" }, column: "event_id", value: "a-open" },
        sql => sql.startsWith('SELECT "id" AS value FROM "events" WHERE "id" IN (')],
      ["POST", "/import", apply, sql => sql.startsWith('SELECT * FROM "software_catalog" WHERE ("id" = ?) LIMIT ')],
      ["PATCH", "/data", patch, sql => sql.includes("FROM pragma_table_xinfo(?) AS x")],
    ];
    const snapshot = () => ({
      rows: honoSqlite.prepare("SELECT * FROM software_catalog ORDER BY id").all(),
      slots: honoSqlite.prepare("SELECT * FROM slots ORDER BY id").all(),
      nonces: honoSqlite.prepare("SELECT * FROM spreadsheet_import_runs ORDER BY nonce").all(),
      audits: allAudits(honoSqlite), queue: allQueueRows(honoSqlite),
    });
    const before = snapshot();
    const beforeWrites = honoD1.stats.writes;
    const beforeBatches = honoD1.stats.batches;
    const originalPrepare = honoD1.prepare;
    const originalError = console.error;
    const faults = [
      receipt => ({ ...receipt, success: false }),
      receipt => ({ ...receipt, success: false, results: [] }),
      receipt => ({ results: receipt.results, meta: receipt.meta }),
      receipt => ({ success: true, meta: receipt.meta }),
      receipt => ({ ...receipt, results: null }),
      receipt => ({ ...receipt, results: "invalid" }),
      receipt => Object.defineProperty({ ...receipt }, "results", { get() { throw new Error("row_not_found"); } }),
      receipt => Object.defineProperty({ ...receipt }, "success", { get() { throw new Error("preview_required"); } }),
    ];
    let injected = 0;
    const logs = [];
    try {
      console.error = (...args) => logs.push(args);
      for (const [method, path, body, matches] of cases) {
        for (const fault of faults) {
          resetAllCaches();
          const prior = injected;
          honoD1.prepare = sql => {
            const stmt = originalPrepare(sql);
            if (!matches(sql)) return stmt;
            return { ...stmt, bind(...params) {
              const bound = stmt.bind(...params);
              return { ...bound, async all() {
                injected++;
                return fault(await bound.all());
              } };
            } };
          };
          const result = await callHono(method, path, body);
          assert.equal(injected, prior + 1, method + " " + path);
          assert.equal(result.status, 500);
          assert.deepEqual(result.body, { error: "internal_error" });
          assert.match(result.headers.get("cache-control"), /private.*no-store/);
        }
      }
      assert.equal(injected, cases.length * faults.length);
      assert.deepEqual(logs, Array.from({ length: injected }, () => ["[spreadsheet] WRITE_FAILED"]));
    } finally {
      honoD1.prepare = originalPrepare;
      console.error = originalError;
    }
    assert.equal(honoD1.stats.writes, beforeWrites);
    assert.equal(honoD1.stats.batches, beforeBatches);
    assert.deepEqual(snapshot(), before);

    // A stable successful receipt with accessors must be captured once.
    // Re-reading its result field could substitute the audited before-image.
    const upsertRead = cases[3][3];
    let successReads = 0;
    let resultReads = 0;
    try {
      honoD1.prepare = sql => {
        const stmt = originalPrepare(sql);
        if (!upsertRead(sql)) return stmt;
        return { ...stmt, bind(...params) {
          const bound = stmt.bind(...params);
          return { ...bound, async all() {
            const receipt = await bound.all();
            return {
              get success() { assert.equal(++successReads, 1); return true; },
              get results() { assert.equal(++resultReads, 1); return receipt.results; },
              meta: receipt.meta,
            };
          } };
        } };
      };
      const recovered = await callHono("POST", "/import", apply);
      assert.equal(recovered.status, 200);
      contracts.AdminSpreadsheetImportApplyResponseSchema.parse(recovered.body);
      assert.equal(recovered.body.updated, 1);
    } finally {
      honoD1.prepare = originalPrepare;
    }
    assert.equal(successReads, 1);
    assert.equal(resultReads, 1);
    assert.equal(honoD1.stats.batches, beforeBatches + 1);
    assert.equal(honoSqlite.prepare("SELECT name FROM software_catalog WHERE id = 'sw-base'").get().name, "After receipt check");
    const missing = await callHono("PATCH", "/data", { ...patch, primaryKey: { id: "not-present" } });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: "row_not_found" });
    const fkMissing = await callHono("PATCH", "/data", {
      table: "slots", primaryKey: { id: "slot-base" }, column: "event_id", value: "not-present",
    });
    assert.equal(fkMissing.status, 400);
    assert.deepEqual(fkMissing.body, { error: "foreign_key_violation" });
    assert.equal(honoD1.stats.batches, beforeBatches + 1);
  });

  test("MIG-0638 U01/U02: migrated editable catalog preserves real PRAGMA column and explicit FK facts", async () => {
    resetAllCaches();
    const sqlite = createSqlite();
    try {
      const { resolveSpreadsheetWriteTableContext } = await import("../src/routes/admin/spreadsheet/write.ts");
      const { buildSpreadsheetTableDefs } = await import("../src/routes/admin/spreadsheet/registry.ts");
      const { SPREADSHEET_SCHEMA_TABLES } = await import("../src/routes/admin/spreadsheet/schemaCatalog.ts");
      const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
      const eligible = buildSpreadsheetTableDefs(names, SPREADSHEET_SCHEMA_TABLES).filter(def => def.mode === "editable");
      const d1 = createAtomicD1(sqlite);
      const verified = [];
      for (const def of eligible) {
        const columns = sqlite.prepare("SELECT * FROM pragma_table_xinfo(?) ORDER BY cid").all(def.table);
        // Preserve the existing UNKNOWN_TABLE contract for generated/no-PK tables.
        if (!columns.some(column => column.pk > 0) || columns.some(column => column.hidden !== 0)) continue;
        const fks = sqlite.prepare('SELECT "from" AS column, "table" AS referencedTable, "to" AS referencedColumn FROM pragma_foreign_key_list(?)').all(def.table).map(row => ({ ...row }));
        const before = d1.stats.reads;
        const resolved = await resolveSpreadsheetWriteTableContext(d1, def.table);
        assert.equal(resolved.fromCache, false, def.table);
        assert.equal(d1.stats.reads - before, 1, def.table);
        assert.deepEqual(resolved.ctx.columnNames, columns.map(column => column.name), def.table);
        assert.deepEqual(resolved.ctx.primaryKeys, columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name), def.table);
        const ordered = values => values.map(value => JSON.stringify(value)).sort();
        assert.deepEqual(ordered(resolved.foreignKeys), ordered(fks), def.table);
        assert.equal((await resolveSpreadsheetWriteTableContext(d1, def.table)).fromCache, true, def.table);
        assert.equal(d1.stats.reads - before, 1, def.table + " cache");
        verified.push(def.table);
      }
      assert.ok(verified.includes("slots") && verified.includes("software_catalog"));
      assert.equal(d1.stats.writes, 0);
      assert.equal(d1.stats.batches, 0);
    } finally {
      invalidateSpreadsheetWriteCaches();
      sqlite.close();
    }
  });

  test("MIG-0638 U01/U02: malformed catalog projections never become cached schema or absent foreign keys", async () => {
    resetAllCaches();
    const { honoSqlite, honoD1, callHono } = createFixture();
    const upsert = {
      table: "software_catalog", mode: "upsert",
      rows: [{ id: "sw-base", name: "Catalog recovered", normalized_name: "base soft", created_at: "100", updated_at: "101" }],
    };
    const preview = await callHono("POST", "/import", { ...upsert, dryRun: true });
    assert.equal(preview.status, 200);
    contracts.AdminSpreadsheetImportDryRunResponseSchema.parse(preview.body);
    const apply = { ...upsert, previewToken: preview.body.previewToken };
    const patch = { table: "slots", primaryKey: { id: "slot-base" }, column: "event_id", value: "a-open" };
    const snapshot = () => ({
      software: honoSqlite.prepare("SELECT * FROM software_catalog ORDER BY id").all(),
      slots: honoSqlite.prepare("SELECT * FROM slots ORDER BY id").all(),
      nonces: honoSqlite.prepare("SELECT * FROM spreadsheet_import_runs ORDER BY nonce").all(),
      audits: allAudits(honoSqlite), queue: allQueueRows(honoSqlite),
    });
    const before = snapshot();
    const beforeWrites = honoD1.stats.writes;
    const beforeBatches = honoD1.stats.batches;
    const originalPrepare = honoD1.prepare;
    const originalError = console.error;
    const replaceFk = (rows, value) => rows.map(row => ({ ...row, foreign_keys_json: value }));
    const faults = [
      rows => replaceFk(rows, null),
      rows => replaceFk(rows, ""),
      rows => replaceFk(rows, "["),
      rows => replaceFk(rows, "{}"),
      rows => replaceFk(rows, "[null]"),
      rows => replaceFk(rows, JSON.stringify([{ column: rows[0].name, referencedTable: "events" }])),
      rows => replaceFk(rows, JSON.stringify([{ column: rows[0].name, referencedTable: "events", referencedColumn: null }])),
      rows => replaceFk(rows, JSON.stringify([{ column: "not_a_catalog_column", referencedTable: "events", referencedColumn: "id" }])),
      rows => replaceFk(rows, JSON.stringify([{ column: rows[0].name, referencedTable: "invalid table", referencedColumn: "id" }])),
      rows => rows.map((row, i) => i === 1 ? { ...row, foreign_keys_json: "invalid" } : row),
      rows => rows.map((row, i) => i === 0 ? Object.defineProperty({ ...row }, "foreign_keys_json", {
        get() { throw new Error("preview_required"); },
      }) : row),
      rows => rows.map((row, i) => i === 0 ? Object.create(row) : row),
      rows => [rows[0], rows[0], ...rows.slice(1)],
      rows => rows.map((row, i) => i === 0 ? { ...row, not_null: "1" } : row),
      rows => rows.map(row => ({ ...row, pk: 0 })),
      rows => rows.map(row => ({ ...row, pk: 1 })),
      rows => rows.map(row => row.pk > 0 ? { ...row, pk: row.pk + 1 } : row),
      rows => rows.map(row => row.pk > 0 ? { ...row, pk: null } : row),
      rows => rows.map(row => row.pk > 0 ? { ...row, pk: Number.MAX_SAFE_INTEGER } : row),
    ];
    const logs = [];
    let injected = 0;
    try {
      console.error = (...args) => logs.push(args);
      for (const [method, path, body] of [["PATCH", "/data", patch], ["POST", "/import", apply]]) {
        for (const fault of faults) {
          resetAllCaches();
          const prior = injected;
          honoD1.prepare = sql => {
            const stmt = originalPrepare(sql);
            if (!sql.includes("FROM pragma_table_xinfo(?) AS x")) return stmt;
            return { ...stmt, bind(...params) {
              const bound = stmt.bind(...params);
              return { ...bound, async all() {
                const receipt = await bound.all();
                injected++;
                return { ...receipt, results: fault(receipt.results) };
              } };
            } };
          };
          const res = await callHono(method, path, body);
          assert.equal(injected, prior + 1);
          assert.equal(res.status, 500, method + " " + path);
          assert.deepEqual(res.body, { error: "internal_error" });
          assert.match(res.headers.get("cache-control"), /private.*no-store/);
        }
      }
      assert.equal(injected, faults.length * 2);
      assert.deepEqual(logs, Array.from({ length: injected }, () => ["[spreadsheet] WRITE_FAILED"]));
    } finally {
      honoD1.prepare = originalPrepare;
      console.error = originalError;
    }
    assert.equal(honoD1.stats.writes, beforeWrites);
    assert.equal(honoD1.stats.batches, beforeBatches);
    assert.deepEqual(snapshot(), before);
    // No cache reset: a malformed catalog was never cached. The same signed
    // token must still authorize its original import after a healthy read.
    const recovered = await callHono("POST", "/import", apply);
    assert.equal(recovered.status, 200);
    contracts.AdminSpreadsheetImportApplyResponseSchema.parse(recovered.body);
    assert.equal(recovered.body.updated, 1);
    assert.equal(honoSqlite.prepare("SELECT name FROM software_catalog WHERE id = 'sw-base'").get().name, "Catalog recovered");
    const missing = await callHono("PATCH", "/data", { ...patch, value: "not-present" });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, { error: "foreign_key_violation" });
    assert.equal(honoD1.stats.batches, beforeBatches + 1);
  });

  test("MIG-0638 U01/U02: composite key catalog completeness protects exact row identity and import nonce", async () => {
    for (const extra of [false, true]) {
      resetAllCaches();
      const { curSqlite, honoSqlite, honoD1, callHono } = createFixture();
      const originalPrepare = honoD1.prepare;
      const originalError = console.error;
      try {
        const video = "av-pending-1";
        const missing = { table: "video_events", primaryKey: { video_id: video, event_id: "a-point" } };
        if (extra) insert(honoSqlite, "video_events", { video_id: video, event_id: "a-ended" });
        const links = () => honoSqlite.prepare("SELECT event_id FROM video_events WHERE video_id = ? ORDER BY event_id").all(video).map(row => row.event_id);
        const originalLinks = extra ? ["a-ended", "a-open"] : ["a-open"];
        assert.deepEqual(links(), originalLinks);
        const input = { table: "video_events", mode: "insert", rows: [{ video_id: video, event_id: "a-point" }] };
        const preview = await callHono("POST", "/import", { ...input, dryRun: true });
        assert.equal(preview.status, 200);
        contracts.AdminSpreadsheetImportDryRunResponseSchema.parse(preview.body);
        const apply = { ...input, previewToken: preview.body.previewToken };
        const snapshot = () => ({
          links: honoSqlite.prepare("SELECT * FROM video_events ORDER BY video_id, event_id").all(),
          audits: allAudits(honoSqlite),
          queue: allQueueRows(honoSqlite),
          nonces: honoSqlite.prepare("SELECT * FROM spreadsheet_import_runs ORDER BY nonce").all(),
        });
        const before = snapshot();
        const beforeWrites = honoD1.stats.writes;
        const beforeBatches = honoD1.stats.batches;
        const setKeyList = (rows, value) => rows.map(row => ({ ...row, primary_keys_json: value }));
        const faults = [
          rows => rows.map(row => row.pk === 2 ? { ...row, pk: 0 } : row),
          rows => rows.filter(row => row.pk !== 2),
          rows => rows.map(row => ({ ...row, pk: 3 - row.pk })),
          rows => setKeyList(rows, '["video_id"]'),
          rows => setKeyList(rows, '["event_id","video_id"]'),
          rows => setKeyList(rows, '["video_id","video_id"]'),
          rows => setKeyList(rows, "["),
          rows => rows.map((row, i) => i === 1 ? { ...row, primary_keys_json: "[]" } : row),
          rows => rows.map(({ primary_keys_json: _missing, ...row }) => row),
        ];
        const logs = [];
        let injected = 0;
        console.error = (...args) => logs.push(args);
        for (const [method, path, body] of [["DELETE", "/data", missing], ["POST", "/import", apply]]) {
          for (const fault of faults) {
            resetAllCaches();
            const prior = injected;
            honoD1.prepare = sql => {
              const stmt = originalPrepare(sql);
              if (!sql.includes("FROM pragma_table_xinfo(?) AS x")) return stmt;
              return { ...stmt, bind(...params) {
                const bound = stmt.bind(...params);
                if (!params.every(value => value === "video_events")) return bound;
                return { ...bound, async all() {
                  const receipt = await bound.all();
                  injected++;
                  return { ...receipt, results: fault(receipt.results) };
                } };
              } };
            };
            const result = await callHono(method, path, body);
            assert.equal(injected, prior + 1);
            assert.equal(result.status, 500, method + " extra=" + extra);
            assert.deepEqual(result.body, { error: "internal_error" });
            assert.match(result.headers.get("cache-control"), /private.*no-store/);
          }
        }
        assert.equal(injected, faults.length * 2);
        assert.deepEqual(logs, Array.from({ length: injected }, () => ["[spreadsheet] WRITE_FAILED"]));
        assert.equal(honoD1.stats.writes, beforeWrites);
        assert.equal(honoD1.stats.batches, beforeBatches);
        assert.deepEqual(snapshot(), before);

        // No cache reset: a failed projection must not replace the healthy key.
        // A full-key miss is 404 even when one or several prefix rows exist.
        honoD1.prepare = originalPrepare;
        console.error = originalError;
        const absent = await callHono("DELETE", "/data", missing);
        assert.equal(absent.status, 404);
        assert.deepEqual(absent.body, { error: "row_not_found" });
        assert.deepEqual(snapshot(), before);
        const recovered = await callHono("POST", "/import", apply);
        assert.equal(recovered.status, 200);
        contracts.AdminSpreadsheetImportApplyResponseSchema.parse(recovered.body);
        assert.equal(recovered.body.inserted, 1);
        assert.deepEqual(links(), [...originalLinks, "a-point"]);
        const deleted = await callHono("DELETE", "/data", missing);
        assert.equal(deleted.status, 200);
        assert.deepEqual(links(), originalLinks);
        const audit = latestAudit(honoSqlite);
        assert.equal(audit.table_name, "video_events");
        assert.equal(audit.operation, "DELETE");
        assert.deepEqual(JSON.parse(audit.before_json), { video_id: video, event_id: "a-point" });
        assert.equal(honoD1.stats.batches, beforeBatches + 2);
      } finally {
        honoD1.prepare = originalPrepare;
        console.error = originalError;
        resetAllCaches();
        curSqlite.close();
        honoSqlite.close();
      }
    }
  });

  test("MIG-0638 T06: D1 statement budget (S2 reads <= 3, S3 writes pre-reads + 1 atomic batch)", async () => {
    resetAllCaches();
    const { honoD1, callHono } = createFixture();

    // Warm write context once so steady-state S3 pre-reads are measured cleanly.
    const warmPost = await callHono("POST", "/data", {
      table: "software_catalog",
      row: { id: "sw-warm", name: "Warm", normalized_name: "warm", created_at: "1", updated_at: "1" },
    });
    assert.equal(warmPost.status, 200);

    const snap = () => ({ ...honoD1.stats });
    const diff = (a, b) => ({
      reads: b.reads - a.reads,
      batches: b.batches - a.batches,
      maxBinds: b.maxBinds,
    });

    // POST warm without FK: session(1) + writeGuard(1) + costGuard(1) = 3 pre-reads + 1 batch
    const s0 = snap();
    const rPost = await callHono("POST", "/data", {
      table: "software_catalog",
      row: { id: "sw-s3", name: "S3", normalized_name: "s3", created_at: "1", updated_at: "1" },
    });
    assert.equal(rPost.status, 200);
    const dPost = diff(s0, snap());
    assert.equal(dPost.batches, 1);
    assert.equal(dPost.reads, 3, "warm POST without FK uses exactly 3 pre-reads (session+writeGuard+costGuard)");

    // PATCH warm without FK: session(1) + writeGuard(1) + costGuard(1) + before-image(1) = 4 pre-reads + 1 batch
    const s1 = snap();
    const rPatch = await callHono("PATCH", "/data", {
      table: "software_catalog",
      primaryKey: { id: "sw-s3" },
      column: "name",
      value: "S3 Updated",
    });
    assert.equal(rPatch.status, 200);
    const dPatch = diff(s1, snap());
    assert.equal(dPatch.batches, 1);
    assert.equal(dPatch.reads, 4, "warm PATCH adds 1 before-image read (4 total) + 1 atomic batch");

    // DELETE warm: 4 pre-reads + 1 batch
    const s2 = snap();
    const rDel = await callHono("DELETE", "/data", {
      table: "software_catalog",
      primaryKey: { id: "sw-s3" },
    });
    assert.equal(rDel.status, 200);
    const dDel = diff(s2, snap());
    assert.equal(dDel.batches, 1);
    assert.equal(dDel.reads, 4, "warm DELETE adds 1 before-image read (4 total) + 1 atomic batch");
  });

  // #893: characterization only. These expectations deliberately record the
  // CURRENT TARGET costs, including over-budget requests. Do not interpret
  // a green test as compliance with the <=3 pre-read S3 gate.
  test("MIG-0638 T06: cold/warm CRUD, FK, release and signed import read accounting (#893)", async (t) => {
    resetAllCaches();
    const { curSqlite, honoSqlite, honoD1, callHono } = createFixture();
    const reports = [];
    const tableRows = table => honoSqlite.prepare('SELECT * FROM "' + table + '" ORDER BY id').all();
    const nonces = () => honoSqlite.prepare("SELECT * FROM spreadsheet_import_runs ORDER BY rowid").all();
    const queueSnapshot = () => honoSqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY rowid").all();
    const activeQueue = () => new Map(honoSqlite.prepare(
      "SELECT target_type, target_id, updated_at FROM static_rebuild_queue WHERE status IN ('pending', 'processing')"
    ).all().map(row => [row.target_type + ":" + row.target_id, row.updated_at]));
    function assertQueueAdvanced(before, keys) {
      const after = activeQueue();
      for (const key of keys) {
        assert.ok(after.has(key), key);
        if (before.has(key)) assert.ok(after.get(key) > before.get(key), key + " generation must advance");
      }
      // An unrelated existing target must not be coalesced or added.
      const unrelated = map => [...map].filter(([key]) => !keys.includes(key));
      assert.deepEqual(new Map(unrelated(after)), new Map(unrelated(before)));
    }
    function assertMemberQueue(before, video, linked) {
      const expected = ["video:" + video, "users_index:global", ...(linked ? ["event_release:a-open"] : [])];
      assertQueueAdvanced(before, expected);
    }
    async function measure(label, method, path, payload, { cold, reads, writes = 0, batches = 1 }) {
      if (cold) resetAllCaches();
      const before = { ...honoD1.stats };
      // maxBinds is a high-water mark, not a counter: reset it per request.
      honoD1.stats.maxBinds = 0;
      const response = await callHono(method, path, payload);
      const actual = {
        reads: honoD1.stats.reads - before.reads,
        writes: honoD1.stats.writes - before.writes,
        batches: honoD1.stats.batches - before.batches,
        statements: honoD1.stats.statements - before.statements,
        maxBinds: honoD1.stats.maxBinds,
      };
      const report = { label, cold, ...actual, overS3: actual.reads > 3 };
      reports.push(report);
      t.diagnostic("S3 characterization " + JSON.stringify(report));
      assert.equal(response.status, 200, label + " " + response.text);
      assert.match(response.headers.get("cache-control"), /private.*no-store/, label);
      assert.equal(actual.reads, reads + Number(cold), label + " pre-reads");
      assert.equal(actual.writes, writes, label + " standalone writes");
      assert.equal(actual.batches, batches, label + " batches");
      assert.ok(actual.maxBinds > 0 && actual.maxBinds <= 100, label + " binds");
      assert.ok(actual.statements >= actual.reads + actual.writes + actual.batches, label);
      return response.body;
    }
    async function crud(label, method, payload, cold, reads, check) {
      const beforeAudit = allAudits(honoSqlite).length;
      const beforeNonces = nonces();
      const beforeQueue = queueSnapshot();
      const beforeActive = activeQueue();
      const body = await measure(label, method, "/data", payload, { cold, reads });
      contracts.AdminSpreadsheetMutationResponseSchema.parse(body);
      const added = allAudits(honoSqlite).slice(beforeAudit);
      assert.equal(added.length, 1, label);
      assert.equal(added[0].table_name, payload.table, label);
      assert.equal(added[0].operation, { POST: "CREATE", PATCH: "UPDATE", DELETE: "DELETE" }[method], label);
      assert.equal(added[0].actor_user_id, "u_root", label);
      assert.deepEqual(nonces(), beforeNonces, label);
      check(body, beforeQueue, beforeActive);
    }
    try {
      const catalogRow = id => ({ id, name: id, normalized_name: id, created_at: "1", updated_at: "1" });
      for (const cold of [true, false]) {
        const event = cold ? "a-ended" : "a-open";
        await crud("slots FK PATCH " + event, "PATCH", { table: "slots", primaryKey: { id: "slot-base" }, column: "event_id", value: event }, cold, 5,
          (_body, _queue) => {
            assert.equal(tableRows("slots").find(row => row.id === "slot-base").event_id, event);
          });
      }

      for (const cold of [true, false]) {
        const id = cold ? "s3-slot-cold" : "s3-slot-warm";
        await crud("slots FK POST " + id, "POST", {
          table: "slots", row: { id, event_id: "a-open", slot_label: id, status: "available" },
        }, cold, 4, () => {
          assert.equal(tableRows("slots").find(row => row.id === id).event_id, "a-open");
        });
      }

      // Both linked and unlinked video rows require the release lookup; the
      // genuine no-link receipt must not add an event target.
      for (const [id, video, linked] of [["vm-ov-0", "av-overflow", false], ["vm-1", "av-pending-1", true]]) {
        for (const cold of [true, false]) {
          const name = id + (cold ? "-cold" : "-warm");
          await crud("member PATCH " + name, "PATCH", { table: "video_members", primaryKey: { id }, column: "name", value: name }, cold, 5,
            (body, _queue, beforeActive) => {
              assert.equal(body.pendingPublicReflection, true);
              assert.equal(tableRows("video_members").find(row => row.id === id).name, name);
              assertMemberQueue(beforeActive, video, linked);
            });
        }
      }

      // New members exercise a default-completed INSERT (one video FK read)
      // and exact-PK DELETE (one before-image), each with one release lookup.
      for (const [video, linked] of [["av-overflow", false], ["av-pending-1", true]]) {
        for (const method of ["POST", "DELETE"]) {
          for (const cold of [true, false]) {
            const id = "s3-member-" + video + (cold ? "-cold" : "-warm");
            const payload = method === "POST"
              ? { table: "video_members", row: { id, video_id: video, name: id } }
              : { table: "video_members", primaryKey: { id } };
            await crud("member " + method + " " + id, method, payload, cold, 5,
              (body, _queue, beforeActive) => {
                assert.equal(body.pendingPublicReflection, true);
                assert.equal(tableRows("video_members").some(row => row.id === id), method === "POST");
                assertMemberQueue(beforeActive, video, linked);
              });
          }
        }
      }

      // Non-enqueue cases must run with existing active targets, otherwise a
      // spurious coalescing UPDATE could not be distinguished from no enqueue.
      assert.ok(activeQueue().has("video:av-pending-1"));
      assert.ok(activeQueue().has("event_release:a-open"));
      // Each cold request clears both schema caches. The immediately following
      // request to the same table measures the warm context with a new mutation.
      for (const cold of [true, false]) {
        const id = cold ? "s3-cold" : "s3-warm";
        await crud("catalog POST " + id, "POST", { table: "software_catalog", row: catalogRow(id) }, cold, 3,
          (body, queue) => {
            assert.equal(body.pendingPublicReflection, false);
            assert.ok(tableRows("software_catalog").some(row => row.id === id));
            assert.deepEqual(queueSnapshot(), queue);
          });
      }
      for (const cold of [true, false]) {
        const id = cold ? "s3-cold" : "s3-warm";
        await crud("catalog PATCH " + id, "PATCH", { table: "software_catalog", primaryKey: { id }, column: "name", value: id + "-updated" }, cold, 4,
          (body, queue) => {
            assert.equal(body.pendingPublicReflection, false);
            assert.equal(tableRows("software_catalog").find(row => row.id === id).name, id + "-updated");
            assert.deepEqual(queueSnapshot(), queue);
          });
      }
      for (const cold of [true, false]) {
        const id = cold ? "s3-cold" : "s3-warm";
        await crud("catalog DELETE " + id, "DELETE", { table: "software_catalog", primaryKey: { id } }, cold, 4,
          (body, queue) => {
            assert.equal(body.pendingPublicReflection, false);
            assert.ok(!tableRows("software_catalog").some(row => row.id === id));
            assert.deepEqual(queueSnapshot(), queue);
          });
      }

      async function importPair(label, input, cold, reads, counts, check) {
        const beforeRows = tableRows(input.table);
        const beforeAudit = allAudits(honoSqlite).length;
        const beforeQueue = queueSnapshot();
        const beforeActive = activeQueue();
        const beforeNonces = nonces();
        const preview = await measure(label + " preview", "POST", "/import", { ...input, dryRun: true },
          { cold, reads: 3, writes: 1, batches: 0 });
        contracts.AdminSpreadsheetImportDryRunResponseSchema.parse(preview);
        assert.equal(preview.rowCount, input.rows.length);
        assert.deepEqual(tableRows(input.table), beforeRows, label + " preview must not mutate rows");
        assert.equal(allAudits(honoSqlite).length, beforeAudit, label + " preview must not audit mutations");
        assert.deepEqual(queueSnapshot(), beforeQueue, label + " preview must not enqueue");
        const issued = nonces();
        assert.equal(issued.length, beforeNonces.length + 1);
        assert.equal(issued.at(-1).consumed_at, null);
        const nonce = issued.at(-1).nonce;
        const applied = await measure(label + " apply", "POST", "/import", { ...input, previewToken: preview.previewToken },
          { cold, reads });
        contracts.AdminSpreadsheetImportApplyResponseSchema.parse(applied);
        assert.deepEqual([applied.inserted, applied.updated, applied.skipped], counts, label);
        assert.deepEqual(applied.errors, [], label);
        const audits = allAudits(honoSqlite).slice(beforeAudit);
        assert.equal(audits.length, counts[0] + counts[1] + 1, label + " rows plus nonce audit");
        assert.ok(audits.every(row => row.actor_user_id === "u_root"), label);
        assert.equal(audits.filter(row => row.table_name === input.table).length, counts[0] + counts[1]);
        assert.equal(audits.filter(row => row.table_name === "spreadsheet_import_runs").length, 1);
        assert.equal(nonces().length, issued.length);
        assert.notEqual(nonces().find(row => row.nonce === nonce).consumed_at, null);
        check(applied, beforeQueue, beforeActive);
      }
      for (const cold of [true, false]) {
        const id = cold ? "s3-imp-cold" : "s3-imp-warm";
        const rows = [catalogRow(id + "-1"), catalogRow(id + "-2")];
        await importPair("catalog insert " + id, { table: "software_catalog", mode: "insert", rows }, cold, 3, [2, 0, 0],
          (body, queue) => {
            assert.equal(body.pendingPublicReflection, false);
            assert.ok(rows.every(row => tableRows("software_catalog").some(saved => saved.id === row.id)));
            assert.deepEqual(queueSnapshot(), queue);
          });
      }
      for (const cold of [true, false]) {
        const id = cold ? "s3-imp-cold" : "s3-imp-warm";
        const rows = [{ id: id + "-1", name: id + "-updated" }, catalogRow(id + "-3"), { id: id + "-2" }];
        await importPair("catalog mixed upsert " + id, { table: "software_catalog", mode: "upsert", rows }, cold, 4, [1, 1, 1],
          (body, queue) => {
            assert.equal(body.pendingPublicReflection, false);
            assert.equal(tableRows("software_catalog").find(row => row.id === id + "-1").name, id + "-updated");
            assert.ok(tableRows("software_catalog").some(row => row.id === id + "-3"));
            assert.deepEqual(queueSnapshot(), queue);
          });
      }
      for (const cold of [true, false]) {
        const suffix = cold ? "-import-cold" : "-import-warm";
        const rows = [
          { id: "vm-1", video_id: "av-pending-1", name: "linked" + suffix },
          { id: "vm-ov-0", video_id: "av-overflow", name: "unlinked" + suffix },
        ];
        // one shared PK read + one deduplicated FK read + one release read
        await importPair("member FK upsert " + suffix, { table: "video_members", mode: "upsert", rows }, cold, 6, [0, 2, 0],
          (body, _queue, beforeActive) => {
            assert.equal(body.pendingPublicReflection, true);
            for (const row of rows) assert.equal(tableRows("video_members").find(saved => saved.id === row.id).name, row.name);
            assertQueueAdvanced(beforeActive, ["video:av-pending-1", "video:av-overflow", "users_index:global", "event_release:a-open"]);
          });
      }
      assert.equal(reports.length, 34);
      assert.equal(reports.filter(row => row.cold).length, 17);
      assert.ok(reports.some(row => row.overS3), "#893 remains over budget");
    } finally {
      resetAllCaches();
      curSqlite.close();
      honoSqlite.close();
    }
  });
}

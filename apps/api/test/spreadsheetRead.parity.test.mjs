import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/adminReadSeed.mjs";

// MIG-0605 U02 (read half) parity: RH-003 GET /data, RH-007 GET /export, RH-009 GET /tables.
// The same seeded SQLite is read by CURRENT's real route handlers + src/lib/admin/spreadsheet/** (guard stubbed to
// "admin"; DB injected through the local-bindings hook) and by /api/admin/spreadsheet/* on the Hono app.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      const resolved = nextResolve(specifier, context);
      // CURRENT's session-backed guard is replaced by an always-admin stub: the guard itself is tested on the Hono side.
      if (resolved.url.endsWith("/src/lib/admin/spreadsheet/guard.ts")) {
        const stub =
          'export const isAdminSpreadsheetEnabled=()=>true;' +
          'export const requireAdminSpreadsheetApi=async()=>({ok:true,session:{userId:"u_root"}});' +
          'export const requireAdminSpreadsheetWriteApi=async()=>({ok:true,session:{userId:"u_root"}});';
        return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
      }
      return resolved;
    },
  });

  const { isTable, getTableName, getTableColumns } = await import("drizzle-orm");
  const schema = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const { invalidateSpreadsheetCaches } = await import("../src/routes/admin/spreadsheet/catalog.ts");
  const { MAX_SPREADSHEET_EXPORT_ROWS, MAX_SPREADSHEET_PAGE_ROWS, MAX_SPREADSHEET_RESPONSE_BYTES } = await import(
    "../src/routes/admin/spreadsheet/read.ts"
  );
  const ours = await import("../src/routes/admin/spreadsheet/registry.ts");
  const { SPREADSHEET_COLUMN_ENUMS, SPREADSHEET_SCHEMA_TABLES } = await import(
    "../src/routes/admin/spreadsheet/schemaCatalog.ts"
  );
  const current = await import("../../../src/lib/admin/spreadsheet/query.ts");
  const currentDiscovery = await import("../../../src/lib/admin/spreadsheet/discovery.ts");
  const currentRegistry = await import("../../../src/lib/admin/spreadsheet/registry.ts");
  const currentColumns = await import("../../../src/lib/admin/spreadsheet/tableContext.ts");
  const currentDataRoute = await import("../../../app/api/admin/spreadsheet/data/route.ts");
  const currentExportRoute = await import("../../../app/api/admin/spreadsheet/export/route.ts");
  const currentTablesRoute = await import("../../../app/api/admin/spreadsheet/tables/route.ts");
  const contracts = await import("@flamenode/contracts");

  const sqlite = createSqlite();
  seed(sqlite);
  const SECRET = "test-secret-mig-0605-u02";
  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));
  const PRIVATE = "private, no-store, no-cache, must-revalidate";

  // CURRENT's catalog SQL says `pragma_table_info(name)`; node:sqlite (SQLite 3.50) resolves that `name` to the
  // function's own column and finds no tables, so the reference connection qualifies it (what CURRENT means).
  const baseRefD1 = createD1(sqlite);
  const refD1 = {
    stats: baseRefD1.stats,
    batch: baseRefD1.batch,
    prepare: (sql) => baseRefD1.prepare(sql.replace("pragma_table_info(name)", "pragma_table_info(sqlite_master.name)")),
  };
  globalThis.__FLAMENODE_LOCAL_BINDINGS = {
    DB: refD1,
    BUCKET: { get: async () => null, put: async () => null, delete: async () => null },
    KV: { get: async () => null, put: async () => null, delete: async () => null },
  };
  const resetCaches = () => {
    invalidateSpreadsheetCaches();
    currentDiscovery.invalidateSpreadsheetTableCache();
    currentColumns.invalidateSpreadsheetColumnCache();
  };

  async function call(path, token = "root", options = {}) {
    const d1 = options.d1 ?? createD1(sqlite);
    const env = { DB: d1, AUTH_SECRET: SECRET, ...("env" in options ? options.env : { ADMIN_SPREADSHEET_ENABLED: "1" }) };
    const response = await app.request(path, { method: options.method ?? "GET", headers: token ? cookie(`tok-${token}`) : {} }, env);
    const text = await response.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* csv */
    }
    return { status: response.status, headers: response.headers, text, body, stats: d1.stats };
  }
  async function get(path, token = "root") {
    const r = await call(path, token);
    assert.equal(r.status, 200, `${path}: ${r.text.slice(0, 200)}`);
    assert.equal(r.headers.get("cache-control"), PRIVATE);
    assert.equal(r.stats.writes, 0, `${path}: GET must not write`);
    assert.equal(r.stats.batches, 0);
    assert.ok(r.stats.maxBinds <= 100, `${path}: ${r.stats.maxBinds} binds`);
    assert.ok(r.stats.statements <= 3, `${path}: ${r.stats.statements} D1 statements (S2 allows 3 incl. session)`);
    return r;
  }

  const tableNames = (await currentDiscovery.listSpreadsheetTables()).map((t) => t.table);

  test("T00 sanity: CURRENT catalog is non-trivial and covers editable + readonly tables", () => {
    assert.ok(tableNames.length >= 20, tableNames.join(","));
    assert.ok(tableNames.includes("x_users") && tableNames.includes("session") && tableNames.includes("announcements"));
  });

  test("T01 drift: registry and schemaCatalog equal CURRENT (real registry.ts / drizzle schema)", () => {
    assert.deepEqual(ours.SPREADSHEET_TABLE_OVERRIDES, currentRegistry.SPREADSHEET_TABLE_OVERRIDES);
    assert.deepEqual([...ours.SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS], [...currentRegistry.SPREADSHEET_VISIBILITY_STATUS_READONLY_COLUMNS]);
    assert.deepEqual([...ours.SPREADSHEET_TABLE_BLOCKLIST], [...currentRegistry.SPREADSHEET_TABLE_BLOCKLIST]);
    assert.deepEqual([...ours.SPREADSHEET_SECRET_COLUMNS], [...currentRegistry.SPREADSHEET_SECRET_COLUMNS]);
    const names = ["user", "x_users", "_x", "sqlite_x", "d1_migrations", "9a", "a-b", "events", "token", "session", "refresh_token", "api_tokens", "client_secret_x", "mysecrets", "my_password"];
    for (const n of names) {
      assert.equal(ours.isValidSqliteTableName(n), currentRegistry.isValidSqliteTableName(n), n);
      assert.equal(ours.isSpreadsheetTableBlocklisted(n), currentRegistry.isSpreadsheetTableBlocklisted(n), n);
      assert.equal(ours.isSpreadsheetSecretColumn(n), currentRegistry.isSpreadsheetSecretColumn(n), n);
      for (const inSchema of [true, false]) {
        assert.deepEqual(ours.resolveSpreadsheetTableDef(n, inSchema), currentRegistry.resolveSpreadsheetTableDef(n, inSchema), n);
      }
    }
    const dbNames = [...tableNames, "ghost", "_hidden", "sqlite_sequence", "static_artifacts"];
    assert.deepEqual(
      ours.buildSpreadsheetTableDefs(dbNames, SPREADSHEET_SCHEMA_TABLES),
      currentRegistry.buildSpreadsheetTableDefs(dbNames, SPREADSHEET_SCHEMA_TABLES),
    );
    for (const def of ours.buildSpreadsheetTableDefs(dbNames, SPREADSHEET_SCHEMA_TABLES)) {
      for (const column of ["id", "status", "visibility_status", "approval_status", "access_token", "x"]) {
        assert.equal(ours.isSpreadsheetColumnEditable(def, column), currentRegistry.isSpreadsheetColumnEditable(def, column), `${def.table}.${column}`);
      }
    }
    // schemaCatalog.ts equals the real drizzle schema (table names, and enum values keyed by drizzle property key).
    const realTables = new Set();
    const realEnums = {};
    for (const value of Object.values(schema)) {
      if (!isTable(value)) continue;
      realTables.add(getTableName(value));
      for (const [key, column] of Object.entries(getTableColumns(value))) {
        const k = `${getTableName(value)}.${key}`;
        if (column.enumValues?.length && !(k in realEnums)) realEnums[k] = [...column.enumValues];
      }
    }
    assert.deepEqual([...SPREADSHEET_SCHEMA_TABLES].sort(), [...realTables].sort());
    assert.deepEqual(canon(SPREADSHEET_COLUMN_ENUMS), canon(realEnums));
  });

  test("T02 RH-009 /tables equals CURRENT route (tables, groups, warnings) except the S2 page size", async () => {
    resetCaches();
    const ref = await (await currentTablesRoute.GET(new Request("http://t/api/admin/spreadsheet/tables"))).json();
    resetCaches();
    const r = await get("/api/admin/spreadsheet/tables");
    assert.deepEqual(r.body.tables, ref.tables);
    assert.deepEqual(r.body.groups, ref.groups);
    assert.deepEqual(r.body.inSchemaNotInDb, ref.inSchemaNotInDb);
    assert.deepEqual(r.body.notInSchema, ref.notInSchema);
    assert.equal(ref.pageSize, 500);
    assert.equal(r.body.pageSize, MAX_SPREADSHEET_PAGE_ROWS);
    assert.ok(!Number.isNaN(Date.parse(r.body.discoveredAt)));
    assert.equal(r.stats.statements, 2, "session + catalog");
    contracts.AdminSpreadsheetTablesResponseSchema.parse(r.body);
  });

  test("T03 RH-009 refresh=1 re-reads the catalog, plain request within 30 s does not", async () => {
    resetCaches();
    const first = await get("/api/admin/spreadsheet/tables");
    assert.equal(first.stats.statements, 2);
    const cached = await get("/api/admin/spreadsheet/tables");
    assert.equal(cached.stats.statements, 1, "session only");
    const refreshed = await get("/api/admin/spreadsheet/tables?refresh=1");
    assert.equal(refreshed.stats.statements, 2);
  });

  test("T04 RH-003 /data equals CURRENT fetchSpreadsheetPage for every discoverable table (page 1 and 2)", async () => {
    for (const table of tableNames) {
      for (const [page, limit] of [[1, 50], [2, 7]]) {
        resetCaches();
        const ref = canon(await current.fetchSpreadsheetPage({ table, page, limit }));
        resetCaches();
        const r = await get(`/api/admin/spreadsheet/data?table=${table}&page=${page}&limit=${limit}`);
        const body = { ...r.body };
        delete body.truncated;
        assert.deepEqual(body, ref, `${table} page ${page}`);
        assert.equal(r.body.truncated, undefined, `${table}: unexpectedly truncated`);
        assert.equal(r.stats.statements, 3, `${table}: session + definition/columns + rows`);
        contracts.AdminSpreadsheetPageResponseSchema.parse(r.body);
      }
    }
  });

  test("T05 secret columns are masked exactly like CURRENT (session tokens)", async () => {
    resetCaches();
    const ref = canon(await current.fetchSpreadsheetPage({ table: "session", page: 1, limit: 50 }));
    resetCaches();
    const r = await get("/api/admin/spreadsheet/data?table=session&limit=50");
    assert.ok(ref.rows.length > 0);
    assert.deepEqual(r.body.rows, ref.rows);
    assert.doesNotMatch(JSON.stringify(r.body), /tok-root/);
    assert.match(r.body.rows[0].sessionToken, /…|•/);
  });

  test("T06 RH-003 parameter handling: trim, bad page, bad limit, missing table", async () => {
    resetCaches();
    const trimmed = await get("/api/admin/spreadsheet/data?table=%20x_users%20&page=abc&limit=5");
    const ref = canon(await current.fetchSpreadsheetPage({ table: "x_users", page: Number("abc"), limit: 5 }));
    assert.equal(trimmed.body.page, 1);
    assert.deepEqual({ ...trimmed.body, truncated: undefined }, { ...ref, truncated: undefined });
    const big = await get("/api/admin/spreadsheet/data?table=x_users&limit=100000");
    assert.equal(big.body.limit, MAX_SPREADSHEET_PAGE_ROWS, "limit above the S2 cap is clamped (CURRENT cap was 5000)");
    const zero = await get("/api/admin/spreadsheet/data?table=x_users&limit=0");
    assert.equal(zero.body.limit, 1);
    const nan = await get("/api/admin/spreadsheet/data?table=x_users&limit=zz");
    assert.equal(nan.body.limit, MAX_SPREADSHEET_PAGE_ROWS);
    const dflt = await get("/api/admin/spreadsheet/data?table=x_users");
    assert.equal(dflt.body.limit, MAX_SPREADSHEET_PAGE_ROWS);
    assert.equal(dflt.body.hasMore, true, "x_users has more than one page");
    const negative = await get("/api/admin/spreadsheet/data?table=x_users&page=-4&limit=3");
    assert.equal(negative.body.page, 1);
    for (const path of ["/api/admin/spreadsheet/data", "/api/admin/spreadsheet/data?table=", "/api/admin/spreadsheet/data?table=%20%20"]) {
      const r = await call(path);
      assert.equal(r.status, 400);
      assert.deepEqual(r.body, { error: "unknown_table" });
      assert.equal(r.headers.get("cache-control"), PRIVATE);
      const reference = await currentDataRoute.GET(new Request(`http://t${path}`));
      assert.equal(reference.status, 400);
      assert.deepEqual(await reference.json(), { error: "unknown_table" });
    }
  });

  test("T07 unknown / blocked / not-in-schema tables are 400 unknown_table like CURRENT, with no definition read for static rejects", async () => {
    for (const table of ["nope", "static_artifacts", "d1_migrations", "__drizzle_migrations", "sqlite_master", "_cf_KV", "user;drop", "a-b", '"user"', "x_users%20--"]) {
      resetCaches();
      const reference = await currentDataRoute.GET(new Request(`http://t/api/admin/spreadsheet/data?table=${encodeURIComponent(table)}`));
      resetCaches();
      const r = await call(`/api/admin/spreadsheet/data?table=${encodeURIComponent(table)}`);
      assert.equal(reference.status, 400, table);
      assert.equal(r.status, 400, table);
      assert.deepEqual(r.body, await reference.json(), table);
      assert.equal(r.stats.statements, 1, `${table}: session only (rejected before any definition read)`);
    }
  });

  test("T08 RH-007 /export equals CURRENT route (csv, tsv, header=0) for tables that fit the S2 caps", async () => {
    for (const [table, query] of [["user", ""], ["user", "&format=tsv"], ["user", "&header=0"], ["session", "&format=TSV&header=0"], ["slots", ""], ["video_events", ""], ["event_staff", ""]]) {
      resetCaches();
      const reference = await currentExportRoute.GET(new Request(`http://t/api/admin/spreadsheet/export?table=${table}${query}`));
      const refText = await reference.text();
      resetCaches();
      const r = await get(`/api/admin/spreadsheet/export?table=${table}${query}`);
      assert.equal(reference.headers.get("x-spreadsheet-truncated"), "0", `${table}: fixture must fit CURRENT cap`);
      assert.equal(r.text, refText, `${table}${query}`);
      for (const name of ["content-type", "content-disposition", "x-spreadsheet-truncated", "cache-control", "pragma", "expires"]) {
        assert.equal(r.headers.get(name), reference.headers.get(name), `${table} ${name}`);
      }
      assert.equal(r.stats.statements, 3);
    }
  });

  test("T09 RH-007 export edge cases: missing table 400, unknown table 400, filename sanitised", async () => {
    assert.deepEqual((await call("/api/admin/spreadsheet/export")).body, { error: "unknown_table" });
    assert.equal((await call("/api/admin/spreadsheet/export?table=nope")).status, 400);
    const r = await get("/api/admin/spreadsheet/export?table=user&format=csv");
    assert.match(r.headers.get("content-disposition"), /^attachment; filename="user\.csv"$/);
    const bad = await call("/api/admin/spreadsheet/export?table=x%22%0A_users");
    assert.equal(bad.status, 400);
  });

  test("T10 S2 bounds: row cap, byte cap and truncated flags (CURRENT allowed 5000 rows and unbounded bytes)", async () => {
    for (let i = 0; i < 130; i += 1) {
      insert(sqlite, "software_catalog", { id: `sw${String(i).padStart(3, "0")}`, name: `Soft ${i}`, normalized_name: `soft ${i}`, created_at: 1, updated_at: 1 });
    }
    resetCaches();
    const refExport = await currentExportRoute.GET(new Request("http://t/api/admin/spreadsheet/export?table=software_catalog"));
    const refLines = (await refExport.text()).split("\n");
    assert.equal(refLines.length, 131, "CURRENT exports all 130 rows");
    resetCaches();
    const exp = await get("/api/admin/spreadsheet/export?table=software_catalog");
    const lines = exp.text.split("\n");
    assert.equal(lines.length, 1 + MAX_SPREADSHEET_EXPORT_ROWS);
    assert.deepEqual(lines, refLines.slice(0, lines.length), "partial export is a prefix of CURRENT's");
    assert.equal(exp.headers.get("x-spreadsheet-truncated"), "1");
    assert.match(exp.headers.get("content-disposition"), /filename="software_catalog-partial\.csv"/);

    const page = await get("/api/admin/spreadsheet/data?table=software_catalog&limit=50&page=3");
    assert.equal(page.body.rows.length, 30);
    assert.equal(page.body.hasMore, false);

    // Byte cap: 6 rows of 20 000 characters cannot fit 48 KiB; trailing rows are dropped, never cut.
    for (let i = 0; i < 6; i += 1) {
      insert(sqlite, "software_aliases", { software_id: "sw000", alias: "a".repeat(20_000), normalized_alias: `n${i}` });
    }
    resetCaches();
    const wide = await get("/api/admin/spreadsheet/data?table=software_aliases&limit=50");
    assert.equal(wide.body.truncated, true);
    assert.equal(wide.body.hasMore, true);
    assert.equal(wide.body.rows.length, 2);
    assert.ok(Buffer.byteLength(wide.text) < 64 * 1024, `${Buffer.byteLength(wide.text)} bytes`);
    assert.ok(wide.body.rows.every((row) => row.alias.length === 20_000));
    contracts.AdminSpreadsheetPageResponseSchema.parse(wide.body);
    const wideExport = await get("/api/admin/spreadsheet/export?table=software_aliases");
    assert.equal(wideExport.headers.get("x-spreadsheet-truncated"), "1");
    assert.ok(Buffer.byteLength(wideExport.text) <= MAX_SPREADSHEET_RESPONSE_BYTES + 1024);
    assert.equal(wideExport.text.split("\n").length, 1 + 2);
  });

  test("T11 guards: disabled -> 404 before any D1, then 401 / 403 / 503 / 200 with no-store", async () => {
    for (const env of [{}, { ADMIN_SPREADSHEET_ENABLED: "0" }, { ADMIN_SPREADSHEET_ENABLED: "off" }, { ADMIN_SPREADSHEET_ENABLED: "" }]) {
      for (const path of ["data?table=x_users", "tables", "export?table=x_users"]) {
        const r = await call(`/api/admin/spreadsheet/${path}`, "root", { env });
        assert.equal(r.status, 404, path);
        assert.deepEqual(r.body, { error: "spreadsheet_disabled" });
        assert.equal(r.stats.statements, 0, "disabled must not read D1");
        assert.equal(r.headers.get("cache-control"), PRIVATE);
      }
      const anon = await call("/api/admin/spreadsheet/tables", null, { env });
      assert.equal(anon.status, 404, "disabled is answered before authentication, like CURRENT");
    }
    for (const value of ["1", "true", "TRUE", " yes "]) {
      assert.equal((await call("/api/admin/spreadsheet/tables", "root", { env: { ADMIN_SPREADSHEET_ENABLED: value } })).status, 200, value);
    }
    const statuses = {
      anonymous: (await call("/api/admin/spreadsheet/tables", null)).status,
      banned: (await call("/api/admin/spreadsheet/tables", "badmin")).status,
      user: (await call("/api/admin/spreadsheet/tables", "alice")).status,
      moderator: (await call("/api/admin/spreadsheet/tables", "bob")).status,
      admin: (await call("/api/admin/spreadsheet/tables", "root")).status,
    };
    assert.deepEqual(statuses, { anonymous: 401, banned: 403, user: 403, moderator: 403, admin: 200 });
    const unavailable = await call("/api/admin/spreadsheet/data?table=x_users", "root", {
      d1: { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("down"); }, all: async () => { throw new Error("down"); } }), all: async () => { throw new Error("down"); } }), stats: { statements: 0, writes: 0 } },
    });
    assert.equal(unavailable.status, 503);
    for (const path of ["data?table=x_users", "export?table=x_users", "tables"]) {
      const denied = await call(`/api/admin/spreadsheet/${path}`, "alice");
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get("cache-control"), "private, no-store");
      assert.ok(!JSON.stringify(denied.body).includes("software_catalog"));
    }
  });

  test("T12 D1 failure after the session read is a fixed error code (no SQL text)", async () => {
    resetCaches();
    const base = createD1(sqlite);
    const d1 = {
      stats: base.stats,
      prepare: (sql) => {
        if (/FROM "x_users"/.test(sql)) throw new Error('D1_ERROR: no such table: "x_users" SELECT secret');
        return base.prepare(sql);
      },
    };
    const r = await call("/api/admin/spreadsheet/data?table=x_users", "root", { d1 });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: "internal_error" });
  });

  test("T13 writes are not mounted here: non-GET methods never reach a spreadsheet handler", async () => {
    for (const [method, path] of [["POST", "data"], ["PATCH", "data"], ["DELETE", "data"], ["POST", "import"], ["PUT", "tables"]]) {
      const anon = await call(`/api/admin/spreadsheet/${path}`, null, { method });
      assert.ok(anon.status >= 400 && anon.status !== 400, `${method} ${path}: ${anon.status}`);
      assert.ok(!("rows" in (anon.body ?? {})) && !("tables" in (anon.body ?? {})));
      const admin = await call(`/api/admin/spreadsheet/${path}`, "root", { method });
      assert.ok(admin.status >= 400, `${method} ${path} as admin: ${admin.status}`);
      assert.ok(!("rows" in (admin.body ?? {})) && !("tables" in (admin.body ?? {})));
      assert.equal(admin.stats.writes, 0);
    }
  });

  test("S2 budget summary (informational)", async () => {
    resetCaches();
    const summary = {};
    for (const path of ["tables", "data?table=x_users&limit=50", "data?table=events", "export?table=x_users"]) {
      resetCaches();
      const r = await get(`/api/admin/spreadsheet/${path}`);
      summary[path] = { statements: r.stats.statements, binds: r.stats.maxBinds, bytes: Buffer.byteLength(r.text) };
    }
    console.log("[MIG-0605 U02] D1 usage per request", JSON.stringify(summary));
    assert.ok(Object.values(summary).every((s) => s.bytes <= 64 * 1024));
  });
}

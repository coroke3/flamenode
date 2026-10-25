// MIG-0602 U02 / MIG-0617: parity of the audit rows and batches the Hono routes write
// (packages/server-core with the guards' `preloaded` settings / actor snapshot, MIG-0617 L3)
// with CURRENT prepareAuditLogEntries (src/lib/audit/logger.ts, which reads them itself), and of
// the announcement queue statement with CURRENT buildAnnouncementChangeQueueBatch. CURRENT code
// uses "@/..." aliases, so (like src/lib/audit/mutate.execution.test.mjs) the file re-runs
// itself under tsx.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const underTsx = process.env.FLAMENODE_AUDIT_PARITY === "1";

if (!underTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, FLAMENODE_AUDIT_PARITY: "1" },
    },
  );
  if (result.error) throw result.error;
  test("audit parity (tsx child process)", () => {
    assert.equal(result.status, 0, "child tsx parity run must pass");
  });
} else {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const { getTableColumns } = await import("drizzle-orm");
  const dialect = new SQLiteSyncDialect();
  const current = await import("../../../src/lib/audit/logger.ts");
  const schema = await import("../../../src/lib/db/schema.ts");
  const core = await import("../../../packages/server-core/src/audit/logger.ts");
  const coreSettings = await import("../../../packages/server-core/src/audit/settings.ts");
  const { createAdminRoutes } = await import("../src/routes/admin/index.ts");
  const { Hono } = await import("hono");
  const { createAdminD1, seedBase } = await import("./helpers/sqliteD1.mjs");
  const announcements = await import("../src/routes/admin/announcements.ts");
  const apiEndpoints = await import("../src/routes/admin/apiEndpoints.ts");
  const enqueue = await import("../../../src/lib/staticRebuild/hooks.ts");

  const NOW_MS = 1_800_000_000_000;
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

  function currentDb({ settings, actor }) {
    let calls = 0;
    const get = async () => (++calls === 1 ? settings : actor);
    const chain = { leftJoin: () => chain, where: () => ({ get }) };
    return { select: () => ({ from: () => chain }) };
  }

  /** What the Hono guards hand to mutateWithAudit: no audit read may run (the db throws on any use). */
  function minePreloaded({ settings, actor }, actorUserId) {
    return {
      settings: coreSettings.mapAuditSettings(settings),
      actorSnapshotJsonById: { [actorUserId]: JSON.stringify(core.actorSnapshotFromRow(actor)) },
    };
  }
  const forbiddenDb = new Proxy({}, { get() { throw new Error("audit read although preloaded"); } });

  const SETTINGS = {
    audit_normal_retention_days: 30,
    audit_restorable_retention_days: 180,
    audit_long_retention_days: 365,
    audit_max_payload_bytes: 120_000,
    audit_compact_after_days: 30,
  };
  const ACTOR = {
    discord_id: "d-1", discord_name: "Admin", active_x_user_id: "x1",
    user_image: "https://img/user.png", x_name: "X Name", x_icon_url: null,
  };

  const CASES = {
    "announcement create": {
      input: { table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1", title: "日本語 \u{1F600}", n: 1, nul: null, u: undefined }, actor_user_id: "admin-1", retention_class: "normal" },
    },
    "announcement update": {
      input: { table_name: "announcements", target_id: "a1", operation: "UPDATE", before: { id: "a1", title: "Old", updated_at: 1 }, after: { id: "a1", title: "New", updated_at: 2 }, actor_user_id: "admin-1", retention_class: "normal" },
    },
    "announcement delete": {
      input: { table_name: "announcements", target_id: "a1", operation: "DELETE", before: { id: "a1", title: "Old" }, after: null, actor_user_id: "admin-1" },
    },
    "events long_audit with reason/context": {
      input: { table_name: "events", target_id: "ev-1", operation: "UPDATE", before: { id: "ev-1", public_api_enabled: 0, updated_at: 20 }, after: { id: "ev-1", public_api_enabled: 1, updated_at: 21 }, actor_user_id: "admin-1", context: "admin_api_endpoints", reason: "公開APIリンクを発行", retention_class: "long_audit" },
    },
    "redacted key": {
      input: { table_name: "announcements", target_id: "a1", operation: "UPDATE", before: { id: "a1", api_key: "k1", x_token: "t" }, after: { id: "a1", api_key: "k2", x_token: "t2" }, actor_user_id: "admin-1" },
    },
    "payload exceeded": {
      settings: { ...SETTINGS, audit_max_payload_bytes: 50 },
      input: { table_name: "announcements", target_id: "a1", operation: "UPDATE", before: { id: "a1", title: "x".repeat(40) }, after: { id: "a1", title: "y".repeat(40) }, actor_user_id: "admin-1" },
    },
    "no settings row (defaults)": {
      settings: undefined,
      input: { table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1" }, actor_user_id: "admin-1" },
    },
    "missing actor row": {
      actor: undefined,
      input: { table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1" }, actor_user_id: "ghost" },
    },
    "actor with x icon": {
      actor: { ...ACTOR, x_icon_url: "https://img/x.png" },
      input: { table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1" }, actor_user_id: "admin-1" },
    },
    "blocked table": {
      input: { table_name: "session", target_id: "s1", operation: "UPDATE", before: { id: "s1" }, after: { id: "s1" }, actor_user_id: "admin-1" },
    },
  };

  for (const [name, c] of Object.entries(CASES)) {
    test(`audit entry is byte-identical to CURRENT: ${name}`, async () => {
      const settings = "settings" in c ? c.settings : SETTINGS;
      const actor = "actor" in c ? c.actor : ACTOR;
      const restore = freeze();
      try {
        const [expected] = await current.prepareAuditLogEntries(currentDb({ settings, actor }), [{ ...c.input, strict: true }]);
        restore();
        const restore2 = freeze();
        try {
          const [actual] = await core.prepareAuditLogEntries(
            forbiddenDb,
            [{ ...c.input, strict: true }],
            minePreloaded({ settings, actor }, c.input.actor_user_id),
          );
          assert.equal(JSON.stringify(actual), JSON.stringify(expected));
        } finally {
          restore2();
        }
      } finally {
        restore();
      }
    });
  }

  test("announcement and event column order equal the CURRENT drizzle schema", () => {
    assert.deepEqual([...announcements.ANNOUNCEMENT_COLUMNS], Object.keys(getTableColumns(schema.announcements)));
    assert.deepEqual([...apiEndpoints.EVENT_COLUMNS], Object.keys(getTableColumns(schema.events)));
  });

  test("event export cache keys and public JSON cache Request equal CURRENT (pins EVENT_EXPORT_CACHE_VERSION)", async () => {
    const exportCache = await import("../../../src/lib/api/eventExportCache.ts");
    const publicCache = await import("../../../src/lib/publicData/publicCache.ts");
    for (const id of ["ev-1", "日本語 id/with?chars"]) {
      const expected = [];
      for (const format of ["v5", "legacy"]) {
        for (const minutes of exportCache.EVENT_EXPORT_REFRESH_MINUTES) {
          expected.push(exportCache.eventExportPayloadCacheKey(id, format, minutes));
        }
      }
      assert.deepEqual(apiEndpoints.eventExportCacheKeys(id), expected);
      for (const key of expected) {
        assert.equal(apiEndpoints.publicJsonCacheRequestUrl(key), publicCache.publicJsonCacheKey(key).url);
      }
    }
  });

  const SITE = "https://app.flamenode.example";
  const norm = (s) => s.replace(/\s+/g, " ").trim();

  /** The D1 batch the real route sends for POST /api/admin/announcements (guards, preloaded audit context and all). */
  async function announcementCreateBatch() {
    const { db, sqlite } = createAdminD1();
    seedBase(sqlite);
    const batches = [];
    const original = db.batch.bind(db);
    db.batch = async (statements) => {
      batches.push(statements.map((s) => ({ sql: s._sql, params: [...s._params] })));
      return original(statements);
    };
    const hono = new Hono();
    hono.route("/api/admin", createAdminRoutes({
      session: async (c, next) => {
        c.set("user", { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null });
        c.set("sessionState", "user");
        await next();
      },
    }));
    const res = await hono.request("/api/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: SITE },
      body: JSON.stringify({ title: "T", body: "B", severity: "info", target_audience: "all", is_published: 1, id: "a-new" }),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
    assert.equal(res.status, 200);
    assert.equal(batches.length, 1);
    return batches[0];
  }

  test("announcement queue statement the route sends equals CURRENT buildAnnouncementChangeQueueBatch", async () => {
    const captured = [];
    const db = { run: (query) => { captured.push(dialect.sqlToQuery(query.getSQL ? query.getSQL() : query)); return { kind: "run" }; } };
    const restore = freeze();
    let expected;
    try {
      await enqueue.buildAnnouncementChangeQueueBatch(db, { reason: "announcement_create", requestedByUserId: "admin-1" });
      expected = captured[0];
    } finally {
      restore();
    }
    const restore2 = freeze();
    let batch;
    try {
      batch = await announcementCreateBatch();
    } finally {
      restore2();
    }
    // batch = [INSERT announcement, changes() assertion, queue UPSERT, changes() assertion, audit INSERT, audit assertion]
    assert.equal(batch.length, 6);
    assert.equal(norm(batch[2].sql), norm(expected.sql));
    assert.deepEqual(batch[2].params, expected.params);
  });

  test("audit INSERT / assertion SQL the route sends equals CURRENT mutateWithAudit shape", async () => {
    const { mutateWithAudit } = await import("../../../src/lib/audit/mutate.ts");
    const { sql } = await import("drizzle-orm");
    const restore = freeze();
    let batch;
    try {
      batch = await announcementCreateBatch();
    } finally {
      restore();
    }
    const restore2 = freeze();
    let batchCurrent;
    try {
      globalThis.crypto.randomUUID(); // the route spent its first uuid on the queue row
      const base = currentDb({ settings: undefined, actor: { ...ACTOR, discord_id: "d-1", discord_name: "Admin", active_x_user_id: null, user_image: null, x_name: null, x_icon_url: null } });
      const db = {
        ...base,
        run: (query) => {
          const q = dialect.sqlToQuery(query);
          return { config: { action: "run" }, getSQL: () => query, getQuery: () => q, _prepare: () => ({ getQuery: () => q, stmt: { bind: () => ({}) } }) };
        },
        batch: async (items) => { batchCurrent = items.map((i) => i.getQuery()); },
      };
      const now = NOW_MS / 1000;
      await mutateWithAudit(db, {
        mutationStatements: [db.run(sql`SELECT 1`)],
        expectedMutationChanges: 1,
        audits: [{
          table_name: "announcements", target_id: "a-new", operation: "CREATE", before: null,
          after: { id: "a-new", title: "T", body: "B", severity: "info", target_audience: "all", is_published: 1, publish_at: null, expire_at: null, created_by_user_id: "admin-1", created_at: now, updated_at: now },
          actor_user_id: "admin-1", retention_class: "normal",
        }],
      });
    } finally {
      restore2();
    }
    assert.equal(batchCurrent.length, 4);
    for (const [offset, expected] of batchCurrent.slice(-2).entries()) {
      const actual = batch[batch.length - 2 + offset];
      assert.equal(norm(actual.sql), norm(expected.sql), `statement ${offset}`);
      assert.deepEqual(actual.params, expected.params, `params ${offset}`);
    }
  });
}

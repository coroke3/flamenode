// MIG-0602 U02: parity of the raw-D1 audit module with CURRENT
// prepareAuditLogEntries (src/lib/audit/logger.ts) and the static rebuild
// queue statement with CURRENT buildStaticRebuildQueueBatch. CURRENT code uses
// "@/..." aliases, so (like src/lib/audit/mutate.execution.test.mjs) the file
// re-runs itself under tsx.
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
  const mine = await import("../src/audit/mutateWithAudit.ts");
  const queue = await import("../src/audit/staticRebuildQueue.ts");
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

  function mineDb({ settings, actor }) {
    return {
      prepare(sql) {
        return {
          bind: () => ({
            first: async () => (sql.includes("system_settings") ? settings : actor),
          }),
        };
      },
    };
  }

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
          const [actual] = await mine.prepareAuditEntries(mineDb({ settings, actor }), [c.input]);
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

  test("static rebuild queue statement equals CURRENT buildAnnouncementChangeQueueBatch", async () => {
    const captured = [];
    const db = { run: (query) => { captured.push(dialect.sqlToQuery(query.getSQL ? query.getSQL() : query)); return { kind: "run" }; } };
    const restore = freeze();
    let expected;
    try {
      await enqueue.buildAnnouncementChangeQueueBatch(db, { reason: "announcement_update", requestedByUserId: "admin-1" });
      expected = captured[0];
    } finally {
      restore();
    }
    const restore2 = freeze();
    let actual;
    try {
      actual = queue.buildAnnouncementChangeQueueStatement({ reason: "announcement_update", requestedByUserId: "admin-1" });
    } finally {
      restore2();
    }
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    assert.equal(norm(actual.statement.sql), norm(expected.sql));
    assert.deepEqual([...actual.statement.params], expected.params);
    assert.equal(actual.expectedChanges, 1);
  });

  test("audit INSERT / assertion SQL equals CURRENT mutateWithAudit shape", async () => {
    const { mutateWithAudit } = await import("../../../src/lib/audit/mutate.ts");
    const { sql } = await import("drizzle-orm");
    const restore = freeze();
    let batchCurrent;
    try {
      const db = {
        select: () => ({ from: () => { const chain = { leftJoin: () => chain, where: () => ({ get: async () => undefined }) }; return chain; } }),
        run: (query) => {
          const q = dialect.sqlToQuery(query);
          return { config: { action: "run" }, getSQL: () => query, getQuery: () => q, _prepare: () => ({ getQuery: () => q, stmt: { bind: () => ({}) } }) };
        },
        batch: async (items) => { batchCurrent = items.map((i) => i.getQuery()); },
      };
      await mutateWithAudit(db, {
        mutationStatements: [db.run(sql`UPDATE announcements SET title = ${"x"} WHERE id = ${"a1"}`)],
        expectedMutationChanges: 1,
        audits: [{ table_name: "announcements", target_id: "a1", operation: "UPDATE", before: { id: "a1" }, after: { id: "a1", t: 1 }, actor_user_id: "admin-1" }],
      });
    } finally {
      restore();
    }
    const restore2 = freeze();
    let batchMine = [];
    try {
      const db = {
        prepare: (s) => ({ bind: (...params) => ({ _sql: s, _params: params, first: async () => null }) }),
        batch: async (stmts) => { batchMine = stmts.map((s) => ({ sql: s._sql, params: s._params })); },
      };
      await mine.mutateWithAudit(db, {
        mutationStatements: [{ sql: "UPDATE announcements SET title = ? WHERE id = ?", params: ["x", "a1"] }],
        expectedMutationChanges: [1],
        audits: [{ table_name: "announcements", target_id: "a1", operation: "UPDATE", before: { id: "a1" }, after: { id: "a1", t: 1 }, actor_user_id: "admin-1" }],
      });
    } finally {
      restore2();
    }
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    assert.equal(batchMine.length, batchCurrent.length);
    for (const [i, expected] of batchCurrent.entries()) {
      assert.equal(norm(batchMine[i].sql), norm(expected.sql), `statement ${i}`);
      assert.deepEqual([...batchMine[i].params], expected.params, `params ${i}`);
    }
  });
}

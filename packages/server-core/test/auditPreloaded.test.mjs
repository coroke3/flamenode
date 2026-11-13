// MIG-0617 L3: `preloaded` (settings / actorSnapshotJsonById) on the core audit preparation.
// Without it the core reads exactly as before; with it the entries are byte-identical and the
// matching reads are skipped. Runs on the real schema (all migrations on node:sqlite).
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { mutateWithAudit, planAtomicAuditMutationBudget } from "@flamenode/server-core/audit/mutate";
import { planD1AuditMutationBudget } from "@flamenode/server-core/audit/mutateBudget";
import { actorSnapshotFromRow, isValidPreloadedAuditSettings, prepareAuditLogEntries } from "@flamenode/server-core/audit/logger";
import { mapAuditSettings } from "@flamenode/server-core/audit/settings";
import { sql } from "@flamenode/server-core/sql";
import { buildEventGroupChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";

const MIGRATIONS = new URL("../../../migrations/", import.meta.url);

function world() {
  const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(fs.readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(`INSERT INTO "x_users" (id, x_name, icon_url, approval_status) VALUES ('x1', 'XN', 'https://i/x.png', 'approved')`);
  sqlite.exec(`INSERT INTO "user" (id, name, discord_id, role, is_banned, is_tos_accepted, active_x_user_id, image) VALUES ('admin-1', 'Admin', 'd-1', 'admin', 0, 1, 'x1', 'https://i/u.png')`);
  sqlite.exec("UPDATE system_settings SET audit_normal_retention_days = 45, audit_max_payload_bytes = 90000 WHERE id = 'default'");
  const stats = { reads: [], batches: 0 };
  const run = (text, params) => sqlite.prepare(text).all(...params).map((row) => ({ ...row }));
  const statement = (text, params) => ({
    __sql: text,
    __params: params,
    bind: (...values) => statement(text, values),
    async all() {
      stats.reads.push(text);
      return { results: run(text, params) };
    },
    async run() {
      return { results: run(text, params), success: true, meta: { changes: 0 } };
    },
    async raw() {
      stats.reads.push(text);
      const prepared = sqlite.prepare(text);
      prepared.setReturnArrays(true);
      try {
        return prepared.all(...params).map((row) => [...row]);
      } finally {
        prepared.setReturnArrays(false);
      }
    },
  });
  const d1 = {
    prepare: (text) => statement(text, []),
    async batch(statements) {
      stats.batches += 1;
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => ({ results: run(s.__sql, s.__params) }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, stats, db: drizzle(d1, { schema }) };
}

function freeze() {
  let n = 0;
  const originalNow = Date.now;
  const originalUuid = globalThis.crypto.randomUUID;
  Date.now = () => 1_800_000_000_000;
  globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return () => {
    Date.now = originalNow;
    globalThis.crypto.randomUUID = originalUuid;
  };
}

const AUDIT = {
  table_name: "announcements",
  target_id: "a1",
  operation: "CREATE",
  before: null,
  after: { id: "a1", title: "日本語" },
  actor_user_id: "admin-1",
  retention_class: "normal",
  strict: true,
};

async function prepare(preloadedFrom) {
  const w = world();
  const restore = freeze();
  try {
    let preloaded;
    if (preloadedFrom) {
      const settingsRow = w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get();
      const actorRow = w.sqlite.prepare(`SELECT u.discord_id AS discord_id, u.name AS discord_name, u.active_x_user_id AS active_x_user_id,
        u.image AS user_image, x.x_name AS x_name, x.icon_url AS x_icon_url FROM "user" u LEFT JOIN x_users x ON x.id = u.active_x_user_id WHERE u.id = 'admin-1'`).get();
      preloaded = {};
      if (preloadedFrom !== "actor") preloaded.settings = mapAuditSettings(settingsRow);
      if (preloadedFrom !== "settings") preloaded.actorSnapshotJsonById = { "admin-1": JSON.stringify(actorSnapshotFromRow(actorRow)) };
    }
    const entries = await prepareAuditLogEntries(w.db, [AUDIT], preloaded);
    return { entries: JSON.stringify(entries), reads: w.stats.reads.length };
  } finally {
    restore();
  }
}

test("without preloaded the core reads settings and the actor (unchanged behaviour)", async () => {
  const self = await prepare(null);
  assert.equal(self.reads, 2);
  const [entry] = JSON.parse(self.entries);
  assert.equal(entry.expires_at - entry.created_at, 45 * 86400);
  assert.deepEqual(JSON.parse(entry.actor_snapshot_json), {
    discord_id: "d-1", discord_name: "Admin", x_user_id: "x1", x_name: "XN", icon_url: "https://i/x.png",
  });
});

test("preloaded settings + actor: entries are byte-identical and both reads are skipped", async () => {
  const self = await prepare(null);
  const both = await prepare("both");
  assert.equal(both.reads, 0);
  assert.equal(both.entries, self.entries);
});

test("preloaded settings only / actor only: only the other read remains, bytes unchanged", async () => {
  const self = await prepare(null);
  const settingsOnly = await prepare("settings");
  const actorOnly = await prepare("actor");
  assert.equal(settingsOnly.reads, 1);
  assert.equal(actorOnly.reads, 1);
  assert.equal(settingsOnly.entries, self.entries);
  assert.equal(actorOnly.entries, self.entries);
});

test("actorSnapshotFromRow: missing user is the empty snapshot, image fallback order is x icon then user image", () => {
  assert.deepEqual(actorSnapshotFromRow(null), { discord_id: null, discord_name: null, x_user_id: null, x_name: null, icon_url: null });
  assert.equal(actorSnapshotFromRow({ discord_id: null, discord_name: null, active_x_user_id: null, user_image: "u", x_name: null, x_icon_url: "" }).icon_url, "u");
  assert.equal(actorSnapshotFromRow({ discord_id: null, discord_name: null, active_x_user_id: null, user_image: "u", x_name: null, x_icon_url: "x" }).icon_url, "x");
});

test("mutateWithAudit forwards preloaded: one batch, no settings or actor read, same audit row", async () => {
  const run = async (withPreloaded) => {
    const w = world();
    const restore = freeze();
    try {
      w.sqlite.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
      const preloaded = withPreloaded
        ? {
            settings: mapAuditSettings(w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get()),
            actorSnapshotJsonById: { "admin-1": JSON.stringify(actorSnapshotFromRow(null)) },
          }
        : undefined;
      const before = w.stats.reads.length;
      await mutateWithAudit(w.db, {
        mutationStatements: [sql`INSERT INTO t (id) VALUES (${"a1"})`],
        expectedMutationChanges: 1,
        audits: [{ table_name: "announcements", target_id: "a1", operation: "CREATE", before: null, after: { id: "a1" }, actor_user_id: "admin-1" }],
        preloaded,
      });
      return { reads: w.stats.reads.length - before, batches: w.stats.batches, row: w.sqlite.prepare("SELECT * FROM audit_logs").get() };
    } finally {
      restore();
    }
  };
  const self = await run(false);
  const pre = await run(true);
  assert.equal(self.reads, 2);
  assert.equal(pre.reads, 0);
  assert.equal(pre.batches, 1);
  // the preloaded actor here is the empty snapshot, so only actor_snapshot_json may differ
  assert.deepEqual({ ...pre.row, actor_snapshot_json: null }, { ...self.row, actor_snapshot_json: null });
  assert.deepEqual(JSON.parse(pre.row.actor_snapshot_json), actorSnapshotFromRow(null));
});


test("Issue #669: exact 50-query budget uses only matching guard-preloaded audit reads", () => {
  const audit = { ...AUDIT, actor_user_id: "admin-1" };
  const base = {
    mutationStatements: [sql`INSERT INTO test_table (id) VALUES (${"a1"})`],
    expectedMutationChanges: 1,
    audits: [audit],
    callerQueryCount: 46,
  };
  const settings = mapAuditSettings(null);
  const validPreload = {
    settings,
    actorSnapshotJsonById: { "admin-1": JSON.stringify(actorSnapshotFromRow(null)) },
  };
  const noPreload = planAtomicAuditMutationBudget(base);
  assert.equal(noPreload.preparationQueryCount, 2);
  assert.equal(noPreload.totalQueryCount, 52);
  assert.equal(noPreload.withinLimit, false);

  for (const [label, preload] of [
    ["only settings", { settings }],
    ["wrong actor key", { settings, actorSnapshotJsonById: { other: "{}" } }],
    ["only actor", { actorSnapshotJsonById: validPreload.actorSnapshotJsonById }],
    ["null actor placeholder", { settings, actorSnapshotJsonById: { "admin-1": null } }],
  ]) {
    const budget = planAtomicAuditMutationBudget({ ...base, preloaded: preload });
    assert.equal(budget.preparationQueryCount, 1, label);
    assert.equal(budget.totalQueryCount, 51, label);
    assert.equal(budget.withinLimit, false, label);
  }
  const full = planAtomicAuditMutationBudget({ ...base, preloaded: validPreload });
  assert.equal(full.preparationQueryCount, 0);
  assert.equal(full.totalQueryCount, 50);
  assert.equal(full.withinLimit, true);
  const withActorX = planAtomicAuditMutationBudget({
    ...base, audits: [{ ...audit, actor_x_user_id: "x1" }], preloaded: validPreload,
  });
  assert.equal(withActorX.preparationQueryCount, 1, "actor-X approval SELECT is not preloaded");
  assert.equal(withActorX.totalQueryCount, 51);
  assert.equal(withActorX.withinLimit, false);

  const distinct = planD1AuditMutationBudget({
    mutationStatementCount: 1, mutationAssertionCount: 1,
    auditEntryCount: 1, distinctActorCount: 1, callerQueryCount: 46,
    preloadedSettings: true, preloadedActorCount: 10000,
  });
  assert.equal(distinct.preparationQueryCount, 0, "credits are capped by real distinct actors");
  const invalidCredit = planD1AuditMutationBudget({
    mutationStatementCount: 1, mutationAssertionCount: 1,
    auditEntryCount: 1, distinctActorCount: 1, callerQueryCount: 46,
    preloadedSettings: true, preloadedActorCount: Number.NaN,
  });
  assert.equal(invalidCredit.preparationQueryCount, 1, "invalid actor counts cannot reduce the budget");
});

test("Issue #669: real SQLite audited mutation accepts fully preloaded 50/50; partial/missing fail before reads", async () => {
  for (const mode of ["none", "settings", "actor", "wrongActor", "both"]) {
    const w = world();
    const restore = freeze();
    try {
      w.sqlite.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
      const settings = mapAuditSettings(w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get());
      const actor = JSON.stringify(actorSnapshotFromRow(null));
      const preloaded = mode === "none" ? undefined : {
        ...(mode === "settings" || mode === "wrongActor" || mode === "both" ? { settings } : {}),
        ...(mode === "actor" || mode === "both"
          ? { actorSnapshotJsonById: { "admin-1": actor } }
          : mode === "wrongActor" ? { actorSnapshotJsonById: { "other": actor } } : {}),
      };
      const input = {
        mutationStatements: [sql`INSERT INTO t (id) VALUES (${"a1"})`],
        expectedMutationChanges: 1,
        audits: [{ ...AUDIT }],
        callerQueryCount: 46,
        preloaded,
      };
      assert.equal(planAtomicAuditMutationBudget(input).withinLimit, mode === "both");
      if (mode === "both") {
        await mutateWithAudit(w.db, input);
        assert.equal(w.stats.reads.length, 0, "both authoritative preflight reads were reused");
        assert.equal(w.stats.batches, 1);
        assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM t").get().n, 1);
        assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
      } else {
        await assert.rejects(() => mutateWithAudit(w.db, input), /query 数が上限/);
        assert.equal(w.stats.reads.length, 0, "budget rejects before any audit SELECT");
        assert.equal(w.stats.batches, 0, "budget rejects before the D1 transaction");
        assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM t").get().n, 0);
        assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
      }
    } finally {
      restore();
      w.sqlite.close();
    }
  }
});


test("Issue #669: 80-event SA-029 with the prospective MIG-0516 marker fits 50 without dropping audits", async () => {
  const queue = await buildEventGroupChangeQueueBatch(
    { run: (query) => query },
    { reason: "event_group_member_add", requestedByUserId: "admin-1" },
  );
  assert.equal(queue.acceptedTargetCount, 1);
  assert.equal(queue.statements.length, 1, "actual current events_index upsert is one DML");
  assert.deepEqual(queue.expectedChanges, [1]);
  const now = 1800000000000;
  const marker = sql`UPDATE public_build_state
    SET requested_at = MAX(requested_at, ${now}) WHERE id = 1`;
  const audits = Array.from({ length: 80 }, (_, i) => ({
    table_name: "event_group_events",
    target_id: `grp:${i}`,
    operation: "CREATE",
    after: { event_group_id: "grp", event_id: `event-${i}` },
    actor_user_id: "admin-1",
    retention_class: "restorable",
  }));
  const proposal = {
    mutationStatements: [sql`SELECT 1`, ...queue.statements, marker],
    expectedMutationChanges: [80, ...queue.expectedChanges, 1],
    audits,
    callerQueryCount: 3,
  };
  const legacy = planAtomicAuditMutationBudget(proposal);
  assert.equal(legacy.auditChunkCount, 20);
  assert.equal(legacy.auditQueryCount, 40, "no per-row audit or count assertion is dropped");
  assert.equal(legacy.preparationQueryCount, 2);
  assert.equal(legacy.totalQueryCount, 51);
  assert.equal(legacy.withinLimit, false);
  const reused = planAtomicAuditMutationBudget({
    ...proposal,
    preloaded: {
      settings: mapAuditSettings(null),
      actorSnapshotJsonById: { "admin-1": JSON.stringify(actorSnapshotFromRow(null)) },
    },
  });
  assert.equal(reused.mutationStatementCount, 3);
  assert.equal(reused.mutationAssertionCount, 3, "marker still has strict changes()=1");
  assert.equal(reused.auditChunkCount, 20);
  assert.equal(reused.preparationQueryCount, 0);
  assert.equal(reused.totalQueryCount, 49);
  assert.equal(reused.withinLimit, true);
});


test("Issue #669: actual SQLite 80-member insert + queue + MIG-0516 marker audits all 80 under D1 50", async () => {
  const w = world();
  const restore = freeze();
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = Array.from({ length: 80 }, (_, i) => ({
      event_group_id: "test-66", event_id: `event-${String(i).padStart(3, "0")}`,
      relation_type: "member", created_at: now, updated_at: now,
    }));
    const queue = await buildEventGroupChangeQueueBatch(w.db, {
      reason: "event_group_member_add", requestedByUserId: "admin-1",
    });
    assert.equal(queue.statements.length, 1);
    assert.deepEqual(queue.expectedChanges, [1]);
    const mutation = w.db.run(sql`
      INSERT INTO event_group_events
        (event_group_id, event_id, relation_type, created_at, updated_at)
      SELECT
        json_extract(value, '$.event_group_id'),
        json_extract(value, '$.event_id'),
        json_extract(value, '$.relation_type'),
        json_extract(value, '$.created_at'),
        json_extract(value, '$.updated_at')
      FROM json_each(${JSON.stringify(payload)})
    `);
    // SQL and strict expected-changes assertion mirror MIG-0516's builder.
    // This is a projected cross-PR integration test, NOT a mounted route.
    const marker = w.db.run(sql`
      UPDATE public_build_state
      SET requested_at = MAX(requested_at, ${Date.now()})
      WHERE id = 1
    `);
    const audits = payload.map((row) => ({
      table_name: "event_group_events",
      target_id: `${row.event_group_id}:${row.event_id}`,
      operation: "CREATE", after: { ...row },
      actor_user_id: "admin-1", retention_class: "restorable",
    }));
    const fullPreload = {
      settings: mapAuditSettings(w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get()),
      actorSnapshotJsonById: { "admin-1": JSON.stringify(actorSnapshotFromRow(null)) },
    };
    const input = {
      mutationStatements: [mutation, ...queue.statements, marker],
      expectedMutationChanges: [80, ...queue.expectedChanges, 1],
      audits,
      callerQueryCount: 3,
      preloaded: fullPreload,
    };
    const budget = planAtomicAuditMutationBudget(input);
    assert.equal(budget.totalQueryCount, 49);
    assert.equal(budget.auditChunkCount, 20);
    assert.equal(budget.mutationStatementCount, 3);
    assert.equal(budget.mutationAssertionCount, 3);
    assert.equal(budget.preparationQueryCount, 0);
    assert.equal(budget.withinLimit, true);

    // Same exact queued marker and audits, but without the guard's read
    // snapshots, must refuse 51/50 *before* any D1 read or write.
    const noPreload = { ...input, preloaded: undefined };
    assert.equal(planAtomicAuditMutationBudget(noPreload).totalQueryCount, 51);
    await assert.rejects(() => mutateWithAudit(w.db, noPreload), /query 数が上限/);
    assert.equal(w.stats.reads.length, 0);
    assert.equal(w.stats.batches, 0);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM event_group_events WHERE event_group_id = 'test-66'").get().n, 0);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
    assert.equal(w.sqlite.prepare("SELECT requested_at FROM public_build_state WHERE id = 1").get().requested_at, 0);

    await mutateWithAudit(w.db, input);
    assert.equal(w.stats.reads.length, 0, "guard preloads eliminate *actual* audit preparation queries");
    assert.equal(w.stats.batches, 1);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM event_group_events WHERE event_group_id = 'test-66'").get().n, 80);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'event_group_events' AND operation = 'CREATE'").get().n, 80);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue WHERE target_type = 'events_index'").get().n, 1);
    assert.equal(w.sqlite.prepare("SELECT requested_at FROM public_build_state WHERE id = 1").get().requested_at, Date.now());
    const rows = w.sqlite.prepare("SELECT target_id, after_json, retention_class FROM audit_logs ORDER BY target_id").all();
    assert.equal(new Set(rows.map((row) => row.target_id)).size, 80);
    assert.ok(rows.every((row) =>
      row.retention_class === "restorable" && JSON.parse(row.after_json).event_group_id === "test-66"
    ), "all audits are independently restorable with complete snapshots");
  } finally {
    restore();
    w.sqlite.close();
  }
});


test("Issue #669: incomplete or corrupted settings cannot earn a preload SELECT credit", async () => {
  const canonical = mapAuditSettings(null);
  const actorSnapshot = JSON.stringify(actorSnapshotFromRow(null));
  for (const badSettings of [
    null, false, {}, { max_payload_bytes: 90_000 },
    { ...canonical, normal_retention_days: "30" },
    { ...canonical, restorable_retention_days: Number.NaN },
    { ...canonical, compact_after_days: -1 },
    { ...canonical, extra: true },
  ]) {
    const w = world();
    const restore = freeze();
    try {
      const preload = {
        settings: badSettings,
        actorSnapshotJsonById: { "admin-1": actorSnapshot },
      };
      const planned = planAtomicAuditMutationBudget({
        mutationStatements: [sql`SELECT 1`],
        expectedMutationChanges: 0,
        audits: [AUDIT],
        callerQueryCount: 0,
        preloaded: preload,
      });
      assert.equal(planned.preparationQueryCount, 1, "malformed settings must not earn a D1 query credit");
      const [entry] = await prepareAuditLogEntries(w.db, [AUDIT], preload);
      assert.ok(entry, "audit row must still be prepared with authoritative settings");
      assert.equal(w.stats.reads.length, 1, "runtime must perform the same settings read planner charged");
      assert.equal(entry.retention_class, "normal");
      assert.equal(entry.expires_at, entry.created_at + 45 * 86400, "retain the authoritative SQLite 45-day policy, not a missing-field/default placeholder");
    } finally {
      restore();
      w.sqlite.close();
    }
  }
});

test("Issue #677: throwing settings preload getter and Proxy pay for the authoritative D1 read", async () => {
  for (const makePreload of [
    (actorJson) => ({
      get settings() { throw new Error("private settings getter error"); },
      actorSnapshotJsonById: { "admin-1": actorJson },
    }),
    (actorJson) => new Proxy({
      actorSnapshotJsonById: { "admin-1": actorJson },
    }, {
      get(target, property, receiver) {
        if (property === "settings") throw new Error("private provider Proxy error");
        return Reflect.get(target, property, receiver);
      },
    }),
  ]) {
    const w = world();
    const restore = freeze();
    try {
      const preload = makePreload(JSON.stringify(actorSnapshotFromRow(null)));
      const proposal = {
        mutationStatements: [sql`SELECT 1`],
        expectedMutationChanges: 0,
        audits: [AUDIT],
        callerQueryCount: 0,
        preloaded: preload,
      };
      const budget = planAtomicAuditMutationBudget(proposal);
      assert.equal(budget.preparationQueryCount, 1,
        "throwing settings access must never earn a D1 read credit");
      const [entry] = await prepareAuditLogEntries(w.db, [AUDIT], preload);
      assert.ok(entry, "logger falls back to authoritative settings");
      assert.equal(w.stats.reads.length, 1,
        "runtime must perform the same settings read as the planner charged");
      assert.equal(entry.expires_at - entry.created_at, 45 * 86400);
    } finally {
      restore();
      w.sqlite.close();
    }
  }
});

test("Issue #677: throwing actor preload accessor fails closed in budget and logger", async () => {
  const w = world();
  const restore = freeze();
  let getterCalls = 0;
  try {
    const canonical = mapAuditSettings(
      w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get(),
    );
    const preload = {
      settings: canonical,
      actorSnapshotJsonById: new Proxy({}, {
        get() {
          getterCalls += 1;
          throw new Error("never expose this private provider exception");
        },
      }),
    };
    const input = {
      mutationStatements: [sql`SELECT 1`],
      expectedMutationChanges: 0,
      audits: [AUDIT],
      callerQueryCount: 0,
      preloaded: preload,
    };
    const budget = planAtomicAuditMutationBudget(input);
    assert.equal(budget.preparationQueryCount, 1, "invalid actor must pay for a D1 SELECT");
    const [entry] = await prepareAuditLogEntries(w.db, [AUDIT], preload);
    assert.ok(entry);
    assert.equal(w.stats.reads.length, 1);
    assert.deepEqual(JSON.parse(entry.actor_snapshot_json), {
      discord_id: "d-1", discord_name: "Admin",
      x_user_id: "x1", x_name: "XN", icon_url: "https://i/x.png",
    }, "stored actor snapshot comes from actual D1, not the hostile accessor");
    assert.equal(getterCalls, 2, "both exported paths guard their single accessor read");
  } finally {
    restore();
    w.sqlite.close();
  }
});

test("Issue #677: settings preload snapshots descriptors rather than reading Proxy get traps", async () => {
  const w = world();
  const restore = freeze();
  try {
    const canonical = mapAuditSettings(
      w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get(),
    );
    let getCalls = 0;
    const deceptive = new Proxy({ ...canonical }, {
      get(target, property, receiver) {
        if (property === "normal_retention_days") {
          getCalls += 1;
          return 9999; // not the value inspected by property descriptors
        }
        return Reflect.get(target, property, receiver);
      },
    });
    assert.equal(isValidPreloadedAuditSettings(deceptive), true);
    const preload = {
      settings: deceptive,
      actorSnapshotJsonById: { "admin-1": JSON.stringify(actorSnapshotFromRow(null)) },
    };
    const budget = planAtomicAuditMutationBudget({
      mutationStatements: [sql`SELECT 1`],
      expectedMutationChanges: 0,
      audits: [AUDIT],
      callerQueryCount: 0,
      preloaded: preload,
    });
    assert.equal(budget.preparationQueryCount, 0, "descriptor-valid preload can avoid the D1 SELECT");
    const [entry] = await prepareAuditLogEntries(w.db, [AUDIT], preload);
    assert.ok(entry);
    assert.equal(w.stats.reads.length, 0, "runtime and planner agree on zero reads");
    assert.equal(entry.expires_at - entry.created_at, 45 * 86400,
      "audit retention must come from the validated snapshot, not Proxy get");
    assert.equal(getCalls, 0, "no caller-controlled get trap may run after validation");
  } finally {
    restore();
    w.sqlite.close();
  }
});

test("Issue #677: atomic mutation snapshots changing preloads once for budget and runtime", async () => {
  const w = world();
  const restore = freeze();
  try {
    w.sqlite.exec("CREATE TABLE t (id TEXT PRIMARY KEY)");
    const canonical = mapAuditSettings(
      w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get(),
    );
    const actorJson = JSON.stringify(actorSnapshotFromRow(null));
    let descriptorReads = 0;
    let actorGets = 0;
    const settings = new Proxy({ ...canonical }, {
      getOwnPropertyDescriptor(target, key) {
        const desc = Reflect.getOwnPropertyDescriptor(target, key);
        if (key === "normal_retention_days") {
          descriptorReads += 1;
          return { ...desc, value: descriptorReads === 1 ? canonical.normal_retention_days : -1 };
        }
        return desc;
      },
    });
    const actorSnapshotJsonById = new Proxy({ "admin-1": actorJson }, {
      get(target, key, receiver) {
        if (key === "admin-1") {
          actorGets += 1;
          return actorGets === 1 ? actorJson : "{}";
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const audit = { ...AUDIT, after: { id: "race-safe" } };
    const input = {
      mutationStatements: [sql`INSERT INTO t (id) VALUES (${"race-safe"})`],
      expectedMutationChanges: 1,
      audits: [audit],
      callerQueryCount: 46, // would be 52/50 if both invalid second reads were charged
      preloaded: { settings, actorSnapshotJsonById },
    };
    await mutateWithAudit(w.db, input);
    assert.equal(w.stats.reads.length, 0, "no unbudgeted settings or actor SELECT");
    assert.equal(w.stats.batches, 1);
    assert.equal(descriptorReads, 1, "single validated settings descriptor snapshot");
    assert.equal(actorGets, 1, "single validated actor JSON snapshot");
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM t").get().n, 1);
    const stored = w.sqlite.prepare("SELECT * FROM audit_logs").get();
    assert.ok(stored);
    assert.equal(stored.expires_at - stored.created_at, 45 * 86400);
    assert.equal(stored.actor_snapshot_json, actorJson);
  } finally {
    restore();
    w.sqlite.close();
  }
});

test("Issue #677: exotic settings preload is rejected without invoking accessors", async () => {
  const canonical = mapAuditSettings(null);
  const actorSnapshot = JSON.stringify(actorSnapshotFromRow(null));
  let getterCalls = 0;
  const accessor = { ...canonical };
  Object.defineProperty(accessor, "max_payload_bytes", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("sensitive getter must never execute"); },
  });
  const symbolKey = { ...canonical, [Symbol("hidden")]: 123 };
  const hiddenKey = { ...canonical };
  Object.defineProperty(hiddenKey, "secret", { value: "hidden", enumerable: false });
  const inherited = Object.assign(Object.create({ inherited: true }), canonical);
  const hostileProxy = new Proxy({ ...canonical }, {
    ownKeys() { throw new Error("provider private details"); },
  });
  for (const badSettings of [accessor, symbolKey, hiddenKey, inherited, hostileProxy]) {
    const w = world();
    const restore = freeze();
    try {
      assert.equal(isValidPreloadedAuditSettings(badSettings), false);
      const preload = {
        settings: badSettings,
        actorSnapshotJsonById: { "admin-1": actorSnapshot },
      };
      const budget = planAtomicAuditMutationBudget({
        mutationStatements: [sql`SELECT 1`],
        expectedMutationChanges: 0,
        audits: [AUDIT],
        callerQueryCount: 0,
        preloaded: preload,
      });
      assert.equal(budget.preparationQueryCount, 1);
      const [entry] = await prepareAuditLogEntries(w.db, [AUDIT], preload);
      assert.equal(w.stats.reads.length, 1, "authoritative settings D1 SELECT");
      assert.equal(entry.expires_at - entry.created_at, 45 * 86400);
      assert.equal(getterCalls, 0, "never execute a preload property getter");
    } finally {
      restore();
      w.sqlite.close();
    }
  }
});

test("Issue #669: corrupted preload JSON and non-string placeholders never bypass D1", async () => {
  const canonical = actorSnapshotFromRow(null);
  const canonicalJson = JSON.stringify(canonical);
  const duplicateKeyJson = canonicalJson.replace(
    '"discord_id":null', '"discord_id":"forged","discord_id":null',
  );
  // Native JSON.parse treats the duplicate's last value as authoritative.
  // Other JSON consumers can treat the same raw bytes differently.
  assert.deepEqual(JSON.parse(duplicateKeyJson), canonical);
  for (const placeholder of [
    null, false, 42, {}, "", "null", "[]", "{}", "{broken-json",
    JSON.stringify({ ...canonical, extra: "injected" }),
    JSON.stringify({ ...canonical, icon_url: 17 }),
    duplicateKeyJson,
    " " + canonicalJson,
    JSON.stringify({
      icon_url: canonical.icon_url, x_name: canonical.x_name,
      x_user_id: canonical.x_user_id, discord_name: canonical.discord_name,
      discord_id: canonical.discord_id,
    }),
    canonicalJson.replace('"discord_id":null', '"disc\\u006frd_id":null'),
  ]) {
    const w = world();
    const restore = freeze();
    try {
      const settings = mapAuditSettings(
        w.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get(),
      );
      const preload = {
        settings,
        actorSnapshotJsonById: { "admin-1": placeholder },
      };
      const planned = planAtomicAuditMutationBudget({
        mutationStatements: [sql`SELECT 1`],
        expectedMutationChanges: 0,
        audits: [AUDIT],
        callerQueryCount: 0,
        preloaded: preload,
      });
      assert.equal(planned.preparationQueryCount, 1, "the invalid actor cannot earn a D1 credit");
      const [entry] = await prepareAuditLogEntries(w.db, [AUDIT], preload);
      assert.equal(w.stats.reads.length, 1, "the logger must perform the read charged by the planner");
      assert.deepEqual(JSON.parse(entry.actor_snapshot_json), {
        discord_id: "d-1",
        discord_name: "Admin",
        x_user_id: "x1",
        x_name: "XN",
        icon_url: "https://i/x.png",
      });
    } finally {
      restore();
      w.sqlite.close();
    }
  }
});

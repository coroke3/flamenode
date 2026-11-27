// MIG-0516 T01–T03: mutation queue invalidations mark the same atomic build state.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import {
  buildStaticRebuildQueueBatch,
  enqueueStaticRebuild,
  enqueueStaticRebuildMany,
  MAX_STATIC_REBUILD_BATCH_TARGETS,
} from "@flamenode/server-core/staticRebuild/enqueue";
import { asBatchRunnable } from "@flamenode/server-core/audit/mutate";

const FIXED_NOW = 1_800_000_000_000;
function world({ requestedAt = 0, lastHookAt = 0, hasMigration = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE static_rebuild_queue (
      id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      reason TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL, requested_by_user_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX static_rebuild_queue_active
      ON static_rebuild_queue(target_type, target_id)
      WHERE status IN ('pending', 'processing');
  `);
  if (hasMigration) {
    sqlite.exec(`CREATE TABLE public_build_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      requested_at INTEGER NOT NULL DEFAULT 0,
      last_hook_at INTEGER NOT NULL DEFAULT 0
    );`);
    sqlite.prepare("INSERT INTO public_build_state(id, requested_at, last_hook_at) VALUES (1, ?, ?)").run(requestedAt, lastHookAt);
  }
  const stats = { batches: 0, statements: [] };
  const prepare = (query, params = []) => ({
    query, params,
    bind(...values) { return prepare(query, values); },
    async run() {
      const info = sqlite.prepare(query).run(...params);
      return { success: true, meta: { changes: Number(info.changes) } };
    },
    async all() { return { results: sqlite.prepare(query).all(...params) }; },
  });
  const d1 = {
    prepare(query) { return prepare(query); },
    async batch(statements) {
      stats.batches += 1;
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          stats.statements.push({ sql: statement.query, params: statement.params });
          const info = sqlite.prepare(statement.query).run(...statement.params);
          return { success: true, results: [], meta: { changes: Number(info.changes) } };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db: drizzle(d1), sqlite, stats };
}

async function batchAt(world, items, now = FIXED_NOW) {
  const original = Date.now;
  Date.now = () => now;
  try {
    const batch = await buildStaticRebuildQueueBatch(world.db, items);
    if (batch.statements.length > 0) {
      await world.db.batch(batch.statements.map((statement) => asBatchRunnable(world.db, statement)));
    }
    return batch;
  } finally {
    Date.now = original;
  }
}

const item = { targetType: "video", targetId: "v1", reason: "video_update" };

test("T01: public mutation updates requested_at atomically in milliseconds", async () => {
  const w = world();
  try {
    const batch = await batchAt(w, [item]);
    assert.equal(batch.acceptedTargetCount, 1);
    assert.deepEqual(batch.expectedChanges, [1, 1]);
    assert.equal(batch.statements.length, 2);
    assert.equal(w.stats.batches, 1);
    assert.match(w.stats.statements[1].sql, /UPDATE public_build_state/);
    assert.ok(w.stats.statements[1].sql.includes("requested_at = MAX(requested_at + 1, last_hook_at + 1, ?)"));
    assert.deepEqual(w.stats.statements[1].params, [FIXED_NOW]);
    assert.equal(w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at, FIXED_NOW);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 1);
    assert.equal(w.sqlite.prepare("SELECT created_at FROM static_rebuild_queue").get().created_at, FIXED_NOW / 1000);
  } finally { w.sqlite.close(); }
});

test("T02: no public queue invalidation does not mark a build", async () => {
  const w = world({ requestedAt: 123 });
  try {
    const batch = await batchAt(w, []);
    assert.equal(batch.acceptedTargetCount, 0);
    assert.deepEqual(batch.statements, []);
    assert.deepEqual(batch.expectedChanges, []);
    assert.equal(w.stats.batches, 0);
    assert.equal(w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at, 123);
  } finally { w.sqlite.close(); }
});

test("T03: an older enqueue advances even when requested_at is newer than its clock", async () => {
  const w = world({ requestedAt: FIXED_NOW + 10000 });
  try {
    const batch = await batchAt(w, [item], FIXED_NOW);
    assert.deepEqual(batch.expectedChanges, [1, 1]);
    assert.equal(w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at, FIXED_NOW + 10001);
  } finally { w.sqlite.close(); }
});

test("T04: two public mutations in the same millisecond have distinct build generations", async () => {
  const w = world();
  try {
    await batchAt(w, [item], FIXED_NOW);
    const first = w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at;
    await batchAt(w, [item], FIXED_NOW);
    const second = w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at;
    assert.equal(first, FIXED_NOW);
    assert.equal(second, first + 1);
    assert.equal(w.stats.batches, 2, "both mutations commit their atomic queue and marker");
  } finally { w.sqlite.close(); }
});

test("T05: a slow writer must mark after an already claimed build hook", async () => {
  const lastHookAt = FIXED_NOW + 5_000;
  const w = world({ requestedAt: FIXED_NOW - 1000, lastHookAt });
  try {
    await batchAt(w, [item], FIXED_NOW);
    const state = w.sqlite.prepare("SELECT requested_at, last_hook_at FROM public_build_state").get();
    assert.equal(state.requested_at, lastHookAt + 1);
    assert.ok(state.requested_at > state.last_hook_at,
      "requested_at <= last_hook_at would permanently skip this committed change");
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 1);
  } finally { w.sqlite.close(); }
});

test("101 targets use only two queue UPSERT statements plus one build mark", async () => {
  const w = world();
  try {
    const items = Array.from({ length: 101 }, (_, index) => ({
      targetType: "video", targetId: `v${index}`, reason: "test",
    }));
    const batch = await batchAt(w, items);
    assert.equal(batch.statements.length, 3);
    assert.deepEqual(batch.expectedChanges, [100, 1, 1]);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 101);
    assert.equal(w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at, FIXED_NOW);
  } finally { w.sqlite.close(); }
});

test("missing migration 0065 rolls back queue writes (merge requires owner read-only check)", async () => {
  const w = world({ hasMigration: false });
  try {
    await assert.rejects(batchAt(w, [item]), /no such table: public_build_state/);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
  } finally { w.sqlite.close(); }
});


// SEC-782: run the actual exported best-effort entry points, including the
// real auditAction helper. The chain mock counts its DB operations and
// records the audit entry instead of performing a remote write.
function enqueueFailureDb({ error, failAudit = false, failEnqueue = true }) {
  const calls = { queueReads: 0, auditReads: 0, queueWrites: 0, audits: [] };
  const db = {
    select() {
      const query = {
        from() { return query; },
        leftJoin() { return query; },
        where() { return query; },
        async limit() {
          calls.queueReads++;
          if (failEnqueue) throw error;
          return [];
        },
        async get() { calls.auditReads++; return undefined; },
      };
      return query;
    },
    insert() {
      return {
        values(value) {
          if (value.table_name === "static_rebuild_queue") {
            calls.audits.push(value);
            return failAudit ? Promise.reject(error) : Promise.resolve();
          }
          return {
            async onConflictDoNothing() {
              calls.queueWrites++;
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

function poisonProviderError() {
  let reads = 0;
  const error = new Error("PROVIDER_SECRET_CANARY");
  for (const key of ["name", "message", "cause", "stack", "toString"]) {
    Object.defineProperty(error, key, {
      configurable: true,
      get() { reads++; throw new Error("PROVIDER_GETTER_CANARY"); },
    });
  }
  return { error, readCount: () => reads };
}

function recordWarnings(t, { throwing = false } = {}) {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => {
    warnings.push(args);
    if (throwing) throw new Error("diagnostic sink unavailable");
  });
  return warnings;
}

function wakeFixture() {
  const sent = [];
  const sentKinds = new Set();
  let loads = 0;
  return {
    sent, sentKinds, loadCount: () => loads,
    options: {
      sentKinds,
      envFlags: { QUEUE_DISPATCH_ENABLED: "1" },
      queue: { async send(message) { sent.push(message); } },
    },
    async loadHost() {
      loads++;
      return {
        readEnv: () => null,
        readWaitUntil: () => null,
        readKv: () => null,
      };
    },
  };
}

test("SEC-782: single enqueue audits a fixed failure even when diagnostics throw", async (t) => {
  const poisoned = poisonProviderError();
  const { db, calls } = enqueueFailureDb({ error: poisoned.error });
  const warnings = recordWarnings(t, { throwing: true });
  const wake = wakeFixture();
  const target = { ...item, reason: "REASON_PRIVATE_CANARY", requestedByUserId: "actor-1" };

  await enqueueStaticRebuild(db, target, wake.options, wake.loadHost);

  assert.equal(poisoned.readCount(), 0);
  assert.deepEqual(warnings, [["[static-rebuild]", "enqueue_failed"]]);
  assert.equal(calls.queueReads, 1);
  assert.equal(calls.auditReads, 2);
  assert.equal(calls.queueWrites, 0);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].table_name, "static_rebuild_queue");
  assert.equal(calls.audits[0].target_id, "video:v1");
  assert.equal(calls.audits[0].actor_user_id, "actor-1");
  assert.equal(calls.audits[0].operation, "UPDATE");
  assert.equal(calls.audits[0].retention_class, "normal");
  assert.deepEqual(JSON.parse(calls.audits[0].after_json), { error: "enqueue_failed" });
  assert.equal(wake.loadCount(), 0);
  assert.equal(wake.sentKinds.size, 0);
});

test("SEC-782: failed audit insert and failed logger cannot reject single enqueue", async (t) => {
  const poisoned = poisonProviderError();
  const { db, calls } = enqueueFailureDb({ error: poisoned.error, failAudit: true });
  const warnings = recordWarnings(t, { throwing: true });
  const wake = wakeFixture();

  await enqueueStaticRebuild(db, item, wake.options, wake.loadHost);

  assert.equal(poisoned.readCount(), 0);
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.auditReads, 2);
  assert.deepEqual(warnings, [
    ["[static-rebuild]", "enqueue_failed"],
    ["[static-rebuild]", "history_log_failed"],
  ]);
  assert.equal(wake.loadCount(), 0);
  assert.equal(wake.sentKinds.size, 0);
});

test("SEC-782: bulk D1 exception and oversized plan are fail-soft with a throwing logger", async (t) => {
  const poisoned = poisonProviderError();
  const warnings = recordWarnings(t, { throwing: true });
  const wake = wakeFixture();
  let batchCalls = 0;
  let planned = 0;
  const db = {
    run() { planned++; return { _prepare() {} }; },
    async batch() { batchCalls++; throw poisoned.error; },
  };
  await enqueueStaticRebuildMany(db, [item], wake.options, wake.loadHost);
  assert.equal(planned, 2, "one queue UPSERT and one build mark");
  assert.equal(batchCalls, 1);

  const oversized = Array.from({ length: MAX_STATIC_REBUILD_BATCH_TARGETS + 1 }, (_, n) => ({
    ...item, targetId: `too-many-${n}`,
  }));
  await enqueueStaticRebuildMany(db, oversized, wake.options, wake.loadHost);
  assert.equal(planned, 2, "overflow must fail before any additional statement");
  assert.equal(batchCalls, 1);
  assert.equal(poisoned.readCount(), 0);
  assert.deepEqual(warnings, [
    ["[static-rebuild]", "bulk_enqueue_failed"],
    ["[static-rebuild]", "bulk_enqueue_failed"],
  ]);
  assert.equal(wake.loadCount(), 0);
  assert.equal(wake.sentKinds.size, 0);
});

test("SEC-782: successful single and bulk enqueue preserve wake dedupe and atomic marker", async (t) => {
  const warnings = recordWarnings(t);
  const { db, calls } = enqueueFailureDb({ failEnqueue: false });
  const wake = wakeFixture();
  await enqueueStaticRebuild(db, item, wake.options, wake.loadHost);
  assert.equal(calls.queueReads, 1);
  assert.equal(calls.queueWrites, 1);
  assert.equal(calls.auditReads, 0);
  assert.equal(calls.audits.length, 0);

  const w = world();
  try {
    await enqueueStaticRebuildMany(w.db, [item], wake.options, wake.loadHost);
    assert.equal(w.stats.batches, 1);
    assert.equal(w.stats.statements.length, 2);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 1);
    assert.ok(w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at > 0);
    assert.equal(wake.sent.length, 1);
    assert.equal(wake.sent[0].kind, "static_rebuild_available");
    assert.deepEqual([...wake.sentKinds], ["static_rebuild_available"]);
    assert.deepEqual(warnings, []);
  } finally { w.sqlite.close(); }
});

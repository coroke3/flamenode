// MIG-0516 T01–T03: mutation queue invalidations mark the same atomic build state.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { asBatchRunnable } from "@flamenode/server-core/audit/mutate";

const FIXED_NOW = 1_800_000_000_000;
function world({ requestedAt = 0, hasMigration = true } = {}) {
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
      requested_at INTEGER NOT NULL DEFAULT 0
    );`);
    sqlite.prepare("INSERT INTO public_build_state(id, requested_at) VALUES (1, ?)").run(requestedAt);
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
    assert.match(w.stats.statements[1].sql, /requested_at = MAX\(requested_at, \?\)/);
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

test("T03: an older enqueue never moves requested_at backwards", async () => {
  const w = world({ requestedAt: FIXED_NOW + 10000 });
  try {
    const batch = await batchAt(w, [item], FIXED_NOW);
    assert.deepEqual(batch.expectedChanges, [1, 1]);
    assert.equal(w.sqlite.prepare("SELECT requested_at FROM public_build_state").get().requested_at, FIXED_NOW + 10000);
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

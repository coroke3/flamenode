// MIG-0650 U03bg: real SQLite-backed atomic D1 adapter boundary tests.
// This is an UNMOUNTED candidate: no HTTP route or production D1 binding.
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import * as schema from "@flamenode/db/schema";
import { mapAuditSettings } from "../src/audit/settings.ts";
import { inspectVideoAtomicWritePlanBudget } from "../src/video/videoAtomicBudget.ts";
import { buildStaticRebuildQueueBatch } from "../src/staticRebuild/enqueue.ts";
import {
  executeAdminMemberAtomicCandidate,
} from "../src/video/adminMemberAtomicExecute.ts";

const migrations = new URL("../../../migrations/", import.meta.url);
function world() {
  const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  for (const file of fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    sqlite.exec(fs.readFileSync(new URL(file, migrations), "utf8"));
  }
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec("CREATE TABLE sa085_atomic_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const stats = { batches: 0, reads: 0 };
  const run = (text, params) => sqlite.prepare(text).all(...params).map(row => ({ ...row }));
  const statement = (text, params) => ({
    __sql: text,
    __params: params,
    bind: (...values) => statement(text, values),
    async first() { stats.reads++; return run(text, params)[0] ?? null; },
    async all() { stats.reads++; return { results: run(text, params) }; },
    async run() { return { results: run(text, params), success: true, meta: { changes: 0 } }; },
    async raw() {
      stats.reads++;
      const prepared = sqlite.prepare(text);
      prepared.setReturnArrays(true);
      try { return prepared.all(...params).map(row => [...row]); }
      finally { prepared.setReturnArrays(false); }
    },
  });
  const d1 = {
    prepare: text => statement(text, []),
    async batch(statements) {
      stats.batches++;
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(stmt => ({ results: run(stmt.__sql, stmt.__params) }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const db = drizzle(d1, { schema });
  const settingsRow = sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get();
  const preloaded = {
    settings: mapAuditSettings(settingsRow),
    actorSnapshotJsonById: {
      "admin-1": JSON.stringify({
        discord_id: null, discord_name: null, x_user_id: null,
        x_name: null, icon_url: null,
      }),
    },
  };
  return { sqlite, stats, db, preloaded };
}

const count = (sqlite, table) =>
  sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;

async function input(world, { wrongCount = false, queue = true } = {}) {
  const statement = world.db.run(sql`
    INSERT INTO sa085_atomic_probe (id, value) VALUES (${"video-1"}, ${"saved"})
  `);
  const targets = queue
    ? [{
        targetType: "video", targetId: "video-1",
        reason: "video_members_update", requestedByUserId: "admin-1",
      }]
    : [];
  const queuePlan = await buildStaticRebuildQueueBatch(world.db, targets);
  const audit = {
    table_name: "video_members_set",
    target_id: "video-1", operation: "MERGE",
    actor_user_id: "admin-1", strict: true,
    before: { id: "video-1", rows: [] },
    after: { id: "video-1", rows: [] },
  };
  const plan = {
    statements: [statement, ...queuePlan.statements],
    expectedChanges: [wrongCount ? 2 : 1, ...queuePlan.expectedChanges],
    audits: [audit],
  };
  return {
    assembly: {
      plan, queue: queuePlan, targets, noOp: false,
      budget: inspectVideoAtomicWritePlanBudget(plan),
    },
    videoId: "video-1", actorUserId: "admin-1",
    callerQueryCount: 3, preloaded: world.preloaded,
  };
}

const disabledWake = () => ({
  readEnv: () => null,
  readWaitUntil: () => null,
  readKv: () => null,
});

test("MIG-0650 U03bg commits mutation, strict audit and durable Queue in one D1 batch", async () => {
  const w = world();
  try {
    const planned = await input(w);
    let wakeLoaderCalls = 0;
    const readsBefore = w.stats.reads;
    const result = await executeAdminMemberAtomicCandidate(w.db, planned, async () => {
      wakeLoaderCalls++;
      assert.equal(count(w.sqlite, "sa085_atomic_probe"), 1,
        "postcommit wake lookup observes committed mutation");
      assert.equal(count(w.sqlite, "audit_logs"), 1,
        "strict audit is committed before wake lookup");
      assert.equal(count(w.sqlite, "static_rebuild_queue"), 1,
        "durable rebuild row exists before wake lookup");
      return disabledWake();
    });
    assert.equal(result.committed, true);
    assert.equal(result.auditIds.length, 1);
    assert.equal(w.stats.batches, 1);
    assert.equal(w.stats.reads - readsBefore, 0,
      "valid preloaded settings/actor require no extra preparation D1 read");
    assert.equal(wakeLoaderCalls, 1);
    assert.equal(w.sqlite.prepare(
      "SELECT value FROM sa085_atomic_probe WHERE id = 'video-1'"
    ).get().value, "saved");
  } finally { w.sqlite.close(); }
});

test("MIG-0650 U03bg wrong member changes() assertion rolls back mutation, audit and Queue", async () => {
  const w = world();
  try {
    const planned = await input(w, { wrongCount: true });
    let wakeLoaderCalls = 0;
    await assert.rejects(
      executeAdminMemberAtomicCandidate(w.db, planned, async () => {
        wakeLoaderCalls++; return disabledWake();
      }),
    );
    assert.equal(w.stats.batches, 1);
    assert.equal(count(w.sqlite, "sa085_atomic_probe"), 0);
    assert.equal(count(w.sqlite, "static_rebuild_queue"), 0);
    assert.equal(count(w.sqlite, "audit_logs"), 0);
    assert.equal(wakeLoaderCalls, 0, "no postcommit wake after rollback");
  } finally { w.sqlite.close(); }
});

test("MIG-0650 U03bg failed strict audit INSERT rolls back previously built Queue and member mutations", async () => {
  const w = world();
  try {
    const planned = await input(w);
    w.sqlite.exec("DROP TABLE audit_logs"); // faults at the audit write, after mutation + Queue
    let wakeLoaderCalls = 0;
    await assert.rejects(
      executeAdminMemberAtomicCandidate(w.db, planned, async () => {
        wakeLoaderCalls++; return disabledWake();
      }),
    );
    assert.equal(w.stats.batches, 1);
    assert.equal(count(w.sqlite, "sa085_atomic_probe"), 0);
    assert.equal(count(w.sqlite, "static_rebuild_queue"), 0);
    assert.equal(wakeLoaderCalls, 0);
  } finally { w.sqlite.close(); }
});

test("MIG-0650 U03bg missing mandatory Queue wake host rejects before any D1 write", async () => {
  const w = world();
  try {
    const planned = await input(w);
    await assert.rejects(
      executeAdminMemberAtomicCandidate(w.db, planned),
      { name: "RangeError", message: "video_admin_member_atomic_execution_invalid" },
    );
    assert.equal(w.stats.batches, 0);
    assert.equal(count(w.sqlite, "sa085_atomic_probe"), 0);
    assert.equal(count(w.sqlite, "static_rebuild_queue"), 0);
  } finally { w.sqlite.close(); }
});

test("MIG-0650 U03bg no-Queue strict audit mutation executes without a wake port", async () => {
  const w = world();
  try {
    const planned = await input(w, { queue: false });
    const result = await executeAdminMemberAtomicCandidate(w.db, planned);
    assert.equal(result.committed, true);
    assert.equal(result.auditIds.length, 1);
    assert.equal(w.stats.batches, 1);
    assert.equal(count(w.sqlite, "sa085_atomic_probe"), 1);
    assert.equal(count(w.sqlite, "audit_logs"), 1);
    assert.equal(count(w.sqlite, "static_rebuild_queue"), 0);
  } finally { w.sqlite.close(); }
});

test("MIG-0650 U03bh failed postcommit wake-host loader preserves durable committed save", async () => {
  const w = world();
  try {
    const planned = await input(w);
    let loaderCalls = 0;
    const result = await executeAdminMemberAtomicCandidate(w.db, planned, async () => {
      loaderCalls++;
      assert.equal(count(w.sqlite, "sa085_atomic_probe"), 1);
      assert.equal(count(w.sqlite, "static_rebuild_queue"), 1);
      throw Error("missing optional Queue wake binding");
    });
    assert.equal(result.committed, true, "already committed mutation cannot become a false 500");
    assert.equal(result.auditIds.length, 1);
    assert.equal(w.stats.batches, 1);
    assert.equal(loaderCalls, 1);
    assert.equal(count(w.sqlite, "sa085_atomic_probe"), 1);
    assert.equal(count(w.sqlite, "audit_logs"), 1);
    assert.equal(count(w.sqlite, "static_rebuild_queue"), 1);
  } finally { w.sqlite.close(); }
});

test("MIG-0650 U03bh duplicate member insert rolls back the retry without a second audit or wake", async () => {
  const w = world();
  try {
    const first = await input(w);
    const saved = await executeAdminMemberAtomicCandidate(w.db, first, async () => disabledWake());
    assert.equal(saved.committed, true);
    const again = await input(w);
    let retryWake = 0;
    await assert.rejects(
      executeAdminMemberAtomicCandidate(w.db, again, async () => {
        retryWake++; return disabledWake();
      }),
    );
    assert.equal(w.stats.batches, 2);
    assert.equal(retryWake, 0);
    assert.equal(count(w.sqlite, "sa085_atomic_probe"), 1);
    assert.equal(count(w.sqlite, "audit_logs"), 1,
      "a retried duplicate cannot append an audit for a save that rolled back");
    assert.equal(count(w.sqlite, "static_rebuild_queue"), 1);
  } finally { w.sqlite.close(); }
});

test("MIG-0650 U03bh failed durable Queue statement rolls back member mutation with no strict audit", async () => {
  const w = world();
  try {
    const planned = await input(w);
    // The Queue JSON1 statement is built, but its table disappears before
    // execution. D1's one transaction must roll the preceding member INSERT back.
    w.sqlite.exec("DROP TABLE static_rebuild_queue");
    let wakeCalls = 0;
    await assert.rejects(
      executeAdminMemberAtomicCandidate(w.db, planned, async () => {
        wakeCalls++; return disabledWake();
      }),
    );
    assert.equal(w.stats.batches, 1);
    assert.equal(count(w.sqlite, "sa085_atomic_probe"), 0);
    assert.equal(count(w.sqlite, "audit_logs"), 0);
    assert.equal(wakeCalls, 0);
  } finally { w.sqlite.close(); }
});

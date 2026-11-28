import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import * as schema from "@flamenode/db/schema";
import { buildFreeVideoSoftwareInsertPlan } from "../src/video/freeVideoSoftwareInsertPlan.ts";
import { buildFreeVideoSoftwareInsertPlan as exportedSoftwarePlan } from "@flamenode/server-core/video/unslottedEventPlans";
import { MAX_ATOMIC_VIDEO_SOFTWARES } from "@flamenode/domain/video/atomicLimits";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

test("MIG-0651 software: public server-core entry preserves exact plan implementation", () => {
  assert.strictEqual(exportedSoftwarePlan, buildFreeVideoSoftwareInsertPlan);
});

const NOW = 1770000000;
function liveDb(sqlite, stats) {
  const db = drizzle(async (query, values, method) => {
    stats.reads += 1;
    stats.lastSql = query;
    stats.lastValues = values;
    const rows = sqlite.prepare(query).all(...values);
    return { rows: method === "all" || method === "values"
      ? rows.map((row) => Object.values(row)) : rows };
  }, { schema });
  // db.run(sql) is not an eager D1 read: the returned assertion is prepared
  // and must be executed by the future single audited batch.
  return {
    select: (...args) => db.select(...args),
    insert: (...args) => db.insert(...args),
    run(expr) { return { sqlExpr: expr }; },
  };
}
const dialect = new SQLiteSyncDialect();
function compiled(statement) {
  return "sqlExpr" in statement
    ? dialect.sqlToQuery(statement.sqlExpr) : statement.toSQL();
}
function executeGuard(sqlite, plan) {
  assert.equal(plan.expectedChanges[0], null, "first statement must be policy CAS");
  const q = compiled(plan.statements[0]);
  assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
  const result = sqlite.prepare(q.sql).get(...q.params);
  assert.equal(Object.values(result)[0], 1, "current software selection matches preflight");
}

test("MIG-0651 software: empty input has no read/write; >4 labels fail before D1", async () => {
  const noDb = {
    select() { throw Error("no D1 reads allowed"); },
    insert() { throw Error("no D1 inserts allowed"); },
  };
  const empty = await buildFreeVideoSoftwareInsertPlan(noDb, {
    videoId: "v", actorUserId: "u", raw: null, now: NOW,
  });
  assert.deepEqual(empty, { statements: [], expectedChanges: [], audits: [] });
  assert.equal(MAX_ATOMIC_VIDEO_SOFTWARES, 4);
  await assert.rejects(() => buildFreeVideoSoftwareInsertPlan(noDb, {
    videoId: "v", actorUserId: "u", raw: "a,b,c,d,e", now: NOW,
  }), /video_software_atomic_limit_exceeded/);
  await assert.rejects(() => buildFreeVideoSoftwareInsertPlan(noDb, {
    videoId: "", actorUserId: "u", raw: "a", now: NOW,
  }), /free_video_software_arguments_invalid/);
});

test("MIG-0651 software: migrated SQLite resolves active alias before catalog name and audits only actual 3 links", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "software_catalog", {
      id: "sw_blender", name: "Blender", normalized_name: "blender",
      is_active: 1, is_verified: 1, usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    insert(sqlite, "software_catalog", {
      id: "sw_ae", name: "After Effects", normalized_name: "after effects",
      is_active: 1, is_verified: 0, usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    insert(sqlite, "software_aliases", {
      software_id: "sw_blender", alias: "B3D", normalized_alias: "b3d",
    });
    // One submitted value matches both a direct name and a different alias.
    // CURRENT's alias-first rule must keep using sw_blender.
    insert(sqlite, "software_catalog", {
      id: "sw_b3d_shadow", name: "B3D", normalized_name: "b3d",
      is_active: 1, is_verified: 1, usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    insert(sqlite, "videos", {
      id: "v-software", submitted_by_user_id: "u", creator_display_name: "Example",
      title: "Example", youtube_video_id: "dQw4w9WgXcQ", visibility_status: "public",
    });
    const stats = { reads: 0 };
    const db = liveDb(sqlite, stats);
    const plan = await buildFreeVideoSoftwareInsertPlan(db, {
      videoId: "v-software", actorUserId: "u",
      raw: "B3D, Blender, After Effects, New Tool", now: NOW,
    });
    assert.equal(stats.reads, 1, "alias and direct names resolve in one bounded JOIN read");
    const planner = sqlite.prepare("EXPLAIN QUERY PLAN " + stats.lastSql)
      .all(...stats.lastValues).map(row => row.detail);
    assert.ok(planner.some(detail => detail.includes("software_catalog_norm_uniq")),
      "name search must use the existing normalized catalog index");
    assert.ok(planner.some(detail => detail.includes("software_aliases_global_alias_uniq")),
      "alias search must use the existing normalized alias index");
    assert.ok(!planner.some(detail => detail.startsWith("SCAN software_catalog")),
      "the one-query optimization must NOT scan every catalog row");
    assert.deepEqual(plan.expectedChanges, [null, 1, 3], "CAS, one new catalog, three unique links");
    assert.deepEqual(plan.audits.map((a) => [a.table_name, a.operation, a.strict]), [
      ["software_catalog", "CREATE", true],
      ["video_softwares", "CREATE", true],
      ["video_softwares", "CREATE", true],
      ["video_softwares", "CREATE", true],
    ]);
    assert.equal(new Set(plan.audits.map((a) => a.target_id)).size, 4);
    assert.ok(plan.audits.every((a) => a.actor_user_id === "u"));
    sqlite.exec("BEGIN");
    try {
      for (const [i, stmt] of plan.statements.entries()) {
        const q = compiled(stmt);
        assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
        if (plan.expectedChanges[i] === null) {
          const result = sqlite.prepare(q.sql).get(...q.params);
          assert.equal(Object.values(result)[0], 1);
        } else {
          const result = sqlite.prepare(q.sql).run(...q.params);
          assert.equal(Number(result.changes), plan.expectedChanges[i]);
        }
      }
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    const rows = sqlite.prepare(
      "SELECT c.normalized_name AS name, vs.raw_label AS raw, vs.software_id AS id " +
      "FROM video_softwares AS vs JOIN software_catalog AS c ON c.id=vs.software_id " +
      "WHERE vs.video_id=? ORDER BY vs.raw_label",
    ).all("v-software");
    assert.deepEqual(rows.map((r) => r.raw), ["After Effects", "B3D", "New Tool"]);
    assert.deepEqual(rows.map((r) => r.id), ["sw_ae", "sw_blender",
      plan.audits[0].target_id]);
    assert.equal(sqlite.prepare(
      "SELECT COUNT(*) AS count FROM software_catalog WHERE normalized_name='new tool'",
    ).get().count, 1);
  } finally { sqlite.close(); }
});

test("MIG-0651 software: inactive alias target is ignored by one-query lookup", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "software_catalog", {
      id: "sw_inactive", name: "Retired Studio", normalized_name: "retired studio",
      is_active: 0, usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    insert(sqlite, "software_aliases", {
      software_id: "sw_inactive", alias: "Fresh Alias", normalized_alias: "freshalias",
    });
    const stats = { reads: 0 };
    const plan = await buildFreeVideoSoftwareInsertPlan(liveDb(sqlite, stats), {
      videoId: "v-new", actorUserId: "u", raw: "Fresh Alias", now: NOW,
    });
    assert.equal(stats.reads, 1, "inactive alias must not trigger a follow-up query");
    assert.deepEqual(plan.expectedChanges, [null, 1, 1],
      "unknown active software name creates its own catalog row");
    assert.equal(plan.audits[0].after.normalized_name, "fresh alias");
    assert.notEqual(plan.audits[1].after.software_id, "sw_inactive");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_softwares").get().n, 0,
      "pure builder must not write anything");
  } finally { sqlite.close(); }
});

test("MIG-0651 software: in-batch CAS prevents alias retarget after bounded pre-read", async () => {
  const sqlite = createSqlite();
  try {
    for (const id of ["original", "other"]) {
      insert(sqlite, "software_catalog", {
        id, name: id, normalized_name: id, is_active: 1, is_verified: 0,
        usage_count: 0, created_at: NOW, updated_at: NOW,
      });
    }
    insert(sqlite, "software_aliases", {
      software_id: "original", alias: "Best Editor", normalized_alias: "besteditor",
    });
    const stats = { reads: 0 };
    const plan = await buildFreeVideoSoftwareInsertPlan(liveDb(sqlite, stats), {
      videoId: "v", actorUserId: "u", raw: "Best Editor", now: NOW,
    });
    assert.equal(stats.reads, 1);
    assert.deepEqual(plan.expectedChanges, [null, 1]);
    assert.equal(plan.audits[0].after.software_id, "original");
    executeGuard(sqlite, plan);
    sqlite.prepare("UPDATE software_aliases SET software_id='other' WHERE normalized_alias='besteditor'").run();
    assert.throws(() => executeGuard(sqlite, plan), /malformed JSON/,
      "stale pre-read must not link to original after alias retarget");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_softwares").get().n, 0);
  } finally { sqlite.close(); }
});

test("MIG-0651 software: in-batch CAS rejects active catalog deactivation and fresh-name arrival", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "software_catalog", {
      id: "old", name: "Old", normalized_name: "old", is_active: 1,
      usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    const stats = { reads: 0 };
    const db = liveDb(sqlite, stats);
    const oldPlan = await buildFreeVideoSoftwareInsertPlan(db, {
      videoId: "v", actorUserId: "u", raw: "Old", now: NOW,
    });
    assert.deepEqual(oldPlan.expectedChanges, [null, 1]);
    executeGuard(sqlite, oldPlan);
    sqlite.prepare("UPDATE software_catalog SET is_active=0 WHERE id='old'").run();
    assert.throws(() => executeGuard(sqlite, oldPlan), /malformed JSON/,
      "deactivated catalog cannot be silently used from stale snapshot");

    const freshPlan = await buildFreeVideoSoftwareInsertPlan(db, {
      videoId: "v", actorUserId: "u", raw: "Fresh", now: NOW,
    });
    assert.deepEqual(freshPlan.expectedChanges, [null, 1, 1]);
    executeGuard(sqlite, freshPlan);
    insert(sqlite, "software_catalog", {
      id: "racer", name: "Fresh", normalized_name: "fresh", is_active: 1,
      usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    assert.throws(() => executeGuard(sqlite, freshPlan), /malformed JSON/,
      "fresh direct catalog name must not invalidate a pending CREATE audit");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_softwares").get().n, 0);
  } finally { sqlite.close(); }
});

test("MIG-0651 software: unique catalog collision fails whole SQLite transaction", async () => {
  const sqlite = createSqlite();
  try {
    const stats = { reads: 0 };
    const db = liveDb(sqlite, stats);
    const plan = await buildFreeVideoSoftwareInsertPlan(db, {
      videoId: "v-new", actorUserId: "u", raw: "Collision Tool", now: NOW,
    });
    assert.deepEqual(plan.expectedChanges, [null, 1, 1]);
    insert(sqlite, "software_catalog", {
      id: "sw-racer", name: "Collision Tool", normalized_name: "collision tool",
      is_active: 1, is_verified: 0, usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    sqlite.exec("BEGIN");
    insert(sqlite, "videos", {
      id: "v-new", submitted_by_user_id: "u", creator_display_name: "Example",
      title: "Example", youtube_video_id: "dQw4w9WgXcQ", visibility_status: "public",
    });
    assert.throws(() => {
      for (const stmt of plan.statements) {
        const q = compiled(stmt);
        if ("sqlExpr" in stmt) sqlite.prepare(q.sql).get(...q.params);
        else sqlite.prepare(q.sql).run(...q.params);
      }
    }, /malformed JSON|UNIQUE|constraint/i,
    "new catalog name collision must fail the entire write batch");
    sqlite.exec("ROLLBACK");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0);
    assert.deepEqual(sqlite.prepare("SELECT id FROM software_catalog").all().map((r) => r.id),
      ["sw-racer"], "the pre-existing racing catalog remains but uncommitted rows disappear");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_softwares").get().n, 0);
  } finally { sqlite.close(); }
});

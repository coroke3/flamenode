import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
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
  return drizzle(async (query, values, method) => {
    stats.reads += 1;
    const rows = sqlite.prepare(query).all(...values);
    return { rows: method === "all" || method === "values"
      ? rows.map((row) => Object.values(row)) : rows };
  }, { schema });
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
    assert.equal(stats.reads, 3, "alias, direct and alias target catalog each use one bounded read");
    assert.deepEqual(plan.expectedChanges, [1, 3], "one new catalog and three unique links");
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
        const q = stmt.toSQL();
        assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
        const result = sqlite.prepare(q.sql).run(...q.params);
        assert.equal(Number(result.changes), plan.expectedChanges[i]);
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

test("MIG-0651 software: unique catalog collision fails whole SQLite transaction", async () => {
  const sqlite = createSqlite();
  try {
    const stats = { reads: 0 };
    const db = liveDb(sqlite, stats);
    const plan = await buildFreeVideoSoftwareInsertPlan(db, {
      videoId: "v-new", actorUserId: "u", raw: "Collision Tool", now: NOW,
    });
    assert.deepEqual(plan.expectedChanges, [1, 1]);
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
        const q = stmt.toSQL();
        sqlite.prepare(q.sql).run(...q.params);
      }
    }, /UNIQUE|constraint/i);
    sqlite.exec("ROLLBACK");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0);
    assert.deepEqual(sqlite.prepare("SELECT id FROM software_catalog").all(),
      [{ id: "sw-racer" }]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_softwares").get().n, 0);
  } finally { sqlite.close(); }
});

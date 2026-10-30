import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { staticRebuildAdminRoutes } from "../src/routes/admin/staticRebuild.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";
import { AdminStaticRebuildResultSchema } from "@flamenode/contracts/admin/staticRebuildOps";

const ADMIN = { id: "admin-1", role: "admin", name: "Admin", is_banned: 0 };

function setup({ beforeBatch } = {}) {
  const fixture = createAdminD1();
  seedBase(fixture.sqlite);
  fixture.sqlite.exec(`
    ALTER TABLE static_rebuild_queue ADD COLUMN processing_started_at INTEGER;
    ALTER TABLE static_rebuild_queue ADD COLUMN lease_token TEXT;
    ALTER TABLE static_rebuild_queue ADD COLUMN lease_expires_at INTEGER;
    ALTER TABLE static_rebuild_queue ADD COLUMN processed_at INTEGER;
    ALTER TABLE static_rebuild_queue ADD COLUMN next_retry_at INTEGER;
    ALTER TABLE static_rebuild_queue ADD COLUMN error TEXT;
  `);
  const db = beforeBatch
    ? { ...fixture.db, batch: async (items) => {
        beforeBatch(fixture.sqlite);
        return fixture.db.batch(items);
      } }
    : fixture.db;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", ADMIN);
    c.set("db", drizzle(db, { schema }));
    c.set("actorSnapshotJsonById", { [ADMIN.id]: "{}" });
    await next();
  });
  app.route("/api/admin/static-builds", staticRebuildAdminRoutes);
  const request = (path, body, headers = {}) => app.request(
    "/api/admin/static-builds" + path,
    { method: "POST", headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) },
    { DB: db },
  );
  const rows = () => fixture.sqlite.prepare(
    "SELECT * FROM static_rebuild_queue ORDER BY created_at,id",
  ).all();
  const audits = () => fixture.sqlite.prepare(
    "SELECT * FROM audit_logs ORDER BY created_at,id",
  ).all();
  const seed = (id, status = "failed", updated = 100) => fixture.sqlite.prepare(`
    INSERT INTO static_rebuild_queue (
      id, target_type, target_id, reason, priority, status, attempt_count,
      requested_by_user_id, created_at, updated_at, processing_started_at,
      lease_token, lease_expires_at, processed_at, next_retry_at, error
    ) VALUES (?, 'video', ?, 'old', 'normal', ?, 2, 'admin-1', ?, ?, null, 'stale', ?, null, ?, 'failed')`
  ).run(id, id, status, updated, updated, updated + 10, updated + 100);
  return { ...fixture, request, rows, audits, seed };
}

test("MIG-0643 U02 SA-071: invalid target, malformed body, >64KB body fail closed", async () => {
  const s = setup();
  for (const body of [{ target_type: "wrong", target_id: "x" }, { target_type: "video", target_id: "" }, { target_type: "video", target_id: "x".repeat(129) }]) {
    const r = await s.request("/rebuild", body);
    assert.equal(r.status, 400);
  }
  const tooLarge = await s.request("/rebuild", { target_type: "video", target_id: "x", extra: "x".repeat(65536) });
  assert.equal(tooLarge.status, 413);
  assert.equal(s.stats.batches, 0);
  assert.equal(s.audits().length, 0);
});

test("MIG-0643 U02 SA-071: manual queue enqueue/strict audit with zero extra D1 reads", async () => {
  const s = setup();
  const res = await s.request("/rebuild", { target_type: "video", target_id: "vid-1" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, queued: 1 });
  const rows = s.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_type, "video");
  assert.equal(rows[0].target_id, "vid-1");
  assert.equal(rows[0].reason, "manual_rebuild");
  assert.equal(rows[0].priority, "high");
  assert.equal(rows[0].status, "pending");
  assert.equal(s.stats.reads, 1, "CostGuard is the only pre-read in isolated Hono");
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audits().length, 1);
  assert.equal(s.audits()[0].context, "admin_static_rebuild_enqueue");
  assert.equal(s.audits()[0].target_id, "manual:video:vid-1");
  assert.equal(AdminStaticRebuildResultSchema.safeParse({ ok: true, queued: 1 }).success, true);
});

test("MIG-0643 U02 SA-072: two shared-input rebuilds in one D1 batch and one strict audit", async () => {
  const s = setup();
  const res = await s.request("/shared-inputs/rebuild");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, queued: 2 });
  const rows = s.rows();
  assert.deepEqual(rows.map(r => r.target_type).sort(), ["random_video_pool", "youtube_related_blocklist"]);
  assert.equal(rows.every(r => r.target_id === "global" && r.status === "pending"), true);
  assert.equal(s.stats.reads, 1);
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audits().length, 1);
  assert.deepEqual(JSON.parse(s.audits()[0].after_json).targets,
    ["youtube_related_blocklist", "random_video_pool"]);
});

test("MIG-0643 U02 SA-070: failed row CAS retry resets only exact CURRENT patch fields", async () => {
  const s = setup();
  s.seed("q1", "failed", 100);
  const before = { ...s.rows()[0] };
  const res = await s.request("/queue/q1/retry");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, retried: 1 });
  const after = { ...s.rows()[0] };
  assert.deepEqual(
    { ...after, status: "failed", priority: "normal", error: "failed",
      lease_token: "stale", lease_expires_at: 110, next_retry_at: 200,
      updated_at: 100 },
    before,
  );
  assert.equal(after.status, "pending");
  assert.equal(after.priority, "high");
  assert.equal(after.error, null);
  assert.equal(after.lease_token, null);
  assert.equal(after.next_retry_at, null);
  assert.equal(s.stats.batches, 1);
  assert.equal(s.stats.reads, 2);
  const audit = s.audits()[0];
  assert.deepEqual(JSON.parse(audit.before_json), before);
  assert.deepEqual(JSON.parse(audit.after_json), after);
});

test("MIG-0643 U02 SA-070: absent, non-failed, bad ID are no-op", async () => {
  const s = setup();
  s.seed("q-done", "done");
  for (const [path, status] of [
    ["/queue/q-done/retry", 200], ["/queue/missing/retry", 200],
    ["/queue/" + "x".repeat(129) + "/retry", 400],
  ]) {
    assert.equal((await s.request(path)).status, status);
  }
  assert.equal(s.stats.batches, 0);
  assert.equal(s.audits().length, 0);
});

test("MIG-0643 U02 SA-073: max eight failed rows in one batch with per-row audit", async () => {
  const s = setup();
  for (let i = 0; i < 10; i++) s.seed("q" + i, "failed", 100 + i);
  const res = await s.request("/retry-failed");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, retried: 8 });
  assert.equal(s.rows().filter(r => r.status === "pending").length, 8);
  assert.equal(s.rows().filter(r => r.status === "failed").length, 2);
  assert.equal(s.audits().length, 8);
  assert.equal(s.stats.batches, 1);
  assert.equal(s.stats.reads, 2);
});

test("MIG-0643 U02 SA-070: concurrent mutation produces rollback with no audit", async () => {
  let once = false;
  const s = setup({ beforeBatch(sqlite) {
    if (once) return;
    once = true;
    sqlite.prepare("UPDATE static_rebuild_queue SET error='raced' WHERE id='q1'").run();
  } });
  s.seed("q1");
  const res = await s.request("/queue/q1/retry");
  assert.equal(res.status, 500);
  assert.equal(s.rows()[0].error, "raced");
  assert.equal(s.rows()[0].status, "failed");
  assert.equal(s.audits().length, 0);
});

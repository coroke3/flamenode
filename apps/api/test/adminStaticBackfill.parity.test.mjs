import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { staticBackfillAdminRoutes } from "../src/routes/admin/staticBackfill.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";
import { STATIC_BACKFILL_KV_KEY } from "@flamenode/domain/admin";

function setup({ r2Ready = false, r2Throws = false, r2GeneratedAt = { blocklist: 100, pool: 100 }, r2BadSize = null, r2BadJson = null } = {}) {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  d1.sqlite.exec("CREATE TABLE videos (id TEXT PRIMARY KEY, visibility_status TEXT);");
  const state = { raw: null, reads: 0, writes: 0 };
  const kv = {
    async get(key) { assert.equal(key, STATIC_BACKFILL_KV_KEY); state.reads++; return state.raw; },
    async put(key, value) { assert.equal(key, STATIC_BACKFILL_KV_KEY); state.writes++; state.raw = value; },
  };
  const bucket = { gets: 0, cancels: 0, async get(key) {
    this.gets++;
    if (r2Throws) throw new Error("simulated R2 unavailable");
    if (!r2Ready) return null;
    const kind = key.includes("blocklist") ? "blocklist" : "pool";
    const value = kind === "blocklist"
      ? { schema_version: 1, generated_at: r2GeneratedAt.blocklist, blocked: {} }
      : { schema_version: 1, generated_at: r2GeneratedAt.pool, generation_key: "ok", items: [] };
    const payload = r2BadJson === kind ? "{malformed-json" : JSON.stringify(value);
    const size = r2BadSize?.kind === kind ? r2BadSize.size : payload.length;
    return {
      size,
      body: { cancel: async () => { this.cancels++; } },
      text: async () => payload,
    };
  } };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: "admin-1", role: "admin" });
    c.set("db", drizzle(d1.db, { schema }));
    c.set("actorSnapshotJsonById", { "admin-1": "{}" });
    await next();
  });
  app.route("/api/admin/static-builds/backfill", staticBackfillAdminRoutes);
  const request = (body) => app.request("/api/admin/static-builds/backfill", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: d1.db, KV: kv, BUCKET: bucket });
  const rows = () => d1.sqlite.prepare("SELECT target_type,target_id,status,priority FROM static_rebuild_queue ORDER BY target_id").all();
  const audit = () => d1.sqlite.prepare("SELECT * FROM audit_logs").all();
  const saved = () => JSON.parse(state.raw);
  return { ...d1, request, state, bucket, rows, audit, saved };
}

test("MIG-0643 SA-069: invalid kind/cursor and 64KiB cap fail before mutation", async () => {
  const s = setup();
  for (const data of [{ kind: "not-a-kind" }, { kind: "event_crew", cursor: "x".repeat(129) }]) {
    const res = await s.request(data);
    assert.equal(res.status, 400);
  }
  const huge = await s.request({ kind: "event_crew", extra: "x".repeat(65536) });
  assert.equal(huge.status, 413);
  assert.equal(s.stats.batches, 0);
  assert.equal(s.state.writes, 0);
});

test("MIG-0643 SA-069: 13 events -> 12 low-priority queue rows, one D1 batch, KV cursor", async () => {
  const s = setup();
  for (let i = 0; i < 13; i++) seedEvent(s.sqlite, { id: "ev-" + String(i).padStart(2, "0") });
  const first = await s.request({ kind: "event_crew" });
  assert.equal(first.status, 200);
  const b1 = await first.json();
  assert.equal(b1.backfill_scanned, "12");
  assert.equal(b1.backfill_enqueued, "12");
  assert.equal(b1.backfill_done, "0");
  assert.equal(b1.backfill_cursor, "ev-11");
  assert.equal(b1.backfill_state_persisted, "1");
  assert.equal(s.rows().length, 12);
  assert.equal(s.rows().every(r => r.priority === "low" && r.status === "pending" && r.target_type === "event"), true);
  assert.equal(s.stats.reads, 2, "CostGuard + one bounded count/page query");
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
  const firstAudit = JSON.parse(s.audit()[0].after_json);
  assert.equal(firstAudit.kind, "event_crew");
  assert.equal(firstAudit.scanned, 12);
  assert.equal(firstAudit.accepted_targets, 12,
    "CURRENT writes queue.acceptedTargetCount to strict audit after_json");
  assert.equal(firstAudit.next_cursor, "ev-11");
  assert.equal(s.saved().runs.event_crew.scanned, 12);
  const second = await s.request({ kind: "event_crew" });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), {
    backfill_kind: "event_crew", backfill_scanned: "1", backfill_enqueued: "1",
    backfill_done: "1", backfill_state_persisted: "1",
  });
  assert.equal(s.rows().length, 13);
  assert.equal(s.saved().runs.event_crew.status, "completed");
  assert.equal(s.saved().runs.event_crew.scanned, 13);
});

test("MIG-0643 SA-069: video backfill without shared inputs queues two rebuild targets and pauses", async () => {
  const s = setup();
  s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
  const res = await s.request({ kind: "video_v2" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    backfill_kind: "video_v2", backfill_scanned: "0", backfill_enqueued: "0",
    backfill_done: "0", backfill_state_persisted: "1",
  });
  assert.deepEqual(s.rows().map(x => x.target_type).sort(), ["random_video_pool","youtube_related_blocklist"]);
  assert.equal(s.saved().runs.video_v2.phase, "shared_inputs");
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
  assert.equal(s.bucket.gets, 1);
});

test("MIG-0643 SA-069: ready video inputs allow actual video queue in same request", async () => {
  const s = setup({ r2Ready: true });
  s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
  s.sqlite.prepare("INSERT INTO videos VALUES('v2','private')").run();
  const res = await s.request({ kind: "video_v2" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backfill_done, "1");
  assert.deepEqual(s.rows().map(r => r.target_id), ["v1"]);
  assert.equal(s.bucket.gets, 2);
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
});

test("MIG-0643 SA-069: empty backfill completes without D1 batch", async () => {
  const s = setup();
  const res = await s.request({ kind: "user_profile" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backfill_done, "1");
  assert.equal(s.stats.batches, 0);
  assert.equal(s.saved().runs.user_profile.status, "completed");
});

test("MIG-0643 SA-069: restart resets cursor and counters", async () => {
  const s = setup();
  seedEvent(s.sqlite, { id: "ev-a" });
  await s.request({ kind: "event_crew" });
  const res = await s.request({ kind: "event_crew", mode: "restart" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backfill_scanned, "1");
  assert.equal(s.saved().runs.event_crew.scanned, 1);
});

test("MIG-0643 SA-069: R2 read error schedules shared-input repair instead of failing KV run", async () => {
  const s = setup({ r2Throws: true });
  s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
  const res = await s.request({ kind: "video_v2" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backfill_done, "0");
  assert.equal(s.saved().runs.video_v2.status, "running");
  assert.equal(s.saved().runs.video_v2.phase, "shared_inputs");
  assert.deepEqual(
    s.rows().map(x => x.target_type).sort(),
    ["random_video_pool", "youtube_related_blocklist"],
  );
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
});

test("MIG-0643 SA-069: non-finite R2 generated_at fails closed like CURRENT normalizers", async () => {
  for (const r2GeneratedAt of [
    { blocklist: "Infinity", pool: 100 },
    { blocklist: 100, pool: "1e309" },
    { blocklist: 0, pool: 100 },
    { blocklist: 100, pool: "NaN" },
  ]) {
    const s = setup({ r2Ready: true, r2GeneratedAt });
    s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
    const response = await s.request({ kind: "video_v2" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).backfill_done, "0");
    assert.equal(s.saved().runs.video_v2.phase, "shared_inputs");
    assert.deepEqual(
      s.rows().map(row => row.target_type).sort(),
      ["random_video_pool", "youtube_related_blocklist"],
    );
    assert.equal(s.rows().some(row => row.target_type === "video"), false);
    assert.equal(s.stats.batches, 1);
    assert.equal(s.audit().length, 1);
  }
});

test("MIG-0643 SA-069: unsafe/oversized R2 object metadata never advances video backfill", async () => {
  const inputs = [
    { kind: "blocklist", size: 2 * 1024 * 1024 + 1 },
    { kind: "pool", size: 8 * 1024 * 1024 + 1 },
    { kind: "blocklist", size: -1 },
    { kind: "pool", size: 0.5 },
    { kind: "pool", size: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const r2BadSize of inputs) {
    const s = setup({ r2Ready: true, r2BadSize });
    s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
    const response = await s.request({ kind: "video_v2" });
    assert.equal(response.status, 200, JSON.stringify(r2BadSize));
    assert.equal((await response.json()).backfill_done, "0");
    assert.equal(s.saved().runs.video_v2.phase, "shared_inputs");
    assert.deepEqual(
      s.rows().map(row => row.target_type).sort(),
      ["random_video_pool", "youtube_related_blocklist"],
    );
    assert.equal(s.bucket.cancels, 1, "discarded object body must be cancelled");
    assert.equal(s.stats.batches, 1);
    assert.equal(s.audit().length, 1);
  }
});

test("MIG-0643 SA-069: malformed shared JSON fails closed and schedules both rebuilds", async () => {
  for (const r2BadJson of ["blocklist", "pool"]) {
    const s = setup({ r2Ready: true, r2BadJson });
    s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
    const res = await s.request({ kind: "video_v2" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).backfill_done, "0");
    assert.equal(s.saved().runs.video_v2.phase, "shared_inputs");
    assert.deepEqual(
      s.rows().map(row => row.target_type).sort(),
      ["random_video_pool", "youtube_related_blocklist"],
    );
    assert.equal(s.stats.batches, 1);
    assert.equal(s.audit().length, 1);
  }
});

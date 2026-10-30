import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { staticBackfillAdminRoutes } from "../src/routes/admin/staticBackfill.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";
import { STATIC_BACKFILL_KV_KEY } from "@flamenode/domain/admin";

function setup({ r2Ready = false, r2Throws = false, r2GeneratedAt = { blocklist: 100, pool: 100 }, r2BadSize = null, r2BadJson = null, kvGetterThrows = false, bucketGetterThrows = false } = {}) {
  const d1 = createAdminD1();
  seedBase(d1.sqlite);
  d1.sqlite.exec("CREATE TABLE videos (id TEXT PRIMARY KEY, visibility_status TEXT);");
  const state = { raw: null, reads: 0, writes: 0 };
  const kv = {
    async get(key) { assert.equal(key, STATIC_BACKFILL_KV_KEY); state.reads++; return state.raw; },
    async put(key, value) { assert.equal(key, STATIC_BACKFILL_KV_KEY); state.writes++; state.raw = value; },
  };
  // Successful producer writes record the hash and generation in D1 only
  // after putting the JSON body and metadata in R2.
  d1.sqlite.exec(`CREATE TABLE static_artifacts (
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, object_key TEXT NOT NULL,
    content_hash TEXT NOT NULL, generated_at INTEGER NOT NULL, deleted_at INTEGER
  )`);
  const proofHashes = { blocklist: "a".repeat(64), pool: "b".repeat(64) };
  if (r2Ready) {
    d1.sqlite.prepare(`INSERT INTO static_artifacts
      (target_type,target_id,object_key,content_hash,generated_at,deleted_at)
      VALUES ('youtube_related_blocklist','global','youtube/related-blocklist.v1.json',?,?,NULL)`)
      .run(proofHashes.blocklist,r2GeneratedAt.blocklist);
    d1.sqlite.prepare(`INSERT INTO static_artifacts
      (target_type,target_id,object_key,content_hash,generated_at,deleted_at)
      VALUES ('random_video_pool','global','videos/random-pool.v1.json',?,?,NULL)`)
      .run(proofHashes.pool,r2GeneratedAt.pool);
  }
  const bucket = { heads: 0, gets: 0, async head(key) {
    this.heads++;
    if (r2Throws) throw new Error("simulated R2 unavailable");
    if (!r2Ready) return null;
    const kind = key.includes("blocklist") ? "blocklist" : "pool";
    const size = r2BadSize?.kind === kind ? r2BadSize.size : 1024;
    const hash = r2BadJson === kind ? "mismatched-producer-hash" : proofHashes[kind];
    return { size, customMetadata: {
      schema_version: "1", content_hash: hash,
      source_generation: kind === "pool" ? "valid-generation-key" : proofHashes.blocklist,
    } };
  }, async get() { this.gets++; throw new Error("S3 must never fetch or parse the shared JSON bodies"); } };
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
  }, {
    DB: d1.db,
    get KV() {
      if (kvGetterThrows) throw new Error("PRIVATE_KV_BINDING_GETTER_CREDENTIAL");
      return kv;
    },
    get BUCKET() {
      if (bucketGetterThrows) throw new Error("PRIVATE_R2_BINDING_GETTER_CREDENTIAL");
      return bucket;
    },
  });
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
  // Missing D1 producer proof short-circuits before any R2 HEAD call.
  assert.equal(s.bucket.heads, 0);
  assert.equal(s.bucket.gets, 0);
});

test("MIG-0643 SA-069: ready video inputs allow actual video queue in same request", async () => {
  const s = setup({ r2Ready: true });
  s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
  s.sqlite.prepare("INSERT INTO videos VALUES('v2','private')").run();
  const res = await s.request({ kind: "video_v2" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backfill_done, "1");
  assert.deepEqual(s.rows().map(r => r.target_id), ["v1"]);
  assert.equal(s.bucket.heads, 2);
  assert.equal(s.bucket.gets, 0);
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
    assert.equal(s.bucket.gets, 0, "HEAD-only readiness never allocates an R2 object body");
    assert.equal(s.stats.batches, 1);
    assert.equal(s.audit().length, 1);
  }
});

test("MIG-0643 SA-069: mismatched producer hash fails closed and schedules both rebuilds", async () => {
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

test("MIG-0643 SA-069: D1 provider failures never leak through API or persisted KV state", async () => {
  const s = setup();
  seedEvent(s.sqlite, { id: "ev-1" });
  const sentinel = "PRIVATE_DB_PROVIDER_CREDENTIAL_NEVER_EXPOSE";
  const originalPrepare = s.db.prepare.bind(s.db);
  let failedReads = 0;
  s.db.prepare = (query) => {
    if (String(query).includes("json_group_array(id)")) {
      failedReads += 1;
      throw new Error(sentinel);
    }
    return originalPrepare(query);
  };
  const response = await s.request({ kind: "event_crew" });
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.doesNotMatch(body, /PRIVATE_DB_PROVIDER_CREDENTIAL_NEVER_EXPOSE/);
  const parsed = JSON.parse(body);
  assert.equal(parsed.backfill_kind, "event_crew");
  assert.equal(parsed.backfill_state_persisted, "1");
  assert.match(parsed.backfill_error, /再試行/);
  assert.equal(failedReads, 1);
  const kv = JSON.stringify(s.saved());
  assert.doesNotMatch(kv, /PRIVATE_DB_PROVIDER_CREDENTIAL_NEVER_EXPOSE/);
  assert.equal(s.saved().runs.event_crew.status, "failed");
  assert.equal(s.saved().runs.event_crew.last_error, parsed.backfill_error);
  assert.equal(s.stats.batches, 0);
  assert.equal(s.audit().length, 0);
});

test("MIG-0643 SA-069: near-limit shared inputs use HEAD proofs without reading body", async () => {
  const s = setup({ r2Ready: true, r2BadSize: { kind: "pool", size: 8 * 1024 * 1024 } });
  s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
  const res = await s.request({ kind: "video_v2" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backfill_done, "1");
  assert.equal(s.bucket.heads, 2);
  assert.equal(s.bucket.gets, 0, "even 8 MiB input must not be fully read/parsed on S3");
  assert.deepEqual(s.rows().map(row => row.target_id), ["v1"]);
  assert.equal(s.stats.reads, 2, "CostGuard + combined D1 paging/tracking proof");
});

test("MIG-0643 SA-069: missing producer tracking fails closed for existing R2 HEAD objects", async () => {
  const s = setup({ r2Ready: true });
  s.sqlite.prepare("DELETE FROM static_artifacts WHERE target_type = 'random_video_pool'").run();
  s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
  const res = await s.request({ kind: "video_v2" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).backfill_done, "0");
  assert.equal(s.bucket.gets, 0);
  assert.deepEqual(s.rows().map(row => row.target_type).sort(),
    ["random_video_pool", "youtube_related_blocklist"]);
});

test("MIG-0643 SA-069: forged or deleted tracking metadata never advances backfill", async () => {
  for (const mutation of ["bad_hash","deleted","bad_timestamp"]) {
    const s = setup({ r2Ready: true });
    if (mutation === "bad_hash") s.sqlite.exec("UPDATE static_artifacts SET content_hash = 'untrusted'");
    if (mutation === "deleted") s.sqlite.exec("UPDATE static_artifacts SET deleted_at = 99");
    if (mutation === "bad_timestamp") s.sqlite.exec("UPDATE static_artifacts SET generated_at = 0");
    s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
    const response = await s.request({ kind: "video_v2" });
    assert.equal(response.status, 200, mutation);
    assert.equal((await response.json()).backfill_done, "0", mutation);
    assert.equal(s.rows().some(row => row.target_type === "video"), false);
    assert.equal(s.stats.batches, 1);
    assert.equal(s.bucket.gets, 0);
  }
});


test("MIG-0643 SA-069: throwing KV binding getter remains best-effort after D1 queue commit", async () => {
  const s = setup({ kvGetterThrows: true });
  seedEvent(s.sqlite, { id: "ev-kv-binding" });
  const response = await s.request({ kind: "event_crew" });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, /PRIVATE_KV_BINDING_GETTER_CREDENTIAL/);
  assert.deepEqual(JSON.parse(body), {
    backfill_kind: "event_crew", backfill_scanned: "1", backfill_enqueued: "1",
    backfill_done: "1", backfill_state_persisted: "0",
  });
  assert.equal(s.rows().length, 1, "D1 queue write remains committed and reported accurately");
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
  assert.equal(s.state.reads, 0);
  assert.equal(s.state.writes, 0);
});

test("MIG-0643 SA-069: throwing R2 binding getter schedules shared-input repair, not a video queue", async () => {
  const s = setup({ r2Ready: true, bucketGetterThrows: true });
  s.sqlite.prepare("INSERT INTO videos VALUES('v1','public')").run();
  const response = await s.request({ kind: "video_v2" });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, /PRIVATE_R2_BINDING_GETTER_CREDENTIAL/);
  assert.equal(JSON.parse(body).backfill_done, "0");
  assert.equal(s.saved().runs.video_v2.phase, "shared_inputs");
  assert.deepEqual(s.rows().map(r => r.target_type).sort(),
    ["random_video_pool", "youtube_related_blocklist"]);
  assert.equal(s.rows().some(r => r.target_type === "video"), false);
  assert.equal(s.bucket.heads, 0);
  assert.equal(s.bucket.gets, 0);
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
});

test("MIG-0643 S3: oversized valid KV state fails soft before JSON.parse (ASCII and UTF-8)", async () => {
  // The producer writes only three bounded run records. Do not parse arbitrarily
  // large legacy/corrupt state in an 8ms-budget mutation request.
  for (const padding of ["x".repeat(70 * 1024), "漢".repeat(24000)]) {
    const s = setup();
    seedEvent(s.sqlite, { id: "ev-kv-cap" });
    s.state.raw = JSON.stringify({
      schema_version: 1,
      updated_at: 1,
      runs: {
        event_crew: {
          cursor: "zz-after-all-events", phase: "items", status: "running",
          total: 99, scanned: 98, enqueued: 98,
          last_error: null, last_run_at: 1,
        },
      },
      ignored_padding: padding,
    });
    assert.ok(new TextEncoder().encode(s.state.raw).byteLength > 64 * 1024);
    const response = await s.request({ kind: "event_crew" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      backfill_kind: "event_crew", backfill_scanned: "1", backfill_enqueued: "1",
      backfill_done: "1", backfill_state_persisted: "1",
    });
    assert.equal(s.state.reads, 1);
    assert.equal(s.state.writes, 1);
    assert.equal(s.rows().length, 1, "oversized cursor must not skip the first queued event");
    assert.equal(s.rows()[0].target_id, "ev-kv-cap");
    assert.equal(s.saved().runs.event_crew.scanned, 1);
    assert.equal(s.saved().runs.event_crew.cursor, null);
    assert.equal(s.stats.batches, 1, "queue and strict audit remain atomic");
    assert.equal(s.audit().length, 1);
    s.sqlite.close();
  }
});

test("MIG-0643 S3: oversized persisted cursor cannot bypass 128-char form bound", async () => {
  const s = setup();
  seedEvent(s.sqlite, { id: "ev-first" });
  s.state.raw = JSON.stringify({
    schema_version: 1,
    updated_at: 1,
    runs: {
      event_crew: {
        cursor: "z".repeat(129), phase: "items", status: "running",
        total: 100, scanned: 99, enqueued: 99,
        last_error: null, last_run_at: 1,
      },
      user_profile: {
        cursor: "safe-cursor", phase: "items", status: "running",
        total: 5, scanned: 2, enqueued: 2,
        last_error: null, last_run_at: 1,
      },
    },
  });
  assert.ok(s.state.raw.length < 64 * 1024, "tests the under-budget invalid cursor path");
  const res = await s.request({ kind: "event_crew" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    backfill_kind: "event_crew", backfill_scanned: "1", backfill_enqueued: "1",
    backfill_done: "1", backfill_state_persisted: "1",
  });
  assert.equal(s.rows()[0].target_id, "ev-first");
  assert.equal(s.saved().runs.event_crew.scanned, 1,
    "invalid checkpoint must not contaminate restarted counters");
  assert.equal(s.saved().runs.event_crew.cursor, null);
  assert.equal(s.saved().runs.user_profile.cursor, "safe-cursor",
    "unrelated valid checkpoint remains intact");
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
  s.sqlite.close();
});

test("MIG-0643 S3: D1 target IDs over the queue contract fail closed before any audit batch", async () => {
  // LIMIT 13 is a row-count guard, NOT a guarantee of bounded D1 TEXT IDs.
  // Test the 128-char queue contract and the independent 64-KiB parse budget.
  for (const invalidId of ["x".repeat(129), "x".repeat(70 * 1024)]) {
    const s = setup();
    seedEvent(s.sqlite, { id: invalidId });
    const response = await s.request({ kind: "event_crew" });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.backfill_kind, "event_crew");
    assert.match(payload.backfill_error, /再試行/);
    assert.doesNotMatch(JSON.stringify(payload), /xxxxxxxxxxxxxxxxxxxxxxxx/);
    assert.equal(s.rows().length, 0, "no queue targets can escape the D1 ID bound");
    assert.equal(s.stats.batches, 0, "no audit or mutation for invalid D1 page");
    assert.equal(s.audit().length, 0);
    assert.equal(s.saved().runs.event_crew.status, "failed");
    s.sqlite.close();
  }
});

test("MIG-0643 S3: a valid 128-char D1 target ID stays queueable", async () => {
  const s = setup();
  const eventId = "e".repeat(128);
  seedEvent(s.sqlite, { id: eventId });
  const response = await s.request({ kind: "event_crew" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).backfill_enqueued, "1");
  assert.equal(s.rows()[0].target_id, eventId);
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
  s.sqlite.close();
});

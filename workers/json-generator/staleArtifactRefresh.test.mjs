import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS,
  STALE_ARTIFACT_REFRESH_MAX_TARGETS,
  STALE_ARTIFACT_REFRESH_REASON,
  ensureStaleArtifactRefresh,
} from "./staleArtifactRefresh.ts";
import { STATIC_ARTIFACT_REFRESH_AFTER_SEC } from "./r2Dedup.ts";
import { enqueuePerTargetComposerFollowUp } from "./followUpEnqueue.ts";

const NOW = 1_800_000_000;
const OLD = NOW - STATIC_ARTIFACT_REFRESH_AFTER_SEC - 10;
const FRESH = NOW - 1000;

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY NOT NULL, visibility_status TEXT NOT NULL);
    CREATE TABLE static_artifacts (
      id TEXT PRIMARY KEY NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      object_key TEXT NOT NULL, content_hash TEXT NOT NULL, schema_version INTEGER NOT NULL,
      source_updated_at INTEGER, generated_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE TABLE static_rebuild_queue (
      id TEXT PRIMARY KEY NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      reason TEXT, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX q_uniq ON static_rebuild_queue (target_type, target_id)
      WHERE status IN ('pending', 'processing');
  `);
  const uploaded = new Map();
  const heads = [];
  const exec = (sql, values, mode) => {
    const statement = sqlite.prepare(sql);
    return mode === "all" ? { results: statement.all(...values) } : (statement.run(...values), { meta: { changes: 1 } });
  };
  const DB = {
    prepare: (sql) => ({
      bind: (...values) => ({
        all: async () => exec(sql, values, "all"),
        run: async () => {
          const before = sqlite.prepare("SELECT COUNT(*) AS c FROM static_rebuild_queue").get().c;
          sqlite.prepare(sql).run(...values);
          const after = sqlite.prepare("SELECT COUNT(*) AS c FROM static_rebuild_queue").get().c;
          return { meta: { changes: after - before } };
        },
      }),
    }),
  };
  const R2 = {
    async head(key) {
      heads.push(key);
      return uploaded.has(key) ? { uploaded: new Date(uploaded.get(key) * 1000) } : null;
    },
  };
  const track = (type, id, key, generatedAt, deletedAt = null) =>
    sqlite
      .prepare("INSERT INTO static_artifacts VALUES (?, ?, ?, ?, 'h', 1, NULL, ?, ?)")
      .run(`${type}:${id}:${key}`, type, id, key, generatedAt, deletedAt);
  const event = (id, visibility = "public") => sqlite.prepare("INSERT INTO events VALUES (?, ?)").run(id, visibility);
  const queue = () => sqlite.prepare("SELECT target_type, target_id, reason, priority, status FROM static_rebuild_queue ORDER BY target_type, target_id").all();
  return { sqlite, env: { DB, R2 }, uploaded, heads, track, event, queue };
}

test("期限超過のvideo/event detailだけを低優先度でenqueueし、新しい行・削除済み・queue active行は除く", async () => {
  const f = createFixture();
  f.track("video", "old", "videos/old.json", OLD);
  f.track("video", "fresh", "videos/fresh.json", FRESH);
  f.track("video", "mixed", "videos/mixed-a.json", OLD);
  f.track("video", "mixed", "videos/mixed-b.json", FRESH);
  f.track("event", "oldev", "events/oldev.json", OLD);
  f.event("oldev");
  f.track("event_base", "oldev", "events/oldev/base.v1.json", FRESH);
  f.track("event_slots", "oldev", "events/oldev/slots.v1.json", FRESH);
  f.track("video", "deleted", "videos/deleted.json", OLD, NOW);
  f.track("video", "active", "videos/active.json", OLD);
  f.track("user", "u1", "users/u1.json", OLD);
  f.sqlite
    .prepare("INSERT INTO static_rebuild_queue VALUES ('q1','video','active','manual','high','pending',0,1,1)")
    .run();

  const enqueued = await ensureStaleArtifactRefresh(f.env, { now: NOW });
  assert.equal(enqueued, 3);
  const queue = f.queue();
  assert.deepEqual(
    queue.filter((row) => row.reason === STALE_ARTIFACT_REFRESH_REASON).map((row) => `${row.target_type}:${row.target_id}`),
    ["event:oldev", "video:mixed", "video:old"],
  );
  assert.ok(queue.filter((row) => row.reason === STALE_ARTIFACT_REFRESH_REASON).every((row) => row.priority === "low"));
  assert.equal(queue.find((row) => row.target_id === "active").reason, "manual");

  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 0, "再実行は重複enqueueしない");
});

test("1 runのdetail enqueueは MAX_TARGETS 件までで、古い順", async () => {
  const f = createFixture();
  const total = STALE_ARTIFACT_REFRESH_MAX_TARGETS + 25;
  for (let i = 0; i < total; i += 1) {
    f.track("video", `v${String(i).padStart(4, "0")}`, `videos/v${i}.json`, OLD - (total - i));
  }
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), STALE_ARTIFACT_REFRESH_MAX_TARGETS);
  const ids = f.queue().map((row) => row.target_id);
  assert.equal(ids.length, STALE_ARTIFACT_REFRESH_MAX_TARGETS);
  assert.ok(ids.includes("v0000"));
  assert.ok(!ids.includes(`v${String(total - 1).padStart(4, "0")}`));
});

test("global artifactは tracking 行が新しくてもR2最終PUTが古ければenqueueする", async () => {
  const f = createFixture();
  f.uploaded.set("rules/current.json", OLD);
  f.uploaded.set("list/recent.json", FRESH);
  f.uploaded.set("recommend.json", OLD);
  // top.json は R2 object 欠落 → enqueue せず（別の欠落修復経路の責務）
  const enqueued = await ensureStaleArtifactRefresh(f.env, { now: NOW });
  assert.equal(enqueued, 2);
  assert.deepEqual(
    f.queue().map((row) => `${row.target_type}:${row.target_id}:${row.priority}`),
    ["recommend:global:low", "rules:global:low"],
  );
  assert.equal(f.heads.length, Object.keys(STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS).length);
});

test("rules は 32 件を超える古い search_index 行があっても enqueue される", async () => {
  const f = createFixture();
  for (let i = 0; i < 40; i += 1) {
    f.track("search_index", "global", `search/postings/${i}.json`, OLD - 1000 - i);
  }
  f.track("rules", "global", "rules/current.json", FRESH);
  f.uploaded.set("rules/current.json", NOW - 91 * 24 * 3600);
  f.uploaded.set("search-index-lite.json", FRESH);
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 1);
  assert.deepEqual(f.queue().map((row) => row.target_type), ["rules"]);
});

test("failed / active の target は sweep から除外する", async () => {
  const f = createFixture();
  f.track("video", "failedv", "videos/failedv.json", OLD);
  f.track("video", "okv", "videos/okv.json", OLD);
  f.uploaded.set("rules/current.json", OLD);
  f.uploaded.set("top.json", OLD);
  f.track("video", "oldfailv", "videos/oldfailv.json", OLD);
  f.uploaded.set("list/recent.json", OLD);
  const recent = NOW - 3600;
  const longAgo = NOW - 30 * 24 * 3600;
  for (const [id, type, target, updatedAt] of [
    ["q1", "video", "failedv", recent],
    ["q2", "rules", "global", recent],
    // 7日より古い failed は除外しない
    ["q3", "video", "oldfailv", longAgo],
    ["q4", "list_recent", "global", longAgo],
  ]) {
    f.sqlite
      .prepare("INSERT INTO static_rebuild_queue VALUES (?, ?, ?, 'x', 'normal', 'failed', 3, ?, ?)")
      .run(id, type, target, updatedAt, updatedAt);
  }
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 4);
  assert.deepEqual(
    f.queue().filter((row) => row.reason === STALE_ARTIFACT_REFRESH_REASON).map((row) => `${row.target_type}:${row.target_id}`),
    ["list_recent:global", "top:global", "video:okv", "video:oldfailv"],
  );
});


test("SEC-533: stale event with no slots tracker enqueues producer despite a recently failed composer", async () => {
  const f = createFixture();
  f.track("event", "ev1", "events/ev1.json", OLD);
  f.event("ev1");
  f.track("event_base", "ev1", "events/ev1/base.v1.json", FRESH);
  f.sqlite.prepare(
    "INSERT INTO static_rebuild_queue VALUES ('old-composer','event','ev1','artifact_slo_refresh','low','failed',4,?,?)",
  ).run(NOW - 120, NOW - 120);
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 1);
  const queued = f.queue();
  assert.deepEqual(
    queued.filter((x) => x.status !== "failed").map((x) => `${x.target_type}:${x.target_id}:${x.priority}`),
    ["event_slots:ev1:low"],
  );
  assert.ok(!queued.some((x) => x.target_type === "event" && x.status === "pending"));
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 0, "active slots is not duplicated");

  // The existing producer follow-up must resume the previously failed event.
  f.sqlite.prepare("UPDATE static_rebuild_queue SET status='done' WHERE target_type='event_slots'").run();
  f.track("event_slots", "ev1", "events/ev1/slots.v1.json", FRESH);
  assert.equal(await enqueuePerTargetComposerFollowUp(f.env, "event_slots", "ev1"), true);
  const resumed = f.queue();
  assert.ok(resumed.some((x) => x.target_type === "event" && x.target_id === "ev1" &&
    x.status === "pending" && x.priority === "high"));
});

test("SEC-533: missing base is repaired before slots, and event after both tracked sections", async () => {
  const f = createFixture();
  f.track("event", "both-missing", "events/both-missing.json", OLD);
  f.event("both-missing");

  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 1);
  assert.deepEqual(f.queue().map((x) => `${x.target_type}:${x.target_id}`), ["event_base:both-missing"]);
  f.sqlite.prepare("UPDATE static_rebuild_queue SET status='done' WHERE target_type='event_base'").run();
  f.track("event_base", "both-missing", "events/both-missing/base.v1.json", FRESH);

  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 1);
  assert.ok(f.queue().some((x) => x.target_type === "event_slots" && x.target_id === "both-missing"));
  f.sqlite.prepare("UPDATE static_rebuild_queue SET status='done' WHERE target_type='event_slots'").run();
  f.track("event_slots", "both-missing", "events/both-missing/slots.v1.json", FRESH);

  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 1);
  assert.ok(f.queue().some((x) => x.target_type === "event" && x.target_id === "both-missing"));
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 0, "same event active row blocks duplicate");
});

test("SEC-533: producer cooldown and active protection are checked on selected target", async () => {
  const f = createFixture();
  for (const id of ["slots-failed", "slots-active", "event-failed", "healthy-event"]) {
    f.track("event", id, `events/${id}.json`, OLD);
    f.event(id);
    f.track("event_base", id, `events/${id}/base.v1.json`, FRESH);
    if (id === "healthy-event") {
      f.track("event_slots", id, `events/${id}/slots.v1.json`, FRESH);
    }
  }
  const insert = f.sqlite.prepare(
    "INSERT INTO static_rebuild_queue VALUES (?, ?, ?, 'fixture', 'low', ?, 4, ?, ?)",
  );
  insert.run("q1", "event_slots", "slots-failed", "failed", NOW - 3600, NOW - 3600);
  insert.run("q2", "event_slots", "slots-active", "processing", NOW - 300, NOW - 300);
  insert.run("q3", "event", "event-failed", "failed", NOW - 3600, NOW - 3600);
  insert.run("q4", "event", "healthy-event", "failed", NOW - 3600, NOW - 3600);
  // The same event-type failed history must not suppress a different slots producer.
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 1);
  const pending = f.queue().filter((x) => x.reason === STALE_ARTIFACT_REFRESH_REASON);
  assert.deepEqual(pending.map((x) => `${x.target_type}:${x.target_id}`), ["event_slots:event-failed"]);
  assert.equal(f.heads.length, Object.keys(STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS).length);
});

test("SEC-533: missing event sections share the existing 100-detail-target cap", async () => {
  const f = createFixture();
  const total = STALE_ARTIFACT_REFRESH_MAX_TARGETS + 25;
  for (let i = 0; i < total; i++) {
    const id = `evt${String(i).padStart(4, "0")}`;
    f.track("event", id, `events/${id}.json`, OLD - (total - i));
    f.event(id);
    f.track("event_base", id, `events/${id}/base.v1.json`, FRESH);
  }
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), STALE_ARTIFACT_REFRESH_MAX_TARGETS);
  const queued = f.queue();
  assert.equal(queued.length, STALE_ARTIFACT_REFRESH_MAX_TARGETS);
  assert.ok(queued.every((x) => x.target_type === "event_slots" && x.priority === "low"));
  assert.ok(queued.some((x) => x.target_id === "evt0000"));
  assert.ok(!queued.some((x) => x.target_id === `evt${String(total - 1).padStart(4, "0")}`));
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 25,
    "next sweep enqueues the remaining unclaimed targets");
  assert.equal(f.queue().length, total);
});

test("SEC-533: nonpublic or missing event rows must never bootstrap section producers", async () => {
  const f = createFixture();
  for (const [id, visibility] of [
    ["private-event", "private"],
    ["draft-event", "draft"],
    ["archived-event", "archived"],
  ]) {
    f.event(id, visibility);
    f.track("event", id, `events/${id}.json`, OLD);
  }
  f.track("event", "orphan-event", "events/orphan-event.json", OLD);
  // A real public event remains eligible for missing section repair.
  f.event("public-event", "public");
  f.track("event", "public-event", "events/public-event.json", OLD);
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 5);
  const queued = f.queue();
  assert.deepEqual(queued.map((q) => `${q.target_type}:${q.target_id}`), [
    "event:archived-event",
    "event:orphan-event",
    "event:private-event",
    "event:draft-event",
    "event_base:public-event",
  ]);
  assert.equal(queued.filter((q) => q.target_type === "event_base" || q.target_type === "event_slots").length, 1,
    "section producers must be limited to currently public event IDs");
});

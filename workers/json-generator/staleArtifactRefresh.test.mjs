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

const NOW = 1_800_000_000;
const OLD = NOW - STATIC_ARTIFACT_REFRESH_AFTER_SEC - 10;
const FRESH = NOW - 1000;

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
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
  const queue = () => sqlite.prepare("SELECT target_type, target_id, reason, priority FROM static_rebuild_queue ORDER BY target_type, target_id").all();
  return { sqlite, env: { DB, R2 }, uploaded, heads, track, queue };
}

test("期限超過のvideo/event detailだけを低優先度でenqueueし、新しい行・削除済み・queue active行は除く", async () => {
  const f = createFixture();
  f.track("video", "old", "videos/old.json", OLD);
  f.track("video", "fresh", "videos/fresh.json", FRESH);
  f.track("video", "mixed", "videos/mixed-a.json", OLD);
  f.track("video", "mixed", "videos/mixed-b.json", FRESH);
  f.track("event", "oldev", "events/oldev.json", OLD);
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
  f.sqlite
    .prepare("INSERT INTO static_rebuild_queue VALUES ('q1','video','failedv','x','normal','failed',3,1,1)")
    .run();
  f.sqlite
    .prepare("INSERT INTO static_rebuild_queue VALUES ('q2','rules','global','x','normal','failed',3,1,1)")
    .run();
  assert.equal(await ensureStaleArtifactRefresh(f.env, { now: NOW }), 2);
  assert.deepEqual(
    f.queue().filter((row) => row.reason === STALE_ARTIFACT_REFRESH_REASON).map((row) => `${row.target_type}:${row.target_id}`),
    ["top:global", "video:okv"],
  );
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { rebuildTarget } from "./rebuild.ts";

function createEnv() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      creator_display_name TEXT,
      creator_x_user_id TEXT,
      youtube_video_id TEXT,
      visibility_status TEXT NOT NULL,
      primary_event_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE video_events (video_id TEXT NOT NULL, event_id TEXT NOT NULL);
    CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT, approval_status TEXT);
    CREATE TABLE static_artifacts (
      id TEXT PRIMARY KEY NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      source_updated_at INTEGER,
      generated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE UNIQUE INDEX static_artifacts_target_key_uniq
      ON static_artifacts (target_type, target_id, object_key);
  `);
  const insertVideo = sqlite.prepare(
    `INSERT INTO videos
      (id, title, creator_display_name, creator_x_user_id, youtube_video_id,
       visibility_status, primary_event_id, updated_at)
     VALUES (?, ?, ?, ?, ?, 'public', NULL, ?)`
  );
  for (let index = 0; index < 20; index += 1) {
    insertVideo.run(
      `video-${index}`,
      `Video title ${index}`,
      `Creator ${index}`,
      `creator-${index}`,
      `youtube-${index}`,
      1_700_000_000 - index,
    );
  }
  const insertUser = sqlite.prepare(
    `INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')`,
  );
  for (let index = 0; index < 20; index += 1) {
    insertUser.run(`creator-${index}`, `Creator ${index}`);
  }

  const DB = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const direct = {
        async first() {
          return statement.get() ?? null;
        },
        async all() {
          return { results: statement.all() };
        },
        async run() {
          const result = statement.run();
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
      };
      return {
        bind(...values) {
          const bound = sqlite.prepare(sql);
          return {
            async first() {
              return bound.get(...values) ?? null;
            },
            async all() {
              return { results: bound.all(...values) };
            },
            async run() {
              const result = bound.run(...values);
              return { meta: { changes: Number(result.changes ?? 0) } };
            },
          };
        },
        ...direct,
      };
    },
  };
  const objects = new Map();
  const log = { puts: [], deletes: [], failPostingPutAfter: null, postingPuts: 0 };
  const R2 = {
    async head(key) {
      return objects.has(key) ? {} : null;
    },
    async get(key) {
      if (!objects.has(key)) return null;
      const body = objects.get(key);
      return {
        size: body.length,
        async json() {
          return JSON.parse(body);
        },
      };
    },
    async put(key, value) {
      if (key.startsWith("search-postings.v1/")) {
        log.postingPuts += 1;
        if (log.failPostingPutAfter !== null && log.postingPuts > log.failPostingPutAfter) {
          throw new Error("injected_put_failure");
        }
      }
      log.puts.push(key);
      objects.set(key, String(value));
      return {};
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        log.deletes.push(key);
        objects.delete(key);
      }
    },
  };
  return { DB, R2, KV: {}, objects, sqlite, log };
}

test("search-index posting rebuild tracks bounded shards and keeps them after target cleanup", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");

  assert.ok(env.objects.has("search-index-lite.json"));
  assert.ok(env.objects.has("search-index-postings.v1/manifest.json"));
  const postingKeys = [...env.objects.keys()].filter((key) =>
    key.startsWith("search-postings.v1/"),
  );
  assert.ok(postingKeys.length > 0);

  const tracked = env.sqlite
    .prepare(
      `SELECT object_key FROM static_artifacts
       WHERE target_type = 'search_index' AND target_id = 'global'
         AND deleted_at IS NULL`,
    )
    .all()
    .map((row) => row.object_key);
  for (const key of ["search-index-lite.json", "search-index-postings.v1/manifest.json", ...postingKeys]) {
    assert.ok(tracked.includes(key), `missing tracking row for ${key}`);
  }
  env.sqlite.close();
});

const MANIFEST_KEY = "search-index-postings.v1/manifest.json";
const isPostingKey = (key) => key.startsWith("search-postings.v1/");

function resetLog(env) {
  env.log.puts.length = 0;
  env.log.deletes.length = 0;
  env.log.failPostingPutAfter = null;
  env.log.postingPuts = 0;
}

function untrackFirstPostingKey(env, key) {
  env.sqlite
    .prepare(
      `UPDATE static_artifacts SET deleted_at = 1
       WHERE target_type = 'search_index' AND target_id = 'global' AND object_key = ?`,
    )
    .run(key);
}

test("same generation with complete tracking skips posting and manifest PUTs", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");
  const postingKeys = [...env.objects.keys()].filter(isPostingKey).sort();
  assert.ok(postingKeys.length > 0);
  resetLog(env);

  await rebuildTarget(env, "search_index", "global");

  assert.deepEqual(env.log.puts.filter((key) => isPostingKey(key) || key === MANIFEST_KEY), []);
  assert.deepEqual(env.log.deletes, []);
  assert.deepEqual([...env.objects.keys()].filter(isPostingKey).sort(), postingKeys);
  env.sqlite.close();
});

test("same generation with incomplete tracking falls back to the full PUT path", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");
  const postingKeys = [...env.objects.keys()].filter(isPostingKey);
  untrackFirstPostingKey(env, postingKeys[0]);
  resetLog(env);

  await rebuildTarget(env, "search_index", "global");

  assert.equal(new Set(env.log.puts.filter(isPostingKey)).size, postingKeys.length);
  assert.ok(env.log.puts.includes(MANIFEST_KEY));
  const live = env.sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM static_artifacts
       WHERE target_type = 'search_index' AND target_id = 'global'
         AND deleted_at IS NULL AND object_key = ?`,
    )
    .get(postingKeys[0]);
  assert.equal(live.c, 1);
  env.sqlite.close();
});

test("same-generation PUT failure never deletes keys of the live generation", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");
  const postingKeys = [...env.objects.keys()].filter(isPostingKey);
  untrackFirstPostingKey(env, postingKeys[0]);
  resetLog(env);
  env.log.failPostingPutAfter = 2;

  await assert.rejects(rebuildTarget(env, "search_index", "global"), /injected_put_failure/);

  assert.deepEqual(env.log.deletes, []);
  for (const key of postingKeys) assert.ok(env.objects.has(key), `live key deleted: ${key}`);
  env.sqlite.close();
});

test("same-generation tracking failure never deletes keys of the live generation", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");
  const postingKeys = [...env.objects.keys()].filter(isPostingKey);
  untrackFirstPostingKey(env, postingKeys[0]);
  resetLog(env);
  env.sqlite.exec(
    `CREATE TRIGGER fail_static_artifacts_insert BEFORE INSERT ON static_artifacts
     BEGIN SELECT RAISE(ABORT, 'injected_tracking_failure'); END;`,
  );
  env.sqlite.exec(
    `CREATE TRIGGER fail_static_artifacts_update BEFORE UPDATE ON static_artifacts
     BEGIN SELECT RAISE(ABORT, 'injected_tracking_failure'); END;`,
  );

  await assert.rejects(rebuildTarget(env, "search_index", "global"), /injected_tracking_failure/);

  assert.deepEqual(env.log.deletes, []);
  for (const key of postingKeys) assert.ok(env.objects.has(key), `live key deleted: ${key}`);
  env.sqlite.close();
});

test("different-generation PUT failure deletes only the pending new keys", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");
  const liveKeys = [...env.objects.keys()].filter(isPostingKey);
  env.sqlite.prepare(`UPDATE videos SET title = 'Changed title' WHERE id = 'video-0'`).run();
  resetLog(env);
  env.log.failPostingPutAfter = 2;

  await assert.rejects(rebuildTarget(env, "search_index", "global"), /injected_put_failure/);

  assert.equal(env.log.deletes.length, 2);
  for (const key of env.log.deletes) {
    assert.ok(isPostingKey(key));
    assert.ok(!liveKeys.includes(key), `live key deleted: ${key}`);
  }
  for (const key of liveKeys) assert.ok(env.objects.has(key), `live key deleted: ${key}`);
  env.sqlite.close();
});

test("page counts のない旧 manifest は同一 generation でも1回だけ全件書き直し、次回から skip する", async () => {
  const env = createEnv();
  await rebuildTarget(env, "search_index", "global");
  const postingKeys = [...env.objects.keys()].filter(isPostingKey).sort();
  const { page_counts: pageCounts, ...legacyManifest } = JSON.parse(env.objects.get(MANIFEST_KEY));
  assert.ok(Array.isArray(pageCounts));
  env.objects.set(MANIFEST_KEY, JSON.stringify(legacyManifest));
  resetLog(env);

  await rebuildTarget(env, "search_index", "global");

  assert.equal(new Set(env.log.puts.filter(isPostingKey)).size, postingKeys.length);
  assert.deepEqual(env.log.deletes, []);
  assert.deepEqual(JSON.parse(env.objects.get(MANIFEST_KEY)).page_counts, pageCounts);
  resetLog(env);

  await rebuildTarget(env, "search_index", "global");

  assert.deepEqual(env.log.puts.filter((key) => isPostingKey(key) || key === MANIFEST_KEY), []);
  assert.deepEqual([...env.objects.keys()].filter(isPostingKey).sort(), postingKeys);
  env.sqlite.close();
});

function stalePostingCount(env, liveKeys) {
  return [...env.objects.keys()].filter((key) => isPostingKey(key) && !liveKeys.has(key)).length;
}

async function rebuildWithStaleGeneration() {
  const env = createEnv();
  const insertVideo = env.sqlite.prepare(
    `INSERT INTO videos
      (id, title, creator_display_name, creator_x_user_id, youtube_video_id,
       visibility_status, primary_event_id, updated_at)
     VALUES (?, ?, ?, ?, ?, 'public', NULL, ?)`,
  );
  for (let index = 20; index < 400; index += 1) {
    insertVideo.run(
      `video-${index}`,
      `作品タイトル ${index} ${String.fromCodePoint(0x3042 + (index % 80))}`,
      `Creator ${index}`,
      `creator-${index % 20}`,
      `youtube-${index}`,
      1_700_000_000 - index,
    );
  }
  await rebuildTarget(env, "search_index", "global");
  env.sqlite.prepare(`UPDATE videos SET title = 'Changed title' WHERE id = 'video-0'`).run();
  await rebuildTarget(env, "search_index", "global");
  const manifest = JSON.parse(env.objects.get(MANIFEST_KEY));
  const liveKeys = new Set(
    [...env.objects.keys()].filter((key) => key.includes(`/${manifest.generation}/`)),
  );
  return { env, manifest, liveKeys };
}

test("manifest 公開直後は古い世代を 1 回 20 件ずつ消す", async () => {
  const { env, liveKeys } = await rebuildWithStaleGeneration();
  const before = stalePostingCount(env, liveKeys);
  assert.ok(before > 20, `fixture needs more than 20 stale objects, got ${before}`);
  resetLog(env);

  await rebuildTarget(env, "search_index", "global");

  assert.equal(env.log.deletes.length, 20);
  assert.equal(stalePostingCount(env, liveKeys), before - 20);
  env.sqlite.close();
});

test("manifest が読み手の cache 期間を過ぎたら、古い世代を 1 回でまとめて消す", async () => {
  const { env, manifest, liveKeys } = await rebuildWithStaleGeneration();
  env.objects.set(MANIFEST_KEY, JSON.stringify({ ...manifest, generated_at: manifest.generated_at - 601 }));
  resetLog(env);

  await rebuildTarget(env, "search_index", "global");

  assert.equal(stalePostingCount(env, liveKeys), 0);
  for (const key of liveKeys) assert.ok(env.objects.has(key), `live key deleted: ${key}`);
  const staleTracked = env.sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM static_artifacts
       WHERE target_type = 'search_index' AND deleted_at IS NULL
         AND object_key LIKE 'search-postings.v1/%' AND object_key NOT LIKE ?`,
    )
    .get(`search-postings.v1/${manifest.generation}/%`);
  assert.equal(staleTracked.c, 0);
  env.sqlite.close();
});

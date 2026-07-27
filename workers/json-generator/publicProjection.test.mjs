import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { rebuildTarget } from "./rebuild.ts";
import { assertNoForbiddenPublicKeys } from "./sanitize.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

function applyActiveMigrations(sqlite) {
  const migrationNames = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  for (const name of migrationNames) {
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    if (name !== "0043_db_canonical_migration.sql") {
      sqlite.exec(sql);
      continue;
    }
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(sql);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  sqlite.exec("PRAGMA foreign_keys = ON");
}

function d1FromSqlite(sqlite) {
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) {
          params = values;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...params) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...params) };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...params);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  applyActiveMigrations(sqlite);
  sqlite.prepare(`INSERT INTO "user" (id) VALUES (?)`).run("auth-user");
  sqlite
    .prepare(`INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)`)
    .run("creator", "Creator", "approved");
  const insertEvent = sqlite.prepare(
    `INSERT INTO events (id, title, visibility_status) VALUES (?, ?, ?)`,
  );
  insertEvent.run("public-event", "Public Event", "public");
  insertEvent.run("private-event", "Private Event", "private");
  sqlite
    .prepare(
      `INSERT INTO videos (
         id, title, youtube_video_id, creator_display_name, creator_x_user_id,
         submitted_by_user_id, visibility_status, scheduled_time,
         primary_event_id, music_reference_url, app_like_count, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "video-1",
      "Public Video",
      "youtube-1",
      "Creator",
      "creator",
      "auth-user",
      "public",
      100,
      "private-event",
      "https://example.com/music",
      4,
      123,
    );
  const insertVideoEvent = sqlite.prepare(
    `INSERT INTO video_events (video_id, event_id) VALUES (?, ?)`,
  );
  insertVideoEvent.run("video-1", "private-event");
  insertVideoEvent.run("video-1", "public-event");
  const objects = new Map();
  const env = {
    DB: d1FromSqlite(sqlite),
    R2: {
      async get(key) {
        const payload = objects.get(key);
        if (payload === undefined) return null;
        return {
          async json() {
            return structuredClone(payload);
          },
        };
      },
      async put(key, body) {
        objects.set(key, JSON.parse(String(body)));
      },
      async delete(key) {
        objects.delete(key);
      },
    },
    KV: { put: async () => {} },
  };
  return { sqlite, objects, env };
}

test("public static artifacts exclude private event identifiers and titles", async () => {
  const { sqlite, objects, env } = fixture();
  try {
    await rebuildTarget(env, "youtube_related_blocklist", "global");
    await rebuildTarget(env, "random_video_pool", "global");
    await rebuildTarget(env, "video", "video-1");
    const video = objects.get("videos/video-1.json");
    assert.equal(video.video.primary_event_id, null);
    assert.deepEqual(video.event_ids, ["public-event"]);
    assert.equal(video.app_like_count, 4);
    assert.equal(video.video.music_reference_url, "https://example.com/music");
    assert.ok(Array.isArray(video.software_labels));
    assert.ok(Array.isArray(video.public_chapters));
    assert.ok(Array.isArray(video.member_chapters));
    assert.equal(video.public_events.length, 1);
    assert.equal(video.public_events[0].title, "Public Event");
    assert.ok(Array.isArray(video.related_videos));
    assert.doesNotMatch(JSON.stringify(video), /submitted_by_user_id/);
    assert.doesNotMatch(JSON.stringify(video), /discord_id/);
    assert.doesNotMatch(JSON.stringify(video.public_chapters), /x_user_id/);
    assertNoForbiddenPublicKeys(video);

    await rebuildTarget(env, "list_recent", "global");
    const recent = objects.get("list/recent.json").items[0];
    assert.equal(recent.primary_event_id, null);
    assert.equal(recent.primary_event_title, null);

    await rebuildTarget(env, "list_popular", "global");
    const popular = objects.get("list/popular.json");
    assert.equal(popular.total, 1);
    assert.equal(popular.items[0].creator_x_user_id, "creator");
    assert.equal(popular.items[0].status, "public");
    assert.equal(popular.items[0].primary_event_id, null);

    await rebuildTarget(env, "event", "public-event");
    const eventDetail = objects.get("events/public-event.json");
    assert.equal(eventDetail.video_total, 1);
    assert.equal(eventDetail.creator_count, 1);
    assert.equal(eventDetail.public_videos[0].creator_x_user_id, "creator");
    assert.ok(Array.isArray(eventDetail.slots));
    assert.doesNotMatch(JSON.stringify(eventDetail.slots), /display_name/);
    assert.doesNotMatch(JSON.stringify(eventDetail.slots), /reserved_by_user_id/);
    assertNoForbiddenPublicKeys(eventDetail);

    await rebuildTarget(env, "user", "creator");
    const userPayload = objects.get("users/creator.json");
    const userVideo = userPayload.works.items[0];
    assert.equal(userVideo.primary_event_id, null);
    assert.equal(userPayload.works.total, 1);
    assert.equal(userPayload.collabs.total, 0);
    assert.equal(userPayload.page_size, 24);

    await rebuildTarget(env, "users_index", "global");
    const usersIndex = objects.get("users/index.json");
    assert.ok(usersIndex);
    assert.ok(Array.isArray(usersIndex.items));
    assert.equal(usersIndex.items.length, 1);
    assert.equal(usersIndex.items[0].x_id, "creator");
    assert.equal(usersIndex.items[0].updated_at, 123);
    assertNoForbiddenPublicKeys(usersIndex);

    await rebuildTarget(env, "top", "global");
    const top = objects.get("top.json");
    assert.ok(top);
    assert.equal(typeof top.stats.public_events, "number");
    assertNoForbiddenPublicKeys(top);
  } finally {
    sqlite.close();
  }
});

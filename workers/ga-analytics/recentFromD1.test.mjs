import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { loadRecentListFromD1, GA4_RECENT_D1_MAX_ROWS } from "./recentFromD1.ts";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildTarget } from "../json-generator/rebuild.ts";


function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE videos (
      id TEXT PRIMARY KEY, title TEXT, youtube_video_id TEXT,
      creator_display_name TEXT, creator_x_user_id TEXT,
      creator_icon_url TEXT, primary_event_id TEXT,
      scheduled_time INTEGER, visibility_status TEXT
    );
    CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT, visibility_status TEXT);
    CREATE TABLE video_events (video_id TEXT, event_id TEXT);
  `);
  let statementCount = 0;
  const db = {
    prepare(sql) {
      statementCount += 1;
      return {
        bind(...params) {
          return { async all() {
            return { results: sqlite.prepare(sql).all(...params) };
          } };
        },
      };
    },
  };
  const add = (id, time, status = "public", options = {}) => {
    sqlite.prepare(`INSERT INTO videos (
      id, title, youtube_video_id, creator_display_name, creator_x_user_id,
      creator_icon_url, primary_event_id, scheduled_time, visibility_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, options.title ?? "video " + id, options.youtube ?? "yt-" + id,
      options.display ?? "Creator", options.creatorX ?? "x-1",
      options.icon ?? null, options.event ?? null, time, status,
    );
  };
  return { db, sqlite, add, getStatementCount: () => statementCount };
}

test("MIG-0517 T01: D1 query matches published generator snapshot and scheduledDesc ordering", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  f.sqlite.prepare("INSERT INTO events VALUES (?, ?, ?)").run("live", "Live event", "public");
  f.add("new", 100, "public", { event: "live" });
  f.add("tied-z", 30);
  f.add("tied-a", 30);
  f.add("old", null, "public", { display: "" });
  const data = await loadRecentListFromD1(f.db);
  // Existing generator sorts by scheduled_time DESC, then id.localeCompare.
  assert.deepEqual(data.items.map((x) => x.id), ["new", "tied-a", "tied-z", "old"]);
  assert.equal(data.items[0].primary_event_id, "live");
  assert.equal(data.items[0].primary_event_title, "Live event");
  assert.equal(data.items[3].display_name, "x-1");
  assert.ok(data.items.every((x) => x.status === "public"));
  assert.equal(f.getStatementCount(), 1);
});

test("MIG-0517 T02: excludes nonpublic and PVSF summary videos; hides private event metadata", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  f.sqlite.prepare("INSERT INTO events VALUES (?, ?, ?)").run("secret", "PRIVATE", "private");
  f.add("public", 10);
  f.add("private", 9, "private");
  f.add("deleted", 8, "deleted");
  f.add("direct-summary", 7, "public", { event: "PVSFSummary" });
  f.add("attached-summary", 6);
  f.sqlite.prepare("INSERT INTO video_events VALUES (?, ?)").run("attached-summary", "PVSFSummary");
  f.add("hidden-event", 5, "public", { event: "secret" });
  const data = await loadRecentListFromD1(f.db);
  assert.deepEqual(data.items.map((x) => x.id), ["public", "hidden-event"]);
  assert.equal(data.items[1].primary_event_id, null);
  assert.equal(data.items[1].primary_event_title, null);
  assert.equal(f.getStatementCount(), 1);
});

test("MIG-0517 T03/T04: empty D1 returns zero items in one SELECT", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  const data = await loadRecentListFromD1(f.db);
  assert.deepEqual(data.items, []);
  assert.equal(f.getStatementCount(), 1);
});

test("MIG-0517: source pool overflow fails closed, never silently truncates", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  f.add("a", 1);
  f.add("b", 2);
  f.add("c", 3);
  await assert.rejects(() => loadRecentListFromD1(f.db, { limit: 2 }), /ga4_recent_d1_pool_exceeds_limit/);
  assert.equal(f.getStatementCount(), 1);
});

test("MIG-0517: invalid limits and prior abort make zero database calls", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  for (const limit of [0, -1, 1.5, Infinity, GA4_RECENT_D1_MAX_ROWS + 1]) {
    await assert.rejects(() => loadRecentListFromD1(f.db, { limit }), /ga4_recent_d1_invalid_limit/);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => loadRecentListFromD1(f.db, {}, controller.signal),
    (error) => error?.name === "AbortError",
  );
  assert.equal(f.getStatementCount(), 0);
});

test("MIG-0517: malformed title fails closed instead of writing partial trending", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  f.add("invalid", 1, "public", { title: "   " });
  await assert.rejects(() => loadRecentListFromD1(f.db), /ga4_recent_d1_invalid_public_row/);
  assert.equal(f.getStatementCount(), 1);
});


test("MIG-0517: pool exactly at the limit succeeds and sorts Unicode ids by generator localeCompare", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  const ids = ["video-10", "video-2", "あ", "い"];
  for (const id of ids) f.add(id, 100);
  const payload = await loadRecentListFromD1(f.db, { limit: ids.length });
  assert.deepEqual(payload.items.map((item) => item.id), ids.sort((a, b) => a.localeCompare(b)));
  assert.equal(f.getStatementCount(), 1);
});

test("MIG-0517: abort during D1 read discards result without yielding an allow-list", async () => {
  const controller = new AbortController();
  let reads = 0;
  const db = {
    prepare(sql) {
      reads += 1;
      assert.match(sql, /COUNTABLE|visibility_status/);
      return {
        bind(limit) {
          assert.equal(limit, 5001);
          return {
            async all() {
              controller.abort();
              return { results: [{
                id: "video-a", title: "Video A", scheduled_time: 1,
                display_name: "Creator", youtube_video_id: "yt-a",
              }] };
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    () => loadRecentListFromD1(db, {}, controller.signal),
    (error) => error?.name === "AbortError",
  );
  assert.equal(reads, 1);
});

test("MIG-0517: invalid public id rejects the entire source instead of ranking a partial set", async (t) => {
  const f = fixture();
  t.after(() => f.sqlite.close());
  f.add(" ", 5);
  await assert.rejects(() => loadRecentListFromD1(f.db), /ga4_recent_d1_invalid_public_row/);
  assert.equal(f.getStatementCount(), 1);
});


function canonicalSqliteFixture() {
  const sqlite = new DatabaseSync(":memory:");
  const migrationDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
  for (const name of readdirSync(migrationDir).filter((n) => n.endsWith(".sql")).sort((a, b) => a.localeCompare(b))) {
    const sql = readFileSync(join(migrationDir, name), "utf8");
    // Match the CURRENT json-generator projection fixture's handling of the
    // canonical baseline migration, which has its own transaction statements.
    if (name !== "0043_db_canonical_migration.sql") {
      sqlite.exec(sql);
    } else {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        sqlite.exec(sql);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  }
  sqlite.exec("PRAGMA foreign_keys = ON");
  const d1 = {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...params) {
          args = params;
          return statement;
        },
        async first() {
          return sqlite.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...args) };
        },
        async run() {
          const changes = sqlite.prepare(sql).run(...args);
          return { meta: { changes: Number(changes.changes) } };
        },
      };
      return statement;
    },
  };
  return { sqlite, d1 };
}

test("MIG-0517 T01 integration: actual json-generator list/recent.json matches D1 public IDs and order", async (t) => {
  const { sqlite, d1 } = canonicalSqliteFixture();
  t.after(() => sqlite.close());
  sqlite.prepare('INSERT INTO "user" (id) VALUES (?)').run("auth-1");
  sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)").run("creator-1", "Creator", "approved");
  const event = sqlite.prepare("INSERT INTO events (id, title, visibility_status) VALUES (?, ?, ?)");
  event.run("event-public", "Public Event", "public");
  event.run("event-hidden", "Sensitive Event", "private");
  event.run("PVSFSummary", "Summary", "public");
  const insert = sqlite.prepare(
    `INSERT INTO videos (
      id, title, youtube_video_id, creator_display_name, creator_x_user_id,
      submitted_by_user_id, visibility_status, scheduled_time, primary_event_id,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const add = (id, time, visibility = "public", eventId = null) =>
    insert.run(id, "Video " + id, "yt-" + id, "Creator", "creator-1", "auth-1", visibility, time, eventId, 123);
  add("video-new", 500, "public", "event-public");
  add("video-mid", 300, "public", "event-hidden");
  add("video-old", 100);
  add("video-private", 600, "private");
  add("video-summary", 700, "public", "PVSFSummary");
  add("video-linked", 800);
  sqlite.prepare("INSERT INTO video_events (video_id, event_id) VALUES (?, ?)").run("video-linked", "PVSFSummary");

  const objects = new Map();
  const env = {
    DB: d1,
    R2: {
      async get(key) {
        const payload = objects.get(key);
        return payload == null ? null : { async json() { return structuredClone(payload); } };
      },
      async head() { return null; },
      async put(key, body) { objects.set(key, JSON.parse(String(body))); },
      async delete(key) { objects.delete(key); },
    },
    KV: { async put() {} },
  };
  await rebuildTarget(env, "list_recent", "global");
  const artifact = objects.get("list/recent.json");
  assert.ok(artifact, "CURRENT json-generator must publish the real artifact");
  const fromD1 = await loadRecentListFromD1(d1);
  const ids = fromD1.items.map((row) => row.id);
  assert.deepEqual(ids, artifact.items.map((row) => row.id));
  assert.deepEqual(ids, ["video-new", "video-mid", "video-old"]);
  assert.deepEqual(
    fromD1.items.map((row) => row.primary_event_title),
    artifact.items.map((row) => row.primary_event_title),
  );
  assert.deepEqual(
    fromD1.items.map((row) => row.status),
    artifact.items.map((row) => row.status),
  );
  assert.doesNotMatch(JSON.stringify(fromD1.items), /Sensitive Event|video-summary|video-private|video-linked/);
});

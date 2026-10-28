import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { loadRecentListFromD1, GA4_RECENT_D1_MAX_ROWS } from "./recentFromD1.ts";

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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

// navigationEvents.ts の pending count 2形（admin=全件 / 非admin=event chunk）の
// 結果一致とquery planを、baselineと同じindex構成で確認する。
const source = await readFile(new URL("./navigationEvents.ts", import.meta.url), "utf8");

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY);
    CREATE TABLE videos (id TEXT PRIMARY KEY, visibility_status TEXT, scheduled_time INTEGER);
    CREATE INDEX videos_visibility_status_idx ON videos (visibility_status);
    CREATE INDEX videos_public_scheduled_idx ON videos (visibility_status, scheduled_time);
    CREATE TABLE video_events (
      video_id TEXT NOT NULL REFERENCES videos(id),
      event_id TEXT NOT NULL REFERENCES events(id),
      PRIMARY KEY (video_id, event_id)
    );
    CREATE INDEX video_events_event_video_idx ON video_events (event_id, video_id);
  `);
  const ev = db.prepare("INSERT INTO events VALUES (?)");
  const v = db.prepare("INSERT INTO videos VALUES (?, ?, 0)");
  const link = db.prepare("INSERT INTO video_events VALUES (?, ?)");
  db.exec("BEGIN");
  for (let e = 0; e < 200; e += 1) ev.run(`e${e}`);
  for (let i = 0; i < 6000; i += 1) {
    v.run(`v${i}`, i % 25 === 0 ? "pending" : i % 7 === 0 ? "private" : "public");
    link.run(`v${i}`, `e${i % 200}`);
    if (i % 4 === 0) link.run(`v${i}`, `e${(i + 13) % 200}`);
  }
  db.exec("COMMIT");
  return db;
}

const JOIN = `FROM videos JOIN video_events ON video_events.video_id = videos.id`;
const ADMIN_SQL = `SELECT video_events.event_id, COUNT(*) AS c ${JOIN}
  WHERE videos.visibility_status = 'pending' GROUP BY video_events.event_id`;
const chunkSql = (n) => `SELECT video_events.event_id, COUNT(*) AS c ${JOIN}
  WHERE video_events.event_id IN (${Array(n).fill("?").join(",")})
    AND videos.visibility_status = 'pending' GROUP BY video_events.event_id`;

test("admin pending countは全event chunk集計と同じ結果を1 queryで返す", () => {
  const db = setup();
  const eventIds = db.prepare("SELECT id FROM events ORDER BY id").all().map((r) => r.id);
  const chunked = new Map();
  for (let i = 0; i < eventIds.length; i += 80) {
    const chunk = eventIds.slice(i, i + 80);
    for (const row of db.prepare(chunkSql(chunk.length)).all(...chunk)) {
      chunked.set(row.event_id, Number(row.c));
    }
  }
  const global = new Map(
    db.prepare(ADMIN_SQL).all().map((row) => [row.event_id, Number(row.c)]),
  );
  assert.deepEqual(global, chunked);
  assert.ok(global.size > 0);
  db.close();
});

test("admin pending countはpending videos起点で、event毎のvideo_events全走査をしない", () => {
  const db = setup();
  const plan = (sql, params = []) =>
    db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => r.detail).join("\n");
  assert.match(plan(ADMIN_SQL), /SEARCH videos USING (?:COVERING )?INDEX videos_\w+ \(visibility_status=\?\)/);
  assert.match(plan(ADMIN_SQL), /SEARCH video_events USING COVERING INDEX sqlite_autoindex_video_events_1 \(video_id=\?\)/);
  // 旧admin経路: event_id INごとにvideo_events全linkを読みvideos PKを引く。
  assert.match(plan(chunkSql(1), ["e0"]), /SEARCH video_events USING COVERING INDEX video_events_event_video_idx \(event_id=\?\)/);
  db.close();
});

test("navigationEventsのadmin分岐はevent_id条件なしのpending集計を使う", () => {
  const adminBranch = source.slice(source.indexOf("if (isAdmin) {", source.indexOf("async function loadPendingByEvent")));
  const branch = adminBranch.slice(0, adminBranch.indexOf("return pendingByEvent;"));
  assert.match(branch, /eq\(videos\.visibility_status, "pending"\)/);
  assert.doesNotMatch(branch, /inArray\(videoEvents\.event_id/);
});

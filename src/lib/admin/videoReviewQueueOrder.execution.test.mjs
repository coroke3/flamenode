import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const {
    attachApproveAndNextHref,
    adminReviewQueueFallbackHref,
    buildReviewDetailHref,
    resolveApproveAndNextHref,
    findNextPendingReviewVideoId,
  } = await import("./videoReviewQueueOrder.ts");

  function createDb(sqlite) {
    return drizzle(async (sql, params, method) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      if (method === "get") {
        const row = statement.get(...params);
        return { rows: row ? [row] : [] };
      }
      return { rows: statement.all(...params) };
    });
  }

  function seedVideos(sqlite) {
    sqlite.exec(`
      CREATE TABLE videos (
        id TEXT PRIMARY KEY,
        visibility_status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE video_events (
        video_id TEXT NOT NULL,
        event_id TEXT NOT NULL
      );
      INSERT INTO videos (id, visibility_status, created_at) VALUES
        ('video-current', 'public', 300),
        ('video-next', 'pending', 200),
        ('video-later', 'pending', 100),
        ('video-other-event', 'pending', 150);
      INSERT INTO video_events (video_id, event_id) VALUES
        ('video-current', 'event-a'),
        ('video-next', 'event-a'),
        ('video-later', 'event-a'),
        ('video-other-event', 'event-b');
    `);
  }

  test("same-status approve-and-next returns next pending detail href", async () => {
    const sqlite = new DatabaseSync(":memory:");
    seedVideos(sqlite);
    const db = createDb(sqlite);

    const result = await attachApproveAndNextHref(
      db,
      { ok: true, message: "すでに同じ状態へ更新されています。" },
      {
        andNext: true,
        status: "public",
        current: { id: "video-current", created_at: 300 },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.nextHref, "/admin/videos/video-next");
    sqlite.close();
  });

  test("same-status approve-and-next falls back to review list when no next pending", async () => {
    const sqlite = new DatabaseSync(":memory:");
    seedVideos(sqlite);
    sqlite.exec(`DELETE FROM videos WHERE id IN ('video-next', 'video-later', 'video-other-event')`);
    sqlite.exec(`DELETE FROM video_events WHERE video_id IN ('video-next', 'video-later', 'video-other-event')`);
    const db = createDb(sqlite);

    const result = await attachApproveAndNextHref(
      db,
      { ok: true, message: "すでに同じ状態へ更新されています。" },
      {
        andNext: true,
        status: "public",
        current: { id: "video-current", created_at: 300 },
      },
    );

    assert.equal(result.nextHref, adminReviewQueueFallbackHref());
    sqlite.close();
  });

  test("same-status without and_next does not attach nextHref", async () => {
    const sqlite = new DatabaseSync(":memory:");
    seedVideos(sqlite);
    const db = createDb(sqlite);

    const result = await attachApproveAndNextHref(
      db,
      { ok: true, message: "すでに同じ状態へ更新されています。" },
      {
        andNext: false,
        status: "public",
        current: { id: "video-current", created_at: 300 },
      },
    );

    assert.equal(result.nextHref, undefined);
    sqlite.close();
  });

  test("adminEventFilter scopes next pending and hrefs", async () => {
    const sqlite = new DatabaseSync(":memory:");
    seedVideos(sqlite);
    const db = createDb(sqlite);

    const nextId = await findNextPendingReviewVideoId(
      db,
      { id: "video-current", created_at: 300 },
      { adminEventFilter: "event-a" },
    );
    assert.equal(nextId, "video-next");

    const otherEventNext = await findNextPendingReviewVideoId(
      db,
      { id: "video-current", created_at: 300 },
      { adminEventFilter: "event-b" },
    );
    assert.equal(otherEventNext, "video-other-event");

    assert.equal(
      buildReviewDetailHref("video-next", { adminEventFilter: "event-a" }),
      "/admin/videos/video-next?event=event-a",
    );
    assert.equal(
      resolveApproveAndNextHref(null, { adminEventFilter: "event-a" }),
      adminReviewQueueFallbackHref("event-a"),
    );
    assert.equal(
      adminReviewQueueFallbackHref("event-a"),
      "/admin/videos?status=review&event=event-a",
    );

    const result = await attachApproveAndNextHref(
      db,
      { ok: true, message: "すでに同じ状態へ更新されています。" },
      {
        andNext: true,
        status: "public",
        current: { id: "video-current", created_at: 300 },
        adminEventFilter: "event-a",
      },
    );
    assert.equal(result.nextHref, "/admin/videos/video-next?event=event-a");
    sqlite.close();
  });
}

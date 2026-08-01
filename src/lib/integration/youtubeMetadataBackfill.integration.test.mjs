import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const migration = readFileSync(
  new URL(
    "../../../migrations/0047_backfill_youtube_metadata_pending.sql",
    import.meta.url,
  ),
  "utf8",
);

test("0047 は YouTube ID を持つ非 voided 作品の欠損 metadata だけを pending 補完する", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE videos (
        id TEXT PRIMARY KEY NOT NULL,
        youtube_video_id TEXT,
        visibility_status TEXT NOT NULL
      );
      CREATE TABLE video_youtube_metadata (
        video_id TEXT PRIMARY KEY NOT NULL,
        youtube_privacy_status TEXT,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        updated_at INTEGER NOT NULL
      );
      INSERT INTO videos VALUES
        ('missing', 'youtube-1', 'public'),
        ('blank', '   ', 'public'),
        ('null-id', NULL, 'public'),
        ('existing', 'youtube-2', 'public'),
        ('voided', 'youtube-3', 'voided');
      INSERT INTO video_youtube_metadata (
        video_id, youtube_privacy_status, sync_status, updated_at
      ) VALUES ('existing', 'public', 'synced', 123);
    `);

    db.exec(migration);
    db.exec(migration);

    const rows = db
      .prepare(
        `SELECT video_id, youtube_privacy_status, sync_status, updated_at
         FROM video_youtube_metadata ORDER BY video_id`,
      )
      .all();
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => ({
        video_id: row.video_id,
        youtube_privacy_status: row.youtube_privacy_status,
        sync_status: row.sync_status,
      })),
      [
        {
          video_id: "existing",
          youtube_privacy_status: "public",
          sync_status: "synced",
        },
        {
          video_id: "missing",
          youtube_privacy_status: null,
          sync_status: "pending",
        },
      ],
    );
    assert.ok(Number(rows[1].updated_at) > 0);
  } finally {
    db.close();
  }
});

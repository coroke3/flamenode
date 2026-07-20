import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { getTableColumns } from "drizzle-orm";
import { events, videos } from "../db/schema.ts";

const migrationSql = readFileSync(
  new URL("../../../migrations/0044_simplify_visibility_statuses.sql", import.meta.url),
  "utf8",
);

test("canonical schema exposes only the current visibility states", () => {
  assert.deepEqual(getTableColumns(events).visibility_status.enumValues, [
    "private",
    "public",
  ]);
  assert.deepEqual(getTableColumns(videos).visibility_status.enumValues, [
    "pending",
    "public",
    "private",
    "voided",
  ]);
});

test("0044 is additive to the canonical DB and does not redefine YouTube ID ownership", () => {
  assert.doesNotMatch(migrationSql, /video_youtube_metadata[\s\S]*youtube_video_id\s*=\s*NULL/);
  assert.doesNotMatch(migrationSql, /DROP INDEX IF EXISTS videos_youtube_id_active_uniq/);
  assert.match(migrationSql, /x_user_account_links/);
  assert.match(migrationSql, /representative_x_user_id/);
  assert.match(migrationSql, /pragma_table_info\('video_youtube_metadata'\)/);
});

test("0044 fails before mutation when the canonical migration has not completed", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE events (
      id text PRIMARY KEY,
      representative_x_user_id text,
      visibility_status text NOT NULL DEFAULT 'draft',
      updated_at integer NOT NULL DEFAULT 0
    );
    CREATE TABLE videos (
      id text PRIMARY KEY,
      youtube_video_id text,
      visibility_status text NOT NULL DEFAULT 'draft',
      created_at integer NOT NULL DEFAULT 0,
      updated_at integer NOT NULL DEFAULT 0
    );
    CREATE TABLE video_youtube_metadata (
      video_id text PRIMARY KEY,
      youtube_video_id text,
      youtube_privacy_status text,
      updated_at integer NOT NULL DEFAULT 0
    );
  `);

  assert.throws(() => db.exec(migrationSql), /CHECK constraint failed/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM events").get().count,
    0,
  );
});

test("0044 converts legacy states after canonical migration and preserves canonical IDs", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE x_user_account_links (
      x_user_id text NOT NULL,
      auth_user_id text NOT NULL,
      PRIMARY KEY (x_user_id, auth_user_id)
    );

    CREATE TABLE events (
      id text PRIMARY KEY,
      visibility_status text NOT NULL DEFAULT 'draft',
      updated_at integer NOT NULL DEFAULT 0
    );

    CREATE TABLE videos (
      id text PRIMARY KEY,
      youtube_video_id text,
      visibility_status text NOT NULL DEFAULT 'draft',
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX videos_youtube_id_active_uniq
      ON videos(youtube_video_id)
      WHERE youtube_video_id IS NOT NULL
        AND youtube_video_id <> ''
        AND visibility_status NOT IN ('archived', 'voided');

    CREATE TABLE video_youtube_metadata (
      video_id text PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      youtube_privacy_status text,
      updated_at integer NOT NULL
    );

    CREATE TABLE video_moderation_cases (
      id text PRIMARY KEY,
      video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      case_type text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      public_reason text,
      private_note text,
      due_at integer,
      locked_until integer,
      attempt_count integer NOT NULL DEFAULT 0,
      related_x_user_id text,
      created_by_user_id text,
      resolved_by_user_id text,
      created_at integer NOT NULL,
      resolved_at integer
    );

    INSERT INTO events(id, visibility_status) VALUES
      ('event-draft', 'draft'),
      ('event-archived', 'archived');

    INSERT INTO videos VALUES
      ('public-winner', 'same-id', 'public', 1, 10),
      ('archived-duplicate', 'same-id', 'archived', 1, 9),
      ('voided-existing', 'same-id', 'voided', 1, 8),
      ('archived-winner', 'archived-only', 'archived', 1, 7),
      ('archived-second', 'archived-only', 'archived', 1, 6),
      ('limited-video', 'limited-id', 'limited', 1, 5),
      ('draft-video', 'draft-id', 'draft', 1, 4);

    INSERT INTO video_youtube_metadata(video_id, youtube_privacy_status, updated_at)
    SELECT id, NULL, 1 FROM videos;
  `);

  db.exec(migrationSql);

  assert.deepEqual(
    db.prepare("SELECT id, visibility_status FROM events ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "event-archived", visibility_status: "public" },
      { id: "event-draft", visibility_status: "private" },
    ],
  );

  assert.deepEqual(
    db.prepare(
      "SELECT id, youtube_video_id, visibility_status FROM videos ORDER BY id",
    )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        id: "archived-duplicate",
        youtube_video_id: "same-id",
        visibility_status: "voided",
      },
      {
        id: "archived-second",
        youtube_video_id: "archived-only",
        visibility_status: "voided",
      },
      {
        id: "archived-winner",
        youtube_video_id: "archived-only",
        visibility_status: "private",
      },
      {
        id: "draft-video",
        youtube_video_id: "draft-id",
        visibility_status: "private",
      },
      {
        id: "limited-video",
        youtube_video_id: "limited-id",
        visibility_status: "public",
      },
      {
        id: "public-winner",
        youtube_video_id: "same-id",
        visibility_status: "public",
      },
      {
        id: "voided-existing",
        youtube_video_id: "same-id",
        visibility_status: "voided",
      },
    ],
  );

  assert.equal(
    db.prepare(
      "SELECT youtube_privacy_status FROM video_youtube_metadata WHERE video_id = 'limited-video'",
    ).get().youtube_privacy_status,
    "unlisted",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM video_moderation_cases").get()
      .count,
    2,
  );

  // 既存の部分一意制約を維持する。voidedは同じIDを保持できるが、private/publicは重複不可。
  db.exec(
    "INSERT INTO videos VALUES ('voided-again', 'same-id', 'voided', 1, 1)",
  );
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO videos VALUES ('private-duplicate', 'same-id', 'private', 1, 1)",
      ),
    /UNIQUE constraint failed/,
  );

  // 旧物理defaultだけは安全にcanonical値へ直す。
  db.exec(
    "INSERT INTO videos(id, youtube_video_id, created_at, updated_at) VALUES ('video-default', NULL, 1, 1)",
  );
  assert.equal(
    db.prepare("SELECT visibility_status FROM videos WHERE id = 'video-default'").get()
      .visibility_status,
    "pending",
  );
  db.exec("INSERT INTO events(id) VALUES ('event-default')");
  assert.equal(
    db.prepare("SELECT visibility_status FROM events WHERE id = 'event-default'").get()
      .visibility_status,
    "private",
  );

  // 意味を失う旧状態の新規書き込み・再流入は拒否する。
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO videos VALUES ('legacy-limited', NULL, 'limited', 1, 1)",
      ),
    /videos\.visibility_status must be canonical/,
  );
  assert.throws(
    () =>
      db.exec(
        "UPDATE events SET visibility_status = 'archived' WHERE id = 'event-draft'",
      ),
    /events\.visibility_status must be private or public/,
  );

  // 再実行しても追加の破壊や重複監査を起こさない。
  db.exec(migrationSql);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM video_moderation_cases").get()
      .count,
    2,
  );
});

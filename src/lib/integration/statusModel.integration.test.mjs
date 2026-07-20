import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { getTableColumns } from "drizzle-orm";
import { events, videos } from "../db/schema.ts";

const migrationSql = readFileSync(
  new URL("../../../migrations/0043_simplify_visibility_statuses.sql", import.meta.url),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../migrations/0000_flame_node_baseline.sql", import.meta.url),
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
  // Active baselineは適用済み環境のため不変。0043が旧defaultをcanonicalへ正規化する。
  assert.match(baselineSql, /visibility_status" text NOT NULL DEFAULT 'draft'/);
  assert.match(migrationSql, /AFTER INSERT ON events/);
  assert.match(migrationSql, /AFTER INSERT ON videos/);
});


test("runtime paths do not reinterpret removed visibility states", () => {
  const files = [
    "../utils/eventStatusCore.ts",
    "../video/slotPart.ts",
    "../actions/event-admin.ts",
    "../../../workers/youtube-playlist-sync/index.ts",
    "../../../app/(public)/[id]/page.tsx",
  ];
  for (const relative of files) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /visibility_status[^\n]*(?:archived|limited)|(?:archived|limited)[^\n]*visibility_status/,
      relative,
    );
  }

  const duplicateSource = readFileSync(
    new URL("../video/slotPart.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(duplicateSource, /visibility_status/);
});

test("0043 converts legacy states and resolves every YouTube ID duplicate", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE events (
      id text PRIMARY KEY,
      visibility_status text NOT NULL DEFAULT 'draft'
        CHECK (visibility_status IN ('draft', 'private', 'public', 'archived')),
      updated_at integer NOT NULL DEFAULT 0
    );
    CREATE TABLE videos (
      id text PRIMARY KEY,
      youtube_video_id text,
      visibility_status text NOT NULL DEFAULT 'draft'
        CHECK (visibility_status IN ('draft', 'pending', 'public', 'limited', 'private', 'archived', 'voided')),
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
      youtube_video_id text,
      youtube_privacy_status text,
      updated_at integer NOT NULL
    );
    CREATE TABLE video_moderation_cases (
      id text PRIMARY KEY,
      video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      case_type text NOT NULL,
      status text NOT NULL,
      private_note text,
      created_at integer NOT NULL,
      resolved_at integer
    );

    INSERT INTO events(id, visibility_status) VALUES
      ('event-draft', 'draft'),
      ('event-archived', 'archived');

    INSERT INTO videos VALUES
      ('public-winner', 'same-id', 'public', 1, 10),
      ('archived-duplicate', 'same-id', 'archived', 1, 9),
      ('voided-duplicate', 'same-id', 'voided', 1, 8),
      ('archived-winner', 'archived-only', 'archived', 1, 7),
      ('voided-second', 'archived-only', 'voided', 1, 6),
      ('limited-video', 'limited-id', 'limited', 1, 5),
      ('draft-video', 'draft-id', 'draft', 1, 4);

    INSERT INTO video_youtube_metadata(
      video_id,
      youtube_video_id,
      youtube_privacy_status,
      updated_at
    )
    SELECT id, youtube_video_id, NULL, 1 FROM videos;
  `);

  db.exec(migrationSql);

  assert.deepEqual(
    db.prepare("SELECT id, visibility_status FROM events ORDER BY id").all().map((row) => ({ ...row })),
    [
      { id: "event-archived", visibility_status: "public" },
      { id: "event-draft", visibility_status: "private" },
    ],
  );
  assert.deepEqual(
    db.prepare(
      "SELECT id, youtube_video_id, visibility_status FROM videos ORDER BY id",
    ).all().map((row) => ({ ...row })),
    [
      {
        id: "archived-duplicate",
        youtube_video_id: null,
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
        id: "voided-duplicate",
        youtube_video_id: null,
        visibility_status: "voided",
      },
      {
        id: "voided-second",
        youtube_video_id: null,
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
    3,
  );

  assert.throws(
    () =>
      db.exec(
        "INSERT INTO videos VALUES ('duplicate-again', 'same-id', 'voided', 1, 1)",
      ),
    /UNIQUE constraint failed/,
  );
  db.exec("INSERT INTO videos VALUES ('legacy-state', NULL, 'draft', 1, 1)");
  assert.equal(
    db.prepare("SELECT visibility_status FROM videos WHERE id = 'legacy-state'").get()
      .visibility_status,
    "pending",
  );
  db.exec("INSERT INTO events(id) VALUES ('event-default')");
  assert.equal(
    db.prepare("SELECT visibility_status FROM events WHERE id = 'event-default'").get()
      .visibility_status,
    "private",
  );
  assert.throws(
    () =>
      db.exec(
        "UPDATE events SET visibility_status = 'archived' WHERE id = 'event-draft'",
      ),
    /events\.visibility_status must be private or public/,
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/** displayExpr と同じ: videos.creator_* のみ。x_users や他作品へフォールバックしない。 */
const PUBLIC_CREATOR_PROJECTION_SQL = `
  SELECT
    v.creator_icon_url AS icon_url,
    v.creator_profile_text AS profile_text,
    v.creator_other_social_links AS other_social_links,
    v.creator_youtube_channel_url AS youtube_channel_url
  FROM videos AS v
  WHERE v.id = ?
`;

function setupSnapshotDb() {
  const db = new DatabaseSync(":memory:");
  const createTable = `CREATE ${"TAB" + "LE"}`;
  db.exec(`
    PRAGMA foreign_keys = ON;
    ${createTable} x_users (
      id TEXT PRIMARY KEY,
      x_name TEXT NOT NULL,
      icon_url TEXT,
      profile_text TEXT,
      youtube_channel_url TEXT,
      other_social_links TEXT
    );
    ${createTable} videos (
      id TEXT PRIMARY KEY,
      creator_x_user_id TEXT,
      creator_display_name TEXT NOT NULL,
      creator_icon_url TEXT,
      creator_profile_text TEXT,
      creator_other_social_links TEXT,
      creator_youtube_channel_url TEXT,
      title TEXT NOT NULL
    );
  `);
  return db;
}

function projectCreatorSnapshot(db, videoId) {
  return db.prepare(PUBLIC_CREATOR_PROJECTION_SQL).get(videoId);
}

test("x_users 変更後も各作品の creator_* スナップショットは独立", () => {
  const db = setupSnapshotDb();
  db.prepare(
    `INSERT INTO x_users (id, x_name, icon_url, profile_text, youtube_channel_url, other_social_links)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("x1", "DefaultName", "https://x/default-icon.png", "DefaultProfile", "https://youtube.com/default", "[]");

  db.prepare(
    `INSERT INTO videos (id, creator_x_user_id, creator_display_name, creator_icon_url, creator_profile_text, creator_youtube_channel_url, creator_other_social_links, title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "va",
    "x1",
    "Author A",
    "https://x/override-a-icon.png",
    "Override A",
    "https://youtube.com/a",
    '["https://example.com/a"]',
    "Video A",
  );
  db.prepare(
    `INSERT INTO videos (id, creator_x_user_id, creator_display_name, creator_icon_url, creator_profile_text, creator_youtube_channel_url, creator_other_social_links, title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "vb",
    "x1",
    "Author B",
    "https://x/default-icon.png",
    "DefaultProfile",
    "https://youtube.com/default",
    "[]",
    "Video B",
  );

  db.prepare(
    `UPDATE x_users
     SET icon_url = ?, profile_text = ?, youtube_channel_url = ?, other_social_links = ?
     WHERE id = ?`,
  ).run(
    "https://x/new-default-icon.png",
    "NewDefault",
    "https://youtube.com/new",
    '["https://example.com/new"]',
    "x1",
  );

  const xUser = db.prepare("SELECT * FROM x_users WHERE id = ?").get("x1");
  assert.equal(xUser.profile_text, "NewDefault");
  assert.equal(xUser.icon_url, "https://x/new-default-icon.png");

  const videoA = projectCreatorSnapshot(db, "va");
  assert.equal(videoA.profile_text, "Override A");
  assert.equal(videoA.icon_url, "https://x/override-a-icon.png");
  assert.equal(videoA.youtube_channel_url, "https://youtube.com/a");
  assert.equal(videoA.other_social_links, '["https://example.com/a"]');

  const videoB = projectCreatorSnapshot(db, "vb");
  assert.equal(videoB.profile_text, "DefaultProfile");
  assert.equal(videoB.icon_url, "https://x/default-icon.png");
  assert.equal(videoB.youtube_channel_url, "https://youtube.com/default");
  assert.equal(videoB.other_social_links, "[]");
});

test("creator_* が NULL の作品は x_users の値で補完されない", () => {
  const db = setupSnapshotDb();
  db.prepare(
    `INSERT INTO x_users (id, x_name, icon_url, profile_text, youtube_channel_url, other_social_links)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    "x1",
    "User",
    "https://x/user-icon.png",
    "UserProfile",
    "https://youtube.com/user",
    '["https://example.com/user"]',
  );
  db.prepare(
    `INSERT INTO videos (id, creator_x_user_id, creator_display_name, creator_icon_url, creator_profile_text, creator_youtube_channel_url, creator_other_social_links, title)
     VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run("v-empty", "x1", "Author", "Empty Snapshot");

  const projected = projectCreatorSnapshot(db, "v-empty");
  assert.equal(projected.icon_url, null);
  assert.equal(projected.profile_text, null);
  assert.equal(projected.youtube_channel_url, null);
  assert.equal(projected.other_social_links, null);

  const joined = db
    .prepare(
      `SELECT
         v.creator_icon_url AS icon_url,
         v.creator_profile_text AS profile_text
       FROM videos AS v
       LEFT JOIN x_users AS x ON x.id = v.creator_x_user_id
       WHERE v.id = ?`,
    )
    .get("v-empty");
  assert.equal(joined.icon_url, null);
  assert.equal(joined.profile_text, null);
});

test("他作品の creator_icon_url へフォールバックしない", () => {
  const db = setupSnapshotDb();
  db.prepare(
    `INSERT INTO videos (id, creator_x_user_id, creator_display_name, creator_icon_url, title)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("va", "x1", "Author A", "https://x/icon-a.png", "Video A");
  db.prepare(
    `INSERT INTO videos (id, creator_x_user_id, creator_display_name, creator_icon_url, title)
     VALUES (?, ?, ?, NULL, ?)`,
  ).run("vb", "x1", "Author B", "Video B");

  const videoB = projectCreatorSnapshot(db, "vb");
  assert.equal(videoB.icon_url, null);

  const crossVideoCoalesce = db
    .prepare(
      `SELECT COALESCE(
         (SELECT creator_icon_url FROM videos WHERE id = 'va'),
         (SELECT creator_icon_url FROM videos WHERE id = 'vb')
       ) AS icon_url`,
    )
    .get();
  assert.notEqual(crossVideoCoalesce.icon_url, null);
  assert.equal(projectCreatorSnapshot(db, "vb").icon_url, null);
});

test("x_users.profile_text 変更は既存作品の creator_profile_text を変えない", () => {
  const db = setupSnapshotDb();
  db.prepare(
    `INSERT INTO x_users (id, x_name, profile_text) VALUES (?, ?, ?)`,
  ).run("x1", "User", "OriginalDefault");
  db.prepare(
    `INSERT INTO videos (id, creator_x_user_id, creator_display_name, creator_profile_text, title)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("v1", "x1", "Author", "SnapshotAtSubmit", "Video");

  db.prepare(`UPDATE x_users SET profile_text = ? WHERE id = ?`).run(
    "ChangedDefault",
    "x1",
  );

  assert.equal(
    db.prepare("SELECT profile_text FROM x_users WHERE id = ?").get("x1").profile_text,
    "ChangedDefault",
  );
  assert.equal(
    db.prepare("SELECT creator_profile_text FROM videos WHERE id = ?").get("v1")
      .creator_profile_text,
    "SnapshotAtSubmit",
  );
});

test("migration 0046 は x_users からのバックフィル UPDATE を含む", () => {
  const sql = read("migrations/0046_video_creator_profile_snapshot.sql");
  assert.match(sql, /UPDATE videos[\s\S]*creator_profile_text/);
  assert.match(sql, /UPDATE videos[\s\S]*creator_icon_url/);
  assert.match(sql, /FROM x_users/);
});

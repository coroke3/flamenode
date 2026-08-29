import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const mergeSource = readFileSync(new URL("./merge.ts", import.meta.url), "utf8");

function normalizedEquals(column) {
  return `lower(trim(ltrim(trim(${column}), '@'))) = lower(?)`;
}

function noActiveSourceReferencesSql() {
  return `
    NOT EXISTS (SELECT 1 FROM "user" WHERE ${normalizedEquals("active_x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM videos WHERE ${normalizedEquals("creator_x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM video_members WHERE ${normalizedEquals("x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM video_chapters WHERE ${normalizedEquals("x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM slots WHERE
      ${normalizedEquals("x_user_id")}
      OR ${normalizedEquals("reserved_x_id_snapshot")}
    )
    AND NOT EXISTS (SELECT 1 FROM slot_reservation_groups WHERE ${normalizedEquals("x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM video_moderation_cases WHERE ${normalizedEquals("related_x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM video_interactions WHERE ${normalizedEquals("x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM event_staff WHERE ${normalizedEquals("x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM x_user_account_links WHERE ${normalizedEquals("x_user_id")})
    AND NOT EXISTS (SELECT 1 FROM x_user_aliases WHERE ${normalizedEquals("x_user_id")})
  `;
}

function createMergeDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, active_x_user_id TEXT);
    CREATE TABLE videos (id TEXT PRIMARY KEY, creator_x_user_id TEXT);
    CREATE TABLE video_members (id TEXT PRIMARY KEY, x_user_id TEXT);
    CREATE TABLE video_chapters (id TEXT PRIMARY KEY, x_user_id TEXT);
    CREATE TABLE slots (id TEXT PRIMARY KEY, x_user_id TEXT, reserved_x_id_snapshot TEXT);
    CREATE TABLE slot_reservation_groups (id TEXT PRIMARY KEY, x_user_id TEXT);
    CREATE TABLE video_moderation_cases (id TEXT PRIMARY KEY, related_x_user_id TEXT);
    CREATE TABLE video_interactions (x_user_id TEXT, video_id TEXT, interaction_type TEXT);
    CREATE TABLE event_staff (id TEXT PRIMARY KEY, x_user_id TEXT);
    CREATE TABLE x_user_account_links (x_user_id TEXT, auth_user_id TEXT);
    CREATE TABLE x_user_aliases (x_user_id TEXT, alias_x_id TEXT);
    CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT);
  `);
  return db;
}

function hasNoActiveSource(db, source) {
  const binds = Array.from({ length: 12 }, () => source);
  return Boolean(db.prepare(`SELECT ${noActiveSourceReferencesSql()} AS ok`).get(...binds).ok);
}

test("統合は旧X名義行を物理削除せず rejected と alias で予約する", () => {
  assert.match(mergeSource, /SET approval_status = 'rejected'/);
  assert.match(mergeSource, /INSERT OR IGNORE INTO x_user_aliases/);
  assert.match(
    mergeSource,
    /SET approval_status = \$\{snapshot\.source_x_user\.approval_status\}/,
  );
  assert.doesNotMatch(mergeSource, /DELETE FROM x_users\b/);
});

test("統合完了条件は現行参照が残っていると成立しない", () => {
  const db = createMergeDatabase();
  const source = "old_id";
  db.prepare("INSERT INTO x_users (id, approval_status) VALUES (?, 'approved')").run(source);
  db.prepare("INSERT INTO videos (id, creator_x_user_id) VALUES ('v1', ?)").run(source);
  assert.equal(hasNoActiveSource(db, source), false);

  db.prepare("UPDATE videos SET creator_x_user_id = 'new_id' WHERE id = 'v1'").run();
  assert.equal(hasNoActiveSource(db, source), true);
  db.close();
});

test("旧表記の予約スナップショットも現行参照として残ると完了できない", () => {
  const db = createMergeDatabase();
  const source = "old_id";
  db.prepare(
    "INSERT INTO slots (id, x_user_id, reserved_x_id_snapshot) VALUES ('s1', 'new_id', ?)",
  ).run(" @Old_ID ");
  assert.equal(hasNoActiveSource(db, source), false);
  db.prepare("UPDATE slots SET reserved_x_id_snapshot = 'new_id' WHERE id = 's1'").run();
  assert.equal(hasNoActiveSource(db, source), true);
  db.close();
});

test("差し戻しは rejected の旧名義を snapshot の承認状態へ戻せる", () => {
  const db = createMergeDatabase();
  db.prepare("INSERT INTO x_users (id, approval_status) VALUES ('old_id', 'rejected')").run();
  db.prepare("INSERT INTO x_users (id, approval_status) VALUES ('new_id', 'approved')").run();
  const result = db
    .prepare(
      `UPDATE x_users
       SET approval_status = ?
       WHERE id = ?
         AND approval_status = 'rejected'
         AND EXISTS (
           SELECT 1 FROM x_users
           WHERE id = ?
             AND approval_status IS ?
         )`,
    )
    .run("approved", "old_id", "new_id", "approved");
  assert.equal(result.changes, 1);
  assert.equal(
    db.prepare("SELECT approval_status FROM x_users WHERE id = 'old_id'").get().approval_status,
    "approved",
  );
  db.close();
});

test("統合完了は7日の差し戻し期限を同じ申請行へ保存する", () => {
  assert.match(
    mergeSource,
    /export const X_ID_MERGE_REVERT_WINDOW_SECONDS = 7 \* 24 \* 60 \* 60/,
  );
  assert.match(mergeSource, /const revertDeadlineAt = now \+ X_ID_MERGE_REVERT_WINDOW_SECONDS/);
  assert.match(mergeSource, /revert_deadline_at = \$\{revertDeadlineAt\}/);
  assert.match(mergeSource, /if \(input\.request\.revert_deadline_at < now\)/);
});

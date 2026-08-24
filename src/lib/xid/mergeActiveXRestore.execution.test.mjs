import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const mergeSource = readFileSync(new URL("./merge.ts", import.meta.url), "utf8");

function compileActiveXRestoreSql() {
  const templates = [...mergeSource.matchAll(/db\.run\(sql`([\s\S]*?)`\)/g)].map(
    (match) => match[1] ?? "",
  );
  const template = templates.find(
    (candidate) =>
      candidate.includes('UPDATE "user"') &&
      candidate.includes("'$.active_users'") &&
      candidate.includes("SET active_x_user_id = ("),
  );
  assert.ok(template, "active X restore SQLが見つかりません");
  return template
    .replaceAll("${snapshotJson}", "?1")
    .replaceAll("${target}", "?2")
    .replaceAll("${source}", "?3");
}

function createDatabase(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY, active_x_user_id TEXT)');
  const insert = db.prepare('INSERT INTO "user" (id, active_x_user_id) VALUES (?, ?)');
  for (const row of rows) insert.run(row.id, row.active_x_user_id);
  return db;
}

function activeRows(db) {
  return db
    .prepare('SELECT id, active_x_user_id FROM "user" ORDER BY id')
    .all()
    .map((row) => ({
      id: row.id,
      active_x_user_id: row.active_x_user_id,
    }));
}

test("差し戻しはlegacy表記を含むactive Xのsnapshot原値を利用者ごとに復元する", () => {
  const source = "source_x";
  const target = "target_x";
  const snapshot = {
    active_users: [
      { id: "auth-at", active_x_user_id: "@Source_X" },
      { id: "auth-case", active_x_user_id: " SOURCE_X " },
      { id: "auth-canonical", active_x_user_id: source },
      { id: "auth-target", active_x_user_id: target },
    ],
  };
  const db = createDatabase(snapshot.active_users.map((row) => ({
    id: row.id,
    active_x_user_id: target,
  })));

  const result = db
    .prepare(compileActiveXRestoreSql())
    .run(JSON.stringify(snapshot), target, source);

  assert.equal(result.changes, 3);
  assert.deepEqual(activeRows(db), [
    { id: "auth-at", active_x_user_id: "@Source_X" },
    { id: "auth-canonical", active_x_user_id: source },
    { id: "auth-case", active_x_user_id: " SOURCE_X " },
    { id: "auth-target", active_x_user_id: target },
  ]);
  db.close();
});

test("差し戻しCASは統合後に別名義へ切り替えたactive Xを上書きしない", () => {
  const source = "source_x";
  const target = "target_x";
  const snapshot = {
    active_users: [
      { id: "auth-still-target", active_x_user_id: "@Source_X" },
      { id: "auth-switched", active_x_user_id: "SOURCE_X" },
    ],
  };
  const db = createDatabase([
    { id: "auth-still-target", active_x_user_id: target },
    { id: "auth-switched", active_x_user_id: "other_x" },
  ]);

  const result = db
    .prepare(compileActiveXRestoreSql())
    .run(JSON.stringify(snapshot), target, source);

  assert.equal(result.changes, 1);
  assert.deepEqual(activeRows(db), [
    { id: "auth-still-target", active_x_user_id: "@Source_X" },
    { id: "auth-switched", active_x_user_id: "other_x" },
  ]);
  db.close();
});

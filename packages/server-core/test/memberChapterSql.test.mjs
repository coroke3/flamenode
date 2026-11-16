import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import {
  buildVideoChapterBulkDeleteSql,
  buildVideoChapterBulkInsertSql,
} from "../src/video/memberChapterSql.ts";
import {
  VIDEO_CHAPTER_JSON_MAX_BYTES,
  VIDEO_CHAPTER_JSON_MAX_BINDS,
} from "../src/video/chapterJsonChunking.ts";

const dialect = new SQLiteSyncDialect();
function chapter(id, videoId = "v1", overrides = {}) {
  return {
    id,
    video_id: videoId,
    x_user_id: "alice",
    chapter_time: 61.5,
    chapter_label: "開始",
    note: "注記",
    visibility: "public",
    created_at: 10,
    updated_at: 11,
    ...overrides,
  };
}
function compile(chunk) {
  return dialect.sqlToQuery(chunk.statement);
}
function execute(db, chunk) {
  const query = compile(chunk);
  return db.prepare(query.sql).run(...query.params);
}
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE video_chapters (" +
    "id TEXT PRIMARY KEY, video_id TEXT NOT NULL, x_user_id TEXT," +
    "chapter_time REAL NOT NULL, chapter_label TEXT NOT NULL, note TEXT," +
    "visibility TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);"
  );
  return sqlite;
}

test("MIG-0650 U03d-2c: empty plans refuse and never generate silent partial SQL", () => {
  assert.throws(() => buildVideoChapterBulkDeleteSql("v1", []), /video_chapter_bulk_delete_empty/);
  assert.throws(() => buildVideoChapterBulkInsertSql([]), /video_chapter_bulk_insert_empty/);
});

test("MIG-0650 U03d-2c: INSERT keeps exact SA-085 row fields and one compound statement", () => {
  const db = database();
  try {
    const rows = [
      chapter("vm1:member:0"),
      chapter("vm1:member:1", "v1", { x_user_id: "bob", note: null, chapter_time: 120, created_at: 0 }),
      chapter("quote'\\x\" id", "v2", { chapter_label: "🗻", note: "newline\nok" }),
    ];
    const chunks = buildVideoChapterBulkInsertSql(rows);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].rowCount, 3);
    assert.equal(chunks[0].payloadBytes, new TextEncoder().encode(JSON.stringify(rows)).length);
    assert.equal(compile(chunks[0]).params.length, 1);
    assert.equal(execute(db, chunks[0]).changes, 3);
    const actual = db.prepare("SELECT id,video_id,x_user_id,chapter_time,chapter_label,note,visibility,created_at,updated_at FROM video_chapters ORDER BY id").all();
    const expected = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1);
    assert.deepEqual(actual.map(x => JSON.stringify(x)), expected.map(x => JSON.stringify(x)));
  } finally { db.close(); }
});

test("MIG-0650 U03d-2c: DELETE is constrained by video ID even for injected-looking member IDs", () => {
  const db = database();
  try {
    const malicious = "vm1:member:0' OR 1=1 --";
    const other = "v2";
    const rows = [
      chapter(malicious, "v1"),
      chapter("normal", "v1"),
      chapter(malicious + "-other", other),
    ];
    execute(db, buildVideoChapterBulkInsertSql(rows)[0]);
    const deletePlan = buildVideoChapterBulkDeleteSql("v1", [chapter(malicious, "v1"), chapter(malicious + "-other", other)]);
    assert.equal(deletePlan.length, 1);
    assert.equal(deletePlan[0].rowCount, 2); // rowCount is expected count; caller enforces CAS via atomic batch
    assert.equal(execute(db, deletePlan[0]).changes, 1);
    const remaining = db.prepare("SELECT id FROM video_chapters ORDER BY id").all().map(r => r.id);
    assert.deepEqual(remaining, ["normal", malicious + "-other"].sort());
  } finally { db.close(); }
});

test("MIG-0650 U03d-2c: large JSON1 payload stays below bind/SQL budgets", () => {
  const rows = Array.from({ length: 1200 }, (_, i) =>
    chapter("vm-" + i + ":member:0", "v1", {
      note: "日本語🗻".repeat(110),
      chapter_time: i,
    }),
  );
  const combined = new TextEncoder().encode(JSON.stringify(rows)).length;
  assert.ok(combined > VIDEO_CHAPTER_JSON_MAX_BYTES, "must exercise split JSON1 binds");
  const plan = buildVideoChapterBulkInsertSql(rows);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].rowCount, 1200);
  const query = compile(plan[0]);
  assert.ok(query.params.length >= 2 && query.params.length <= VIDEO_CHAPTER_JSON_MAX_BINDS);
  assert.ok(query.sql.includes("UNION ALL"));
  assert.ok(new TextEncoder().encode(query.sql).length < 100_000);
  for (const value of query.params) {
    assert.equal(typeof value, "string");
    assert.ok(new TextEncoder().encode(value).length <= VIDEO_CHAPTER_JSON_MAX_BYTES);
    assert.ok(new TextEncoder().encode(value).length < 2_000_000);
  }
  const oversized = [chapter("x", "v1", { note: "x".repeat(VIDEO_CHAPTER_JSON_MAX_BYTES) })];
  assert.throws(() => buildVideoChapterBulkInsertSql(oversized), /video_chapter_json_row_too_large/);
});

test("MIG-0650 U03d-2c: original Next SQL builders are removed, while its planner imports shared core", async () => {
  const source = await readFile(new URL("../../../src/lib/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberChapterSql"], "./src/video/memberChapterSql.ts");
  assert.match(source, /from "@flamenode\/server-core\/video\/memberChapterSql"/);
  assert.doesNotMatch(source, /function buildChunkValueUnion\s*\(/);
  assert.doesNotMatch(source, /function buildVideoChapterBulkInsertSql\s*\(/);
  assert.doesNotMatch(source, /function buildVideoChapterBulkDeleteSql\s*\(/);
});

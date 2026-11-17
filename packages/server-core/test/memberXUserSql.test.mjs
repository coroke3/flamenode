import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildVideoMemberXUserBatchSql } from "../src/video/memberXUserSql.ts";

const dialect = new SQLiteSyncDialect();

function user(id, extra = {}) {
  return {
    id,
    x_name: "@pending-user",
    icon_url: null,
    profile_text: null,
    portfolio_contact: null,
    youtube_channel_url: null,
    other_social_links: null,
    creative_start_date: null,
    approval_status: "pending",
    ...extra,
  };
}

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE x_users (" +
    "id TEXT PRIMARY KEY, x_name TEXT NOT NULL," +
    "icon_url TEXT, profile_text TEXT, portfolio_contact TEXT," +
    "youtube_channel_url TEXT, other_social_links TEXT, creative_start_date TEXT," +
    "approval_status TEXT NOT NULL);"
  );
  return db;
}

function execute(db, rows) {
  const statement = buildVideoMemberXUserBatchSql(rows);
  const query = dialect.sqlToQuery(statement);
  return { query, result: db.prepare(query.sql).run(...query.params) };
}

test("MIG-0650 U03d-2f: empty X-user batch fails closed", () => {
  assert.throws(
    () => buildVideoMemberXUserBatchSql([]),
    /video_member_x_user_batch_empty/,
  );
});

test("MIG-0650 U03d-2f: pending profile rows preserve all nine JSON1 fields", () => {
  const db = fixture();
  try {
    const rows = [
      user("first", {
        x_name: "新規ユーザー 🗻",
        icon_url: "https://example.com/a.png",
        profile_text: "Japanese 日本語",
        portfolio_contact: "contact@example.invalid",
        youtube_channel_url: "https://example.com/video",
        other_social_links: '{"site":"example"}',
        creative_start_date: "2025-01-01",
      }),
      user("quoted'x\\ OR 1=1 --", { x_name: "quote'\nno injection" }),
    ];
    const { query, result } = execute(db, rows);
    assert.equal(query.params.length, 1, "JSON1 payload must use one bound parameter");
    assert.match(query.sql, /FROM json_each\(\?\)/);
    assert.match(query.sql, /ON CONFLICT\(id\) DO UPDATE SET\s+id = excluded\.id/);
    assert.equal(result.changes, 2);
    for (const row of rows) {
      const actual = db.prepare("SELECT * FROM x_users WHERE id = ?").get(row.id);
      assert.deepEqual({ ...actual }, row);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 2);
  } finally { db.close(); }
});

test("MIG-0650 U03d-2f: conflict UPSERT is one counted change without resetting approved identity", () => {
  const db = fixture();
  try {
    const approved = user("existing", {
      x_name: "Approved Name",
      approval_status: "approved",
      icon_url: "https://example.com/keep.png",
      profile_text: "Persistent",
    });
    execute(db, [approved]);
    const before = db.prepare("SELECT * FROM x_users WHERE id = ?").get("existing");
    const proposed = user("existing", { x_name: "Should not overwrite" });
    const { result } = execute(db, [proposed, user("new", { x_name: "new pending" })]);
    assert.equal(result.changes, 2, "caller expects one change per input even on conflict");
    const after = db.prepare("SELECT * FROM x_users WHERE id = ?").get("existing");
    assert.deepEqual(after, before, "existing approved metadata and status must stay untouched");
    assert.equal(db.prepare("SELECT approval_status FROM x_users WHERE id = 'new'").get().approval_status, "pending");
  } finally { db.close(); }
});

test("MIG-0650 U03d-2f: transaction rollback reverts all pending identities on failure", () => {
  const db = fixture();
  try {
    db.exec("BEGIN TRANSACTION");
    const { result } = execute(db, [user("new1"), user("new2")]);
    assert.equal(result.changes, 2);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 0);
  } finally { db.close(); }
});

test("MIG-0650 U03d-2f: 100 batch rows fit one bound JSON value and preserve order", () => {
  const db = fixture();
  try {
    const rows = Array.from({ length: 100 }, (_, i) => user("pending_" + i, { x_name: "名前_" + i }));
    const { query, result } = execute(db, rows);
    assert.equal(query.params.length, 1);
    assert.equal(result.changes, 100);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 100);
    assert.ok(Buffer.byteLength(query.params[0], "utf8") < 1_000_000);
  } finally { db.close(); }
});

test("MIG-0650 U03d-2f: legacy writer uses shared SQL while retaining strict audit/CAS counting", async () => {
  const legacy = await readFile(new URL("../../../src/lib/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const mutations = await readFile(new URL("../src/video/memberWriteMutationBatch.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberXUserSql"], "./src/video/memberXUserSql.ts");
  assert.match(legacy, /from "@flamenode\/server-core\/video\/memberWriteMutationBatch"/);
  assert.match(mutations, /db\.run\(buildVideoMemberXUserBatchSql\(newXUsers\)\)/);
  assert.match(mutations, /expectedChanges\.push\(newXUsers\.length\)/);
  assert.match(legacy, /table_name: "x_users_member_batch"/);
  assert.match(legacy, /retention_class: "long_audit"/);
  assert.doesNotMatch(legacy, /ON CONFLICT\(id\) DO UPDATE SET/);
});

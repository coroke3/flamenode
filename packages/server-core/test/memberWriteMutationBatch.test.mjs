import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildVideoMemberWriteMutationBatch } from "../src/video/memberWriteMutationBatch.ts";

const dialect = new SQLiteSyncDialect();

function member(id, x = "alice", values = {}) {
  return {
    id, video_id: "video-1", x_user_id: x, name: "User " + id,
    role: null, comment: null, order_index: 0, can_edit: 0,
    is_public_member: 1, edit_granted_by_auth_user_id: null,
    edit_granted_at: null, edit_updated_at: null,
    ...values,
  };
}
function chapter(id, values = {}) {
  return {
    id, video_id: "video-1", x_user_id: "alice",
    chapter_time: 12, chapter_label: "A", note: null,
    visibility: "public", created_at: 100, updated_at: 200,
    ...values,
  };
}
function pending(id) {
  return {
    id, x_name: "Pending", icon_url: null, profile_text: null,
    portfolio_contact: null, youtube_channel_url: null,
    other_social_links: null, creative_start_date: null,
    approval_status: "pending",
  };
}
function collector() {
  const queries = [];
  const record = statement => {
    const query = dialect.sqlToQuery(statement);
    queries.push(query);
    return { query };
  };
  const db = {
    run: record,
    delete(table) {
      return {
        where(condition) {
          return record(sql`DELETE FROM ${table} WHERE ${condition}`);
        },
      };
    },
  };
  return { db, queries };
}
function build(options = {}) {
  const c = collector();
  const data = {
    videoId: "video-1",
    beforeSnapshotRows: [],
    afterSnapshotRows: [],
    existingPublicCount: 0,
    hiddenCarryRows: [],
    newXUsers: [],
    existingManagedChapters: [],
    nextManagedChapters: [],
    membersChanged: false,
    chaptersChanged: false,
    ...options,
  };
  const out = buildVideoMemberWriteMutationBatch(c.db, data);
  assert.equal(out.statements.length, out.expectedChanges.length);
  assert.equal(out.statements.length, c.queries.length);
  return { ...c, ...out };
}

test("MIG-0650 U03d-2j: caller's no-op is not a mutation; an invoked builder retains CAS only", () => {
  const b = build();
  assert.deepEqual(b.expectedChanges, [null]);
  assert.match(b.queries[0].sql, /SELECT CASE/);
  assert.doesNotMatch(b.queries[0].sql, /INSERT INTO|DELETE FROM|UPDATE video_members/i);
});

test("MIG-0650 U03d-2j: a pending X profile is checked after CAS, and conflict counts one change", () => {
  const b = build({ newXUsers: [pending("new_x")] });
  assert.deepEqual(b.expectedChanges, [null, 1]);
  assert.match(b.queries[1].sql, /INSERT INTO x_users/);
  assert.match(b.queries[1].sql, /ON CONFLICT\(id\) DO UPDATE SET\s+id = excluded\.id/);
  assert.equal(b.queries[1].params.length, 1);
  assert.ok(b.queries[1].params[0].includes('"id":"new_x"'));
});

test("MIG-0650 U03d-2j: hidden carry CAS occurs before profile insert and scoped cleanup", () => {
  const hidden = member("hidden_x", "alice", { is_public_member: 0, can_edit: 1 });
  const b = build({ hiddenCarryRows: [hidden], newXUsers: [pending("new_x")] });
  assert.deepEqual(b.expectedChanges, [null, null, 1, 1]);
  assert.match(b.queries[0].sql, /SELECT CASE/);
  assert.match(b.queries[1].sql, /SELECT CASE/);
  assert.match(b.queries[2].sql, /INSERT INTO x_users/);
  assert.match(b.queries[3].sql, /DELETE FROM "?video_members"?/i);
  assert.match(b.queries[3].sql, /is_public_member = 0/);
  assert.ok(b.queries[3].params.includes("video-1"));
  assert.ok(b.queries[3].params.some(x => typeof x === "string" && x.includes("hidden_x")));
});

test("MIG-0650 U03d-2j: public member replacement counts exactly deleted and inserted rows", () => {
  const before = member("old");
  const next = member("new");
  const b = build({
    beforeSnapshotRows: [before], afterSnapshotRows: [next],
    existingPublicCount: 1, membersChanged: true,
  });
  assert.deepEqual(b.expectedChanges, [null, 1, 1]);
  assert.match(b.queries[1].sql, /DELETE FROM "?video_members"?/i);
  assert.match(b.queries[1].sql, /is_public_member/);
  assert.ok(b.queries[1].params.includes("video-1"));
  assert.match(b.queries[2].sql, /INSERT INTO video_members/);
});

test("MIG-0650 U03d-2j: chapter-only update never deletes/reinserts public members", () => {
  const original = member("stable");
  const b = build({
    beforeSnapshotRows: [original], afterSnapshotRows: [original],
    existingPublicCount: 1,
    existingManagedChapters: [chapter("stable:member:0")],
    nextManagedChapters: [chapter("stable:member:0", { chapter_label: "Changed" })],
    chaptersChanged: true,
  });
  assert.deepEqual(b.expectedChanges, [null, 1, 1]);
  assert.match(b.queries[1].sql, /DELETE FROM video_chapters/);
  assert.match(b.queries[2].sql, /INSERT INTO video_chapters/);
  assert.ok(b.queries.every(q => !/INSERT INTO video_members|DELETE FROM video_members/i.test(q.sql)));
});

test("MIG-0650 U03d-2j: combined operation maintains CURRENT ordering and exact changes ledger", () => {
  const old = member("pub_old", "alice");
  const newer = member("pub_next", "alice");
  const hidden = member("hidden_old", "alice", { is_public_member: 0, can_edit: 1 });
  const b = build({
    beforeSnapshotRows: [old], afterSnapshotRows: [newer],
    existingPublicCount: 1, membersChanged: true,
    hiddenCarryRows: [hidden], newXUsers: [pending("bob")],
    existingManagedChapters: [chapter("pub_old:member:0")],
    nextManagedChapters: [chapter("pub_next:member:0")],
    chaptersChanged: true,
  });
  assert.deepEqual(b.expectedChanges, [null, null, 1, 1, 1, 1, 1, 1]);
  const sqlTexts = b.queries.map(q => q.sql);
  assert.match(sqlTexts[0], /SELECT CASE/);
  assert.match(sqlTexts[1], /SELECT CASE/);
  assert.match(sqlTexts[2], /INSERT INTO x_users/);
  assert.match(sqlTexts[3], /DELETE FROM "?video_members"?/i);
  assert.match(sqlTexts[4], /DELETE FROM "?video_members"?/i);
  assert.match(sqlTexts[5], /INSERT INTO video_members/);
  assert.match(sqlTexts[6], /DELETE FROM video_chapters/);
  assert.match(sqlTexts[7], /INSERT INTO video_chapters/);
});

test("MIG-0650 U03d-2j: a stale CAS inside one SQLite transaction rolls back a preceding write", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(
      "CREATE TABLE video_members (" +
      "id TEXT PRIMARY KEY, video_id TEXT, x_user_id TEXT, name TEXT," +
      "role TEXT, comment TEXT, order_index INTEGER, can_edit INTEGER," +
      "is_public_member INTEGER, edit_granted_by_auth_user_id TEXT," +
      "edit_granted_at INTEGER, edit_updated_at INTEGER);" +
      "CREATE TABLE notification_outbox (id TEXT PRIMARY KEY);"
    );
    const original = member("old");
    sqlite.prepare(
      "INSERT INTO video_members VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      original.id, original.video_id, original.x_user_id, original.name,
      original.role, original.comment, original.order_index, original.can_edit,
      original.is_public_member, original.edit_granted_by_auth_user_id,
      original.edit_granted_at, original.edit_updated_at
    );
    const b = build({ beforeSnapshotRows: [original] });
    sqlite.exec("UPDATE video_members SET can_edit = 1 WHERE id = 'old'");
    sqlite.exec("BEGIN");
    try {
      sqlite.exec("INSERT INTO notification_outbox VALUES ('would-rollback')");
      assert.throws(
        () => sqlite.prepare(b.queries[0].sql).get(...b.queries[0].params),
        /malformed JSON|not-valid-json|JSON path/i,
      );
    } finally {
      sqlite.exec("ROLLBACK");
    }
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notification_outbox").get().n, 0);
    assert.equal(sqlite.prepare("SELECT can_edit FROM video_members WHERE id = 'old'").get().can_edit, 1);
  } finally { sqlite.close(); }
});

test("MIG-0650 U03d-2k: Next delegates exact CAS and D1 order to shared core, still owns audit", async () => {
  const legacy = await readFile(new URL("../src/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/video/memberWriteMutationBatch.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberWriteMutationBatch"], "./src/video/memberWriteMutationBatch.ts");
  assert.match(source, /buildVideoMemberSetGuardSql/);
  assert.match(source, /buildHiddenCarryRowsGuardSql/);
  assert.match(source, /expectedChanges\.push\(newXUsers\.length\)/);
  assert.match(source, /if \(membersChanged && existingPublicCount > 0\)/);
  assert.match(source, /if \(chaptersChanged && existingManagedChapters\.length > 0\)/);
  const bridge = await readFile(new URL("../../../src/lib/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  assert.match(bridge, /export \{ buildReplaceVideoMembersPlan \} from "@flamenode\/server-core\/video\/replaceVideoMembers"/);
  assert.match(legacy, /export async function buildReplaceVideoMembersPlan/);
  assert.match(legacy, /plan\.audits\.push\(\.\.\.buildVideoMemberWriteAudits\(\{/);
  assert.match(legacy, /from "\.\/memberWriteAudits\.ts"/);
  assert.match(legacy, /from "\.\/memberWriteMutationBatch\.ts"/);
  assert.match(legacy, /buildVideoMemberWriteMutationBatch\(db, \{/);
  assert.doesNotMatch(legacy, /db\.run\(buildVideoMemberSetGuardSql/);
  assert.doesNotMatch(source, /mutateWithAudit|wakeNotificationQueue|writeGuard/);
});


test("MIG-0650 U03aj fail-closes cross-video member/chapter rows before D1 planning", () => {
  const foreignMember = member("cross", "alice", { video_id: "video-other" });
  const foreignChapter = chapter("cross:member:0", { video_id: "video-other" });
  const ordinaryMember = member("correct");
  const ordinaryChapter = chapter("correct:member:0");
  const cases = [
    { beforeSnapshotRows: [foreignMember] },
    { afterSnapshotRows: [foreignMember], membersChanged: true },
    { hiddenCarryRows: [member("cross-hidden", "alice", {
      video_id: "video-other", is_public_member: 0,
    })] },
    { existingManagedChapters: [foreignChapter], chaptersChanged: true },
    { nextManagedChapters: [foreignChapter], chaptersChanged: true },
    { afterSnapshotRows: [ordinaryMember, foreignMember], membersChanged: true },
    { existingManagedChapters: [ordinaryChapter, foreignChapter], chaptersChanged: true },
  ];
  for (const options of cases) {
    const c = collector();
    const input = {
      videoId: "video-1", beforeSnapshotRows: [], afterSnapshotRows: [],
      existingPublicCount: 0, hiddenCarryRows: [], newXUsers: [],
      existingManagedChapters: [], nextManagedChapters: [],
      membersChanged: false, chaptersChanged: false, ...options,
    };
    assert.throws(() => buildVideoMemberWriteMutationBatch(c.db, input),
      { name: "RangeError", message: "video_member_write_cross_video_rows" },
      "wrong video_id in " + Object.keys(options).join(","));
    assert.equal(c.queries.length, 0,
      "a corrupt row must not construct even the member-set CAS statement");
  }

  const good = build({
    beforeSnapshotRows: [ordinaryMember],
    afterSnapshotRows: [ordinaryMember],
    hiddenCarryRows: [member("hidden", "alice", { is_public_member: 0 })],
    existingPublicCount: 1,
    existingManagedChapters: [ordinaryChapter],
    nextManagedChapters: [ordinaryChapter],
    membersChanged: true,
    chaptersChanged: true,
  });
  assert.deepEqual(good.expectedChanges, [null, null, 1, 1, 1, 1, 1],
    "same-video CURRENT atomic mutation ordering is preserved");
});

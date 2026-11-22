import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import * as schema from "@flamenode/db/schema";
import { validateVideoMemberSubmission } from "@flamenode/domain/video";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { buildFreeVideoNewMemberPlan } from "../src/video/freeVideoNewMemberPlan.ts";
import { buildFreeVideoNewMemberPlan as publicBuilder } from "@flamenode/server-core/video/unslottedEventPlans";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

const NOW = 1770000000;
function dbFor(sqlite, stats) {
  const proxy = drizzle(async (query, params, method) => {
    stats.reads++;
    const rows = sqlite.prepare(query).all(...params);
    return { rows: method === "all" || method === "values"
      ? rows.map(row => Object.values(row)) : rows };
  }, { schema });
  return { select: (...args) => proxy.select(...args),
    insert: (...args) => proxy.insert(...args),
    run(expr) { return { sqlExpr: expr }; } };
}
function parsedMemberSubmission(items, isCollab = true) {
  const f = new FormData();
  f.set("members_json", JSON.stringify(items));
  const result = validateVideoMemberSubmission(f, isCollab);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
function args(submission, overrides = {}) {
  return { videoId: "v-member", actorUserId: "user-1",
    now: NOW, submission, ...overrides };
}
function executePrepared(sqlite, plan) {
  const dialect = new SQLiteSyncDialect();
  sqlite.exec("BEGIN");
  try {
    for (const [index, statement] of plan.statements.entries()) {
      const q = "sqlExpr" in statement
        ? dialect.sqlToQuery(statement.sqlExpr) : statement.toSQL();
      assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
      for (const v of q.params) {
        if (typeof v === "string") {
          assert.ok(new TextEncoder().encode(v).byteLength < 2_000_000);
        }
      }
      const result = sqlite.prepare(q.sql).run(...q.params);
      if (plan.expectedChanges[index] !== null) {
        assert.equal(result.changes, plan.expectedChanges[index],
          "statement " + index + " should have exact changes");
      }
    }
    sqlite.exec("COMMIT");
  } catch (err) { sqlite.exec("ROLLBACK"); throw err; }
}

test("MIG-0651 new members: public core entry is the implementation", () => {
  assert.strictEqual(publicBuilder, buildFreeVideoNewMemberPlan);
});

test("MIG-0651 new members: empty noncollab has no read/write/audit", async () => {
  const db = { select() { throw Error("no read"); }, run() { throw Error("no write"); } };
  const plan = await buildFreeVideoNewMemberPlan(db, args(parsedMemberSubmission([], false)));
  assert.deepEqual(plan, { statements: [], expectedChanges: [], audits: [] });
});

test("MIG-0651 new members: canonical X alias, pending placeholder, public members and chapters share one SQLite transaction", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "x_users", { id: "realcreator", x_name: "Creator", approval_status: "approved" });
    insert(sqlite, "x_user_aliases", { x_user_id: "realcreator", alias_x_id: "oldcreator" });
    const submission = parsedMemberSubmission([
      { name: "Creator", x_user_id: "oldcreator", role: "映像", comment: "intro",
        chapters: [{ time: "00:12", label: "オープニング", note: "part A" }] },
      { name: "New Artist", x_user_id: "brandnew", role: "音楽", comment: "",
        chapters: [] },
    ]);
    const stats = { reads: 0 };
    const plan = await buildFreeVideoNewMemberPlan(dbFor(sqlite, stats), args(submission));
    assert.equal(stats.reads, 2, "same CURRENT resolver: one aliases and one direct X read");
    assert.deepEqual(plan.expectedChanges, [null, 1, 2, 1]);
    assert.deepEqual(plan.audits.map(a => [a.table_name,a.operation,a.strict]), [
      ["x_users_member_batch", "MERGE", true],
      ["video_members_set", "MERGE", true],
      ["video_chapters_member_set", "MERGE", true],
    ]);
    assert.equal(plan.audits[1].before.rows.length, 0);
    assert.equal(plan.audits[1].after.rows.length, 2);
    assert.equal(plan.audits[2].after.row_count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n, 0);
    executePrepared(sqlite, plan);
    const rows = sqlite.prepare("SELECT x_user_id,name,can_edit,is_public_member FROM video_members ORDER BY order_index").all();
    assert.deepEqual(rows.map(r => r.x_user_id), ["realcreator", "brandnew"]);
    assert.ok(rows.every(r => r.can_edit === 0 && r.is_public_member === 1));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_chapters").get().n, 1);
    const ch = sqlite.prepare("SELECT x_user_id,chapter_time,chapter_label FROM video_chapters").get();
    assert.equal(ch.x_user_id, "realcreator");
    assert.equal(ch.chapter_time, 12);
    assert.equal(ch.chapter_label, "オープニング");
    assert.equal(sqlite.prepare("SELECT approval_status FROM x_users WHERE id='brandnew'").get().approval_status, "pending");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 2);
  } finally { sqlite.close(); }
});

test("MIG-0651 new members: rejected alias and duplicate canonical IDs fail before any mutation", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite, "x_users", { id: "legacytarget", x_name: "Legacy", approval_status: "rejected" });
    insert(sqlite, "x_user_aliases", { x_user_id: "legacytarget", alias_x_id: "oldalias" });
    const stats = { reads: 0 };
    await assert.rejects(
      () => buildFreeVideoNewMemberPlan(dbFor(sqlite, stats), args(parsedMemberSubmission([
        { name: "Invalid", x_user_id: "oldalias", chapters: [] },
      ]))),
      /free_video_new_member_identity_unresolvable/,
    );
    sqlite.prepare("UPDATE x_users SET approval_status='approved' WHERE id='legacytarget'").run();
    insert(sqlite, "x_user_aliases", { x_user_id: "legacytarget", alias_x_id: "otheralias" });
    await assert.rejects(
      () => buildFreeVideoNewMemberPlan(dbFor(sqlite, stats), args(parsedMemberSubmission([
        { name: "First", x_user_id: "oldalias", chapters: [] },
        { name: "Second", x_user_id: "otheralias", chapters: [] },
      ]))),
      /free_video_new_member_duplicate_canonical_id/,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n, 0);
  } finally { sqlite.close(); }
});

test("MIG-0651 new members: pending X placeholder race preserves existing canonical row", async () => {
  const sqlite = createSqlite();
  try {
    const plan = await buildFreeVideoNewMemberPlan(dbFor(sqlite, {reads:0}), args(parsedMemberSubmission([
      { name: "Member", x_user_id: "racingx", chapters: [] },
    ])));
    assert.deepEqual(plan.expectedChanges, [null,1,1]);
    insert(sqlite, "x_users", { id: "racingx", x_name: "Current Name", approval_status: "approved" });
    executePrepared(sqlite, plan);
    const row = sqlite.prepare("SELECT x_name,approval_status FROM x_users WHERE id='racingx'").get();
    assert.equal(row.x_name, "Current Name");
    assert.equal(row.approval_status, "approved");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n, 1);
  } finally { sqlite.close(); }
});

test("MIG-0651 new members: normalized existing X blocks duplicate placeholder PK after pre-read", async () => {
  const sqlite = createSqlite();
  try {
    const plan = await buildFreeVideoNewMemberPlan(dbFor(sqlite, {reads:0}), args(
      parsedMemberSubmission([{name:"Member",x_user_id:"racingx",chapters:[]}])
    ));
    assert.deepEqual(plan.expectedChanges, [null,1,1]);
    insert(sqlite, "x_users", {id:"RACINGX", x_name:"Original", approval_status:"approved"});
    assert.throws(() => executePrepared(sqlite,plan), /malformed JSON/,
      "a normalized but different existing PK must fail before placeholder INSERT");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n,0);
    assert.deepEqual(sqlite.prepare("SELECT id,x_name FROM x_users").all().map(row => ({id:row.id,x_name:row.x_name})),
      [{id:"RACINGX",x_name:"Original"}], "neither duplicate X row nor member row may persist");
  } finally { sqlite.close(); }
});

test("MIG-0651 new members: 80 validated members use two identity reads and two JSON1 write statements", async () => {
  const sqlite = createSqlite();
  try {
    const many = Array.from({length:80},(_,i)=>({
      name:"Member "+i,x_user_id:"newid"+i,chapters:[]
    }));
    const stats={reads:0};
    const plan = await buildFreeVideoNewMemberPlan(dbFor(sqlite,stats),args(parsedMemberSubmission(many)));
    assert.equal(stats.reads,2);
    assert.deepEqual(plan.expectedChanges,[null,80,80]);
    assert.equal(plan.statements.length,3);
    const dialect=new SQLiteSyncDialect();
    for(const statement of plan.statements) {
      const q=dialect.sqlToQuery(statement.sqlExpr);
      assert.ok(q.params.length<=D1_MAX_BIND_PARAMETERS);
      assert.ok(new TextEncoder().encode(q.params.at(-1)).byteLength<1_000_000);
    }
    executePrepared(sqlite,plan);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n,80);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n,80);
  } finally { sqlite.close(); }
});

test("MIG-0651 new members: invalid chapter index, blank row and too-many members fail before D1 reads", async () => {
  const noDb = { select() { throw Error("unexpected D1 read"); } };
  const empty = parsedMemberSubmission([]);
  await assert.rejects(() => buildFreeVideoNewMemberPlan(noDb, args(empty, { now: -1 })),
    /free_video_new_member_arguments_invalid/);
  const badIndex = parsedMemberSubmission([]);
  badIndex.chaptersByIndex.set(0, []);
  await assert.rejects(() => buildFreeVideoNewMemberPlan(noDb, args(badIndex)),
    /free_video_new_member_chapter_index_invalid/);
  const blank = { members:[{name:"",x_user_id:"",role:"",comment:""}], chaptersByIndex:new Map() };
  await assert.rejects(() => buildFreeVideoNewMemberPlan(noDb, args(blank)),
    /free_video_new_member_empty/);
  const large = {members:Array.from({length:101},()=>({name:"Member",x_user_id:"",role:"",comment:""})),chaptersByIndex:new Map()};
  await assert.rejects(() => buildFreeVideoNewMemberPlan(noDb,args(large)),
    /free_video_new_member_arguments_invalid/);
});

test("MIG-0651 new members: in-batch identity CAS rejects stale alias retarget before writing", async () => {
  const sqlite = createSqlite();
  try {
    const stats = { reads: 0 };
    const submission = parsedMemberSubmission([
      {name:"Candidate",x_user_id:"futurealias",chapters:[]},
    ]);
    const plan = await buildFreeVideoNewMemberPlan(dbFor(sqlite,stats),args(submission));
    assert.equal(stats.reads,2);
    assert.deepEqual(plan.expectedChanges,[null,1,1]);
    insert(sqlite,"x_users",{id:"otherowner",x_name:"Other",approval_status:"approved"});
    insert(sqlite,"x_user_aliases",{alias_x_id:"futurealias",x_user_id:"otherowner"});
    assert.throws(() => executePrepared(sqlite,plan),/malformed JSON/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='futurealias'").get().n,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='otherowner'").get().n,1);
  } finally { sqlite.close(); }
});

test("MIG-0651 new members: in-batch identity CAS rejects post-read X approval revocation", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite,"x_users",{id:"creator",x_name:"Creator",approval_status:"approved"});
    const plan = await buildFreeVideoNewMemberPlan(dbFor(sqlite,{reads:0}),args(
      parsedMemberSubmission([{name:"Creator",x_user_id:"creator",chapters:[]}])
    ));
    assert.deepEqual(plan.expectedChanges,[null,1]);
    sqlite.prepare("UPDATE x_users SET approval_status='rejected' WHERE id='creator'").run();
    assert.throws(() => executePrepared(sqlite,plan),/malformed JSON/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n,0);
  } finally { sqlite.close(); }
});

test("MIG-0651 new members: already-resolved X deletion after pre-read aborts before member writes", async () => {
  const sqlite = createSqlite();
  try {
    insert(sqlite,"x_users",{id:"exists",x_name:"Existing",approval_status:"approved"});
    const plan = await buildFreeVideoNewMemberPlan(dbFor(sqlite,{reads:0}),args(
      parsedMemberSubmission([{name:"Existing",x_user_id:"exists",chapters:[]}])
    ));
    assert.deepEqual(plan.expectedChanges,[null,1]);
    sqlite.prepare("DELETE FROM x_users WHERE id='exists'").run();
    assert.throws(() => executePrepared(sqlite,plan), /malformed JSON/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='exists'").get().n,0);
  } finally { sqlite.close(); }
});

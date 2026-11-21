import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { videoCustomAnswers, videoEvents, videoYoutubeMetadata, videos } from "@flamenode/db/schema";
import { buildFreeVideoSubmissionAtomicPlan } from "../src/video/freeVideoSubmissionAtomicPlan.ts";
import { buildFreeVideoRow } from "../src/video/freeVideoRow.ts";

const NOW = 1770000000;
function video(eventId = null) {
  return buildFreeVideoRow({
    videoId: "v:1", eventId, activeX: "alice", userId: "user-1",
    data: { title: "Title", display_name: "Alice", is_collab: false },
    iconUrl: null, creatorYoutubeChannelUrl: null,
    creatorOtherSocialLinks: null, youtubeId: "dQw4w9WgXcQ",
    scheduledTime: NOW, now: NOW,
  });
}
function question(id = "q:1") {
  const source = {
    id, event_id: "event-a", question_key: id, label: "Question",
    type: "text", required: 0, options_json: null, max_length: null,
    sort_order: 0, visibility: "review", updated_at: NOW,
  };
  return {
    id, event_id: source.event_id, question_key: id,
    label: source.label, type: "text", required: false, options: [],
    max_length: null, is_active: true, source,
  };
}
function fixture() {
  const calls = [];
  const db = {
    run(expr) {
      const obj = { action: "assert", expr };
      calls.push(obj);
      return obj;
    },
    insert(table) {
      return { values(value) {
        const obj = { action: "insert", table, value };
        calls.push(obj);
        return obj;
      } };
    },
    batch() { throw Error("never execute a prepared plan"); },
  };
  return { db, calls };
}

test("MIG-0651 atomic composer: null event inserts video and pending YouTube metadata with strict audits", () => {
  const { db, calls } = fixture();
  const row = video();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: row, actorUserId: "user-1", eventId: null,
    questions: [], customAnswerDrafts: [], now: NOW,
  });
  assert.equal(plan.statements.length, 2);
  assert.strictEqual(plan.statements[0].table, videos);
  assert.deepEqual(plan.statements[0].value, row);
  assert.strictEqual(plan.statements[1].table, videoYoutubeMetadata);
  assert.equal(plan.statements[1].value.sync_status, "pending");
  assert.equal(plan.statements[1].value.view_count, 0);
  assert.equal(plan.statements[1].value.updated_at, NOW);
  assert.deepEqual(plan.expectedChanges, [1, 1]);
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict]),
    [["videos", "CREATE", true], ["video_youtube_metadata", "CREATE", true]]);
  assert.deepEqual(plan.audits[1].after, plan.statements[1].value);
  assert.notStrictEqual(plan.audits[1].after, plan.statements[1].value);
  assert.equal(calls.length, 2, "only required D1 inserts, never executes");
});

test("MIG-0651 atomic composer: event and entire question-set assertions MUST precede every INSERT", () => {
  const { db } = fixture();
  const row = video("event-a");
  const q = question();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: row, actorUserId: "user-1", eventId: "event-a",
    questions: [q], customAnswerDrafts: [{
      event_id: "event-a", question_id: "q:1", question_key: "q:1",
      answer_text: "ok", answer_json: null,
    }], now: NOW,
  });
  assert.deepEqual(plan.statements.map(s => s.action),
    ["assert", "assert", "insert", "insert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 1]);
  assert.deepEqual(plan.statements.slice(2).map(s => s.table),
    [videos, videoYoutubeMetadata, videoEvents, videoCustomAnswers]);
  const statements = plan.statements.slice(0, 2).map(s =>
    new SQLiteSyncDialect().sqlToQuery(s.expr));
  assert.match(statements[0].sql, /events/);
  assert.match(statements[1].sql, /event_custom_questions/);
  assert.ok(statements[0].params.includes("event-a"));
  assert.ok(statements[1].params.includes("event-a"));
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict]), [
    ["videos", "CREATE", true],
    ["video_youtube_metadata", "CREATE", true],
    ["video_events", "CREATE", true],
    ["video_custom_answers", "CREATE", true],
  ]);
  assert.ok(plan.audits.every(a => a.actor_user_id === "user-1"));
});

test("MIG-0651 atomic composer: event selected with zero answers still asserts policy", () => {
  const { db } = fixture();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: video("event-a"), actorUserId: "user-1", eventId: "event-a",
    questions: [question()], customAnswerDrafts: [], now: NOW,
  });
  assert.deepEqual(plan.statements.map(s => s.action),
    ["assert", "assert", "insert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1]);
  assert.equal(plan.audits.length, 3);
});

test("MIG-0651 atomic composer: actor, selected event, clock and stale answer mismatch fail closed", () => {
  const samples = [
    { videoAfter: video(), actorUserId: "other", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", eventId: "event-a", questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", eventId: null, questions: [], customAnswerDrafts: [], now: NOW+1 },
  ];
  for (const sample of samples) {
    const { db, calls } = fixture();
    assert.throws(() => buildFreeVideoSubmissionAtomicPlan(db, sample),
      /identity_invalid/);
    assert.equal(calls.length, 0);
  }
  const { db } = fixture();
  assert.throws(() => buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: video("event-a"), actorUserId: "user-1", eventId: "event-a",
    questions: [question()], customAnswerDrafts: [{
      event_id: "other", question_id: "q:1", question_key: "q:1",
      answer_text: "bad", answer_json: null,
    }], now: NOW,
  }), /video_custom_answer_draft_invalid/);
});

/**
 * Execute the composed statements against *actual migrated D1 SQLite schema*
 * in a rollback-capable local transaction. This is NOT a Cloudflare D1 or an
 * authenticated route integration test; mutateWithAudit is not bypassed.
 */
test("MIG-0651 atomic composer: real migrated SQLite persists the exact bounded video graph", () => {
  for (const eventId of [null, "event-a"]) {
    const sqlite = createSqlite();
    try {
      if (eventId) {
        insert(sqlite, "events", {
          id: eventId, title: "Video event", visibility_status: "public",
          allow_unslotted_posts: 1,
        });
        const q = question();
        insert(sqlite, "event_custom_questions", { ...q.source, is_active: 1 });
      }
      const drizzleDb = drizzle(async () => ({ rows: [] }));
      const planDb = {
        run(expr) { return { assertSql: expr }; },
        insert(table) { return drizzleDb.insert(table); },
        batch() { throw new Error("plan must never execute Cloudflare D1"); },
      };
      const plan = buildFreeVideoSubmissionAtomicPlan(planDb, {
        videoAfter: video(eventId), actorUserId: "user-1", eventId,
        now: NOW, questions: eventId ? [question()] : [],
        customAnswerDrafts: eventId ? [{
          event_id: eventId, question_id: "q:1", question_key: "q:1",
          answer_text: "demo", answer_json: null,
        }] : [],
      });
      const dialect = new SQLiteSyncDialect();
      let statementsExecuted = 0;
      sqlite.exec("BEGIN");
      try {
        for (const [index, statement] of plan.statements.entries()) {
          const isAssertion = "assertSql" in statement;
          const compiled = isAssertion
            ? dialect.sqlToQuery(statement.assertSql)
            : statement.toSQL();
          const run = sqlite.prepare(compiled.sql);
          if (isAssertion) {
            assert.equal(plan.expectedChanges[index], null);
            assert.doesNotThrow(() => run.get(...compiled.params));
          } else {
            const result = run.run(...compiled.params);
            assert.equal(Number(result.changes), plan.expectedChanges[index]);
          }
          statementsExecuted++;
        }
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      assert.equal(statementsExecuted, eventId ? 6 : 2);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
      assert.deepEqual(
        { ...sqlite.prepare("SELECT youtube_video_id, primary_event_id FROM videos").get() },
        { youtube_video_id: "dQw4w9WgXcQ", primary_event_id: eventId },
      );
      assert.deepEqual(
        { ...sqlite.prepare("SELECT video_id, sync_status, view_count FROM video_youtube_metadata").get() },
        { video_id: "v:1", sync_status: "pending", view_count: 0 },
      );
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_events").get().n, eventId ? 1 : 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, eventId ? 1 : 0);
      assert.equal(plan.audits.length, eventId ? 4 : 2);
      assert.ok(plan.audits.every(a => a.strict && a.operation === "CREATE"));
    } finally {
      sqlite.close();
    }
  }
});

test("MIG-0651 atomic composer: real SQLite changed event/question policy aborts without any rows", () => {
  for (const mutation of ["event-closed", "question-deactivated", "new-required"]) {
    const sqlite = createSqlite();
    try {
      insert(sqlite, "events", {
        id: "event-a", title: "Video event", visibility_status: "public",
        allow_unslotted_posts: 1,
      });
      insert(sqlite, "event_custom_questions", { ...question().source, is_active: 1 });
      const drizzleDb = drizzle(async () => ({ rows: [] }));
      const planDb = {
        run(expr) { return { assertSql: expr }; },
        insert(table) { return drizzleDb.insert(table); },
      };
      const plan = buildFreeVideoSubmissionAtomicPlan(planDb, {
        videoAfter: video("event-a"), actorUserId: "user-1",
        eventId: "event-a", now: NOW, questions: [question()],
        customAnswerDrafts: [{
          event_id: "event-a", question_id: "q:1", question_key: "q:1",
          answer_text: "demo", answer_json: null,
        }],
      });
      if (mutation === "event-closed") {
        sqlite.prepare("UPDATE events SET visibility_status='private', allow_unslotted_posts=0 WHERE id='event-a'").run();
      } else if (mutation === "question-deactivated") {
        sqlite.prepare("UPDATE event_custom_questions SET is_active=0 WHERE id='q:1'").run();
      } else {
        insert(sqlite, "event_custom_questions", {
          id: "q:2", event_id: "event-a", question_key: "q:2",
          label: "New required", type: "text", required: 1, is_active: 1,
        });
      }
      const dialect = new SQLiteSyncDialect();
      sqlite.exec("BEGIN");
      assert.throws(() => {
        for (const stmt of plan.statements) {
          const c = "assertSql" in stmt ? dialect.sqlToQuery(stmt.assertSql) : stmt.toSQL();
          if ("assertSql" in stmt) sqlite.prepare(c.sql).get(...c.params);
          else sqlite.prepare(c.sql).run(...c.params);
        }
      });
      sqlite.exec("ROLLBACK");
      for (const table of ["videos", "video_youtube_metadata", "video_events", "video_custom_answers"]) {
        assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n, 0, `${mutation}: ${table}`);
      }
    } finally {
      sqlite.close();
    }
  }
});

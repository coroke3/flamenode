import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { videoCustomAnswers, videoEvents, videoYoutubeMetadata, videos } from "@flamenode/db/schema";
import * as schema from "@flamenode/db/schema";
import { validateVideoMemberSubmission } from "@flamenode/domain/video";
import { buildFreeVideoSubmissionAtomicPlan, buildFreeVideoSubmissionWithRebuildPlan, inspectFreeVideoSubmissionAtomicPlanBudget } from "../src/video/freeVideoSubmissionAtomicPlan.ts";
import { buildFreeVideoRow } from "../src/video/freeVideoRow.ts";
import { buildFreeVideoSubmissionWithRebuildPlan as exportedRebuildPlan, inspectFreeVideoSubmissionAtomicPlanBudget as exportedD1Budget } from "@flamenode/server-core/video/unslottedEventPlans";
import { D1_MAX_BIND_PARAMETERS } from "../src/audit/mutateBudget.ts";

test("MIG-0651 U02: existing public server-core entrypoint exports rebuild and budget plans", () => {
  assert.strictEqual(exportedRebuildPlan, buildFreeVideoSubmissionWithRebuildPlan);
  assert.strictEqual(exportedD1Budget, inspectFreeVideoSubmissionAtomicPlanBudget);
});

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

function seedApprovedActiveX(sqlite) {
  insert(sqlite, "user", { id: "user-1", active_x_user_id: "alice", is_banned: 0,
    is_tos_accepted: 1, terms_reaccept_required: 0 });
  insert(sqlite, "x_users", { id: "alice", x_name: "Alice", approval_status: "approved" });
  insert(sqlite, "x_user_account_links", {
    x_user_id: "alice", auth_user_id: "user-1", link_role: "manager",
  });
}

test("MIG-0651 atomic composer: null event inserts video and pending YouTube metadata with strict audits", () => {
  const { db, calls } = fixture();
  const row = video();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: row, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null,
    questions: [], customAnswerDrafts: [], now: NOW,
  });
  assert.equal(plan.statements.length, 3);
  assert.equal(plan.statements[0].action, "assert", "authorization must be first");
  assert.strictEqual(plan.statements[1].table, videos);
  assert.deepEqual(plan.statements[1].value, row);
  assert.strictEqual(plan.statements[2].table, videoYoutubeMetadata);
  assert.equal(plan.statements[2].value.sync_status, "pending");
  assert.equal(plan.statements[2].value.view_count, 0);
  assert.equal(plan.statements[2].value.updated_at, NOW);
  assert.deepEqual(plan.expectedChanges, [null, 1, 1]);
  assert.deepEqual(plan.audits.map(a => [a.table_name, a.operation, a.strict]),
    [["videos", "CREATE", true], ["video_youtube_metadata", "CREATE", true]]);
  assert.deepEqual(plan.audits[1].after, plan.statements[2].value);
  assert.notStrictEqual(plan.audits[1].after, plan.statements[2].value);
  assert.equal(calls.length, 3, "authorization assertion and two inserts; never executes");
});

test("MIG-0651 atomic composer: event and entire question-set assertions MUST precede every INSERT", () => {
  const { db } = fixture();
  const row = video("event-a");
  const q = question();
  const plan = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: row, actorUserId: "user-1", trustedActiveXId: "alice", eventId: "event-a",
    questions: [q], customAnswerDrafts: [{
      event_id: "event-a", question_id: "q:1", question_key: "q:1",
      answer_text: "ok", answer_json: null,
    }], now: NOW,
  });
  assert.deepEqual(plan.statements.map(s => s.action),
    ["assert", "assert", "assert", "insert", "insert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, null, 1, 1, 1, 1]);
  assert.deepEqual(plan.statements.slice(3).map(s => s.table),
    [videos, videoYoutubeMetadata, videoEvents, videoCustomAnswers]);
  const statements = plan.statements.slice(0, 3).map(s =>
    new SQLiteSyncDialect().sqlToQuery(s.expr));
  assert.match(statements[0].sql, /x_user_account_links/);
  assert.match(statements[0].sql, /is_tos_accepted/);
  assert.match(statements[0].sql, /terms_reaccept_required/);
  assert.ok(statements[0].params.includes("user-1"));
  assert.ok(statements[0].params.includes("alice"));
  assert.match(statements[1].sql, /events/);
  assert.match(statements[2].sql, /event_custom_questions/);
  assert.ok(statements[1].params.includes("event-a"));
  assert.ok(statements[2].params.includes("event-a"));
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
    videoAfter: video("event-a"), actorUserId: "user-1", trustedActiveXId: "alice", eventId: "event-a",
    questions: [question()], customAnswerDrafts: [], now: NOW,
  });
  assert.deepEqual(plan.statements.map(s => s.action),
    ["assert", "assert", "assert", "insert", "insert", "insert"]);
  assert.deepEqual(plan.expectedChanges, [null, null, null, 1, 1, 1]);
  assert.equal(plan.audits.length, 3);
});

test("MIG-0651 atomic composer: actor, selected event, clock and stale answer mismatch fail closed", () => {
  const samples = [
    { videoAfter: video(), actorUserId: "other", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice", eventId: "event-a", questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW+1 },
    { videoAfter: { ...video(), source_type: "external" }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), youtube_video_id: "short" }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), youtube_video_id: null }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), visibility_status: "private" }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), scheduling_type: "slotted" }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), scheduled_time: null }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), scheduled_time: -1 }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), app_like_count: 1 }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), score: 1 }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), score_updated_at: NOW }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), creator_display_name: "  " }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), title: " " }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "another-x", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
    { videoAfter: { ...video(), creator_x_user_id: "imposter" }, actorUserId: "user-1", trustedActiveXId: "alice", eventId: null, questions: [], customAnswerDrafts: [], now: NOW },
  ];
  for (const sample of samples) {
    const { db, calls } = fixture();
    assert.throws(() => buildFreeVideoSubmissionAtomicPlan(db, sample),
      /identity_invalid/);
    assert.equal(calls.length, 0);
  }
  const { db } = fixture();
  assert.throws(() => buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: video("event-a"), actorUserId: "user-1", trustedActiveXId: "alice", eventId: "event-a",
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
test("MIG-0651 atomic composer: both approved owner and manager X links allow batch-time preflight", () => {
  for (const role of ["owner", "manager"]) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
    try {
      sqlite.prepare("UPDATE x_user_account_links SET link_role=? WHERE x_user_id='alice' AND auth_user_id='user-1'").run(role);
      const { db } = fixture();
      const plan = buildFreeVideoSubmissionAtomicPlan(db, {
        videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
        eventId: null, questions: [], customAnswerDrafts: [], now: NOW,
      });
      const dialect = new SQLiteSyncDialect();
      const compiled = dialect.sqlToQuery(plan.statements[0].expr);
      assert.equal(Object.values(sqlite.prepare(compiled.sql).get(...compiled.params))[0], 1,
        `role ${role} should pass`);
    } finally { sqlite.close(); }
  }
});
test("MIG-0651 atomic composer: real migrated SQLite persists the exact bounded video graph", () => {
  for (const eventId of [null, "event-a"]) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
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
        videoAfter: video(eventId), actorUserId: "user-1", trustedActiveXId: "alice", eventId,
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
          assert.ok(compiled.params.length <= D1_MAX_BIND_PARAMETERS,
            `D1 bind ceiling exceeded: ${compiled.params.length}`);
          for (const param of compiled.params) {
            if (typeof param === "string") {
              assert.ok(Buffer.byteLength(param, "utf8") < 2_000_000,
                "bound JSON/string must fit D1's 2MB per-value ceiling");
            }
          }
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
      assert.equal(statementsExecuted, eventId ? 7 : 3);
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

test("MIG-0651 atomic composer: stale Active X, TOS or account authority aborts before INSERT", () => {
  // All changes happen AFTER plan construction but BEFORE the same-batch
  // assertion. A previously valid HTTP preflight never grants write authority.
  const mutations = {
    switched: sqlite => sqlite.prepare("UPDATE user SET active_x_user_id='other' WHERE id='user-1'").run(),
    unlinked: sqlite => sqlite.prepare("DELETE FROM x_user_account_links WHERE x_user_id='alice' AND auth_user_id='user-1'").run(),
    revoked: sqlite => sqlite.prepare("UPDATE x_users SET approval_status='rejected' WHERE id='alice'").run(),
    banned: sqlite => sqlite.prepare("UPDATE user SET is_banned=1 WHERE id='user-1'").run(),
    tos_revoked: sqlite => sqlite.prepare("UPDATE user SET is_tos_accepted=0 WHERE id='user-1'").run(),
    tos_unknown: sqlite => sqlite.prepare("UPDATE user SET is_tos_accepted=NULL WHERE id='user-1'").run(),
    tos_reaccept: sqlite => sqlite.prepare("UPDATE user SET terms_reaccept_required=1 WHERE id='user-1'").run(),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
    try {
      const drizzleDb = drizzle(async () => ({ rows: [] }));
      const db = {
        run(expr) { return { assertSql: expr }; },
        insert(table) { return drizzleDb.insert(table); },
        batch() { throw new Error("candidate must not execute D1 outside guard"); },
      };
      const plan = buildFreeVideoSubmissionAtomicPlan(db, {
        videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
        eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      });
      assert.deepEqual(plan.expectedChanges, [null, 1, 1]);
      mutate(sqlite);
      const authSql = new SQLiteSyncDialect().sqlToQuery(plan.statements[0].assertSql);
      sqlite.exec("BEGIN");
      assert.throws(
        () => sqlite.prepare(authSql.sql).get(...authSql.params),
        /malformed JSON/i,
        `${name}: rejected without attempting video INSERT`,
      );
      sqlite.exec("ROLLBACK");
      for (const table of ["videos", "video_youtube_metadata"]) {
        assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n, 0,
          `${name}: no partial row in ${table}`);
      }
    } finally { sqlite.close(); }
  }
});

test("MIG-0651 atomic composer: real SQLite changed event/question policy aborts without any rows", () => {
  for (const mutation of ["event-closed", "question-deactivated", "new-required"]) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
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
        videoAfter: video("event-a"), actorUserId: "user-1", trustedActiveXId: "alice",
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

test("MIG-0651 atomic composer: independent D1 50-query and S3 3-pre-read gates", () => {
  const { db } = fixture();
  const noEvent = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: video(null), actorUserId: "user-1", trustedActiveXId: "alice", eventId: null,
    questions: [], customAnswerDrafts: [], now: NOW,
  });
  const noEventBudget = inspectFreeVideoSubmissionAtomicPlanBudget(noEvent, 0);
  assert.equal(noEventBudget.mutationStatementCount, 3);
  assert.equal(noEventBudget.mutationAssertionCount, 2);
  assert.equal(noEventBudget.auditEntryCount, undefined, "budget exposes derived query costs, not input row count");
  assert.equal(noEventBudget.auditChunkCount, 1);
  assert.equal(noEventBudget.auditQueryCount, 2);
  assert.equal(noEventBudget.preparationQueryCount, 2);
  assert.equal(noEventBudget.totalQueryCount, 9);
  assert.equal(noEventBudget.d1WithinLimit, true);
  assert.equal(noEventBudget.s3PreBatchReadCount, 2);
  assert.equal(noEventBudget.s3PreBatchReadLimit, 3);
  assert.equal(noEventBudget.s3WithinLimit, true);
  assert.equal(noEventBudget.withinLimit, true);

  const linked = buildFreeVideoSubmissionAtomicPlan(db, {
    videoAfter: video("event-a"), actorUserId: "user-1", trustedActiveXId: "alice", eventId: "event-a",
    questions: [question()], customAnswerDrafts: [{
      event_id: "event-a", question_id: "q:1", question_key: "q:1",
      answer_text: "demo", answer_json: null,
    }], now: NOW,
  });
  const edge = inspectFreeVideoSubmissionAtomicPlanBudget(linked, 35);
  assert.equal(edge.mutationStatementCount, 7);
  assert.equal(edge.mutationAssertionCount, 4);
  assert.equal(edge.auditChunkCount, 1);
  assert.equal(edge.preparationQueryCount, 2);
  assert.equal(edge.batchQueryCount, 13);
  assert.equal(edge.totalQueryCount, 50);
  assert.equal(edge.d1WithinLimit, true, "50-query D1 budget passes at its exact edge");
  assert.equal(edge.s3PreBatchReadCount, 37);
  assert.equal(edge.s3WithinLimit, false, "35 + 2 pre-batch reads exceed S3");
  assert.equal(edge.withinLimit, false, "a D1-only green must NOT authorize an S3 write");
  const s3Edge = inspectFreeVideoSubmissionAtomicPlanBudget(linked, 1);
  assert.equal(s3Edge.s3PreBatchReadCount, 3);
  assert.equal(s3Edge.s3WithinLimit, true);
  assert.equal(s3Edge.withinLimit, true);
  const s3Exceeded = inspectFreeVideoSubmissionAtomicPlanBudget(linked, 2);
  assert.equal(s3Exceeded.s3PreBatchReadCount, 4);
  assert.equal(s3Exceeded.d1WithinLimit, true);
  assert.equal(s3Exceeded.withinLimit, false);
  const exceeded = inspectFreeVideoSubmissionAtomicPlanBudget(linked, 36);
  assert.equal(exceeded.totalQueryCount, 51);
  assert.equal(exceeded.d1WithinLimit, false);
  assert.equal(exceeded.withinLimit, false, "caller must fail closed before D1 batch");
  for (const invalid of [-1, 1.5, Infinity, NaN]) {
    assert.throws(() => inspectFreeVideoSubmissionAtomicPlanBudget(linked, invalid),
      /budget_arguments_invalid/);
  }
  assert.throws(() => inspectFreeVideoSubmissionAtomicPlanBudget({
    ...linked, expectedChanges: [1],
  }, 0), /budget_arguments_invalid/);
  assert.throws(() => inspectFreeVideoSubmissionAtomicPlanBudget({
    ...linked, audits: linked.audits.map(a => ({ ...a, strict: false })),
  }, 0), /budget_arguments_invalid/);
});

test("MIG-0651 atomic composer: concurrent YouTube ID unique collision rolls back the fresh candidate", () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    const drizzleDb = drizzle(async () => ({ rows: [] }));
    const planDb = {
      run(expr) { return { assertSql: expr }; },
      insert(table) { return drizzleDb.insert(table); },
      batch() { throw new Error("candidate cannot execute before auth and audit"); },
    };
    // Construct this request's plan first, then another request claims the
    // same YouTube video ID. The canonical SQLite active unique index must
    // resolve this race even though the read-only duplicate probe already ran.
    const plan = buildFreeVideoSubmissionAtomicPlan(planDb, {
      videoAfter: video(null), actorUserId: "user-1", trustedActiveXId: "alice", eventId: null,
      questions: [], customAnswerDrafts: [], now: NOW,
    });
    insert(sqlite, "videos", {
      id: "v:previous",
      submitted_by_user_id: "user-2",
      creator_display_name: "Previous",
      title: "Existing upload",
      youtube_video_id: "dQw4w9WgXcQ",
      visibility_status: "public",
    });
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    assert.throws(() => {
      for (const statement of plan.statements) {
        const compiled = "assertSql" in statement
          ? dialect.sqlToQuery(statement.assertSql)
          : statement.toSQL();
        if ("assertSql" in statement) sqlite.prepare(compiled.sql).get(...compiled.params);
        else sqlite.prepare(compiled.sql).run(...compiled.params);
      }
    }, /UNIQUE|constraint/i);
    sqlite.exec("ROLLBACK");
    assert.deepEqual(
      sqlite.prepare("SELECT id FROM videos ORDER BY id").all().map(({ id }) => id),
      ["v:previous"],
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM video_youtube_metadata").get().n,
      0, "no partial pending metadata from rejected duplicate",
    );
    assert.equal(plan.audits.length, 2, "audit metadata remains prepared, never written");
  } finally {
    sqlite.close();
  }
});

test("MIG-0651 atomic composer: mid-batch metadata failure rolls back the earlier video INSERT", () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    sqlite.exec(`
      CREATE TRIGGER fail_fresh_video_metadata
      BEFORE INSERT ON video_youtube_metadata
      BEGIN SELECT RAISE(ABORT, 'metadata-test-abort'); END;
    `);
    const drizzleDb = drizzle(async () => ({ rows: [] }));
    const planDb = {
      run(expr) { return { assertSql: expr }; },
      insert(table) { return drizzleDb.insert(table); },
    };
    const plan = buildFreeVideoSubmissionAtomicPlan(planDb, {
      videoAfter: video(null), actorUserId: "user-1", trustedActiveXId: "alice", eventId: null,
      questions: [], customAnswerDrafts: [], now: NOW,
    });
    assert.deepEqual(plan.expectedChanges, [null, 1, 1]);
    sqlite.exec("BEGIN");
    assert.throws(() => {
      for (const stmt of plan.statements) {
        const compiled = "assertSql" in stmt
          ? new SQLiteSyncDialect().sqlToQuery(stmt.assertSql)
          : stmt.toSQL();
        if ("assertSql" in stmt) sqlite.prepare(compiled.sql).get(...compiled.params);
        else sqlite.prepare(compiled.sql).run(...compiled.params);
      }
    }, /metadata-test-abort/);
    // The video INSERT succeeded before the intentionally failing metadata
    // statement; rollback must remove that earlier row as well.
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
    sqlite.exec("ROLLBACK");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_youtube_metadata").get().n, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0651 U02 rebuild queue: real SQLite inserts 13/16 exact targets in the same video transaction", async () => {
  for (const eventId of [null, "event-a"]) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
    try {
      if (eventId) {
        insert(sqlite, "events", {
          id: eventId, title: "Public event", visibility_status: "public",
          allow_unslotted_posts: 1,
        });
      }
      const drizzleDb = drizzle(async () => ({ rows: [] }));
      const db = {
        run(expr) { return { sqlExpr: expr }; },
        insert(table) { return drizzleDb.insert(table); },
        batch() { throw new Error("must not execute an unmounted candidate"); },
      };
      const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
        videoAfter: video(eventId), actorUserId: "user-1",
        trustedActiveXId: "alice", eventId, now: NOW,
        questions: [], customAnswerDrafts: [],
      });
      assert.equal(plan.statements.length, eventId ? 7 : 4);
      assert.deepEqual(plan.expectedChanges, eventId
        ? [null, null, null, 1, 1, 1, 16]
        : [null, 1, 1, 13]);
      assert.equal(plan.audits.length, eventId ? 3 : 2,
        "queue UPSERT is not a duplicate audit entry");
      assert.equal(plan.statements[0].sqlExpr !== undefined, true);
      const last = plan.statements.at(-1);
      assert.ok(last.sqlExpr, "the queue write is appended after video/event INSERTs");
      assert.match(new SQLiteSyncDialect().sqlToQuery(last.sqlExpr).sql,
        /INSERT INTO static_rebuild_queue/);
      const cost = inspectFreeVideoSubmissionAtomicPlanBudget(plan, 0);
      assert.equal(cost.withinLimit, true);

      const dialect = new SQLiteSyncDialect();
      sqlite.exec("BEGIN");
      try {
        for (const [index, statement] of plan.statements.entries()) {
          const expr = "sqlExpr" in statement;
          const compiled = expr ? dialect.sqlToQuery(statement.sqlExpr) : statement.toSQL();
          assert.ok(compiled.params.length <= D1_MAX_BIND_PARAMETERS,
            "all D1 binds must stay <=100");
          const stmt = sqlite.prepare(compiled.sql);
          const result = expr && index !== plan.statements.length - 1
            ? stmt.get(...compiled.params)
            : stmt.run(...compiled.params);
          if (plan.expectedChanges[index] !== null) {
            assert.equal(Number(result.changes), plan.expectedChanges[index]);
          }
        }
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n,
        eventId ? 16 : 13);
      assert.equal(sqlite.prepare(
        "SELECT COUNT(*) AS n FROM static_rebuild_queue WHERE target_type='video' AND target_id='v:1'",
      ).get().n, 1);
    } finally { sqlite.close(); }
  }
});

test("MIG-0651 U02 rebuild queue: queue write failure also rolls back prior video INSERT", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    sqlite.exec(`
      CREATE TRIGGER fail_queue_insertion
      BEFORE INSERT ON static_rebuild_queue
      BEGIN SELECT RAISE(ABORT, 'queue-test-abort'); END;
    `);
    const drizzleDb = drizzle(async () => ({ rows: [] }));
    const db = {
      run(expr) { return { sqlExpr: expr }; },
      insert(table) { return drizzleDb.insert(table); },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
    });
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    assert.throws(() => {
      for (const [index, statement] of plan.statements.entries()) {
        const isSql = "sqlExpr" in statement;
        const compiled = isSql ? dialect.sqlToQuery(statement.sqlExpr) : statement.toSQL();
        const stmt = sqlite.prepare(compiled.sql);
        if (isSql && index !== plan.statements.length - 1) stmt.get(...compiled.params);
        else stmt.run(...compiled.params);
      }
    }, /queue-test-abort/);
    sqlite.exec("ROLLBACK");
    for (const table of ["videos", "video_youtube_metadata", "static_rebuild_queue"]) {
      assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n, 0);
    }
  } finally { sqlite.close(); }
});

test("MIG-0651 U02: new software catalog + links and static queue commit together with video", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    let preReads = 0;
    const proxy = drizzle(async (query, params, method) => {
      preReads += 1;
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      usedSoftware: "Fresh Tool",
    });
    assert.equal(preReads, 1, "alias+catalog matching uses one bounded JOIN pre-read");
    assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 1, 13]);
    assert.equal(plan.audits.length, 4, "video, metadata, catalog and link each strictly audited");
    assert.ok(plan.audits.every(a => a.strict));
    assert.equal(plan.expectedChanges.findIndex(c => c !== null), 2,
      "Active-X and software selection CAS must both run before video INSERT");
    assert.match(new SQLiteSyncDialect().sqlToQuery(plan.statements[1].sqlExpr).sql,
      /WITH incoming/i, "software selection is the second pre-write assertion");
    const budget = inspectFreeVideoSubmissionAtomicPlanBudget(plan, preReads);
    assert.equal(budget.d1WithinLimit, true);
    assert.equal(budget.s3PreBatchReadCount, 3, "one software JOIN plus two audit preparation reads");
    assert.equal(budget.s3WithinLimit, true);
    assert.equal(budget.withinLimit, true,
      "this isolated unmounted software candidate meets the S3 pre-read budget");
    sqlite.exec("BEGIN");
    try {
      const dialect = new SQLiteSyncDialect();
      for (const [i, statement] of plan.statements.entries()) {
        const isSql = "sqlExpr" in statement;
        const q = isSql ? dialect.sqlToQuery(statement.sqlExpr) : statement.toSQL();
        assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
        const prepared = sqlite.prepare(q.sql);
        const result = isSql && i < plan.statements.length - 1
          ? prepared.get(...q.params) : prepared.run(...q.params);
        if (plan.expectedChanges[i] !== null) {
          assert.equal(Number(result.changes), plan.expectedChanges[i]);
        }
      }
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM software_catalog").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_softwares").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 13);
  } finally { sqlite.close(); }
});

test("MIG-0651 U02: failing rebuild queue rolls back fresh software/catalog/video graph", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    sqlite.exec("CREATE TRIGGER reject_queue BEFORE INSERT ON static_rebuild_queue BEGIN SELECT RAISE(ABORT, 'queue-down'); END;");
    const proxy = drizzle(async (query, params, method) => {
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [], usedSoftware: "Fresh Tool",
    });
    assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 1, 13]);
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    assert.throws(() => {
      for (const [index, statement] of plan.statements.entries()) {
        const isSql = "sqlExpr" in statement;
        const q = isSql ? dialect.sqlToQuery(statement.sqlExpr) : statement.toSQL();
        const prepared = sqlite.prepare(q.sql);
        if (isSql && index < plan.statements.length - 1) prepared.get(...q.params);
        else prepared.run(...q.params);
      }
    }, /queue-down/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM software_catalog").get().n, 1,
      "new catalog exists before rollback");
    sqlite.exec("ROLLBACK");
    for (const table of ["videos", "video_youtube_metadata", "software_catalog",
      "video_softwares", "static_rebuild_queue"]) {
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
        "queue failure must roll back " + table);
    }
  } finally { sqlite.close(); }
});

test("MIG-0651 U02: software catalog arrival after pre-read fails before first video write", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    const proxy = drizzle(async (query, params, method) => {
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values"
        ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      usedSoftware: "New Racing Tool",
    });
    assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 1, 13]);
    insert(sqlite, "software_catalog", {
      id: "raced-software", name: "New Racing Tool", normalized_name: "new racing tool",
      is_active: 1, usage_count: 0, created_at: NOW, updated_at: NOW,
    });
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    try {
      assert.throws(() => {
        for (const stmt of plan.statements) {
          const raw = "sqlExpr" in stmt;
          const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
          if (raw) sqlite.prepare(q.sql).get(...q.params);
          else sqlite.prepare(q.sql).run(...q.params);
        }
      }, /malformed JSON/, "stale software CREATE audit and link must be rejected by CAS");
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0,
        "software CAS must precede first video INSERT, not merely software INSERT");
    } finally { sqlite.exec("ROLLBACK"); }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_softwares").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
    assert.equal(sqlite.prepare("SELECT id FROM software_catalog").get().id, "raced-software");
  } finally { sqlite.close(); }
});

test("MIG-0651 U02: CURRENT-style video_submitted DM, video and rebuild queue share one SQLite commit", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    const stats = { reads: 0 };
    const proxy = drizzle(async (query, params, method) => {
      stats.reads += 1;
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      submittedNotificationPayload: { content: "投稿を受け付けました",
        video_id: "v:1", url: "https://flamenode.example/v:1" },
    });
    assert.equal(stats.reads, 1, "DM active dedupe and preference share one bounded pre-read");
    assert.deepEqual(plan.expectedChanges, [null, 1, 1, null, 13]);
    assert.equal(plan.audits.length, 2, "notification does not duplicate strict video audit");
    const budget = inspectFreeVideoSubmissionAtomicPlanBudget(plan, stats.reads);
    assert.equal(budget.d1WithinLimit, true);
    assert.equal(budget.s3PreBatchReadCount, 3);
    assert.equal(budget.s3WithinLimit, true);
    assert.equal(budget.withinLimit, true,
      "DM-only candidate now satisfies three reads including unpreloaded audit");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    try {
      for (const [index, stmt] of plan.statements.entries()) {
        const raw = "sqlExpr" in stmt;
        const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
        assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
        const prepared = sqlite.prepare(q.sql);
        const result = raw && index === 0 ? prepared.get(...q.params) : prepared.run(...q.params);
        if (plan.expectedChanges[index] !== null) {
          assert.equal(Number(result.changes), plan.expectedChanges[index]);
        }
      }
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_youtube_metadata").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 13);
    const row = sqlite.prepare("SELECT * FROM notification_outbox").get();
    assert.equal(row.type, "video_submitted");
    assert.equal(row.delivery_route, "dm");
    assert.equal(row.dedupe_key, "video_submitted:v:1");
    assert.equal(row.status, "pending");
    assert.equal(row.recipient_user_id, "user-1");
  } finally { sqlite.close(); }
});

test("MIG-0651 U02: queue failure rolls back prepared DM outbox with video and metadata", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    sqlite.exec("CREATE TRIGGER reject_queue_outbox BEFORE INSERT ON static_rebuild_queue BEGIN SELECT RAISE(ABORT, 'queue-and-dm-abort'); END;");
    const proxy = drizzle(async (query, params, method) => {
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      submittedNotificationPayload: { content: "投稿受付",
        video_id: "v:1", url: "https://flamenode.example/v:1" },
    });
    assert.deepEqual(plan.expectedChanges, [null, 1, 1, null, 13]);
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    assert.throws(() => {
      for (const [index, stmt] of plan.statements.entries()) {
        const raw = "sqlExpr" in stmt;
        const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
        if (raw && index === 0) sqlite.prepare(q.sql).get(...q.params);
        else sqlite.prepare(q.sql).run(...q.params);
      }
    }, /queue-and-dm-abort/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 1,
      "DM was inserted before the intentionally rejected queue statement");
    sqlite.exec("ROLLBACK");
    for (const table of ["videos", "video_youtube_metadata", "notification_outbox", "static_rebuild_queue"]) {
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
        "aborted atomic transaction must remove " + table);
    }
  } finally { sqlite.close(); }
});

test("MIG-0651 U02: both free-video notification routes share the video/Queue transaction while DM honors opt-out", async () => {
  for (const dmEnabled of [true, false]) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
    try {
      if (!dmEnabled) sqlite.prepare("UPDATE user SET is_notification_enabled=0 WHERE id='user-1'").run();
      let reads = 0;
      const proxy = drizzle(async (query, params, method) => {
        reads += 1;
        const rows = sqlite.prepare(query).all(...params);
        return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
      }, { schema });
      const db = {
        select: (...args) => proxy.select(...args),
        insert: (...args) => proxy.insert(...args),
        run(expr) { return { sqlExpr: expr }; },
      };
      const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
        videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
        eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
        submittedNotificationPayload: { content: "作品登録完了",
          video_id: "v:1", url: "https://flamenode.example/v:1" },
        registeredChannelNotification: {
          payload: { content: "【運営通知】新規作品",
            video_id: "v:1", url: "https://flamenode.example/v:1" },
          threadName: "[作品登録] Title / @alice",
        },
      });
      assert.equal(reads, 1, "DM preflight is one SELECT; forced ops recipient resolves in the batch INSERT");
      assert.deepEqual(plan.expectedChanges, dmEnabled
        ? [null, 1, 1, null, null, 13]
        : [null, 1, 1, null, 13]);
      assert.equal(plan.audits.length, 2, "notification rows are not fabricated strict audits");
      const budget = inspectFreeVideoSubmissionAtomicPlanBudget(plan, reads);
      assert.equal(budget.d1WithinLimit, true);
      assert.equal(budget.s3PreBatchReadCount, 3);
      assert.equal(budget.s3WithinLimit, true);
      assert.equal(budget.withinLimit, true,
        "DM + forced ops candidate now has one preflight read plus two unpreloaded audit reads");
      const dialect = new SQLiteSyncDialect();
      sqlite.exec("BEGIN");
      try {
        for (const [i, stmt] of plan.statements.entries()) {
          const raw = "sqlExpr" in stmt;
          const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
          assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
          const prepared = sqlite.prepare(q.sql);
          const result = raw && i === 0 ? prepared.get(...q.params) : prepared.run(...q.params);
          if (plan.expectedChanges[i] !== null) {
            assert.equal(Number(result.changes), plan.expectedChanges[i]);
          }
        }
        sqlite.exec("COMMIT");
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 13);
      const rows = sqlite.prepare("SELECT type,delivery_route,recipient_user_id FROM notification_outbox ORDER BY type").all();
      assert.equal(rows.length, dmEnabled ? 2 : 1);
      assert.equal(rows.filter(r => r.type === "discord_webhook" && r.delivery_route === "channel").length, 1);
      assert.equal(rows.filter(r => r.type === "video_submitted" && r.delivery_route === "dm").length, dmEnabled ? 1 : 0);
      assert.ok(rows.every(r => r.recipient_user_id === "user-1"));
    } finally { sqlite.close(); }
  }
});

test("MIG-0651 U02: queue fault rolls back video, DM, forced ops channel and metadata together", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    sqlite.exec("CREATE TRIGGER reject_channel_queue BEFORE INSERT ON static_rebuild_queue BEGIN SELECT RAISE(ABORT, 'channel-queue-abort'); END;");
    const proxy = drizzle(async (query, params, method) => {
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      submittedNotificationPayload: { content: "登録完了",
        video_id: "v:1", url: "https://flamenode.example/v:1" },
      registeredChannelNotification: {
        payload: { content: "運営への登録通知", video_id: "v:1",
          url: "https://flamenode.example/v:1" },
        threadName: "[作品登録] Title / @alice",
      },
    });
    assert.deepEqual(plan.expectedChanges, [null, 1, 1, null, null, 13]);
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    assert.throws(() => {
      for (const [i, stmt] of plan.statements.entries()) {
        const raw = "sqlExpr" in stmt;
        const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
        if (raw && i === 0) sqlite.prepare(q.sql).get(...q.params);
        else sqlite.prepare(q.sql).run(...q.params);
      }
    }, /channel-queue-abort/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 2,
      "both notifications were prepared and inserted before intentionally broken queue");
    sqlite.exec("ROLLBACK");
    for (const table of ["videos", "video_youtube_metadata", "notification_outbox", "static_rebuild_queue"]) {
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0,
        "atomic abort must remove all prior " + table + " writes");
    }
  } finally { sqlite.close(); }
});


function verifiedMembersForNewVideo() {
  const form = new FormData();
  form.set("members_json", JSON.stringify([
    { name: "New Member", x_user_id: "newcollab", role: "映像", comment: "",
      chapters: [{ time: "00:24", label: "Beginning", note: "" }] },
    { name: "Nameless X", x_user_id: "", role: "制作", comment: "", chapters: [] },
  ]));
  const parsed = validateVideoMemberSubmission(form, true);
  assert.equal(parsed.ok, true);
  return parsed.value;
}

test("MIG-0651 U02 new-video member/chapter plan is atomic with video/metadata/rebuild queue", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    let preReads = 0;
    const proxy = drizzle(async (query, params, method) => {
      preReads++;
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: { ...video(), collaboration_type: "collab" },
      actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      memberSubmission: verifiedMembersForNewVideo(),
    });
    assert.equal(preReads, 2, "member lifecycle resolution uses two reads");
    assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 2, 1, 13]);
    assert.equal(plan.audits.length, 5);
    assert.ok(plan.audits.every(a => a.strict));
    assert.equal(plan.expectedChanges.findIndex(n => n !== null), 2,
      "both Active-X and member CAS must precede the video INSERT");
    assert.match(new SQLiteSyncDialect().sqlToQuery(plan.statements[1].sqlExpr).sql,
      /WITH incoming/i, "member CAS occupies the final pre-write assertion position");
    const budget = inspectFreeVideoSubmissionAtomicPlanBudget(plan, preReads);
    assert.equal(budget.d1WithinLimit, true);
    assert.equal(budget.s3PreBatchReadCount, 4);
    assert.equal(budget.withinLimit, false,
      "two member reads plus two unpreloaded audit reads violate S3");

    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    try {
      for (const [i, stmt] of plan.statements.entries()) {
        const raw = "sqlExpr" in stmt;
        const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
        assert.ok(q.params.length <= D1_MAX_BIND_PARAMETERS);
        const prepared = sqlite.prepare(q.sql);
        const out = raw && i < 2 ? prepared.get(...q.params) : prepared.run(...q.params);
        if (raw && i < 2) assert.equal(Object.values(out)[0], 1,
          "both security predicates must be executed and true before video writes");
        if (plan.expectedChanges[i] !== null) assert.equal(Number(out.changes), plan.expectedChanges[i]);
      }
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_chapters").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 13);
    assert.equal(sqlite.prepare("SELECT approval_status FROM x_users WHERE id='newcollab'").get().approval_status, "pending");
  } finally { sqlite.close(); }
});

test("MIG-0651 U02 new-video: exact or normalized X race aborts full audited video batch", async () => {
  // Both variants must reject: case-only aliases would duplicate a canonical
  // identity, while an exact-PK arrival would make strict pending CREATE audits
  // describe a real approved profile we did not create.
  for (const racingId of ["NEWCOLLAB", "newcollab"]) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
    try {
      const proxy = drizzle(async (query, params, method) => {
        const rows = sqlite.prepare(query).all(...params);
        return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
      }, { schema });
      const db = {
        select: (...args) => proxy.select(...args),
        insert: (...args) => proxy.insert(...args),
        run(expr) { return { sqlExpr: expr }; },
      };
      const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
        videoAfter: { ...video(), collaboration_type: "collab" },
        actorUserId: "user-1", trustedActiveXId: "alice",
        eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
        memberSubmission: verifiedMembersForNewVideo(),
      });
      assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 2, 1, 13]);
      insert(sqlite, "x_users", {
        id: racingId, x_name: "Pre-existing approved", approval_status: "approved",
      });
      const dialect = new SQLiteSyncDialect();
      sqlite.exec("BEGIN");
      try {
        assert.throws(() => {
          for (const [i, stmt] of plan.statements.entries()) {
            const raw = "sqlExpr" in stmt;
            const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
            if (raw && i < 2) sqlite.prepare(q.sql).get(...q.params);
            else sqlite.prepare(q.sql).run(...q.params);
          }
        }, /malformed JSON/, "no pending member profile can be audited on concurrent exact/normalized arrival");
        assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0,
          "the identity CAS must abort before the very first video write");
      } finally { sqlite.exec("ROLLBACK"); }
      for (const table of [
        "videos", "video_youtube_metadata", "video_members",
        "video_chapters", "static_rebuild_queue",
      ]) {
        assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0,
          table + " must remain empty after failed transaction");
      }
      assert.deepEqual(sqlite.prepare("SELECT id,x_name,approval_status FROM x_users WHERE id=?")
        .all(racingId).map(r => ({id:r.id,x_name:r.x_name,status:r.approval_status})),
        [{id:racingId,x_name:"Pre-existing approved",status:"approved"}],
        "the concurrent X profile and approval remain unchanged");
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='newcollab' AND approval_status='pending'").get().n, 0);
    } finally { sqlite.close(); }
  }
});

test("MIG-0651 U02 new-video: rebuild failure rolls back member X, chapter and video inserts", async () => {
  const sqlite = createSqlite();
  seedApprovedActiveX(sqlite);
  try {
    sqlite.exec("CREATE TRIGGER fail_members_queue BEFORE INSERT ON static_rebuild_queue BEGIN SELECT RAISE(ABORT, 'member-queue-abort'); END;");
    const proxy = drizzle(async (query, params, method) => {
      const rows = sqlite.prepare(query).all(...params);
      return { rows: method === "all" || method === "values" ? rows.map(r => Object.values(r)) : rows };
    }, { schema });
    const db = {
      select: (...args) => proxy.select(...args),
      insert: (...args) => proxy.insert(...args),
      run(expr) { return { sqlExpr: expr }; },
    };
    const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
      videoAfter: { ...video(), collaboration_type: "collab" },
      actorUserId: "user-1", trustedActiveXId: "alice",
      eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
      memberSubmission: verifiedMembersForNewVideo(),
    });
    assert.deepEqual(plan.expectedChanges, [null, null, 1, 1, 1, 2, 1, 13]);
    const dialect = new SQLiteSyncDialect();
    sqlite.exec("BEGIN");
    assert.throws(() => {
      for (const [i, stmt] of plan.statements.entries()) {
        const raw = "sqlExpr" in stmt;
        const q = raw ? dialect.sqlToQuery(stmt.sqlExpr) : stmt.toSQL();
        if (raw && i < 2) sqlite.prepare(q.sql).get(...q.params);
        else sqlite.prepare(q.sql).run(...q.params);
      }
    }, /member-queue-abort/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_members").get().n, 2,
      "members written before failed Queue UPSERT");
    sqlite.exec("ROLLBACK");
    for (const name of ["videos", "video_youtube_metadata", "video_members", "video_chapters", "static_rebuild_queue"]) {
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + name).get().n, 0);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='newcollab'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='alice'").get().n, 1);
  } finally { sqlite.close(); }
});

test("MIG-0651 U02: real composed member/software/DM combinations fail closed on S3 read budget", async () => {
  const cases = [
    { label: "software + DM", collab: false, usedSoftware: "New Tool",
      callerReads: 2, totalPreReads: 4 },
    { label: "members + DM", collab: true, usedSoftware: null,
      callerReads: 3, totalPreReads: 5 },
    { label: "members + software + DM", collab: true, usedSoftware: "New Tool",
      callerReads: 4, totalPreReads: 6 },
  ];
  for (const scenario of cases) {
    const sqlite = createSqlite();
    seedApprovedActiveX(sqlite);
    try {
      let reads = 0;
      const proxy = drizzle(async (query, params, method) => {
        reads += 1;
        const rows = sqlite.prepare(query).all(...params);
        return { rows: method === "all" || method === "values"
          ? rows.map(r => Object.values(r)) : rows };
      }, { schema });
      const db = {
        select: (...args) => proxy.select(...args),
        insert: (...args) => proxy.insert(...args),
        run(expr) { return { sqlExpr: expr }; },
      };
      const plan = await buildFreeVideoSubmissionWithRebuildPlan(db, {
        videoAfter: {
          ...video(), collaboration_type: scenario.collab ? "collab" : "individual",
        },
        actorUserId: "user-1", trustedActiveXId: "alice",
        eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
        usedSoftware: scenario.usedSoftware,
        ...(scenario.collab ? {memberSubmission: verifiedMembersForNewVideo()} : {}),
        submittedNotificationPayload: {
          content: "投稿を受け付けました",
          video_id: "v:1", url: "https://flamenode.example/v:1",
        },
      });
      assert.equal(reads, scenario.callerReads, scenario.label + " actual D1 preparation reads");
      const budget = inspectFreeVideoSubmissionAtomicPlanBudget(plan, reads);
      assert.equal(budget.d1WithinLimit, true, scenario.label + " fits the logical 50-query D1 cap");
      assert.equal(budget.preparationQueryCount, 2, "audit metadata is not proven preloaded");
      assert.equal(budget.s3PreBatchReadCount, scenario.totalPreReads,
        scenario.label + " total request-side pre-batch reads");
      assert.equal(budget.s3WithinLimit, false);
      assert.equal(budget.withinLimit, false,
        scenario.label + " MUST NOT be authorized by a successful D1-only budget");
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get().n, 0);
    } finally { sqlite.close(); }
  }
});

test("MIG-0651 U02: missing collab member metadata and noncollab member mutation are both rejected", async () => {
  const { db } = fixture();
  await assert.rejects(() => buildFreeVideoSubmissionWithRebuildPlan(db, {
    videoAfter: { ...video(), collaboration_type: "collab" },
    actorUserId: "user-1", trustedActiveXId: "alice", eventId: null,
    now: NOW, questions: [], customAnswerDrafts: [],
  }), /free_video_collab_members_required/);
  await assert.rejects(() => buildFreeVideoSubmissionWithRebuildPlan(db, {
    videoAfter: video(), actorUserId: "user-1", trustedActiveXId: "alice",
    eventId: null, now: NOW, questions: [], customAnswerDrafts: [],
    memberSubmission: verifiedMembersForNewVideo(),
  }), /free_video_noncollab_members_forbidden/);
});

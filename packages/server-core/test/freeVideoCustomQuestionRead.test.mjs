import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { loadGeneralCustomQuestionsForFreeVideo, MAX_VIDEO_CUSTOM_QUESTIONS_READ } from "../src/video/freeVideoCustomQuestionRead.ts";

function setup() {
  const sqlite = createSqlite();
  const statements = [];
  const db = drizzle(async (statement, params, method) => {
    assert.match(statement, /^\s*SELECT\b/i);
    statements.push({ statement, params });
    const rows = sqlite.prepare(statement).all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });
  return { sqlite, db, statements };
}

test("MIG-0651 general questions: null-event skips database completely", async () => {
  const db = { select: () => { throw new Error("unexpected read"); } };
  assert.deepEqual(await loadGeneralCustomQuestionsForFreeVideo(db, null), []);
});

test("MIG-0651 general questions: real SQLite excludes stage, inactive and other events, preserves ordering", async () => {
  const { sqlite, db, statements } = setup();
  try {
    insert(sqlite, "events", { id: "ev-a", title: "Main" });
    insert(sqlite, "events", { id: "ev-b", title: "Other" });
    const put = (id, extra={}) => insert(sqlite, "event_custom_questions", {
      id, event_id: "ev-a", question_key: id, label: "Label " + id,
      type: "checkbox", required: 1, options_json: '[" A ","A","B"]',
      sort_order: 1, is_active: 1, ...extra,
    });
    put("q-last", { sort_order: 9 });
    put("q-first", { sort_order: 0, type: "text", max_length: 17 });
    put("q-no", { is_active: 0 });
    put("stage_permission", { sort_order: 0, required: 1 });
    put("stage_permission_2", { sort_order: 0 });
    put("same_other", { event_id: "ev-b", sort_order: 0 });
    const rows = await loadGeneralCustomQuestionsForFreeVideo(db, "ev-a");
    assert.deepEqual(rows.map(r => r.id), ["q-first", "q-last"]);
    assert.equal(statements.length, 1);
    assert.ok(statements[0].params.includes("ev-a"));
    assert.equal(rows[0].max_length, 17);
    assert.equal(rows[0].type, "text");
    assert.deepEqual(rows[1].options, ["A", "B"]);
    assert.equal(rows[1].required, true);
  } finally { sqlite.close(); }
});

test("MIG-0651 general questions: over 18 active questions fails closed on real SQLite", async () => {
  const { sqlite, db, statements } = setup();
  try {
    insert(sqlite, "events", { id: "ev-over", title: "Over" });
    for (let i=0; i<MAX_VIDEO_CUSTOM_QUESTIONS_READ+1; i++) {
      insert(sqlite, "event_custom_questions", {
        id: "q" + i, event_id: "ev-over", question_key: "key" + i,
        label: "Question", type: "text", is_active: 1,
      });
    }
    await assert.rejects(
      loadGeneralCustomQuestionsForFreeVideo(db, "ev-over"),
      /video_custom_question_read_limit_exceeded/,
    );
    assert.equal(statements.length, 1, "one LIMIT 19 query bounds the read");
    assert.match(statements[0].statement, /limit\s+\?/i);
  } finally { sqlite.close(); }
});

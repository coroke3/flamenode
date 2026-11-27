import test from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createSqlite, insert } from "../../../apps/api/test/support/personalHarness.mjs";
import { loadGeneralCustomQuestionsForFreeVideo, loadGeneralCustomQuestionsForSlotSubmission, decodeGeneralCustomQuestionPolicyProjection, MAX_VIDEO_CUSTOM_QUESTIONS_READ } from "../src/video/freeVideoCustomQuestionRead.ts";
import { loadEligibleUnslottedVideoRequiredFields } from "../src/video/requiredVideoFields.ts";

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

test("MIG-0651 SA-086: a single migrated SQLite event read yields the exact CURRENT-normalized general question snapshot", async () => {
  const { sqlite, db, statements } = setup();
  try {
    insert(sqlite, "events", {
      id: "ev-one", title: "Single query", visibility_status: "public",
      allow_unslotted_posts: 1, required_video_fields_json: '["music"]',
    });
    insert(sqlite, "events", { id: "ev-other", title: "Other" });
    function put(id, extra={}) {
      insert(sqlite, "event_custom_questions", {
        id, event_id: "ev-one", question_key: id, label: "Question " + id,
        type: "checkbox", required: 1, options_json: '[" A ","A","B"]',
        sort_order: 2, is_active: 1, ...extra,
      });
    }
    put("last", { sort_order: 3 });
    put("first", { sort_order: 0, type: "text", max_length: 23 });
    put("skip-stage", { question_key: "stage_permission_2", required: 1 });
    put("stage_permission", { required: 1 });
    put("inactive", { is_active: 0 });
    put("other", { event_id: "ev-other" });
    const separate = await loadGeneralCustomQuestionsForFreeVideo(db, "ev-one");
    assert.deepEqual(separate.map(x => x.id), ["first", "last"]);
    statements.length = 0;

    const combined = await loadEligibleUnslottedVideoRequiredFields(
      db, "ev-one", 1_700_000_000, "dQw4w9WgXcQ", true,
    );
    assert.equal(statements.length, 1, "event, required fields, duplicate and question set in one D1 SELECT");
    assert.match(statements[0].statement, /json_group_array/i);
    assert.match(statements[0].statement, /LIMIT\s+\?/i);
    assert.deepEqual(combined.requiredFields, ["music"]);
    assert.equal(combined.youtubeDuplicate, false);
    assert.equal(typeof combined.questionPolicyJson, "string");
    assert.deepEqual(
      decodeGeneralCustomQuestionPolicyProjection(combined.questionPolicyJson, "ev-one"),
      separate,
      "snapshot must match direct loader including sort and checkbox normalization",
    );
  } finally { sqlite.close(); }
});

test("MIG-0651 SA-086: malformed, foreign and oversized custom policy projections fail closed", () => {
  for (const bad of [
    "{not JSON", "{}", "[1]", '[["other","wrong"]]',
  ]) {
    assert.throws(() => decodeGeneralCustomQuestionPolicyProjection(bad, "ev-one"),
      /video_custom_question_projection_/);
  }
  assert.throws(() =>
    decodeGeneralCustomQuestionPolicyProjection(
      JSON.stringify(Array.from({length: MAX_VIDEO_CUSTOM_QUESTIONS_READ + 1}, () => [
        "id", "ev-one", "key", "label", "text", 0, null, null, 0, "review", 100,
      ])), "ev-one",
    ), /video_custom_question_projection_limit_or_shape_invalid/);
});

test("MIG-0651 SA-088 general questions: complete multi-event order and per-event limits", async () => {
  const { sqlite, db, statements } = setup();
  try {
    for (const id of ["ev-a", "ev-b", "ev-c", "ev-d", "ev-other"]) {
      insert(sqlite, "events", { id, title: id });
    }
    const put = (event, id, extra = {}) => insert(sqlite, "event_custom_questions", {
      id, event_id: event, question_key: id, label: id,
      type: "text", required: 0, is_active: 1, sort_order: 1, ...extra,
    });
    put("ev-a", "a-last", { sort_order: 9 });
    put("ev-a", "a-first", { sort_order: 0, required: 1 });
    put("ev-b", "b-first", { type: "checkbox", options_json: '[" A ","B","A"]' });
    put("ev-c", "c-first", { max_length: 12 });
    put("ev-d", "d-first");
    put("ev-b", "b-stage", { question_key: "stage_permission" });
    put("ev-b", "b-stage2", { question_key: "stage_permission_extra" });
    put("ev-b", "b-not-stage", { question_key: "stage_permissionX" });
    put("ev-b", "b-inactive", { is_active: 0 });
    put("ev-other", "other");
    const ids = ["ev-d", "ev-b", "", "ev-a", "ev-c", "ev-b"];
    const rows = await loadGeneralCustomQuestionsForSlotSubmission(db, ids);
    assert.deepEqual(rows.map(r => r.id), ["a-first","a-last","b-first","b-not-stage","c-first","d-first"]);
    assert.deepEqual(rows.find(r => r.id === "b-first").options, ["A", "B"]);
    assert.equal(rows[0].required, true);
    assert.equal(rows[4].max_length, 12);
    assert.equal(statements.length, 1);
    assert.ok(statements[0].params.includes(73));
    assert.ok(statements[0].params.length <= 9);
    const expected = [];
    for (const id of ["ev-a","ev-b","ev-c","ev-d"]) expected.push(...await loadGeneralCustomQuestionsForFreeVideo(db, id));
    assert.deepEqual(rows, expected);

    // A sparse second event cannot hide overflow in the first event.
    for (let i=0; i<16; i++) put("ev-a", "extra_"+i);
    statements.length = 0;
    const exact = await loadGeneralCustomQuestionsForSlotSubmission(db, ids);
    assert.equal(exact.filter(r => r.event_id === "ev-a").length,18);
    assert.equal(statements.length,1);
    put("ev-a", "overflow");
    statements.length=0;
    await assert.rejects(loadGeneralCustomQuestionsForSlotSubmission(db, ids), /video_custom_question_read_limit_exceeded/);
    assert.equal(statements.length,1);
    sqlite.prepare("DELETE FROM event_custom_questions WHERE id='overflow'").run();
    for (const event of ["ev-b","ev-c","ev-d"]) {
      const n = exact.filter(r => r.event_id===event).length;
      for (let i=n;i<18;i++) put(event,event+"_extra_"+i);
    }
    const full = await loadGeneralCustomQuestionsForSlotSubmission(db, ids);
    assert.equal(full.length,72);
    put("ev-d","global-overflow");
    await assert.rejects(loadGeneralCustomQuestionsForSlotSubmission(db, ids), /video_custom_question_read_limit_exceeded/);
  } finally { sqlite.close(); }
});

test("MIG-0651 SA-088 general questions: no IDs means no reads and >80 preserves CURRENT chunk ordering", async () => {
  const { sqlite, db, statements } = setup();
  try {
    assert.deepEqual(await loadGeneralCustomQuestionsForSlotSubmission(db, ["",""]), []);
    assert.equal(statements.length,0);
    const ids = Array.from({length:82},(_,i)=>"ev-"+String(81-i).padStart(2,"0"));
    for (const id of ids) {
      insert(sqlite,"events",{id,title:id});
      insert(sqlite,"event_custom_questions",{id:"q-"+id,event_id:id,question_key:"q",label:id,type:"text",is_active:1});
    }
    const rows = await loadGeneralCustomQuestionsForSlotSubmission(db,[...ids,ids[0],""]);
    const expected = [...ids.slice(0,80).sort(),...ids.slice(80).sort()];
    assert.deepEqual(rows.map(r=>r.event_id),expected);
    assert.equal(statements.length,2);
    assert.ok(statements[0].params.includes(1441));
    assert.ok(statements[1].params.includes(37));
    assert.ok(statements.every(s=>s.params.length<=85));
    // Overflow in the later chunk must reject the entire read, not return the first.
    for(let i=0;i<18;i++) insert(sqlite,"event_custom_questions",{
      id:"extra-"+i,event_id:ids[80],question_key:"extra-"+i,label:"Extra",type:"text",is_active:1,
    });
    statements.length=0;
    await assert.rejects(loadGeneralCustomQuestionsForSlotSubmission(db,ids),/video_custom_question_read_limit_exceeded/);
    assert.equal(statements.length,2);
  } finally { sqlite.close(); }
});

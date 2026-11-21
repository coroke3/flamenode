import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createSqlite, insert } from "./support/personalHarness.mjs";
import { limitVideoActionBody } from "../src/middleware/bodyLimit.ts";
import {
  readFreeVideoMultipartPreflight,
  validateFreeVideoSubmissionReadPreflight,
} from "../src/routes/videos/submit.ts";

const NOW = 1_700_000_000;
function form(eventId = "ev-a") {
  const data = new FormData();
  data.set("active_x_snapshot", "@alice");
  data.set("display_name", "Alice");
  data.set("title", "Example");
  data.set("youtube_url", "dQw4w9WgXcQ");
  if (eventId) data.set("event_ids", eventId);
  return data;
}
function prepare() {
  const sqlite = createSqlite();
  const statements = [];
  const db = drizzle(async (sql, params, method) => {
    assert.match(sql, /^\s*(SELECT|WITH)\b/i, "unmounted candidate cannot mutate D1");
    statements.push({ sql, params });
    const rows = sqlite.prepare(sql).all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });
  const app = new Hono();
  app.post("/api/videos/free", limitVideoActionBody("SA-086"), async (c) => {
    // Unit-only mock mount; actual app.ts has NO POST /api/videos/free.
    const transport = await readFreeVideoMultipartPreflight(c, { activeXId: "alice", nowSec: NOW });
    if (!transport.ok) return c.json(transport, 400);
    const candidate = await validateFreeVideoSubmissionReadPreflight(db, transport.value, NOW);
    return c.json(candidate, candidate.ok ? 200 : 400);
  });
  insert(sqlite, "events", {
    id: "ev-a", title: "Candidate Event", visibility_status: "public",
    allow_unslotted_posts: 1,
  });
  const put = (key, options = {}) => insert(sqlite, "event_custom_questions", {
    id: key, event_id: "ev-a", question_key: key, label: key,
    type: "text", is_active: 1, required: 0, sort_order: 1, ...options,
  });
  return { sqlite, db, app, put, statements };
}
function send(app, data) {
  return app.request("http://localhost/api/videos/free", { method: "POST", body: data });
}

test("MIG-0651 custom answer HTTP + SQLite: required question fails, valid checkbox persists a draft", async () => {
  const { sqlite, app, put, statements } = prepare();
  try {
    put("reason", { type: "text", required: 1, sort_order: 0 });
    put("choices", { type: "checkbox", options_json: '["A","B"]' });
    put("stage_permission", { required: 1, sort_order: -1 });
    put("stage_permission_2", { required: 1, sort_order: -1 });
    put("inactive", { required: 1, is_active: 0 });
    let response = await send(app, form());
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, message: "reasonを入力してください。" });
    assert.deepEqual(statements.length, 4, "eligibility/required/duplicate/custom definition, all read-only");
    const data = form();
    data.set("custom_answer:ev-a:reason", "  demo  ");
    data.append("custom_answer:ev-a:choices", "B");
    data.append("custom_answer:ev-a:choices", " A ");
    data.append("custom_answer:ev-a:choices", "B");
    response = await send(app, data);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { ok: true, value: {
      youtubeId: "dQw4w9WgXcQ", eventId: "ev-a",
      customAnswerDrafts: [
        { event_id: "ev-a", question_id: "reason", question_key: "reason", answer_text: "demo", answer_json: null },
        { event_id: "ev-a", question_id: "choices", question_key: "choices", answer_text: null, answer_json: '["B","A"]' },
      ],
    } });
  } finally { sqlite.close(); }
});

test("MIG-0651 custom answer HTTP + SQLite: invalid select, 5 answers and >18 definitions fail closed", async () => {
  const { sqlite, app, put } = prepare();
  try {
    put("choice", { type: "select", options_json: '["A","B"]' });
    let data = form();
    data.append("custom_answer:ev-a:choice", "C");
    let response = await send(app, data);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "choiceは選択肢から選んでください。");
    for (let i = 0; i < 4; i++) put("more" + i);
    data = form();
    for (const key of ["choice", "more0", "more1", "more2", "more3"]) {
      data.set("custom_answer:ev-a:" + key, "A");
    }
    response = await send(app, data);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "カスタム質問の回答は最大4件まで保存できます。");
    for (let i = 4; i < 19; i++) put("more" + i);
    response = await send(app, form());
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /一時的なエラー/);
  } finally { sqlite.close(); }
});

test("MIG-0651 custom answer HTTP + SQLite: no event produces no question reads", async () => {
  const { sqlite, app, statements } = prepare();
  try {
    const response = await send(app, form(null));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).value.customAnswerDrafts, []);
    assert.equal(statements.length, 1, "only YouTube duplicate SELECT for unaffiliated video");
  } finally { sqlite.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { createSqlite, insert } from "./support/personalHarness.mjs";
import { events, videos } from "@flamenode/db/schema";
import { parseVideoForm } from "@flamenode/domain/video";
import { limitVideoActionBody } from "../src/middleware/bodyLimit.ts";
import {
  readFreeVideoMultipartPreflight,
  validateFreeVideoDbReadPreflight,
} from "../src/routes/videos/submit.ts";

const authenticated = () => ({
  activeXId: "alice",
  nowSec: 1_700_000_000,
});

function fixture(context = authenticated()) {
  const app = new Hono();
  const mutations = { count: 0 };
  app.post("/api/videos/free", limitVideoActionBody("SA-086"), async (c) => {
    c.header("Cache-Control", "private, no-store");
    const parsed = await readFreeVideoMultipartPreflight(c, context);
    if (!parsed.ok) return c.json(parsed, 400);
    // Mimic a downstream call without a D1 binding: this increments only
    // when the preflight accepts the input. It does NOT test DB mutations.
    mutations.count++;
    return c.json({
      ok: true,
      requestedEventId: parsed.value.requestedEventId,
      scheduledTime: parsed.value.scheduledTime,
      members: parsed.value.memberSubmission.members.length,
      title: parsed.value.videoForm.title,
      youtubeUrl: parsed.value.videoForm.youtube_url,
    }, 200);
  });
  return { app, mutations };
}

const validForm = () => {
  const form = new FormData();
  form.set("active_x_snapshot", "@alice");
  form.set("display_name", " Alice ");
  form.set("title", " Artwork ");
  form.set("youtube_url", "https://youtu.be/dQw4w9WgXcQ");
  form.set("event_ids", "event-a");
  form.set("scheduled_time", "2026-11-21T12:34");
  return form;
};

test("MIG-0651 U02 HTTP: real multipart passes clone byte cap then pure validation", async () => {
  const { app, mutations } = fixture();
  const response = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: validForm(),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    requestedEventId: "event-a",
    scheduledTime: Date.UTC(2026, 10, 21, 3, 34) / 1000,
    members: 0,
    title: "Artwork",
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
  });
  assert.equal(mutations.count, 1);
});

test("MIG-0651 U02 HTTP: conflicting scalar multipart keys fail before mutation", async () => {
  const { app, mutations } = fixture();
  const form = validForm();
  form.append("icon_mode", "none");
  form.append("icon_mode", "upload");
  const response = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: form,
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false, message: "投稿フォームの入力が不正です。",
  });
  assert.equal(mutations.count, 0);
});

test("MIG-0651 U02 HTTP: stale authenticated Active X fails before mutation", async () => {
  const { app, mutations } = fixture({ ...authenticated(), activeXId: "bob" });
  const response = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: validForm(),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /Active X ID/);
  assert.equal(mutations.count, 0);
});

test("MIG-0651 U02 HTTP: invalid media type and broken multipart boundary fail closed", async () => {
  const { app, mutations } = fixture();
  const path = "http://localhost/api/videos/free";
  const plain = await app.request(path, {
    method: "POST", headers: { "Content-Type": "text/plain" },
    body: "active_x_snapshot=alice",
  });
  assert.equal(plain.status, 400);
  assert.deepEqual(await plain.json(), { ok: false, message: "投稿フォームの入力が不正です。" });

  const broken = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=missing" },
    body: "not a multipart payload",
  });
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { ok: false, message: "投稿フォームの入力が不正です。" });
  assert.equal(mutations.count, 0);
});

test("MIG-0651 U02 HTTP: urlencoded body accepted, bad field file denied", async () => {
  const { app, mutations } = fixture();
  const url = await app.request("http://localhost/api/videos/free", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "active_x_snapshot=%40alice&display_name=Alice&title=Artwork&youtube_url=dQw4w9WgXcQ&event_ids=event-a",
  });
  assert.equal(url.status, 200);
  assert.equal((await url.json()).requestedEventId, "event-a");

  const form = validForm();
  form.set("event_ids", new Blob(["event-a"]), "selection.txt");
  const bad = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: form,
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /イベントは1件/);
  assert.equal(mutations.count, 1, "only urlencoded input reached the simulated downstream stage");
});


test("MIG-0651 U02 HTTP: canonical video schema rejects missing title or malformed YouTube before downstream writes", async () => {
  const { app, mutations } = fixture();
  const path = "http://localhost/api/videos/free";
  const noTitle = validForm();
  noTitle.delete("title");
  const titleResp = await app.request(path, { method: "POST", body: noTitle });
  assert.equal(titleResp.status, 400);
  assert.equal((await titleResp.json()).ok, false);
  const invalidUrl = validForm();
  invalidUrl.set("youtube_url", "https://example.com/video");
  const urlResp = await app.request(path, { method: "POST", body: invalidUrl });
  assert.equal(urlResp.status, 400);
  assert.match((await urlResp.json()).message, /YouTube/);
  assert.equal(mutations.count, 0);
});

test("MIG-0651 U02 HTTP: schema-controlled collaboration flag rejects malformed members JSON", async () => {
  const { app, mutations } = fixture();
  const form = validForm();
  form.set("is_collab", "on");
  form.set("members_json", "{bad");
  const response = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: form,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, message: "合作メンバーの JSON が不正です。" });
  assert.equal(mutations.count, 0);
});


test("MIG-0651 U02 HTTP: bounded field count is enforced before canonical form parse", async () => {
  const { app, mutations } = fixture();
  const path = "http://localhost/api/videos/free";
  const form = validForm(); // 6 canonical fields.
  const initial = [...form].length;
  assert.equal(initial, 6);
  for (let i = initial; i < 1024; i++) {
    form.append("custom_question:" + i, "x");
  }
  assert.equal([...form].length, 1024);
  const accepted = await app.request(path, { method: "POST", body: form });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).ok, true);
  assert.equal(mutations.count, 1);
  form.append("custom_question:overflow", "x");
  const denied = await app.request(path, { method: "POST", body: form });
  assert.equal(denied.status, 400);
  assert.deepEqual(await denied.json(), {
    ok: false, message: "投稿フォームの入力が不正です。",
  });
  assert.equal(mutations.count, 1, "rejected form does not execute mock downstream step");
});


const dialect = new SQLiteSyncDialect();
function dbCandidate(form = validForm()) {
  const parsed = parseVideoForm(Object.fromEntries(form));
  assert.equal(parsed.ok, true, "fixture schema must be valid");
  return { requestedEventId: form.get("event_ids"), videoForm: parsed.data };
}

/** D1 mock implements read-only Drizzle SELECT/WHERE/LIMIT and records SQL. */
function readOnlyVideoDb({ eligible = true, required = [], duplicate = false, fail = null } = {}) {
  const reads = [];
  const db = {
    insert: () => { throw new Error("read preflight must never INSERT"); },
    update: () => { throw new Error("read preflight must never UPDATE"); },
    delete: () => { throw new Error("read preflight must never DELETE"); },
    select(columns) {
      const kind = columns.id === videos.id ? "youtube" :
        columns.id === events.id && columns.required_video_fields_json === events.required_video_fields_json
          ? "eligible_required" : "unknown";
      assert.notEqual(kind, "unknown", "event policy and required fields must share one SELECT");
      return {
        from(table) {
          assert.equal(table, kind === "youtube" ? videos : events);
          return {
            where(query) {
              const sql = dialect.sqlToQuery(query);
              reads.push({ kind, sql });
              const rows = kind === "youtube" ? (duplicate ? [{ id: "v-existing" }] : []) :
                (eligible ? [{ id: "event-a", required_video_fields_json: JSON.stringify(required), youtube_duplicate: duplicate ? 1 : 0 }] : []);
              const result = () => {
                if (fail === kind) throw new Error("D1 connection detail (must not leak)");
                return rows;
              };
              return {
                then(onFulfilled, onRejected) {
                  return Promise.resolve().then(result).then(onFulfilled, onRejected);
                },
                limit(n) {
                  assert.equal(n, 1);
                  return Promise.resolve().then(result).then((values) => values.slice(0, n));
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, reads };
}

test("MIG-0651 U02 D1 read: no event uses exactly one bounded YouTube duplicate lookup", async () => {
  const form = validForm();
  form.delete("event_ids");
  const { db, reads } = readOnlyVideoDb();
  const result = await validateFreeVideoDbReadPreflight(db, dbCandidate(form), authenticated().nowSec);
  assert.deepEqual(result, {
    ok: true, value: { eventId: null, youtubeId: "dQw4w9WgXcQ", requiredFieldsSnapshot: null },
  });
  assert.deepEqual(reads.map((r) => r.kind), ["youtube"]);
  assert.ok(reads[0].sql.params.includes("dQw4w9WgXcQ"));
  assert.ok(reads[0].sql.params.includes("voided"));
});

test("MIG-0651 U02 D1 read: eligible event, required fields and nonvoided duplicate share one D1 read", async () => {
  const { db, reads } = readOnlyVideoDb({ required: ["music"] });
  const missing = await validateFreeVideoDbReadPreflight(db, dbCandidate(), authenticated().nowSec);
  assert.deepEqual(missing, { ok: false, message: "「使用楽曲」は必須です。" });
  assert.deepEqual(reads.map((r) => r.kind), ["eligible_required"]);
  assert.ok(reads[0].sql.params.includes("event-a"));
  assert.ok(reads[0].sql.params.includes(authenticated().nowSec));
  assert.equal(reads[0].sql.params.filter((v) => v === "event-a").length, 1,
    "event is bound once in the eligibility-and-required-fields projection");

  const form = validForm();
  form.set("music", "Song");
  const permitted = await validateFreeVideoDbReadPreflight(db, dbCandidate(form), authenticated().nowSec);
  assert.deepEqual(permitted, { ok: true, value: {
    eventId: "event-a", youtubeId: "dQw4w9WgXcQ", requiredFieldsSnapshot: '["music"]',
  } });
  assert.deepEqual(reads.map((r) => r.kind).slice(1), ["eligible_required"]);
  assert.equal(reads.length, 2, "both preflight calls use one event projection each");
});

test("MIG-0651 U02 D1 read: ineligible event fails closed without later reads", async () => {
  const { db, reads } = readOnlyVideoDb({ eligible: false });
  const result = await validateFreeVideoDbReadPreflight(db, dbCandidate(), authenticated().nowSec);
  assert.deepEqual(result, {
    ok: false,
    message: "選択したイベントは枠なし投稿を受け付けていません。公開状態・終了日時・イベント設定を確認してください。",
  });
  assert.deepEqual(reads.map((r) => r.kind), ["eligible_required"]);
});

test("MIG-0651 U02 D1 read: eligibility D1 outage cannot be misreported as event policy denial", async () => {
  const { db, reads } = readOnlyVideoDb({ fail: "eligible_required" });
  const response = await validateFreeVideoDbReadPreflight(db, dbCandidate(), authenticated().nowSec);
  assert.deepEqual(response, {
    ok: false,
    message: "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。",
  });
  assert.deepEqual(reads.map((r) => r.kind), ["eligible_required"], "no subsequent reads after outage");
});

test("MIG-0651 U02 D1 read: existing non-voided YouTube video is refused", async () => {
  const { db, reads } = readOnlyVideoDb({ duplicate: true });
  const result = await validateFreeVideoDbReadPreflight(db, dbCandidate(), authenticated().nowSec);
  assert.deepEqual(result, { ok: false, message: "このYouTube動画は既に登録されています。" });
  assert.deepEqual(reads.map((r) => r.kind), ["eligible_required"]);
  assert.ok(!reads.some((r) => r.kind === "youtube"), "duplicate is returned by event SELECT");
});

test("MIG-0651 U02 D1 read: invalid clock and YouTube ID cause zero reads", async () => {
  const { db, reads } = readOnlyVideoDb();
  const input = dbCandidate();
  assert.equal((await validateFreeVideoDbReadPreflight(db, input, Number.NaN)).ok, false);
  assert.equal((await validateFreeVideoDbReadPreflight(db, input, -1)).ok, false);
  assert.deepEqual(await validateFreeVideoDbReadPreflight(db, {
    ...input, videoForm: { ...input.videoForm, youtube_url: "not youtube" },
  }, authenticated().nowSec), {
    ok: false, message: "YouTube URLを解析できません。",
  });
  assert.deepEqual(reads, []);
});

test("MIG-0651 U02 D1 read: D1 failures do not leak internal messages or allow writes", async () => {
  for (const kind of ["eligible_required", "youtube"]) {
    const { db, reads } = readOnlyVideoDb({ fail: kind });
    const input = kind === "youtube"
      ? { ...dbCandidate(), requestedEventId: null }
      : dbCandidate();
    const result = await validateFreeVideoDbReadPreflight(db, input, authenticated().nowSec);
    assert.deepEqual(result, {
      ok: false, message: "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。",
    });
    assert.equal(reads.at(-1).kind, kind);
  }
});

/** Unlike the earlier mock tests, these exercise the actual migrated SQLite
 * schema and Drizzle SQL. Only fixture setup can write; the candidate preflight
 * is explicitly denied access to any SQL mutation.
 */
test("MIG-0651 U02 SQLite: event visibility, end-time, required fields and YouTube uniqueness", async () => {
  const sqlite = createSqlite();
  const queries = [];
  const db = drizzle(async (statement, params, method) => {
    assert.match(statement, /^\s*(SELECT|WITH)\b/i, "preflight must be read-only");
    queries.push({ statement, params });
    const rows = sqlite.prepare(statement).all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });
  const now = authenticated().nowSec;
  const good = dbCandidate();
  const music = validForm();
  music.set("music", "Test track");
  const withMusic = dbCandidate(music);
  try {
    insert(sqlite, "events", {
      id: "event-a", title: "Test public event",
      visibility_status: "public", allow_unslotted_posts: 1,
      end_time: now + 3600,
      required_video_fields_json: JSON.stringify(["music"]),
    });

    // Active public event is eligible, but its event-specific field is required.
    let result = await validateFreeVideoDbReadPreflight(db, good, now);
    assert.deepEqual(result, { ok: false, message: "「使用楽曲」は必須です。" });
    assert.equal(queries.length, 1, "eligible event and required fields share one SELECT");

    queries.length = 0;
    result = await validateFreeVideoDbReadPreflight(db, withMusic, now);
    assert.deepEqual(result, { ok: true, value: {
      youtubeId: "dQw4w9WgXcQ", eventId: "event-a", requiredFieldsSnapshot: '["music"]',
    } });
    assert.equal(queries.length, 1, "eligible fields and nonvoided YouTube duplicate share one SELECT");
    assert.ok(queries.every(({ statement }) => /^\s*SELECT/i.test(statement)));
    // Prove the combined EXISTS predicate uses the migrated generic YouTube ID
    // lookup index; the partial UNIQUE index cannot cover archived rows.
    const indexDetails = sqlite.prepare("EXPLAIN QUERY PLAN " + queries[0].statement)
      .all(...queries[0].params).map((row) => String(row.detail));
    assert.ok(indexDetails.some((detail) =>
      /SEARCH (?:\w+\.)?videos USING (?:COVERING )?INDEX videos_youtube_id_idx\b/i.test(detail)),
    "correlated duplicate EXISTS must use the migrated videos_youtube_id_idx: " + indexDetails.join("; "));

    // Even an explicitly enabled event is denied if private.
    sqlite.prepare("UPDATE events SET visibility_status='private' WHERE id='event-a'").run();
    queries.length = 0;
    result = await validateFreeVideoDbReadPreflight(db, withMusic, now);
    assert.equal(result.ok, false);
    assert.match(result.message, /枠なし投稿を受け付けていません/);
    assert.equal(queries.length, 1);

    // A public event with allow_unslotted_posts=0 becomes eligible at end_time.
    sqlite.prepare("UPDATE events SET visibility_status='public', allow_unslotted_posts=0, end_time=? WHERE id='event-a'").run(now + 1);
    result = await validateFreeVideoDbReadPreflight(db, withMusic, now);
    assert.equal(result.ok, false);
    sqlite.prepare("UPDATE events SET end_time=? WHERE id='event-a'").run(now);
    result = await validateFreeVideoDbReadPreflight(db, withMusic, now);
    assert.equal(result.ok, true, "end_time is inclusive at the server-supplied second");

    // Existing non-voided YouTube ID must deny a new video even if unpublished.
    insert(sqlite, "videos", {
      id: "existing-video", title: "Existing",
      creator_display_name: "Creator",
      submitted_by_user_id: "u_test",
      youtube_video_id: "dQw4w9WgXcQ",
      visibility_status: "private",
      scheduled_time: now, created_at: now,
    });
    result = await validateFreeVideoDbReadPreflight(db, withMusic, now);
    assert.deepEqual(result, { ok: false, message: "このYouTube動画は既に登録されています。" });
    // CURRENT rejects archived records too, even though the partial active
    // UNIQUE index excludes archived videos. Only voided bypasses the read.
    sqlite.prepare("UPDATE videos SET visibility_status='archived' WHERE id='existing-video'").run();
    queries.length = 0;
    result = await validateFreeVideoDbReadPreflight(db, withMusic, now);
    assert.deepEqual(result, { ok: false, message: "このYouTube動画は既に登録されています。" });
    assert.equal(queries.length, 1, "archived duplicate uses one indexed event SELECT");
    sqlite.prepare("UPDATE videos SET visibility_status='voided' WHERE id='existing-video'").run();
    result = await validateFreeVideoDbReadPreflight(db, withMusic, now);
    assert.equal(result.ok, true, "voided record does not prevent CURRENT duplicate predicate");

    // Unaffiliated free posts skip all event reads.
    const unlinked = { ...withMusic, requestedEventId: null };
    queries.length = 0;
    result = await validateFreeVideoDbReadPreflight(db, unlinked, now);
    assert.equal(result.ok, true);
    assert.equal(queries.length, 1, "only YouTube duplicate lookup is required");
  } finally {
    sqlite.close();
  }
});

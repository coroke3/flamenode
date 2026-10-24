// MIG-0603 U02b: SA-012..015 chapter write endpoints against the real D1 schema
// (all migrations on node:sqlite): guards, permissions, validation, audit bytes,
// queue row, CAS rollback and the D1 budget.
import test from "node:test";
import assert from "node:assert/strict";
import { BulkChapterActionResultSchema, ChapterActionResultSchema } from "@flamenode/contracts";
import { createSqlite } from "./support/personalHarness.mjs";
import { atomicD1, chapterApp, seedChapterWorld, SITE } from "./support/chapterSeed.mjs";

function setup({ as = "u_owner", beforeRead, settings } = {}) {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  if (settings) sqlite.prepare("UPDATE system_settings SET operation_mode = ?").run(settings);
  const d1 = atomicD1(sqlite, { beforeRead });
  return { sqlite, d1, request: chapterApp(d1, as) };
}

const SNAP = (x) => ({ active_x_snapshot: x });
const CREATE = { chapter_time: "1:30", chapter_label: "Intro", note: "hello", visibility: "public" };
const count = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const audits = (sqlite) => sqlite.prepare("SELECT * FROM audit_logs ORDER BY rowid").all();

// ---------------- guards: every write route ----------------

const ROUTES = [
  ["POST", "/api/videos/v_pub/chapters", { ...CREATE, ...SNAP("x_owner") }],
  ["POST", "/api/videos/v_pub/chapters/bulk", { csv: "10,A", ...SNAP("x_owner") }],
  ["PUT", "/api/videos/chapters/ch_owner", CREATE],
  ["DELETE", "/api/videos/chapters/ch_owner", undefined],
];

for (const [method, path, body] of ROUTES) {
  test(`guards ${method} ${path}: origin, auth, CostGuard, active X; all no-store; nothing written`, async () => {
    const cross = setup();
    const r1 = await cross.request(method, path, body, { Origin: "https://evil.example" });
    assert.equal(r1.status, 403);
    assert.equal((await r1.json()).reason, "invalid_origin");
    assert.equal(r1.headers.get("cache-control"), "private, no-store");
    assert.equal(cross.d1.stats.reads, 0, "origin is checked before any D1 read");

    const anon = setup({ as: null });
    const r2 = await anon.request(method, path, body);
    assert.equal(r2.status, 401);
    assert.equal(r2.headers.get("cache-control"), "private, no-store");

    const maint = setup({ settings: "maintenance" });
    const r3 = await maint.request(method, path, body);
    assert.equal(r3.status, 503);
    assert.equal((await r3.json()).reason, "maintenance_mode");

    const nox = setup({ as: "u_nox" });
    const r4 = await nox.request(method, path, body);
    assert.equal(r4.status, 403);
    assert.equal((await r4.json()).reason, "active_x_required");

    const pend = setup({ as: "u_pend" });
    const r5 = await pend.request(method, path, body);
    assert.equal(r5.status, 403);
    assert.equal((await r5.json()).reason, "active_x_not_approved");

    for (const s of [cross, maint, nox, pend]) {
      assert.equal(count(s.sqlite, "audit_logs"), 0);
      assert.equal(count(s.sqlite, "static_rebuild_queue"), 0);
    }
    assert.equal(count(cross.sqlite, "video_chapters"), 4);
  });
}

test("CostGuard feature chapter_comment disabled -> 503 cost_guard_blocked", async () => {
  const s = setup();
  s.sqlite.prepare("UPDATE system_settings SET disabled_features_json = ?").run(JSON.stringify(["chapter_comment"]));
  const res = await s.request("POST", "/api/videos/v_pub/chapters", { ...CREATE, ...SNAP("x_owner") });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "cost_guard_blocked");
});

test("the public GET detail stays guard-free and cacheable (no session, no D1 write path)", async () => {
  const s = setup({ as: null });
  const res = await s.request("GET", "/api/videos/v_pub", undefined, {});
  assert.notEqual(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.status, 200);
});

// ---------------- SA-012 create ----------------

test("SA-012 create: row + audit bytes + queue row + response; 1 pre-read within the budget", async () => {
  const { sqlite, request, d1 } = setup();
  const res = await request("POST", "/api/videos/v_pub/chapters", { ...CREATE, ...SNAP("x_owner") });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = await res.json();
  assert.deepEqual(ChapterActionResultSchema.parse(body), body, "the contract schema describes the response");
  assert.equal(body.ok, true);
  assert.equal(body.pendingPublicReflection, true);
  assert.match(body.chapterId, /^ch_[0-9a-f-]{36}$/);
  const row = sqlite.prepare("SELECT * FROM video_chapters WHERE id = ?").get(body.chapterId);
  assert.deepEqual({ ...row }, {
    id: body.chapterId, video_id: "v_pub", x_user_id: "x_owner", chapter_time: 90,
    chapter_label: "Intro", note: "hello", visibility: "public", created_at: row.created_at, updated_at: row.created_at,
  });
  const [audit] = audits(sqlite);
  assert.equal(audits(sqlite).length, 1);
  assert.deepEqual(
    [audit.table_name, audit.operation, audit.target_id, audit.actor_user_id, audit.retention_class, audit.before_json],
    ["video_chapters", "CREATE", body.chapterId, "u_owner", "normal", null],
  );
  assert.deepEqual(Object.keys(JSON.parse(audit.after_json)), [
    "id", "video_id", "x_user_id", "chapter_time", "chapter_label", "note", "visibility", "created_at", "updated_at",
  ]);
  assert.equal(JSON.parse(audit.actor_snapshot_json).discord_id, "d_u_owner");
  const queue = sqlite.prepare("SELECT * FROM static_rebuild_queue").all();
  assert.equal(queue.length, 1);
  assert.deepEqual(
    [queue[0].target_type, queue[0].target_id, queue[0].reason, queue[0].priority, queue[0].status, queue[0].requested_by_user_id],
    ["video", "v_pub", "chapter_create", "normal", "pending", "u_owner"],
  );
  // guard user read + settings read (reused by the audit) + 1 video read, then one batch.
  assert.equal(d1.stats.reads, 3);
  assert.equal(d1.stats.batches, 1);
  assert.ok(d1.stats.maxBinds <= 100);
});

test("SA-012 create: a second chapter merges into the active video queue row", async () => {
  const { sqlite, request } = setup();
  await request("POST", "/api/videos/v_pub/chapters", { ...CREATE, ...SNAP("x_owner") });
  await request("POST", "/api/videos/v_pub/chapters", { ...CREATE, chapter_label: "Two", ...SNAP("x_owner") });
  assert.equal(count(sqlite, "static_rebuild_queue"), 1);
  assert.equal(count(sqlite, "audit_logs"), 2);
});

test("SA-012 create: rejections keep CURRENT messages; nothing written", async () => {
  const { sqlite, request } = setup();
  const post = (path, body) => request("POST", path, body);
  const stale = await post("/api/videos/v_pub/chapters", { ...CREATE, ...SNAP("x_other") });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).message, /Active X IDが変更されました/);
  assert.equal((await post("/api/videos/v_pub/chapters", CREATE)).status, 409, "missing snapshot");
  const empty = await post("/api/videos/v_pub/chapters", { ...CREATE, chapter_label: "  ", ...SNAP("x_owner") });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).message, "String must contain at least 1 character(s)");
  const long = await post("/api/videos/v_pub/chapters", { ...CREATE, chapter_time: "x".repeat(33), ...SNAP("x_owner") });
  assert.equal(long.status, 400);
  assert.equal((await long.json()).message, "String must contain at most 32 character(s)");
  const vis = await post("/api/videos/v_pub/chapters", { ...CREATE, visibility: "secret", ...SNAP("x_owner") });
  assert.equal(vis.status, 400);
  const missing = await post("/api/videos/ghost/chapters", { ...CREATE, ...SNAP("x_owner") });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { ok: false, message: "動画が見つかりません。" });
  const priv = await post("/api/videos/v_priv/chapters", { ...CREATE, ...SNAP("x_owner") });
  assert.equal(priv.status, 403);
  assert.deepEqual(await priv.json(), { ok: false, message: "この動画にはチャプターコメントを投稿できません。" });
  const badTime = await post("/api/videos/v_pub/chapters", { ...CREATE, chapter_time: "abc", ...SNAP("x_owner") });
  assert.equal(badTime.status, 400);
  assert.equal((await badTime.json()).message, "時刻の形式が不正です。");
  const beyond = await post("/api/videos/v_dur/chapters", { ...CREATE, chapter_time: "121", ...SNAP("x_owner") });
  assert.equal(beyond.status, 400);
  assert.equal((await beyond.json()).message, "動画の長さを超える時刻は指定できません。");
  const within = await post("/api/videos/v_dur/chapters", { ...CREATE, chapter_time: "120", ...SNAP("x_owner") });
  assert.equal(within.status, 200);
  const notJson = await request("POST", "/api/videos/v_pub/chapters", "[1]");
  assert.equal(notJson.status, 400);
  assert.equal(count(sqlite, "audit_logs"), 1);
});

test("SA-012 create: body over 64KB -> 413 before any parse; note defaults to null and visibility to public", async () => {
  const big = setup();
  const res = await big.request("POST", "/api/videos/v_pub/chapters", { ...CREATE, note: "x".repeat(70000), ...SNAP("x_owner") });
  assert.equal(res.status, 413);
  const { sqlite, request } = setup();
  const ok = await request("POST", "/api/videos/v_pub/chapters", { chapter_time: "5", chapter_label: "  L  ", ...SNAP("x_owner") });
  assert.equal(ok.status, 200);
  const row = sqlite.prepare("SELECT chapter_label, note, visibility, chapter_time FROM video_chapters WHERE x_user_id = 'x_owner' AND chapter_label = 'L'").get();
  assert.deepEqual({ ...row }, { chapter_label: "L", note: null, visibility: "public", chapter_time: 5 });
});

// ---------------- SA-013 update / SA-014 delete: permission table (MIG-0304 T01 style) ----------------

// as, chapter, expected status: own chapter always; others need video.chapter_admin in admin/event mode.
const PERMISSION_TABLE = [
  ["u_owner", "ch_owner", 200, "own chapter"],
  ["u_owner", "ch_other", 403, "video owner is NOT a chapter admin in normal mode"],
  ["u_other", "ch_other", 200, "own chapter"],
  ["u_other", "ch_owner", 403, "staff of another event with a preset without chapter_admin"],
  ["u_staff", "ch_owner", 200, "event staff (content_editor) of the video's primary event"],
  ["u_staff", "ch_null", 200, "event staff, chapter without x_user_id"],
  ["u_multi", "ch_owner", 200, "approved X of the staff (not the active one)"],
  ["u_admin", "ch_owner", 200, "admin role"],
  ["u_mod", "ch_owner", 403, "moderator is not admin; staff only of another event"],
  ["u_mod", "ch_two", 200, "moderator with manager preset on the video's linked event"],
  ["u_staff", "ch_two", 403, "staff of ev1 on a video linked to ev2"],
];

for (const [as, chapter, status, why] of PERMISSION_TABLE) {
  test(`SA-013 update ${as} -> ${chapter}: ${status} (${why})`, async () => {
    const { sqlite, request } = setup({ as });
    const res = await request("PUT", `/api/videos/chapters/${chapter}`, { chapter_time: "20", chapter_label: "Edited", note: "n2", visibility: "private" });
    assert.equal(res.status, status);
    const row = sqlite.prepare("SELECT chapter_label, visibility FROM video_chapters WHERE id = ?").get(chapter);
    if (status === 200) {
      assert.deepEqual({ ...row }, { chapter_label: "Edited", visibility: "private" });
      assert.equal(count(sqlite, "audit_logs"), 1);
    } else {
      assert.deepEqual(await res.json(), { ok: false, message: "このチャプターを更新する権限がありません。" });
      assert.equal(row.chapter_label, `L ${chapter}`);
      assert.equal(count(sqlite, "audit_logs"), 0);
      assert.equal(count(sqlite, "static_rebuild_queue"), 0);
    }
  });

  test(`SA-014 delete ${as} -> ${chapter}: ${status} (${why})`, async () => {
    const { sqlite, request } = setup({ as });
    const res = await request("DELETE", `/api/videos/chapters/${chapter}`);
    assert.equal(res.status, status);
    assert.equal(count(sqlite, "video_chapters"), status === 200 ? 3 : 4);
    if (status !== 200) {
      assert.deepEqual(await res.json(), { ok: false, message: "このチャプターを削除する権限がありません。" });
    }
  });
}

test("SA-013 update: audit before/after bytes, queue reason, response, budget", async () => {
  const { sqlite, request, d1 } = setup({ as: "u_other" });
  const res = await request("PUT", "/api/videos/chapters/ch_other", { chapter_time: "20", chapter_label: "Edited", note: "  n2  ", visibility: "private" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, chapterId: "ch_other", message: "チャプターを更新しました。", pendingPublicReflection: true });
  const [audit] = audits(sqlite);
  const keys = ["id", "video_id", "x_user_id", "chapter_time", "chapter_label", "note", "visibility", "created_at", "updated_at"];
  assert.deepEqual(Object.keys(JSON.parse(audit.before_json)), keys);
  assert.deepEqual(JSON.parse(audit.before_json), {
    id: "ch_other", video_id: "v_pub", x_user_id: "x_other", chapter_time: 10, chapter_label: "L ch_other",
    note: null, visibility: "public", created_at: 100, updated_at: 100,
  });
  const after = JSON.parse(audit.after_json);
  assert.deepEqual(Object.keys(after), keys);
  assert.deepEqual({ ...after, updated_at: 0 }, {
    id: "ch_other", video_id: "v_pub", x_user_id: "x_other", chapter_time: 20, chapter_label: "Edited",
    note: "n2", visibility: "private", created_at: 100, updated_at: 0,
  });
  assert.equal(audit.operation, "UPDATE");
  assert.equal(sqlite.prepare("SELECT reason FROM static_rebuild_queue").get().reason, "chapter_update");
  // guard user + settings + chapter(+video) read; own chapter needs no permission read.
  assert.equal(d1.stats.reads, 3);
  assert.equal(d1.stats.batches, 1);
});

test("S3: event staff update / delete / bulk stay within 3 D1 reads including the guard", async () => {
  const upd = setup({ as: "u_staff" });
  const res = await upd.request("PUT", "/api/videos/chapters/ch_owner", { chapter_time: "20", chapter_label: "Edited" });
  assert.equal(res.status, 200);
  // guard user + settings + 1 chapter/video read (events and staff rows are subqueries).
  assert.equal(upd.d1.stats.reads, 3);
  assert.equal(upd.d1.stats.batches, 1);
  assert.ok(upd.d1.stats.maxBinds <= 100);
  const del = setup({ as: "u_staff" });
  assert.equal((await del.request("DELETE", "/api/videos/chapters/ch_owner")).status, 200);
  assert.ok(del.d1.stats.reads <= 3, `delete reads ${del.d1.stats.reads}`);
  const bulk = setup({ as: "u_staff" });
  assert.equal((await bulk.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: "5,A", ...SNAP("x_staff") })).status, 200);
  assert.ok(bulk.d1.stats.reads <= 3, `bulk reads ${bulk.d1.stats.reads}`);
  const denied = setup({ as: "u_other" });
  assert.equal((await denied.request("PUT", "/api/videos/chapters/ch_owner", { chapter_time: "20", chapter_label: "E" })).status, 403);
  assert.ok(denied.d1.stats.reads <= 3, `denied reads ${denied.d1.stats.reads}`);
});

test("SA-013 update: admin needs no permission read; unknown chapter 404; invalid time 400 / beyond duration", async () => {
  const admin = setup({ as: "u_admin" });
  const ok = await admin.request("PUT", "/api/videos/chapters/ch_owner", { chapter_time: "20", chapter_label: "E" });
  assert.equal(ok.status, 200);
  assert.equal(admin.d1.stats.reads, 3);
  const miss = await admin.request("PUT", "/api/videos/chapters/ghost", { chapter_time: "20", chapter_label: "E" });
  assert.equal(miss.status, 404);
  assert.deepEqual(await miss.json(), { ok: false, message: "チャプターが見つかりません。" });
  const bad = await admin.request("PUT", "/api/videos/chapters/ch_owner", { chapter_time: "-1", chapter_label: "E" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).message, "負の時刻は指定できません。");
  const none = await admin.request("PUT", "/api/videos/chapters/ch_owner", { chapter_time: "20" });
  assert.equal(none.status, 400);
});

test("SA-013 update: a concurrent change after the preflight -> CAS fails, rollback, CURRENT message", async () => {
  let raced = false;
  const { sqlite, request } = setup({
    as: "u_owner",
    beforeRead: (sql, q) => {
      if (!raced && sql.includes('FROM "video_chapters" c')) {
        raced = true;
        q.prepare("UPDATE video_chapters SET chapter_label = 'changed elsewhere' WHERE id = 'ch_owner'").run();
      }
    },
  });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await request("PUT", "/api/videos/chapters/ch_owner", { chapter_time: "20", chapter_label: "E" });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, message: "チャプターの保存に失敗しました。画面を更新してもう一度お試しください。" });
  } finally {
    console.error = original;
  }
  assert.equal(sqlite.prepare("SELECT chapter_label FROM video_chapters WHERE id = 'ch_owner'").get().chapter_label, "changed elsewhere");
  assert.equal(count(sqlite, "audit_logs"), 0);
  assert.equal(count(sqlite, "static_rebuild_queue"), 0);
});

test("SA-014 delete: row removed, full row kept in the audit before_json (comment retained), neighbours untouched", async () => {
  const { sqlite, request } = setup({ as: "u_owner" });
  const res = await request("DELETE", "/api/videos/chapters/ch_owner");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, chapterId: "ch_owner", message: "チャプターを削除しました。", pendingPublicReflection: true });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_chapters WHERE id = 'ch_owner'").get().n, 0);
  assert.equal(count(sqlite, "video_chapters"), 3);
  const [audit] = audits(sqlite);
  assert.equal(audit.operation, "DELETE");
  assert.equal(audit.after_json, null);
  assert.equal(JSON.parse(audit.before_json).note, "N ch_owner");
  assert.equal(sqlite.prepare("SELECT reason FROM static_rebuild_queue").get().reason, "chapter_delete");
});

test("SA-014 delete: an already deleted chapter is an idempotent success without audit or queue", async () => {
  const { sqlite, request } = setup({ as: "u_owner" });
  const res = await request("DELETE", "/api/videos/chapters/ghost");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, chapterId: "ghost", message: "既に削除されています。" });
  assert.equal(count(sqlite, "audit_logs"), 0);
});

// ---------------- SA-015 bulk ----------------

const CSV = "time,label,note,visibility\n0:10,Intro,first,public\n1:00,Verse,,private\n,,,\n2:00,Chorus,third";

test("SA-015 bulk: admin inserts valid rows in one statement; audit per row; queue once", async () => {
  const { sqlite, request, d1 } = setup({ as: "u_admin" });
  const res = await request("POST", "/api/videos/v_pub/chapters/bulk", { csv: CSV, ...SNAP("x_admin") });
  assert.equal(res.status, 200);
  const bulk = await res.json();
  assert.deepEqual(BulkChapterActionResultSchema.parse(bulk), bulk, "the contract schema describes the response");
  assert.deepEqual(bulk, { ok: true, message: "3 件追加 / 1 件スキップ", inserted: 3, skipped: 1, errors: [], pendingPublicReflection: true });
  const rows = sqlite.prepare("SELECT chapter_time, chapter_label, note, visibility, x_user_id FROM video_chapters WHERE x_user_id = 'x_admin' ORDER BY chapter_time").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { chapter_time: 10, chapter_label: "Intro", note: "first", visibility: "public", x_user_id: "x_admin" },
    { chapter_time: 60, chapter_label: "Verse", note: null, visibility: "private", x_user_id: "x_admin" },
    { chapter_time: 120, chapter_label: "Chorus", note: "third", visibility: "public", x_user_id: "x_admin" },
  ]);
  assert.equal(count(sqlite, "audit_logs"), 3);
  assert.equal(count(sqlite, "static_rebuild_queue"), 1);
  assert.equal(sqlite.prepare("SELECT reason FROM static_rebuild_queue").get().reason, "chapter_bulk_create");
  assert.equal(d1.stats.reads, 3, "guard user + settings + video; admin needs no permission read");
  assert.equal(d1.stats.batches, 1);
  assert.ok(d1.stats.maxBinds <= 100);
});

test("SA-015 bulk: 8 rows fit the bind and query budgets; 9 rows are refused", async () => {
  const eight = Array.from({ length: 8 }, (_, i) => `${i + 1},L${i + 1}`).join("\n");
  const ok = setup({ as: "u_admin" });
  const res = await ok.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: eight, ...SNAP("x_admin") });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).inserted, 8);
  assert.equal(count(ok.sqlite, "audit_logs"), 8);
  assert.ok(ok.d1.stats.maxBinds <= 100, `max binds ${ok.d1.stats.maxBinds}`);
  const nine = setup({ as: "u_admin" });
  const refused = await nine.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: `${eight}\n9,L9`, ...SNAP("x_admin") });
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), {
    ok: false, message: "CSVは一度に最大8行まで登録できます。", inserted: 0, skipped: 9,
    errors: ["データ行を8行以内に分割してください。"],
  });
  assert.equal(count(nine.sqlite, "audit_logs"), 0);
});

test("SA-015 bulk: permission = video.chapter_admin in admin/event mode only", async () => {
  const body = { csv: "5,A", ...SNAP("x_owner") };
  const owner = setup({ as: "u_owner" });
  const r1 = await owner.request("POST", "/api/videos/v_pub/chapters/bulk", body);
  assert.equal(r1.status, 403);
  assert.deepEqual(await r1.json(), { ok: false, message: "この動画のチャプター一括登録権限がありません。" });
  const staff = setup({ as: "u_staff" });
  assert.equal((await staff.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: "5,A", ...SNAP("x_staff") })).status, 200);
  const other = setup({ as: "u_other" });
  assert.equal((await other.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: "5,A", ...SNAP("x_other") })).status, 403);
  assert.equal(count(owner.sqlite, "audit_logs") + count(other.sqlite, "audit_logs"), 0);
});

test("SA-015 bulk: not found 404, non-public 403 (after permission), no data 400, per-row errors reported", async () => {
  const s = setup({ as: "u_admin" });
  const post = (video, csv) => s.request("POST", `/api/videos/${video}/chapters/bulk`, { csv, ...SNAP("x_admin") });
  assert.equal((await post("ghost", "5,A")).status, 404);
  const priv = await post("v_priv", "5,A");
  assert.equal(priv.status, 403);
  assert.equal((await priv.json()).message, "この動画にはチャプターコメントを投稿できません。");
  const header = await post("v_pub", "time,label");
  assert.equal(header.status, 400);
  assert.equal((await header.json()).message, "CSV にデータがありません。");
  const allBad = await post("v_pub", `abc,X\n5,${"l".repeat(121)}\n6,L,${"n".repeat(1001)}\n7,L,,secret`);
  assert.equal(allBad.status, 400);
  assert.deepEqual(await allBad.json(), {
    ok: false, message: "登録できる行がありませんでした。", inserted: 0, skipped: 4,
    errors: [
      '行 1: 時刻の形式が不正です。 ("abc")',
      "行 2: ラベルが必須 (1〜120文字)",
      "行 3: コメントが 1000 文字を超えています",
      "行4: visibility は public または private を指定してください。",
    ],
  });
  const empty = await s.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: "", ...SNAP("x_admin") });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).message, "String must contain at least 1 character(s)");
  const stale = await s.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: "5,A", ...SNAP("x_owner") });
  assert.equal(stale.status, 409);
  assert.equal(count(s.sqlite, "audit_logs"), 0);
});

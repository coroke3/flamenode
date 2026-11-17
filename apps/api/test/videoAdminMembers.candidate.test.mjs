import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createVideoAdminMembersPreflightRoutes,
  createDefaultVideoAdminMembersPreflightHost,
} from "../src/routes/videos/adminMembers.ts";
import { MAX_ADMIN_VIDEO_MEMBERS_EMPTY_CHUNKS, MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES, MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_CHUNKS, readAdminVideoMembersJsonBody } from "../src/routes/videos/adminMembersBody.ts";

const endpoint = "/v1/members";
const member = i => ({ name: "Name " + i, x_user_id: "user_" + i, chapters: [] });
const valid = () => ({
  is_collab: ["false", "true"],
  members_json: JSON.stringify([member(0)]),
});

function fixture({ role = "admin", includeContext = true, targetError = false, targetOverride } = {}) {
  let invoked = 0;
  let prematureDb = 0;
  const host = {
    // The unmounted fake host never touches D1 and cannot grant permissions.
    // Real-stack tests below use the authoritative SQLite/D1 implementation.
    loadAuthorizedVideo: async (_c, videoId) => {
      if (targetError) throw Error("injected target D1 failure");
      return videoId === "v1" ? targetOverride ?? {
        id: "v1", collaboration_type: "individual", visibility_status: "pending",
        creator_x_user_id: null, youtube_video_id: null,
        primary_event_id: null, updated_at: 100, linked_event_ids_json: "[]", public_member_count: 0,
      } : null;
    },
    writeGuard: async (c, next) => {
      invoked++;
      c.header("Cache-Control", "private, no-store");
      if (includeContext) {
        c.set("user", { id: "actor", role });
        c.set("db", new Proxy({}, {
          get() { prematureDb++; throw Error("unreviewed Hono writer must never use DB"); },
        }));
        c.set("auditSettings", {});
        c.set("actorSnapshotJsonById", { actor: "{}" });
      }
      await next();
    },
  };
  const app = createVideoAdminMembersPreflightRoutes(host);
  const request = (path, body, options = {}) => app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json", ...options.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }, { NEXT_PUBLIC_SITE_URL: "https://example.test" });
  return { request, stats: () => ({ invoked, prematureDb }) };
}

test("MIG-0650 U03e Hono admin SA-085 remains absent from the live videos router", async () => {
  const router = await readFile(new URL("../src/routes/videos/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(router, /adminMembers\.ts|createVideoAdminMembersPreflightRoutes/);
});

test("MIG-0650 U03e missing guard context and non-admin actor fail before body/DB", async () => {
  const unauth = fixture({ includeContext: false });
  const noContext = await unauth.request(endpoint, valid());
  assert.equal(noContext.status, 503);
  assert.equal(noContext.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(unauth.stats(), { invoked: 1, prematureDb: 0 });

  const other = fixture({ role: "user" });
  const forbidden = await other.request(endpoint, "{");
  assert.equal(forbidden.status, 403, "role check must precede parsing invalid JSON");
  assert.equal((await forbidden.json()).ok, false);
  assert.deepEqual(other.stats(), { invoked: 1, prematureDb: 0 });
});

test("MIG-0650 U03e Hono rejects path/body mismatch and malformed URL IDs before DB", async () => {
  const f = fixture();
  const variants = [
    [endpoint, { ...valid(), video_id: "v1" }],
    [endpoint, { ...valid(), video_id: "another" }],
    ["/" + "v".repeat(65) + "/members", valid()],
    ["/v%5Cother/members", valid()],
    ["/v1/members", { ...valid(), unknown_key: "forged" }],
  ];
  for (const [path, body] of variants) {
    const res = await f.request(path, body);
    assert.equal(res.status, 400, path);
    assert.equal((await res.json()).ok, false);
  }
  assert.deepEqual(f.stats(), { invoked: variants.length, prematureDb: 0 });
});

test("MIG-0650 U03e Hono rejects invalid, duplicate or 101 member submissions", async () => {
  const f = fixture();
  for (const rows of [
    [member(0), { name: "duplicate", x_user_id: "user_0" }],
    [{ name: "invalid", x_user_id: "bad-x-id" }],
    Array.from({ length: 101 }, (_, i) => member(i)),
    [{ name: "Broken chapter", x_user_id: "valid", chapters: [{ time: "1:60" }] }],
  ]) {
    const res = await f.request(endpoint, { is_collab: ["false", "true"], members_json: JSON.stringify(rows) });
    assert.equal(res.status, 400, JSON.stringify(rows).slice(0,75));
  }
  assert.deepEqual(f.stats(), { invoked: 4, prematureDb: 0 });
});

test("MIG-0650 U03e/U03k malformed, excessive and forged JSON fail without mutation", async () => {
  const f = fixture();
  const invalidJson = await f.request(endpoint, "{");
  assert.equal(invalidJson.status, 400);
  const nowWithinRouteBudget = await f.request(endpoint, {
    ...valid(), extra: "X".repeat(66000),
  });
  assert.equal(nowWithinRouteBudget.status, 400,
    "below SA-085 body budget but invalid unknown-key payload is still rejected");
  const tooLarge = await f.request(endpoint, {
    ...valid(), extra: "X".repeat(MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES),
  });
  assert.equal(tooLarge.status, 413);
  assert.match((await tooLarge.json()).message, /大きすぎ/);
  assert.deepEqual(f.stats(), { invoked: 3, prematureDb: 0 });
});

test("MIG-0650 U03e valid canonical ON/OFF can never produce a false save success", async () => {
  const f = fixture();
  for (const body of [
    valid(),
    { is_collab: ["false"], members_json: "[]" },
  ]) {
    const res = await f.request(endpoint, body);
    assert.equal(res.status, 501, "missing authorized D1 mutation host must fail closed");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await res.json(), {
      ok: false,
      message: "参加者設定の保存APIは移行準備中です。",
    });
  }
  assert.deepEqual(f.stats(), { invoked: 2, prematureDb: 0 });
});

test("MIG-0650 U03e default stack explicitly enforces admin and edit_video guard sequence", async () => {
  assert.ok(createDefaultVideoAdminMembersPreflightHost().writeGuard);
  const source = await readFile(new URL("../src/routes/videos/adminMembers.ts", import.meta.url), "utf8");
  const order = [
    "originGuardMiddleware(originOptions(c))",
    "sessionMiddleware()",
    'requiredRole: "admin"',
    'costGuardMiddleware("edit_video")',
    "    dbMiddleware,",
  ].map(x => source.indexOf(x));
  assert.ok(order.every(i => i >= 0));
  assert.ok(order.every((value, i) => i === 0 || value > order[i - 1]));
  assert.doesNotMatch(source, /mutateWithAudit|\.batch\(|sendQueueWake/);
});


// A fixture that exercises the actual origin/session/admin/TOS/CostGuard/D1
// middleware stack, not the permissive fake writeGuard used by the unit tests.
// All D1 access uses local transactional SQLite, and this candidate NEVER writes.
import { Hono } from "hono";
import { createSqlite } from "./support/personalHarness.mjs";
import { atomicD1, seedChapterWorld, SESSION_USER, SITE } from "./support/chapterSeed.mjs";
import { validateVideoMemberSubmission } from "@flamenode/domain/video/adminMemberSubmission";
import { MAX_ADMIN_JSON_BODY_BYTES } from "../src/routes/admin/body.ts";

function realGuardFixture({ as = "u_admin", mode = "normal" } = {}) {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  sqlite.prepare("UPDATE system_settings SET operation_mode = ? WHERE id = 'default'").run(mode);
  const d1 = atomicD1(sqlite);
  const actor = as ? SESSION_USER(as, as === "u_admin" ? "admin" : "user", "x_admin") : null;
  const session = async (c, next) => {
    c.set("user", actor);
    c.set("sessionState", actor ? "user" : "none");
    await next();
  };
  const app = new Hono();
  app.route("/api/videos", createVideoAdminMembersPreflightRoutes(
    createDefaultVideoAdminMembersPreflightHost({ session }),
  ));
  const send = (body, origin = SITE, path = "/api/videos/v_pub/members") => app.request(path, {
    method: "PUT",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { DB: d1, NEXT_PUBLIC_SITE_URL: SITE });
  const count = table => sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n;
  return { sqlite, d1, send, count };
}

test("MIG-0650 U03f real origin guard denies cross-origin before any D1 read", async () => {
  const s = realGuardFixture();
  try {
    const response = await s.send(valid(), "https://attacker.invalid");
    assert.equal(response.status, 403, await response.clone().text());
    assert.equal((await response.json()).reason, "invalid_origin");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(s.d1.stats.reads, 0);
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.count("audit_logs"), 0);
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03f real session/admin/CostGuard deny before any member mutation", async () => {
  for (const cfg of [
    { as: null, expected: 401 },
    { as: "u_other", expected: 403 },
    { mode: "maintenance", expected: 503 },
  ]) {
    const s = realGuardFixture(cfg);
    try {
      const response = await s.send(valid());
      assert.equal(response.status, cfg.expected, JSON.stringify(cfg) + " " + await response.clone().text());
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(s.d1.stats.batches, 0);
      assert.equal(s.count("video_members"), 0);
      assert.equal(s.count("audit_logs"), 0);
      assert.equal(s.count("static_rebuild_queue"), 0);
    } finally { s.sqlite.close(); }
  }
});

test("MIG-0650 U03f real admin session + CostGuard may preflight but cannot write D1", async () => {
  const s = realGuardFixture();
  try {
    for (const request of [
      valid(),
      { is_collab: ["false"], members_json: "[]" },
    ]) {
      const response = await s.send(request);
      assert.equal(response.status, 501, await response.clone().text());
      assert.equal((await response.json()).ok, false);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.ok(s.d1.stats.reads > 0, "the real admin/TOS/CostGuard path ran DB reads");
    assert.equal(s.d1.stats.batches, 0, "no D1 mutation batch can execute before writer port");
    assert.equal(s.count("video_members"), 0);
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03k legal CURRENT 100x30 chapter fixture passes bounded transport but remains unwired", async () => {
  const members = Array.from({ length: 100 }, (_, i) => ({
    name: "member_" + i,
    x_user_id: "handle_" + i,
    role: "",
    comment: "",
    chapters: Array.from({ length: 30 }, (_, j) => ({
      time: j + ":00", label: "", note: "",
    })),
  }));
  const membersJson = JSON.stringify(members);
  const form = new FormData();
  form.set("members_json", membersJson);
  const validated = validateVideoMemberSubmission(form, true);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.message);
  assert.equal(validated.value.members.length, 100);
  assert.equal([...validated.value.chaptersByIndex.values()].reduce((n, chapters) => n + chapters.length, 0), 3000);

  const request = { is_collab: ["false", "true"], members_json: membersJson };
  const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
  assert.ok(bytes > MAX_ADMIN_JSON_BODY_BYTES, "documented compatibility gap must be measured, not guessed");
  assert.ok(bytes < MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES, "documented intermediate SA-085 body budget must fit actual fixture");

  const s = realGuardFixture();
  try {
    const response = await s.send(request);
    assert.equal(response.status, 501, "legal 100x30 now passes input preflight but a writer is still deliberately unavailable");
    const reply = await response.json();
    assert.deepEqual(reply, { ok: false, message: "参加者設定の保存APIは移行準備中です。" });
    assert.ok(s.d1.stats.reads <= 3, "larger body cannot add D1 pre-read queries");
    assert.equal(reply.ok, false);
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.count("audit_logs"), 0);
  } finally { s.sqlite.close(); }
});



test("MIG-0650 U03q maximum legal 100x30 chapter text exposes 256KiB compatibility STOP", async () => {
  // The small/empty 100x30 fixture tests count parity, not legal text limits.
  const members = Array.from({ length: 100 }, (_, i) => ({
    name: "N".repeat(80),
    x_user_id: "handle_" + i,
    role: "R".repeat(80),
    comment: "C".repeat(500),
    chapters: Array.from({ length: 30 }, (_, j) => ({
      time: j + ":00", label: "L".repeat(120), note: "M".repeat(1000),
    })),
  }));
  const membersJson = JSON.stringify(members);
  const form = new FormData();
  form.set("members_json", membersJson);
  const validated = validateVideoMemberSubmission(form, true);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.message);
  assert.equal(validated.value.members.length, 100);
  assert.equal([...validated.value.chaptersByIndex.values()].reduce((n, rows) => n + rows.length, 0), 3000);

  const input = { is_collab: ["false", "true"], members_json: membersJson };
  const encoded = JSON.stringify(input);
  const wireBytes = new TextEncoder().encode(encoded).byteLength;
  assert.ok(wireBytes > MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES,
    "CURRENT-valid full-length input is NOT supported by the intermediate 256KiB limit");
  assert.ok(wireBytes > 3 * 1024 * 1024,
    "measure actual worst-case bytes rather than extrapolating from empty chapters");

  const body = await readAdminVideoMembersJsonBody(new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encoded,
  }));
  assert.equal(body.kind, "too_large", "reader rejects instead of truncating legal data");

  const s = realGuardFixture();
  try {
    const response = await s.send(input);
    assert.equal(response.status, 413,
      "CURRENT parity gap: do not mount SA-085 until reviewed body/CPU policy");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).ok, false);
    assert.equal(s.d1.stats.batches, 0, "oversize request cannot partially write D1");
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});


test("MIG-0650 U03r CURRENT-valid escaped chapter notes exceed 20MiB in nested JSON transport", async () => {
  // This is an evidence fixture, not permission to raise the Hono body limit.
  // The CURRENT validator caps note characters but does not reject U+0001;
  // JSON.stringify escapes each control character again in members_json.
  const controlNote = String.fromCharCode(1).repeat(1000);
  const members = Array.from({ length: 100 }, (_, i) => ({
    name: "N".repeat(80),
    x_user_id: "handle_" + i,
    role: "R".repeat(80),
    comment: "C".repeat(500),
    chapters: Array.from({ length: 30 }, (_, j) => ({
      time: j + ":00", label: "L".repeat(120), note: controlNote,
    })),
  }));
  const membersJson = JSON.stringify(members);
  const form = new FormData();
  form.set("members_json", membersJson);
  const validated = validateVideoMemberSubmission(form, true);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.message);
  assert.equal([...validated.value.chaptersByIndex.values()].reduce((n, rows) => n + rows.length, 0), 3000);

  const encoded = JSON.stringify({ is_collab: ["false", "true"], members_json: membersJson });
  const wireBytes = new TextEncoder().encode(encoded).byteLength;
  assert.ok(wireBytes > 20 * 1024 * 1024,
    "a legal nested-JSON submission can exceed 20MiB after escaping control characters");
  assert.ok(wireBytes > MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES,
    "the 256KiB interim limit is not full CURRENT payload parity");

  // No Content-Length shortcut: actual streamed body bytes must reject early.
  const result = await readAdminVideoMembersJsonBody(new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encoded,
  }));
  assert.equal(result.kind, "too_large", "oversize must never be parsed or truncated into member writes");
});

test("MIG-0650 U03g privileged PUT only accepts application/json media type before body", async () => {
  const f = fixture();
  const invalid = [
    ["text/plain", JSON.stringify(valid())],
    ["application/x-www-form-urlencoded", "is_collab=true"],
    ["application/vnd.api+json", JSON.stringify(valid())],
    ["multipart/form-data; boundary=abc", JSON.stringify(valid())],
  ];
  for (const [contentType, body] of invalid) {
    const res = await f.request(endpoint, body, {
      headers: { "content-type": contentType },
    });
    assert.equal(res.status, 400, contentType);
    assert.deepEqual(await res.json(), {
      ok: false,
      message: "JSON形式の入力が必要です。",
    });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }

  const accepted = await f.request(endpoint, valid(), {
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
  assert.equal(accepted.status, 501, "valid JSON media type still cannot write until authorized writer exists");
  assert.deepEqual(f.stats(), { invoked: 5, prematureDb: 0 });
});


test("MIG-0650 U03h unmounted SA-085 denies missing target video and target D1 error", async () => {
  const f = fixture();
  const missing = await f.request("/unknown/members", valid());
  assert.equal(missing.status, 404, await missing.clone().text());
  assert.deepEqual(await missing.json(), { ok: false, message: "作品が見つかりません。" });
  assert.equal(missing.headers.get("cache-control"), "private, no-store");

  const bad = fixture({ targetError: true });
  const failed = await bad.request(endpoint, valid());
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { ok: false, message: "作品の確認に失敗しました。" });
  assert.equal(failed.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(f.stats(), { invoked: 1, prematureDb: 0 });
  assert.deepEqual(bad.stats(), { invoked: 1, prematureDb: 0 });
});

test("MIG-0650 U03h real Hono target lookup uses only one extra D1 read, never a write", async () => {
  const s = realGuardFixture();
  try {
    const existing = await s.send(valid());
    assert.equal(existing.status, 501, "existing authorized video still cannot commit without writer");
    const firstReads = s.d1.stats.reads;
    assert.ok(firstReads > 0 && firstReads <= 3, "actor, CostGuard and video facts fit 3 pre-reads");
    assert.equal(s.d1.stats.batches, 0);

    const missing = await s.send(valid(), SITE, "/api/videos/no_such_video/members");
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).ok, false);
    assert.ok(s.d1.stats.reads - firstReads <= 3, "missing video still fits pre-read budget");
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.count("video_members"), 0);
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});


test("MIG-0650 U03i authorized video facts are selected in the same one D1 query", async () => {
  const s = realGuardFixture();
  try {
    s.sqlite.prepare(
      "UPDATE videos SET collaboration_type = 'collab', visibility_status = 'private', updated_at = 12345 WHERE id = 'v_pub'"
    ).run();
    const res = await s.send(valid());
    assert.equal(res.status, 501);
    assert.equal((await res.json()).ok, false);
    const videoReads = s.d1.stats.readSql.filter(sql => /FROM "videos" WHERE "id" = \? LIMIT 1/.test(sql));
    assert.equal(videoReads.length, 1, "the snapshot must cost exactly one bounded SELECT");
    for (const column of [
      "id", "collaboration_type", "visibility_status", "creator_x_user_id",
      "youtube_video_id", "primary_event_id", "updated_at",
    ]) assert.match(videoReads[0], new RegExp('"' + column + '"'));
    assert.ok(s.d1.stats.reads <= 3, "actor, CostGuard and video snapshot fit pre-read budget");
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.count("video_members"), 0);
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03i forged or corrupted video facts fail closed before any write", async () => {
  const baseline = {
    id: "v1", collaboration_type: "individual", visibility_status: "pending",
    creator_x_user_id: null, youtube_video_id: null,
    primary_event_id: null, updated_at: 12345, linked_event_ids_json: "[]", public_member_count: 0,
  };
  for (const forged of [
    { ...baseline, id: "other_video" },
    { ...baseline, collaboration_type: "unauthorized" },
    { ...baseline, visibility_status: "forged" },
    { ...baseline, updated_at: "12345" },
    { ...baseline, updated_at: Number.NaN },
    { ...baseline, public_member_count: undefined },
    { ...baseline, public_member_count: null },
    { ...baseline, public_member_count: -1 },
    { ...baseline, public_member_count: 101 },
    { ...baseline, public_member_count: 0.5 },
    { ...baseline, public_member_count: Number.NaN },
    { ...baseline, public_member_count: "0" },
    { ...baseline, creator_x_user_id: { forged: true } },
    { ...baseline, primary_event_id: ["cross_video"] },
    { ...baseline, linked_event_ids_json: undefined },
    { ...baseline, linked_event_ids_json: "not-json" },
    { ...baseline, linked_event_ids_json: "{}" },
    { ...baseline, linked_event_ids_json: '["ev1",2]' },
    { ...baseline, linked_event_ids_json: '["  ev1"]' },
    { ...baseline, linked_event_ids_json: JSON.stringify(Array.from({length: 10}, (_, i) => "ev" + i)) },
  ]) {
    const f = fixture({ targetOverride: forged });
    const response = await f.request(endpoint, valid());
    assert.equal(response.status, 503, "untrusted target facts must not enter a future SA-085 writer");
    assert.deepEqual(await response.json(), { ok: false, message: "作品の確認に失敗しました。" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(f.stats(), { invoked: 1, prematureDb: 0 });
  }
});

test("MIG-0650 U03j existing video and linked events share one bounded authoritative D1 SELECT", async () => {
  const s = realGuardFixture();
  try {
    const host = createDefaultVideoAdminMembersPreflightHost();
    const before = s.d1.stats.reads;
    const linked = await host.loadAuthorizedVideo({ env: { DB: s.d1 } }, "v_two");
    assert.equal(linked?.id, "v_two");
    assert.equal(linked?.primary_event_id, null);
    assert.equal(linked?.public_member_count, 0);
    assert.deepEqual(JSON.parse(linked.linked_event_ids_json), ["ev2"]);
    assert.equal(s.d1.stats.reads - before, 1, "linked event lookup adds zero pre-read queries");
    const sql = s.d1.stats.readSql.at(-1);
    assert.match(sql, /FROM "video_events" WHERE "video_id" = \?/);
    assert.match(sql, /ORDER BY "event_id" LIMIT 9/);
    assert.match(sql, /FROM "video_members" WHERE "video_id" = \?/);
    assert.match(sql, /"is_public_member" = 1 LIMIT 101/);
    assert.match(sql, /FROM "videos" WHERE "id" = \? LIMIT 1/);

    const response = await s.send(valid(), SITE, "/api/videos/v_two/members");
    assert.equal(response.status, 501, "the preflight still never writes");
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03j linked event overflow and primary+linked overflow fail closed", async () => {
  const baseline = {
    id: "v1", collaboration_type: "collab", visibility_status: "public",
    creator_x_user_id: null, youtube_video_id: null, primary_event_id: null,
    updated_at: 100,
  };
  for (const events of [
    Array.from({ length: 9 }, (_, i) => "event_" + i),
    Array.from({ length: 8 }, (_, i) => "event_" + i),
  ]) {
    const f = fixture({ targetOverride: {
      ...baseline,
      primary_event_id: events.length === 8 ? "another_primary" : null,
      linked_event_ids_json: JSON.stringify(events), public_member_count: 0,
    } });
    const response = await f.request(endpoint, valid());
    assert.equal(response.status, 400, "9 unique rebuild targets must never be partially enqueued");
    assert.deepEqual(await response.json(), {
      ok: false, message: "関連イベント数が処理上限を超えています。",
    });
    assert.deepEqual(f.stats(), { invoked: 1, prematureDb: 0 });
  }
});

test("MIG-0650 U03k bounded body reader ignores lying or absent Content-Length", async () => {
  const large = JSON.stringify({ ...valid(),
    extra: "X".repeat(MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES) });
  const admitted = JSON.stringify(valid());
  const req = (body, length) => new Request("https://flamenode.test/sa085", {
    method: "POST",
    ...(length === undefined ? {} : { headers: { "content-length": String(length) } }),
    body,
  });
  const noHeader = await readAdminVideoMembersJsonBody(req(large));
  assert.equal(noHeader.kind, "too_large",
    "bytes actually read enforce ceiling without Content-Length");
  const forgedShort = await readAdminVideoMembersJsonBody(req(large, 1));
  assert.equal(forgedShort.kind, "too_large", "short claimed Content-Length cannot bypass byte ceiling");
  const forgedLong = await readAdminVideoMembersJsonBody(req(admitted, MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES + 1));
  assert.equal(forgedLong.kind, "too_large", "claimed oversize is rejected without parsing");
  const accepted = await readAdminVideoMembersJsonBody(req(admitted));
  assert.equal(accepted.kind, "ok");
  assert.deepEqual(accepted.value, valid());

  const standardReader = (await import("../src/routes/admin/body.ts")).readAdminJsonBody;
  const legacy = await standardReader(req(JSON.stringify({ ...valid(), extra: "X".repeat(66000) })));
  assert.equal(legacy.kind, "too_large",
    "all other privileged admin routes retain ZERO_1102 64KiB default cap");
});


test("MIG-0650 U03t locked or consumed request body fails closed before JSON parse", async () => {
  const lockedRequest = new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(valid()),
  });
  const ownedReader = lockedRequest.body.getReader();
  try {
    const locked = await readAdminVideoMembersJsonBody(lockedRequest);
    assert.deepEqual(locked, { kind: "invalid" },
      "locked body must not leak a TypeError/500 to privileged callers");
  } finally {
    await ownedReader.cancel();
    ownedReader.releaseLock();
  }

  const consumedRequest = new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(valid()),
  });
  await consumedRequest.text();
  const consumed = await readAdminVideoMembersJsonBody(consumedRequest);
  assert.deepEqual(consumed, { kind: "invalid" },
    "previously consumed input is never treated as an empty valid member set");
});


test("MIG-0650 U03u oversized streaming input rejects promptly even when cancel never settles", async () => {
  // A hostile transport may report a body chunk over budget but never
  // resolve cancel(); rejecting HTTP 413 must not await that promise.
  let cancelCalled = 0;
  const upload = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES + 1));
    },
    cancel() {
      cancelCalled++;
      return new Promise(() => {});
    },
  });
  const request = new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: upload,
    duplex: "half",
  });
  let timeout;
  try {
    const result = await Promise.race([
      readAdminVideoMembersJsonBody(request),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("oversize input waited for transport cancel")), 1500);
      }),
    ]);
    assert.deepEqual(result, { kind: "too_large" });
    assert.equal(cancelCalled, 1, "the transport is still cancelled best-effort");
  } finally {
    clearTimeout(timeout);
  }
});

test("MIG-0650 U03l SA-085 reader rejects malformed UTF-8 instead of altering participant identity", async () => {
  // JSON.parse succeeds with the replacement character under the default
  // non-fatal TextDecoder. This must be an invalid request, not a renamed row.
  const malformed = new Uint8Array([
    ...new TextEncoder().encode('{"members_json":"'),
    0xc3, 0x28,
    ...new TextEncoder().encode('","is_collab":["false","true"]}'),
  ]);
  const request = new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: malformed,
  });
  const result = await readAdminVideoMembersJsonBody(request);
  assert.deepEqual(result, { kind: "invalid" });
});

test("MIG-0650 U03l SA-085 reader treats an interrupted chunked body as invalid", async () => {
  const brokenStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"members_json":"'));
      controller.error(new Error("client upload interrupted"));
    },
  });
  const request = new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: brokenStream,
    duplex: "half",
  });
  const result = await readAdminVideoMembersJsonBody(request);
  assert.deepEqual(result, { kind: "invalid" });
});

test("MIG-0650 U03l byte-counted limit rejects multi-byte uploads at the actual 256KiB boundary", async () => {
  const below = "あ".repeat(Math.floor((MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES - 20) / 3));
  const body = JSON.stringify({ v: below });
  const bytes = new TextEncoder().encode(body).byteLength;
  assert.ok(bytes < MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES);
  const request = payload => new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: payload }),
  });
  assert.equal((await readAdminVideoMembersJsonBody(request(below))).kind, "ok");
  assert.equal((await readAdminVideoMembersJsonBody(request(below + "あ".repeat(10)))).kind, "too_large");
});

test("MIG-0650 U03aa non-byte stream chunks fail closed; empty byte chunks preserve JSON", async () => {
  const makeRequest = chunks => {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    return new Request("https://flamenode.test/sa085", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    });
  };
  const bytes = text => new TextEncoder().encode(text);
  const payload = JSON.stringify(valid());

  // An injected Request stream can emit non-Uint8Array values despite
  // the TypeScript type. Never trust byteLength or attempt to copy them.
  for (const malformed of [
    "{}", new Uint16Array([123]), { byteLength: 0 },
    new DataView(new ArrayBuffer(2)),
  ]) {
    const result = await readAdminVideoMembersJsonBody(
      makeRequest([bytes("{"), malformed, bytes("}")]),
    );
    assert.deepEqual(result, { kind: "invalid" }, String(malformed));
  }

  const accepted = await readAdminVideoMembersJsonBody(makeRequest([
    new Uint8Array(), bytes(payload.slice(0, 4)),
    new Uint8Array(), bytes(payload.slice(4)),
  ]));
  assert.deepEqual(accepted, { kind: "ok", value: valid() },
    "zero-length byte chunks must not change valid JSON semantics");
});

test("MIG-0650 U03ab rejects invalid URL ID before costly JSON body, after admin guard", async () => {
  const invalidPath = "/" + "v".repeat(65) + "/members";
  const oversized = { ...valid(), extra: "X".repeat(MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_BYTES) };

  const admin = fixture();
  const rejected = await admin.request(invalidPath, oversized);
  assert.equal(rejected.status, 400, "invalid URL must reject before body-size 413");
  assert.deepEqual(await rejected.json(), {
    ok: false,
    message: "対象作品が指定されていません。",
  });
  assert.equal(rejected.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(admin.stats(), { invoked: 1, prematureDb: 0 });

  // The early URL check must never bypass the admin identity guard.
  const forbidden = fixture({ role: "user" });
  const denied = await forbidden.request(invalidPath, oversized);
  assert.equal(denied.status, 403);
  assert.deepEqual(forbidden.stats(), { invoked: 1, prematureDb: 0 });

  // Valid paths still enforce the existing 256KiB body ceiling.
  const normal = await admin.request(endpoint, oversized);
  assert.equal(normal.status, 413);
  assert.deepEqual(admin.stats(), { invoked: 2, prematureDb: 0 });
});


test("MIG-0650 U03ad caps zero-byte streamed reads without waiting on cancellation", async () => {
  let reads = 0;
  let cancels = 0;
  const endlessEmpty = new ReadableStream({
    pull(controller) {
      reads += 1;
      controller.enqueue(new Uint8Array(0));
    },
    cancel() {
      cancels += 1;
      // A malicious transport may never settle its cancellation promise.
      return new Promise(() => {});
    },
  });
  const request = stream => new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  let timeout;
  try {
    const result = await Promise.race([
      readAdminVideoMembersJsonBody(request(endlessEmpty)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("empty stream blocked Worker request")), 1500);
      }),
    ]);
    assert.deepEqual(result, { kind: "invalid" });
    // ReadableStream.pull() may prefetch one extra element ahead of
    // reader.read() even though the parser rejects at exactly max + 1
    // delivered empty chunks. Measure bounded producer work, not an
    // implementation-dependent equality between pull() and read() calls.
    assert.ok(
      reads >= MAX_ADMIN_VIDEO_MEMBERS_EMPTY_CHUNKS + 1 &&
      reads <= MAX_ADMIN_VIDEO_MEMBERS_EMPTY_CHUNKS + 2,
      `unexpected producer pulls: ${reads}`,
    );
    assert.equal(cancels, 1, "rejects without waiting for a stalled transport cancel");
  } finally {
    clearTimeout(timeout);
  }

  // The allowed ceiling is inclusive and does not alter valid JSON.
  const payload = new TextEncoder().encode(JSON.stringify(valid()));
  const allowed = new ReadableStream({
    start(controller) {
      for (let i = 0; i < MAX_ADMIN_VIDEO_MEMBERS_EMPTY_CHUNKS; i++) {
        controller.enqueue(new Uint8Array());
      }
      controller.enqueue(payload);
      controller.close();
    },
  });
  assert.deepEqual(await readAdminVideoMembersJsonBody(request(allowed)), {
    kind: "ok", value: valid(),
  });
});


test("MIG-0650 U03ae aborted stalled upload rejects without waiting for stream cancel", async () => {
  let cancelCount = 0;
  const transport = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"members_json":"'));
      // Never close or enqueue another chunk: the second read cannot finish.
    },
    cancel() {
      cancelCount += 1;
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const request = new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: transport,
    duplex: "half",
    signal: controller.signal,
  });
  let timeout;
  try {
    const read = readAdminVideoMembersJsonBody(request);
    controller.abort();
    const result = await Promise.race([
      read,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("aborted upload hung on read or cancel")), 1500);
      }),
    ]);
    assert.deepEqual(result, { kind: "invalid" });
    assert.ok(cancelCount <= 1, "cancellation remains best effort");
  } finally {
    clearTimeout(timeout);
  }

  const preAborted = new AbortController();
  preAborted.abort();
  const preAbortedRequest = new Request("https://flamenode.test/sa085", {
    method: "POST",
    body: JSON.stringify(valid()),
    signal: preAborted.signal,
  });
  assert.deepEqual(await readAdminVideoMembersJsonBody(preAbortedRequest), {
    kind: "invalid",
  }, "no full body must be parsed after an existing abort");
});


test("MIG-0650 U03af snapshots streamed bytes before an upstream producer reuses its buffer", async () => {
  // A custom Request can reuse a Uint8Array between stream reads. Retaining
  // the first view and concatenating only after EOF would parse mutated
  // bytes rather than the bytes actually delivered by the first read.
  const original = '{"members_json":"original"}';
  const first = new TextEncoder().encode(original.slice(0, 12));
  const second = new TextEncoder().encode(original.slice(12));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(first);
      setImmediate(() => {
        first.fill(88); // upstream reuses the first underlying buffer
        controller.enqueue(second);
        controller.close();
      });
    },
  });
  const request = new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  assert.deepEqual(await readAdminVideoMembersJsonBody(request), {
    kind: "ok", value: { members_json: "original" },
  }, "later producer mutations cannot rewrite already-consumed body bytes");
});


test("MIG-0650 U03ah all seven schema-valid video statuses are valid SA-085 targets", async () => {
  const schema = await readFile(
    new URL("../../../packages/db/src/schema/base.ts", import.meta.url), "utf8",
  );
  const videosDeclaration = schema.slice(schema.indexOf('export const videos = sqliteTable("videos"'));
  const statusDeclaration = videosDeclaration.match(
    /visibility_status: text\("visibility_status", \{\s*enum: \[([^\]]+)\]/,
  );
  assert.ok(statusDeclaration, "schema must still expose videos.visibility_status");
  const schemaStates = Array.from(statusDeclaration[1].matchAll(/"([^"]+)"/g), m => m[1]);
  const validStates = ["draft", "pending", "public", "limited", "private", "archived", "voided"];
  assert.deepEqual(schemaStates.slice().sort(), validStates.slice().sort(),
    "update this preflight test when the authoritative DB enum changes");

  for (const visibility_status of validStates) {
    const f = fixture({ targetOverride: {
      id: "v1", collaboration_type: "individual", visibility_status,
      creator_x_user_id: null, youtube_video_id: null,
      primary_event_id: null, updated_at: 100, linked_event_ids_json: "[]", public_member_count: 0,
    } });
    const result = await f.request(endpoint, valid());
    assert.equal(result.status, 501, visibility_status + " must reach only the unwired save port");
    assert.deepEqual(await result.json(), {
      ok: false, message: "参加者設定の保存APIは移行準備中です。",
    }, visibility_status);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(f.stats(), { invoked: 1, prematureDb: 0 });
  }

  const invalid = fixture({ targetOverride: {
    id: "v1", collaboration_type: "individual", visibility_status: "forged",
    creator_x_user_id: null, youtube_video_id: null,
    primary_event_id: null, updated_at: 100, linked_event_ids_json: "[]", public_member_count: 0,
  } });
  const rejected = await invalid.request(endpoint, valid());
  assert.equal(rejected.status, 503, "unrecognized state must fail closed");
  assert.deepEqual(invalid.stats(), { invoked: 1, prematureDb: 0 });
});

test("MIG-0650 U03ai bounds 1-byte streamed JSON chunks separately from byte count", async () => {
  const makeRequest = body => new Request("https://flamenode.test/sa085", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  });

  // Exactly the full 4096-read budget is still legal when the body is valid
  // JSON. This cannot be confused with the independent 1024 empty-read cap.
  const legalJson = new TextEncoder().encode(
    "{" + " ".repeat(MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_CHUNKS - 2) + "}",
  );
  const legal = new ReadableStream({
    start(controller) {
      for (const byte of legalJson) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(await readAdminVideoMembersJsonBody(makeRequest(legal)), {
    kind: "ok", value: {},
  }, "exactly max delivered nonempty chunks must not be prematurely rejected");

  // A malicious client can issue more than 4096 nonempty 1-byte reads without
  // reaching the 256KiB ceiling. Its cancel() may never settle.
  let emitted = 0;
  let cancelled = 0;
  const endless = new ReadableStream({
    pull(controller) {
      emitted++;
      controller.enqueue(Uint8Array.of(32));
    },
    cancel() {
      cancelled++;
      return new Promise(() => {});
    },
  });
  let timeout;
  try {
    const result = await Promise.race([
      readAdminVideoMembersJsonBody(makeRequest(endless)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("1-byte stream exceeded request CPU budget")), 3000);
      }),
    ]);
    assert.deepEqual(result, { kind: "invalid" });
    assert.ok(emitted >= MAX_ADMIN_VIDEO_MEMBERS_JSON_BODY_CHUNKS + 1);
    assert.equal(cancelled, 1, "reject promptly without awaiting malicious cancel()");
  } finally {
    clearTimeout(timeout);
  }
});

test("MIG-0650 U03at real D1 preflight detects >100 existing public members in one bounded SELECT", async () => {
  const s = realGuardFixture();
  try {
    const host = createDefaultVideoAdminMembersPreflightHost();
    const insertMember = s.sqlite.prepare(
      "INSERT INTO video_members " +
      "(id, video_id, x_user_id, name, role, comment, order_index, can_edit, " +
      "is_public_member, edit_granted_by_auth_user_id, edit_granted_at, edit_updated_at) " +
      "VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, 1, NULL, NULL, NULL)"
    );
    for (let i = 0; i < 100; i++) {
      insertMember.run("preflight_member_" + i, "v_pub", null, "Member " + i, i);
    }
    const before = s.d1.stats.reads;
    const authorized = await host.loadAuthorizedVideo({ env: { DB: s.d1 } }, "v_pub");
    assert.equal(authorized?.public_member_count, 100);
    assert.equal(s.d1.stats.reads - before, 1, "100-public count uses existing target read");

    const allowed = await s.send(valid());
    assert.equal(allowed.status, 501, "valid maximum does not activate writer");
    assert.equal(s.d1.stats.batches, 0);

    insertMember.run("preflight_member_overflow", "v_pub", null, "Overflow", 100);
    const preOverflowReads = s.d1.stats.reads;
    const overflow = await host.loadAuthorizedVideo({ env: { DB: s.d1 } }, "v_pub");
    assert.equal(overflow?.public_member_count, 101, "count is capped at max + 1");
    assert.equal(s.d1.stats.reads - preOverflowReads, 1, "no fourth pre-read to detect overflow");
    const denied = await s.send(valid());
    assert.equal(denied.status, 503, "existing corruption cannot reach future Hono writer");
    assert.deepEqual(await denied.json(), { ok: false, message: "作品の確認に失敗しました。" });
    assert.equal(s.d1.stats.batches, 0, "overflow must never execute a D1 mutation");
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03bi authorized Hono host can compose canonical shared no-op without any D1 batch", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("@flamenode/db/schema");
  const { mapAuditSettings } = await import("@flamenode/server-core/audit/settings");
  const { prepareAdminVideoMemberCandidateWrite } =
    await import("@flamenode/server-core/video/adminMemberCandidatePrepare");
  const s = realGuardFixture();
  try {
    const host = createDefaultVideoAdminMembersPreflightHost();
    const target = await host.loadAuthorizedVideo({ env: { DB: s.d1 } }, "v_two");
    assert.ok(target);
    const form = new FormData();
    form.set("members_json", "[]");
    const validated = validateVideoMemberSubmission(form, false);
    assert.equal(validated.ok, true);
    const prepared = await prepareAdminVideoMemberCandidateWrite(
      drizzle(s.d1, { schema }),
      {
        target, videoId: "v_two", actorUserId: "u_admin",
        validated: validated.value, isCollab: false, eventIds: ["ev2"],
        now: 12345,
        preloaded: {
          settings: mapAuditSettings(s.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get()),
          actorSnapshotJsonById: {
            u_admin: JSON.stringify({
              discord_id: null, discord_name: null, x_user_id: null,
              x_name: null, icon_url: null,
            }),
          },
        },
        readMeasuredCallerQueries: () => s.d1.stats.reads,
      },
    );
    assert.equal(prepared.assembly.noOp, true);
    assert.equal(prepared.atomic, null);
    assert.equal(prepared.executionInput.callerQueryCount, s.d1.stats.reads);
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03bi canonical collaboration-only plan includes strict video audit + Queue but executes no D1", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("@flamenode/db/schema");
  const { mapAuditSettings } = await import("@flamenode/server-core/audit/settings");
  const { prepareAdminVideoMemberCandidateWrite } =
    await import("@flamenode/server-core/video/adminMemberCandidatePrepare");
  const s = realGuardFixture();
  try {
    const target = await createDefaultVideoAdminMembersPreflightHost()
      .loadAuthorizedVideo({ env: { DB: s.d1 } }, "v_two");
    assert.ok(target);
    const form = new FormData();
    form.set("members_json", "[]");
    const validated = validateVideoMemberSubmission(form, true);
    assert.equal(validated.ok, true);
    const preloaded = {
      settings: mapAuditSettings(s.sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get()),
      actorSnapshotJsonById: {
        u_admin: JSON.stringify({
          discord_id: null, discord_name: null, x_user_id: null,
          x_name: null, icon_url: null,
        }),
      },
    };
    let measuredCalls = 0;
    const candidate = await prepareAdminVideoMemberCandidateWrite(drizzle(s.d1, { schema }), {
      target, videoId: "v_two", actorUserId: "u_admin",
      validated: validated.value, isCollab: true, eventIds: ["ev2"],
      now: 12345, preloaded,
      readMeasuredCallerQueries: () => {
        measuredCalls++;
        return s.d1.stats.reads;
      },
    });
    assert.equal(measuredCalls, 1, "measure AFTER shared planner's canonical D1 reads");
    assert.equal(candidate.assembly.noOp, false);
    assert.ok(candidate.atomic);
    assert.ok(candidate.atomic.audits.some(a => a.table_name === "videos" && a.strict));
    assert.equal(candidate.atomic.callerQueryCount, s.d1.stats.reads);
    assert.equal(candidate.atomic.staticRebuildWakeSource, "admin");
    assert.ok(candidate.assembly.targets.some(t => t.targetType === "video"));
    assert.ok(candidate.assembly.targets.some(t => t.targetType === "event_release"));
    assert.equal(s.d1.stats.batches, 0, "planning can never commit D1");
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
    assert.equal(s.sqlite.prepare("SELECT collaboration_type FROM videos WHERE id='v_two'").get().collaboration_type, "individual");
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03bi rejects forged actor/target and absent measured read counter before D1 reads", async () => {
  const { prepareAdminVideoMemberCandidateWrite } =
    await import("@flamenode/server-core/video/adminMemberCandidatePrepare");
  const forbiddenDb = new Proxy({}, { get() { throw Error("must reject before accessing D1"); } });
  const target = { id: "v_two", collaboration_type: "individual",
    visibility_status: "public", creator_x_user_id: null, updated_at: 10 };
  const preloaded = { settings: {}, actorSnapshotJsonById: {
    u_admin: JSON.stringify({ discord_id: null, discord_name: null, x_user_id: null, x_name: null, icon_url: null }),
  } };
  const valid = { target, videoId: "v_two", actorUserId: "u_admin",
    validated: { members: [], chaptersByIndex: new Map() }, isCollab: false,
    eventIds: [], now: 12345, preloaded,
    readMeasuredCallerQueries: () => 0 };
  for (const variant of [
    { videoId: "foreign_video" },
    { actorUserId: "other_user" },
    { readMeasuredCallerQueries: null },
    { eventIds: ["e1", "e1"] },
    { eventIds: Array.from({ length: 9 }, (_, i) => "e" + i) },
    { validated: { members: Array.from({ length: 101 }, () => ({})), chaptersByIndex: new Map() } },
  ]) {
    await assert.rejects(
      prepareAdminVideoMemberCandidateWrite(forbiddenDb, { ...valid, ...variant,
        ...(variant.actorUserId === "other_user" ? { preloaded: { ...preloaded, actorSnapshotJsonById: {} } } : {}) }),
      { name: "RangeError", message: "video_admin_member_candidate_prepare_invalid" },
    );
  }
});

test("MIG-0650 U03bj strict host boundary rejects incomplete chapters and invalid video snapshot before D1", async () => {
  const { prepareAdminVideoMemberCandidateWrite } =
    await import("@flamenode/server-core/video/adminMemberCandidatePrepare");
  let dbAccess = 0;
  const forbiddenDb = new Proxy({}, { get() { dbAccess++; throw Error("unexpected D1 read"); } });
  const target = { id: "v_two", collaboration_type: "individual",
    visibility_status: "public", creator_x_user_id: null, updated_at: 10 };
  const member = { name: "Alice", x_user_id: "alice", role: "",
    comment: "", chapters: [] };
  const goodMap = new Map([[0, []]]);
  const preloaded = { settings: {}, actorSnapshotJsonById: {
    u_admin: JSON.stringify({
      discord_id: null, discord_name: null, x_user_id: null,
      x_name: null, icon_url: null,
    }),
  } };
  const args = {
    target, videoId: "v_two", actorUserId: "u_admin",
    validated: { members: [member], chaptersByIndex: goodMap },
    isCollab: true, eventIds: [], now: 12345, preloaded,
    readMeasuredCallerQueries: () => 1,
  };
  const normalizedChapter = { time_seconds: 12, label: "Hi", note: "", order_index: 0 };
  const rawChapter = { time: "0:12", label: "Hi", note: "" };
  const invalid = [
    { target: { ...target, visibility_status: "forged" } },
    { target: { ...target, updated_at: "10" } },
    { target: { ...target, updated_at: Number.NaN } },
    { target: { ...target, creator_x_user_id: { malformed: true } } },
    { isCollab: false },
    { validated: { members: [member], chaptersByIndex: new Map() } },
    { validated: { members: [], chaptersByIndex: goodMap } },
    { validated: { members: [member], chaptersByIndex: new Map([[1, []]]) } },
    { validated: { members: [{ ...member, x_user_id: "invalid-id!" }], chaptersByIndex: goodMap } },
    { validated: { members: [{ ...member, chapters: [rawChapter] }], chaptersByIndex: goodMap } },
    { validated: { members: [{ ...member, chapters: [rawChapter] }],
      chaptersByIndex: new Map([[0, [{ ...normalizedChapter, time_seconds: NaN }]]]) } },
    { validated: { members: [{ ...member, chapters: [rawChapter] }],
      chaptersByIndex: new Map([[0, [{ ...normalizedChapter, order_index: 7 }]]]) } },
    { validated: { members: [{ ...member, chapters: [rawChapter] }],
      chaptersByIndex: new Map([[0, [{ ...normalizedChapter, note: "N".repeat(1001) }]]]) } },
    { validated: { members: [{ ...member, chapters: [rawChapter] }],
      chaptersByIndex: new Map([[0, [{ ...normalizedChapter, time_seconds: 13 }]]]) } },
    { validated: { members: [{ ...member, chapters: [rawChapter] }],
      chaptersByIndex: new Map([[0, [{ ...normalizedChapter, label: "FORGED" }]]]) } },
    { validated: { members: [{ ...member, chapters: [rawChapter] }],
      chaptersByIndex: new Map([[0, [{ ...normalizedChapter, note: "FORGED" }]]]) } },
    { validated: { members: [{ ...member, chapters: [{ ...rawChapter, time: "1:60" }] }],
      chaptersByIndex: new Map([[0, [normalizedChapter]]]) } },
    { validated: { members: [{ ...member, chapters: Array.from({ length: 31 }, () => rawChapter) }],
      chaptersByIndex: new Map([[0, Array.from({ length: 31 }, (_, i) =>
        ({ ...normalizedChapter, order_index: i }))]]) } },
  ];
  for (const variant of invalid) {
    await assert.rejects(
      prepareAdminVideoMemberCandidateWrite(forbiddenDb, { ...args, ...variant }),
      { name: "RangeError", message: "video_admin_member_candidate_prepare_invalid" },
    );
  }
  assert.equal(dbAccess, 0, "all malformed inputs must fail before identity/chapters SELECT");
});



test("MIG-0650 U03bk real validated member and chapter values produce strict atomic plan without D1 write", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("@flamenode/db/schema");
  const { mapAuditSettings } = await import("@flamenode/server-core/audit/settings");
  const { prepareAdminVideoMemberCandidateWrite } =
    await import("@flamenode/server-core/video/adminMemberCandidatePrepare");
  const s = realGuardFixture();
  try {
    const target = await createDefaultVideoAdminMembersPreflightHost()
      .loadAuthorizedVideo({ env: { DB: s.d1 } }, "v_two");
    assert.ok(target);
    const form = new FormData();
    form.set("members_json", JSON.stringify([{
      name: "Owner", x_user_id: "x_owner", role: "", comment: "",
      chapters: [{ time: "0:12", label: "Owner", note: "Checked" }],
    }]));
    const validated = validateVideoMemberSubmission(form, true);
    assert.equal(validated.ok, true);
    const initialChapterCount = s.count("video_chapters");
    const prepared = await prepareAdminVideoMemberCandidateWrite(drizzle(s.d1, { schema }), {
      target, videoId: "v_two", actorUserId: "u_admin",
      validated: validated.value, isCollab: true, eventIds: ["ev2"],
      now: 12345,
      preloaded: {
        settings: mapAuditSettings(s.sqlite.prepare(
          "SELECT * FROM system_settings WHERE id = 'default'"
        ).get()),
        actorSnapshotJsonById: {
          u_admin: JSON.stringify({
            discord_id: null, discord_name: null, x_user_id: null,
            x_name: null, icon_url: null,
          }),
        },
      },
      readMeasuredCallerQueries: () => s.d1.stats.reads,
    });
    assert.ok(prepared.atomic);
    assert.equal(prepared.assembly.noOp, false);
    for (const table of ["video_members_set", "video_chapters_member_set", "videos"]) {
      assert.ok(prepared.atomic.audits.some(a => a.table_name === table && a.strict), table);
    }
    assert.ok(prepared.assembly.targets.some(t => t.targetType === "event_release"));
    assert.equal(prepared.atomic.callerQueryCount, s.d1.stats.reads);
    assert.equal(s.d1.stats.batches, 0, "candidate preparation can never commit");
    assert.equal(s.count("video_members"), 0);
    assert.equal(s.count("video_chapters"), initialChapterCount);
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
  } finally { s.sqlite.close(); }
});

/** U03bl: exercise the fully canonicalized but UNMOUNTED Hono write pipeline against SQLite. */
async function preparedSqliteMemberSave(s) {
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("@flamenode/db/schema");
  const { mapAuditSettings } = await import("@flamenode/server-core/audit/settings");
  const { prepareAdminVideoMemberCandidateWrite } =
    await import("@flamenode/server-core/video/adminMemberCandidatePrepare");
  const target = await createDefaultVideoAdminMembersPreflightHost()
    .loadAuthorizedVideo({ env: { DB: s.d1 } }, "v_two");
  assert.ok(target, "authoritative video snapshot");
  const form = new FormData();
  form.set("members_json", JSON.stringify([{
    name: "Owner", x_user_id: "x_owner", role: "", comment: "",
    chapters: [{ time: "0:12", label: "Owner", note: "Checked" }],
  }]));
  const validated = validateVideoMemberSubmission(form, true);
  assert.equal(validated.ok, true);
  const db = drizzle(s.d1, { schema });
  const prepared = await prepareAdminVideoMemberCandidateWrite(db, {
    target, videoId: "v_two", actorUserId: "u_admin",
    validated: validated.value, isCollab: true, eventIds: ["ev2"], now: 12345,
    preloaded: {
      settings: mapAuditSettings(s.sqlite.prepare(
        "SELECT * FROM system_settings WHERE id = 'default'"
      ).get()),
      actorSnapshotJsonById: {
        u_admin: JSON.stringify({
          discord_id: null, discord_name: null, x_user_id: null,
          x_name: null, icon_url: null,
        }),
      },
    },
    readMeasuredCallerQueries: () => s.d1.stats.reads,
  });
  assert.ok(prepared.atomic);
  assert.equal(prepared.atomic.callerQueryCount, s.d1.stats.reads);
  assert.equal(s.d1.stats.batches, 0, "preparation cannot start a transaction");
  return { db, prepared };
}

test("MIG-0650 U03bl canonical member/chapter metadata + strict audit + Queue commit in one SQLite D1 batch", async () => {
  const { executeAdminMemberAtomicCandidate } =
    await import("@flamenode/server-core/video/adminMemberAtomicExecute");
  const s = realGuardFixture();
  try {
    const { db, prepared } = await preparedSqliteMemberSave(s);
    const priorChapters = s.count("video_chapters");
    let wakeLookups = 0;
    const saved = await executeAdminMemberAtomicCandidate(
      db, prepared.executionInput, async () => {
        wakeLookups++;
        assert.equal(s.count("video_members"), 1, "member row is committed before wake");
        assert.equal(s.count("video_chapters"), priorChapters + 1,
          "member-managed chapter is committed before wake");
        assert.ok(s.count("audit_logs") >= 3, "strict member/chapter/video audits committed");
        assert.ok(s.count("static_rebuild_queue") > 0, "durable fanout committed");
        return {
          readEnv: () => null, readWaitUntil: () => null, readKv: () => null,
        };
      },
    );
    assert.equal(saved.committed, true);
    assert.ok(saved.auditIds.length >= 3);
    assert.equal(s.d1.stats.batches, 1, "atomic member/chapter/audit/Queue transaction");
    assert.equal(wakeLookups, 1, "no Queue notification before commit");
    assert.equal(s.sqlite.prepare(
      "SELECT collaboration_type FROM videos WHERE id = 'v_two'"
    ).get().collaboration_type, "collab");
    assert.equal(s.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM video_chapters WHERE video_id = 'v_two' AND id LIKE '%:member:0'"
    ).get().n, 1);
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03bl stale member snapshot rolls back chapter, metadata, audit and Queue", async () => {
  const { executeAdminMemberAtomicCandidate } =
    await import("@flamenode/server-core/video/adminMemberAtomicExecute");
  const s = realGuardFixture();
  try {
    const { db, prepared } = await preparedSqliteMemberSave(s);
    const priorChapters = s.count("video_chapters");
    // Simulate a second admin changing the member set AFTER authorized reads,
    // but BEFORE the same-batch optimistic member-set CAS.
    s.sqlite.prepare(
      "INSERT INTO video_members " +
      "(id, video_id, x_user_id, name, role, comment, order_index, can_edit, " +
      "is_public_member, edit_granted_by_auth_user_id, edit_granted_at, edit_updated_at) " +
      "VALUES (?, ?, ?, ?, NULL, NULL, ?, 0, 1, NULL, NULL, NULL)"
    ).run("raced_member", "v_two", null, "Concurrent editor", 0);
    let wakeLookups = 0;
    await assert.rejects(
      executeAdminMemberAtomicCandidate(db, prepared.executionInput, async () => {
        wakeLookups++;
        return {
          readEnv: () => null, readWaitUntil: () => null, readKv: () => null,
        };
      }),
    );
    assert.equal(s.d1.stats.batches, 1);
    assert.equal(wakeLookups, 0, "no wake after a rejected optimistic CAS");
    assert.equal(s.count("video_members"), 1, "concurrent writer row survives");
    assert.equal(s.sqlite.prepare(
      "SELECT id FROM video_members WHERE video_id='v_two'"
    ).get().id, "raced_member");
    assert.equal(s.count("video_chapters"), priorChapters, "no chapter write survives");
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.count("static_rebuild_queue"), 0);
    assert.equal(s.sqlite.prepare(
      "SELECT collaboration_type FROM videos WHERE id = 'v_two'"
    ).get().collaboration_type, "individual");
  } finally { s.sqlite.close(); }
});


test("MIG-0650 U03bm read meter counts bound D1 first/all/raw and forbids writes", async () => {
  const { createAdminMemberD1ReadMeter } =
    await import("../src/routes/videos/adminMemberD1ReadMeter.ts");
  const s = realGuardFixture();
  try {
    const meter = createAdminMemberD1ReadMeter(s.d1);
    const stmt = meter.binding.prepare("SELECT id FROM videos WHERE id = ?").bind("v_two");
    assert.equal((await stmt.first()).id, "v_two");
    assert.equal((await stmt.all()).results.length, 1);
    assert.equal((await stmt.raw()).length, 1);
    assert.equal(meter.readCount(), 3);
    assert.equal(s.d1.stats.reads, 3);
    assert.throws(() => stmt.run(), { name: "RangeError",
      message: "video_admin_member_d1_read_meter_mutation_forbidden" });
    assert.throws(() => meter.binding.batch([]), { name: "RangeError",
      message: "video_admin_member_d1_read_meter_mutation_forbidden" });
    assert.throws(() => meter.binding.exec("DELETE FROM videos"), { name: "RangeError",
      message: "video_admin_member_d1_read_meter_mutation_forbidden" });
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(meter.close(), 3);
    assert.throws(() => stmt.first(), {
      name: "RangeError", message: "video_admin_member_d1_read_meter_closed",
    });
    assert.throws(() => meter.binding.prepare("SELECT 1"), {
      name: "RangeError", message: "video_admin_member_d1_read_meter_closed",
    });
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03bm one meter measures CostGuard, authorized video and canonical member/chapter Drizzle reads", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("@flamenode/db/schema");
  const { evaluateCostGuardWithSettings } =
    await import("../src/middleware/costGuard.ts");
  const { createAdminMemberD1ReadMeter, sealAdminMemberD1ReadMeter } =
    await import("../src/routes/videos/adminMemberD1ReadMeter.ts");
  const { prepareAdminVideoMemberCandidateWrite } =
    await import("@flamenode/server-core/video/adminMemberCandidatePrepare");
  const s = realGuardFixture();
  try {
    const meter = createAdminMemberD1ReadMeter(s.d1);
    const cost = await evaluateCostGuardWithSettings(meter.binding, "edit_video");
    assert.equal(cost.denied, null);
    assert.ok(cost.auditSettings);
    const target = await createDefaultVideoAdminMembersPreflightHost()
      .loadAuthorizedVideo({ env: { DB: meter.binding } }, "v_two");
    assert.ok(target);
    const form = new FormData();
    form.set("members_json", JSON.stringify([{
      name: "Owner", x_user_id: "x_owner", role: "", comment: "",
      chapters: [{ time: "0:12", label: "Owner", note: "Checked" }],
    }]));
    const validated = validateVideoMemberSubmission(form, true);
    assert.equal(validated.ok, true);
    const prepared = await prepareAdminVideoMemberCandidateWrite(
      drizzle(meter.binding, { schema }), {
        target, videoId: "v_two", actorUserId: "u_admin",
        validated: validated.value, isCollab: true, eventIds: ["ev2"],
        now: 12345,
        preloaded: {
          settings: cost.auditSettings,
          actorSnapshotJsonById: {
            u_admin: JSON.stringify({
              discord_id: null, discord_name: null, x_user_id: null,
              x_name: null, icon_url: null,
            }),
          },
        },
        readMeasuredCallerQueries: meter.readCount,
      },
    );
    assert.ok(prepared.atomic);
    assert.equal(prepared.atomic.callerQueryCount, meter.readCount());
    assert.equal(meter.readCount(), s.d1.stats.reads,
      "guard, CostGuard, target and canonical reads must all be metered");
    assert.ok(meter.readCount() > 2, "canonical planner must contribute reads");
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(sealAdminMemberD1ReadMeter(meter, prepared.atomic.callerQueryCount),
      prepared.atomic.callerQueryCount, "the canonical execution budget is sealed");
    assert.throws(() => meter.binding.prepare("SELECT 1"), {
      name: "RangeError", message: "video_admin_member_d1_read_meter_closed",
    });
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03bm 51st D1 read fails BEFORE provider call and cannot bypass cap", async () => {
  const { createAdminMemberD1ReadMeter } =
    await import("../src/routes/videos/adminMemberD1ReadMeter.ts");
  const { D1_MAX_BATCH_QUERIES } =
    await import("@flamenode/server-core/audit/mutateBudget");
  const s = realGuardFixture();
  try {
    const meter = createAdminMemberD1ReadMeter(s.d1);
    const stmt = meter.binding.prepare("SELECT id FROM videos WHERE id = ?")
      .bind("v_two");
    for (let n = 0; n < D1_MAX_BATCH_QUERIES; n++) {
      assert.equal((await stmt.first()).id, "v_two");
    }
    assert.equal(meter.readCount(), D1_MAX_BATCH_QUERIES);
    assert.equal(s.d1.stats.reads, D1_MAX_BATCH_QUERIES);
    assert.throws(() => stmt.first(), {
      name: "RangeError", message: "video_admin_member_d1_read_limit_exceeded",
    });
    assert.equal(s.d1.stats.reads, D1_MAX_BATCH_QUERIES);
    assert.equal(s.d1.stats.batches, 0);
  } finally { s.sqlite.close(); }
});


test("MIG-0650 U03bo blank D1 facade does not leak raw providers via extra properties or reflection", async () => {
  const { createAdminMemberD1ReadMeter } =
    await import("../src/routes/videos/adminMemberD1ReadMeter.ts");
  let reads = 0;
  let rawGetterCalls = 0;
  let statementGetterCalls = 0;
  const rawStmt = {
    bind() { return this; },
    async first() { reads++; return { id: "v_safe" }; },
    async all() { reads++; return { results: [{ id: "v_safe" }] }; },
    async raw() { reads++; return [["v_safe"]]; },
    run() { throw Error("raw writer must not be reachable"); },
    get rawHandle() {
      statementGetterCalls++;
      return { run: () => { throw Error("unmetered statement"); } };
    },
  };
  const rawDb = {
    prepare(sql) {
      assert.equal(sql, "SELECT id FROM videos");
      return rawStmt;
    },
    get rawHandle() {
      rawGetterCalls++;
      return { prepare: () => rawStmt };
    },
  };
  const meter = createAdminMemberD1ReadMeter(rawDb);
  assert.deepEqual(Reflect.ownKeys(meter.binding), [],
    "no raw binding properties are visible by reflection");
  assert.equal(Object.getPrototypeOf(meter.binding), null);
  assert.equal(meter.binding.rawHandle, undefined,
    "host-owned object-valued handles must be unreachable");
  assert.equal(rawGetterCalls, 0, "untrusted binding getter must never run");

  const stmt = meter.binding.prepare("SELECT id FROM videos");
  assert.deepEqual(Reflect.ownKeys(stmt), [],
    "no raw statement properties are visible by reflection");
  assert.equal(Object.getPrototypeOf(stmt), null);
  assert.equal(stmt.rawHandle, undefined);
  assert.equal(statementGetterCalls, 0, "untrusted statement getter must never run");
  assert.deepEqual(await stmt.first(), { id: "v_safe" });
  assert.deepEqual((await stmt.bind("v_safe").all()).results, [{ id: "v_safe" }]);
  assert.deepEqual(await stmt.raw(), [["v_safe"]]);
  assert.equal(meter.readCount(), 3);
  assert.equal(reads, 3);
  assert.throws(() => stmt.run(), {
    name: "RangeError", message: "video_admin_member_d1_read_meter_mutation_forbidden",
  });
  assert.equal(meter.close(), 3);
  assert.throws(() => stmt.first(), {
    name: "RangeError", message: "video_admin_member_d1_read_meter_closed",
  });
});

test("MIG-0650 U03bp mismatched or invalid execution read count closes D1 access before any write", async () => {
  const { createAdminMemberD1ReadMeter, sealAdminMemberD1ReadMeter } =
    await import("../src/routes/videos/adminMemberD1ReadMeter.ts");
  const s = realGuardFixture();
  try {
    for (const expected of [0, 2, -1, 1.5, Number.NaN, undefined]) {
      const meter = createAdminMemberD1ReadMeter(s.d1);
      const stmt = meter.binding.prepare("SELECT id FROM videos WHERE id = ?").bind("v_two");
      assert.deepEqual(await stmt.first(), { id: "v_two" });
      const beforeReads = s.d1.stats.reads;
      assert.throws(() => sealAdminMemberD1ReadMeter(meter, expected), {
        name: "RangeError", message: "video_admin_member_d1_read_meter_count_mismatch",
      }, String(expected));
      assert.equal(meter.readCount(), 1, "rejected seal cannot erase counted reads");
      assert.throws(() => stmt.first(), {
        name: "RangeError", message: "video_admin_member_d1_read_meter_closed",
      });
      assert.throws(() => stmt.bind("v_two"), {
        name: "RangeError", message: "video_admin_member_d1_read_meter_closed",
      });
      assert.equal(s.d1.stats.reads, beforeReads, "rejected seal cannot add D1 reads");
      assert.equal(s.d1.stats.batches, 0, "no D1 mutation on failed handoff");
    }
  } finally { s.sqlite.close(); }
});

test("MIG-0650 U03bn SELECT-only meter refuses DML even when invoked through first/all/raw", async () => {
  const { createAdminMemberD1ReadMeter } =
    await import("../src/routes/videos/adminMemberD1ReadMeter.ts");
  const s = realGuardFixture();
  try {
    const meter = createAdminMemberD1ReadMeter(s.d1);
    const before = s.sqlite.prepare(
      "SELECT collaboration_type FROM videos WHERE id = 'v_two'"
    ).get().collaboration_type;
    const forbidden = [
      "UPDATE videos SET collaboration_type = 'collab' WHERE id = 'v_two' RETURNING id",
      "INSERT INTO videos (id) VALUES ('forged') RETURNING id",
      "DELETE FROM videos WHERE id = 'v_two' RETURNING id",
      "WITH dangerous AS (DELETE FROM videos RETURNING id) SELECT * FROM dangerous",
      "PRAGMA foreign_keys = OFF",
      "SELECT 1; DELETE FROM videos",
      "/* comment */ SELECT 1",
      "SELECT 1;",
      "",
    ];
    for (const statement of forbidden) {
      assert.throws(() => meter.binding.prepare(statement), {
        name: "RangeError",
        message: "video_admin_member_d1_read_meter_mutation_forbidden",
      }, statement);
    }
    assert.deepEqual(await meter.binding.prepare("  SELECT id FROM videos WHERE id = ?")
      .bind("v_two").all().then(result => result.results.map(row => row.id)), ["v_two"]);
    assert.equal(meter.readCount(), 1);
    assert.equal(s.d1.stats.reads, 1, "forbidden queries never reach the D1 provider");
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.sqlite.prepare(
      "SELECT collaboration_type FROM videos WHERE id = 'v_two'"
    ).get().collaboration_type, before);
  } finally { s.sqlite.close(); }
});

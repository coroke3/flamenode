import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createVideoAdminMembersPreflightRoutes,
  createDefaultVideoAdminMembersPreflightHost,
} from "../src/routes/videos/adminMembers.ts";

const endpoint = "/v1/members";
const member = i => ({ name: "Name " + i, x_user_id: "user_" + i, chapters: [] });
const valid = () => ({
  is_collab: ["false", "true"],
  members_json: JSON.stringify([member(0)]),
});

function fixture({ role = "admin", includeContext = true } = {}) {
  let invoked = 0;
  let prematureDb = 0;
  const host = {
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

test("MIG-0650 U03e Hono no-body, malformed body and >64KB reject without mutation", async () => {
  const f = fixture();
  const invalidJson = await f.request(endpoint, "{");
  assert.equal(invalidJson.status, 400);
  const tooLarge = await f.request(endpoint, { ...valid(), extra: "X".repeat(66000) });
  assert.equal(tooLarge.status, 413);
  assert.match((await tooLarge.json()).message, /大きすぎ/);
  assert.deepEqual(f.stats(), { invoked: 2, prematureDb: 0 });
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
  const send = (body, origin = SITE) => app.request("/api/videos/v_pub/members", {
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

test("MIG-0650 U03f legal 100x30 CURRENT chapter input exceeds 64KiB transport cap", async () => {
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
  assert.ok(bytes < MAX_ADMIN_JSON_BODY_BYTES * 4, "fixture is a realistic bounded form, not an arbitrary megabyte payload");

  const s = realGuardFixture();
  try {
    const response = await s.send(request);
    assert.equal(response.status, 413, "current Hono preflight rejects legal CURRENT member+chapter input");
    assert.equal((await response.json()).ok, false);
    assert.equal(s.d1.stats.batches, 0);
    assert.equal(s.count("audit_logs"), 0);
  } finally { s.sqlite.close(); }
});

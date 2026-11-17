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

// MIG-0656 U02c-1b: D-15-10 scoped guard registration WITHOUT mounting slot writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { manageRoutes } from "../src/routes/manage/index.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const CANDIDATES = [
  ["POST", "/api/manage/events/ev-1/slots/batch-delete"],
  ["POST", "/api/manage/events/ev-1/slots/batch-release"],
  ["POST", "/api/manage/events/ev-1/slots/generate-chunk"],
  ["POST", "/api/manage/events/ev-1/slots/delete-available-chunk"],
  ["PATCH", "/api/manage/events/ev-1/slots/labels"],
  ["DELETE", "/api/manage/events/ev-1/slots/a"],
  ["POST", "/api/manage/events/ev-1/slots/a/release"],
  ["POST", "/api/manage/events/ev-1/slots/a/force-release-submitted"],
  ["POST", "/api/manage/events/ev-1/slots/a/release-submitted-video"],
];

const content = readFileSync(new URL("../src/routes/manage/index.ts", import.meta.url), "utf8");
const make = () => {
  let dbPrepares = 0;
  const app = new Hono();
  app.route("/api/manage", manageRoutes);
  const perform = (method, path, origin, siteUrl = SITE) => app.request(
    SITE + path,
    {
      method, headers: origin === null ? {} : { Origin: origin },
      body: JSON.stringify({slot_ids:["a"],label:"ok"}),
    },
    {
      DB: {prepare() { dbPrepares++; throw new Error("DB must not be read before origin"); }},
      NEXT_PUBLIC_SITE_URL: siteUrl,
    },
  );
  return { perform, getDbPrepares: () => dbPrepares };
};

test("MIG-0656 U02c-1b: D-15-10 nine slot write methods use Origin before any session/D1 lookup", async () => {
  const t = make();
  for (const [method,path] of CANDIDATES) {
    for (const origin of ["https://evil.example", null]) {
      const res = await t.perform(method,path,origin);
      assert.equal(res.status,403,method+" "+path);
      assert.equal((await res.json()).reason,"invalid_origin");
      assert.equal(res.headers.get("Cache-Control"),"private, no-store");
    }
  }
  assert.equal(t.getDbPrepares(),0);
});

test("MIG-0656 U03g: valid Origin without Auth.js session rejects before any D1 read", async () => {
  const t = make();
  for (const [method, path] of CANDIDATES) {
    const res = await t.perform(method, path, SITE);
    assert.equal(res.status, 401, method + " " + path);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(t.getDbPrepares(), 0);
});

test("MIG-0656 U02c-1b: missing site origin fails closed before D1", async () => {
  const t = make();
  for (const [method,path] of CANDIDATES) {
    const missing = await t.perform(method,path,SITE,"");
    assert.equal(missing.status,503);
    assert.equal((await missing.json()).reason,"origin_verification_unavailable");
  }
  assert.equal(t.getDbPrepares(),0);
});

test("MIG-0656 U02c-1b: candidate route implementation is still unmounted", () => {
  assert.match(content,/const slotWritePaths = \[/);
  assert.ok(content.includes("const singleSlotDeletePath = \"/events/:id/slots/:slotId\""));
  for (const suffix of ["/events/:id/slots/batch-delete","/events/:id/slots/batch-release","/events/:id/slots/labels","/events/:id/slots/:slotId/release","/events/:id/slots/generate-chunk","/events/:id/slots/delete-available-chunk"]) {
    assert.ok(content.includes(suffix));
  }
  assert.doesNotMatch(content,/import\s+.*slotBatch(?:AvailableDelete|LabelWrite|ReservedRelease)/);
  assert.doesNotMatch(content,/\.route\([^)]*slotBatch(?:AvailableDelete|LabelWrite|ReservedRelease)Routes/);
  assert.doesNotMatch(content,/slotSingleReleaseRoutes|slotSingleRelease\.ts/);
  assert.doesNotMatch(content,/slotGeneratedChunkRoutes|slotGeneratedChunk\.ts/);
  assert.doesNotMatch(content,/slotAvailableDeleteChunkRoutes|slotAvailableDeleteChunk\.ts/);
  for (const suffix of ["/events/:id/slots/:slotId/force-release-submitted", "/events/:id/slots/:slotId/release-submitted-video"]) {
    assert.ok(content.includes(suffix));
  }
  assert.doesNotMatch(content,/\.route\([^)]*slotSubmittedDangerRoutes/);
  assert.doesNotMatch(content,/import\s+.*slotSubmittedDanger(?:Routes)?/);
  assert.match(content,/const scopedWritePaths = \[\.\.\.playlistWritePaths, \.\.\.slotWritePaths, \.\.\.submittedDangerWritePaths\]/);
  assert.equal((content.match(/for \(const path of scopedWritePaths\)/g)||[]).length,2);
});


const SUBMITTED_DANGER_PATHS = CANDIDATES.slice(-2).map(([, path]) => path);
// Both new candidate paths must satisfy the full REAL parent Auth.js+TOS
// stack, despite remaining UNMOUNTED (404 after successful guard passage).
const PARENT_GUARDED_UNMOUNTED_PATHS = [
  ...SUBMITTED_DANGER_PATHS,
  "/api/manage/events/ev-1/slots/generate-chunk",
  "/api/manage/events/ev-1/slots/delete-available-chunk",
];

/**
 * Drive the actual manageRoutes parent stack with a real secure Auth.js
 * database-session cookie and the SQLite-backed D1 adapter. Keep business
 * handlers UNMOUNTED: successful guard passage must end in 404, not writes.
 */
function realAuthHarness() {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite);
  sqlite.exec('CREATE TABLE "session" ("sessionToken" TEXT PRIMARY KEY, "userId" TEXT, "expires" INTEGER)');
  const token = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  sqlite.prepare('INSERT INTO "session" ("sessionToken", "userId", "expires") VALUES (?, ?, ?)')
    .run(token, "admin-1", Date.now() + 60_000);
  const app = new Hono();
  app.route("/api/manage", manageRoutes);
  const post = (path, override = {}) => app.request(SITE + path, {
    method: "POST",
    headers: {
      Origin: SITE,
      Cookie: "__Secure-authjs.session-token=" + token,
      ...(override.headers ?? {}),
    },
  }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  const effects = () => ({
    batches: stats.batches,
    audits: sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
    queue: sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n,
  });
  return { db, sqlite, stats, post, effects, token };
}

test("MIG-0656 U03g-3: signed-in requests with unconfigured site Origin fail before D1", async () => {
  const h = realAuthHarness();
  try {
    const app = new Hono();
    app.route("/api/manage", manageRoutes);
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      const before = h.stats.prepares;
      const res = await app.request(SITE + path, {
        method: "POST",
        headers: { Origin: SITE, Cookie: "__Secure-authjs.session-token=" + h.token },
      }, { DB: h.db, NEXT_PUBLIC_SITE_URL: "" });
      assert.equal(res.status, 503, path);
      assert.equal((await res.json()).reason, "origin_verification_unavailable");
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      assert.equal(h.stats.prepares, before, path + ": unavailable site must not touch D1");
    }
    assert.deepEqual(h.effects(), { batches: 0, audits: 0, queue: 0 });
  } finally { h.sqlite.close(); }
});

test("MIG-0656 U03g-3: signed-in requests with a missing D1 binding return 503, never 401", async () => {
  const h = realAuthHarness();
  try {
    const app = new Hono();
    app.route("/api/manage", manageRoutes);
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      const res = await app.request(SITE + path, {
        method: "POST",
        headers: { Origin: SITE, Cookie: "__Secure-authjs.session-token=" + h.token },
      }, { NEXT_PUBLIC_SITE_URL: SITE });
      assert.equal(res.status, 503, path);
      assert.deepEqual(await res.json(), { error: "database_unavailable" });
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    }
    assert.equal(h.stats.prepares, 0);
    assert.deepEqual(h.effects(), { batches: 0, audits: 0, queue: 0 });
  } finally { h.sqlite.close(); }
});

test("MIG-0656 U03g-2: hostile Origin with a valid Auth.js cookie aborts before the session D1 lookup", async () => {
  const h = realAuthHarness();
  try {
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      const before = h.stats.prepares;
      const res = await h.post(path, { headers: { Origin: "https://evil.example" } });
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).reason, "invalid_origin");
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      assert.equal(h.stats.prepares, before, path + ": session D1 must not be consulted");
    }
    assert.deepEqual(h.effects(), { batches: 0, audits: 0, queue: 0 });
  } finally { h.sqlite.close(); }
});

test("MIG-0656 U03g: real Auth.js session + accepted TOS passes both guards but does not mount writes", async () => {
  const h = realAuthHarness();
  try {
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      const res = await h.post(path);
      assert.equal(res.status, 404, path + ": successful parent guards end at unmounted route");
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    }
    assert.deepEqual(h.effects(), { batches: 0, audits: 0, queue: 0 });
  } finally { h.sqlite.close(); }
});

test("MIG-0656 U03g: real Auth.js session enforces CURRENT TOS and latest major consent", async () => {
  const h = realAuthHarness();
  try {
    h.sqlite.prepare('UPDATE "user" SET is_tos_accepted=0 WHERE id=?').run("admin-1");
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      const res = await h.post(path);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).reason, "tos_required");
    }
    h.sqlite.prepare('UPDATE "user" SET is_tos_accepted=1 WHERE id=?').run("admin-1");
    h.sqlite.prepare('INSERT INTO terms_versions (id, severity, published_at, updated_at) VALUES (?,?,?,?)')
      .run("current-major", "major", 1000, 1000);
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      const res = await h.post(path);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).reason, "tos_reaccept_required");
    }
    h.sqlite.prepare('UPDATE "user" SET accepted_terms_version_id=? WHERE id=?')
      .run("current-major", "admin-1");
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      assert.equal((await h.post(path)).status, 404, path);
    }
    assert.deepEqual(h.effects(), { batches: 0, audits: 0, queue: 0 });
  } finally { h.sqlite.close(); }
});

test("MIG-0656 U03g: real banned/expired sessions cannot reach guarded unmounted writes", async () => {
  const h = realAuthHarness();
  try {
    h.sqlite.prepare('UPDATE "user" SET is_banned=1 WHERE id=?').run("admin-1");
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      assert.equal((await h.post(path)).status, 403, path);
    }
    h.sqlite.prepare('UPDATE "user" SET is_banned=0 WHERE id=?').run("admin-1");
    h.sqlite.prepare('UPDATE "session" SET expires=? WHERE sessionToken=?')
      .run(Date.now() - 60_000, h.token);
    for (const path of PARENT_GUARDED_UNMOUNTED_PATHS) {
      assert.equal((await h.post(path)).status, 401, path);
    }
    assert.deepEqual(h.effects(), { batches: 0, audits: 0, queue: 0 });
  } finally { h.sqlite.close(); }
});

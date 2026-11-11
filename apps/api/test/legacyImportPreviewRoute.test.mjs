// MIG-0645: test-only mounted Hono preview route through the real admin guards.
// Production createAdminRoutes deliberately does NOT mount the preview route.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { legacyImportPreviewRoutes } from "../src/routes/admin/legacyImportPreviewRoute.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null,
  role: "admin", is_banned: 0, active_x_user_id: null };

function setup({ user = ADMIN, role = "admin", settings = "normal", bucket } = {}) {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite, { role, settings });
  const app = new Hono();
  const admin = createAdminRoutes({
    session: async (c, next) => {
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  });
  admin.route("/import/legacy", legacyImportPreviewRoutes);
  app.route("/api/admin", admin);
  const request = (data, origin = SITE) =>
    app.request("/api/admin/import/legacy", {
      method: "POST", headers: { Origin: origin }, body: data,
    }, { DB: db, BUCKET: bucket, NEXT_PUBLIC_SITE_URL: SITE });
  return { request, sqlite, stats };
}

test("MIG-0645 U02 Hono: cross-origin rejected before DB access or multipart parse", async () => {
  const { request, stats } = setup();
  const result = await request(new FormData(), "https://untrusted.example");
  assert.equal(result.status, 403);
  assert.equal((await result.json()).reason, "invalid_origin");
  assert.equal(stats.reads, 0);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 Hono: non-admin denied before CostGuard or R2", async () => {
  const { request } = setup({ user: { ...ADMIN, role: "user" }, role: "user" });
  const res = await request(new FormData());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "forbidden");
});

test("MIG-0645 U02 Hono: maintenance mode fails closed", async () => {
  const { request } = setup({ settings: "maintenance" });
  const res = await request(new FormData());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "maintenance_mode");
});

test("MIG-0645 U02 Hono: apply is refused without D1 mutation or R2 claim", async () => {
  const { request, stats, sqlite } = setup();
  const data = new FormData();
  data.set("mode", "apply");
  const res = await request(data);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).requires_repreview, false);
  assert.equal(stats.batches, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 Hono: preview without files rejects before D1 preflight or R2", async () => {
  const { request, stats } = setup();
  const res = await request(new FormData());
  assert.equal(res.status, 400);
  assert.equal((await res.json()).message, "JSON・CSV・TSVファイルを選択してください。");
  assert.equal(stats.batches, 0);
});

test("MIG-0645 U02 Hono: invalid multipart request never runs an import", async () => {
  const { request, stats } = setup();
  const res = await request("invalid multipart body");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
  assert.equal(stats.batches, 0);
});

test("MIG-0645 U02 Hono: valid event CSV reaches real D1 preflight and R2 persistence without D1 writes", async () => {
  const saved = new Map();
  const bucket = {
    async put(key, body) {
      saved.set(key, String(body));
      return { etag: "1" };
    },
    async get(key) {
      const value = saved.get(key);
      return value == null ? null : { etag: "1", size: Buffer.byteLength(value), text: async () => value };
    },
    async delete(key) { saved.delete(key); },
  };
  const { request, stats } = setup({ bucket });
  const data = new FormData();
  data.set("mode", "preview");
  data.set("files", new File(["eventid,eventname,member,memberid,memberpost\nevent-a,Example,Owner,owner_x,owner\n"], "events.csv", { type: "text/csv" }));
  const res = await request(data);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.preview_token, /^[0-9a-f]{32}$/);
  assert.match(body.plan_hash, /^[0-9a-f]{64}$/);
  assert.equal(body.preview.events[0].id, "event-a");
  assert.equal(saved.size, 1);
  assert.equal(stats.batches, 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 Hono: D1 create-only conflict rejects before R2 persistence", async () => {
  let r2Writes = 0;
  const bucket = { async put() { r2Writes++; throw new Error("must not write"); } };
  const { request, stats, sqlite } = setup({ bucket });
  seedEvent(sqlite, { id: "event-a", title: "Existing title" });
  const data = new FormData();
  data.set("files", new File([
    "eventid,eventname,member,memberid,memberpost\nevent-a,Replacement,Owner,owner_x,owner\n",
  ], "events.csv", { type: "text/csv" }));
  const res = await request(data);
  assert.equal(res.status, 409, JSON.stringify(await res.clone().json()));
  assert.match((await res.json()).message, /イベント event-a は既に存在します/);
  assert.equal(r2Writes, 0, "conflicting preview must not persist an R2 token");
  assert.equal(stats.batches, 0);
  assert.equal(sqlite.prepare("SELECT title FROM events WHERE id = ?").get("event-a").title,
    "Existing title");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 Hono: missing R2 binding fails closed after D1 preflight", async () => {
  const { request, stats } = setup();
  const data = new FormData();
  data.set("files", new File([
    "eventid,eventname,member,memberid,memberpost\nevent-a,Example,Owner,owner_x,owner\n",
  ], "events.csv", { type: "text/csv" }));
  const res = await request(data);
  assert.equal(res.status, 503, JSON.stringify(await res.clone().json()));
  assert.equal((await res.json()).ok, false);
  assert.equal(stats.batches, 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 Hono: replace_imported cannot overwrite a non-imported D1 event", async () => {
  let puts = 0;
  const bucket = { async put() { puts++; throw new Error("unexpected R2 write"); } };
  const { request, sqlite, stats } = setup({ bucket });
  seedEvent(sqlite, { id: "event-a", title: "Protected event" });
  const data = new FormData();
  data.set("strategy", "replace_imported");
  data.set("files", new File([
    "eventid,eventname,member,memberid,memberpost\nevent-a,Overwrite attempt,Owner,owner_x,owner\n",
  ], "events.csv", { type: "text/csv" }));
  const res = await request(data);
  assert.equal(res.status, 409, JSON.stringify(await res.clone().json()));
  assert.match((await res.json()).message, /イベント event-a は旧形式インポート由来ではないため置換できません/);
  assert.equal(puts, 0);
  assert.equal(stats.batches, 0);
  assert.equal(sqlite.prepare("SELECT title FROM events WHERE id = ?").get("event-a").title,
    "Protected event");
});

test("MIG-0645 U02 Hono: skip_existing stores real D1 collision snapshot in owner-bound R2", async () => {
  const objects = new Map();
  const bucket = {
    async put(key, data) {
      objects.set(key, String(data));
      return { etag: "1" };
    },
  };
  const { request, sqlite, stats } = setup({ bucket });
  seedEvent(sqlite, { id: "event-a", title: "Existing event" });
  const data = new FormData();
  data.set("strategy", "skip_existing");
  data.set("files", new File([
    "eventid,eventname,member,memberid,memberpost\nevent-a,Incoming event,Owner,owner_x,owner\n",
  ], "events.csv", { type: "text/csv" }));
  const res = await request(data);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.strategy, "skip_existing");
  assert.equal(objects.size, 1);
  const stored = JSON.parse([...objects.values()][0]);
  assert.equal(stored.authUserId, "admin-1");
  assert.equal(stored.strategy, "skip_existing");
  assert.deepEqual(stored.progress.skipExistingEventIds, ["event-a"]);
  assert.deepEqual(stored.progress.skipExistingVideoIds, []);
  assert.equal(stored.planHash, body.plan_hash);
  assert.equal(stored.status, "ready");
  assert.equal(stats.batches, 0);
  assert.equal(sqlite.prepare("SELECT title FROM events WHERE id = ?").get("event-a").title,
    "Existing event");
});

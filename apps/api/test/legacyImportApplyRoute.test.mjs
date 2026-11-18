// MIG-0645: intentionally test-only mounted apply HTTP adapter.
// The real D1 audited apply adapter is NOT wired, and production has no mount.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createLegacyImportApplyRoutes } from "../src/routes/admin/legacyImportApplyRoute.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null,
  role: "admin", is_banned: 0, active_x_user_id: null };

function setup({ user = ADMIN, role = "admin", settings = "normal", bucket } = {}) {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite, { role, settings });
  let d1ApplyCalls = 0;
  const app = new Hono();
  const admin = createAdminRoutes({
    session: async (c, next) => {
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  });
  admin.route("/import/legacy/apply", createLegacyImportApplyRoutes(async () => {
    d1ApplyCalls += 1;
    throw new Error("D1 apply must never be reached on denied request");
  }));
  app.route("/api/admin", admin);
  const request = (data, origin = SITE) =>
    app.request("/api/admin/import/legacy/apply", {
      method: "POST", headers: { Origin: origin }, body: data,
    }, { DB: db, BUCKET: bucket, NEXT_PUBLIC_SITE_URL: SITE });
  return { request, sqlite, stats, getD1ApplyCalls: () => d1ApplyCalls };
}

test("MIG-0645 U02 apply Hono: cross-origin rejects before D1, multipart or R2", async () => {
  const { request, stats, getD1ApplyCalls } = setup();
  const res = await request(new FormData(), "https://untrusted.example");
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "invalid_origin");
  assert.equal(stats.reads, 0);
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 apply Hono: non-admin cannot claim R2", async () => {
  const { request, getD1ApplyCalls } = setup({
    user: { ...ADMIN, role: "user" }, role: "user",
  });
  const data = new FormData();
  data.set("preview_token", "deadbeef");
  data.set("plan_hash", "hash");
  const res = await request(data);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "forbidden");
  assert.equal(getD1ApplyCalls(), 0);
});

test("MIG-0645 U02 apply Hono: maintenance refuses all writes", async () => {
  const { request, getD1ApplyCalls } = setup({ settings: "maintenance" });
  const res = await request(new FormData());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "maintenance_mode");
  assert.equal(getD1ApplyCalls(), 0);
});

test("MIG-0645 U02 apply Hono: missing credentials reject before R2 claim", async () => {
  const { request, stats, getD1ApplyCalls } = setup();
  const res = await request(new FormData());
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.requires_repreview, true);
  assert.equal(stats.batches, 0);
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 apply Hono: missing R2 fails closed without D1 apply", async () => {
  const { request, getD1ApplyCalls, stats } = setup();
  const data = new FormData();
  data.set("preview_token", "a".repeat(32));
  data.set("plan_hash", "b".repeat(64));
  const res = await request(data);
  assert.equal(res.status, 503, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.preview_error_code, "bucket_unavailable");
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(stats.batches, 0);
});

test("MIG-0645 U02 apply Hono: non-multipart input rejects before claim and D1", async () => {
  const { request, getD1ApplyCalls, stats } = setup();
  const res = await request("invalid multipart body");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(stats.batches, 0);
});

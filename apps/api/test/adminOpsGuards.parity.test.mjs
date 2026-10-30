import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { mountMig0643AdminRoutes } from "../src/routes/admin/mig0643.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

// The production admin parent router is currently owned by MIG-0637 PR #472.
// This test constructs its ordered middleware stack without editing that file.
const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", role: "admin", name: "Admin", is_banned: 0 };
const CASES = [
  { name: "SA-050 visibility repair", path: "/api/admin/visibility-repair", body: { entity_type: "video", entity_id: "v1", fence_token: "t1" } },
  { name: "SA-069 backfill", path: "/api/admin/static-builds/backfill", body: { kind: "event_crew" } },
  { name: "SA-070 retry failed", path: "/api/admin/static-builds/queue/q1/retry" },
  { name: "SA-071 manual enqueue", path: "/api/admin/static-builds/rebuild", body: { target_type: "video", target_id: "v1" } },
  { name: "SA-072 rebuild shared inputs", path: "/api/admin/static-builds/shared-inputs/rebuild" },
  { name: "SA-073 retry all failed", path: "/api/admin/static-builds/retry-failed" },
  { name: "SA-106 Youtube resync", path: "/api/admin/youtube-sync/videos/v1/resync" },
];

function setup({ user = ADMIN, mode = "normal" } = {}) {
  const fake = createAdminD1();
  seedBase(fake.sqlite, { settings: mode });
  const app = new Hono();
  // The REAL admin parent router must apply the middleware chain to every
  // subsequently mounted feature route. This is the same ordering as app.ts.
  const admin = createAdminRoutes({
    session: async (c, next) => {
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  });
  // This is the exact one-call integration point that the owner of
  // admin/index.ts will use once PR #472 releases the shared file.
  mountMig0643AdminRoutes(admin);
  app.route("/api/admin", admin);
  const request = (item, origin = SITE) => app.request(item.path, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(item.body ?? {}),
  }, { DB: fake.db, NEXT_PUBLIC_SITE_URL: SITE });
  const auditCount = () => fake.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs").get().n;
  return { ...fake, request, auditCount };
}

test("MIG-0643 T02: actual createAdminRoutes parent applies origin guard to all seven future mounts", async () => {
  const s = setup();
  for (const item of CASES) {
    const res = await s.request(item, "https://not-our-site.example");
    assert.equal(res.status, 403, item.name);
    assert.equal((await res.json()).reason, "invalid_origin", item.name);
  }
  assert.equal(s.stats.reads, 0, "origin must deny before any D1 reads");
  assert.equal(s.stats.batches, 0);
  assert.equal(s.auditCount(), 0);
});

for (const [label, user, status, reason] of [
  ["unauthenticated", null, 401, "unauthenticated"],
  ["non-admin", { ...ADMIN, role: "user" }, 403, "forbidden"],
  ["banned", { ...ADMIN, is_banned: 1 }, 403, "banned"],
]) {
  test("MIG-0643 T02: " + label + " denied across all seven ops without write", async () => {
    const s = setup({ user });
    for (const item of CASES) {
      const res = await s.request(item);
      assert.equal(res.status, status, item.name);
      assert.equal((await res.json()).reason, reason, item.name);
    }
    assert.equal(s.stats.batches, 0);
    assert.equal(s.auditCount(), 0);
  });
}

test("MIG-0643 T02: maintenance mode denies all seven ops before any mutation", async () => {
  const s = setup({ mode: "maintenance" });
  for (const item of CASES) {
    const res = await s.request(item);
    assert.equal(res.status, 503, item.name);
    assert.equal((await res.json()).reason, "maintenance_mode", item.name);
  }
  assert.equal(s.stats.batches, 0);
  assert.equal(s.auditCount(), 0);
});

test("MIG-0643 T01: actual parent guard permits audited manual rebuild", async () => {
  const s = setup();
  const res = await s.request(CASES.find((item) => item.name === "SA-071 manual enqueue"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, queued: 1 });
  assert.equal(s.stats.reads, 2, "writeGuard user + CostGuard settings, queue upsert zero reads");
  assert.equal(s.stats.batches, 1, "queue UPSERT and strict audit share an atomic batch");
  assert.equal(s.auditCount(), 1);
  const queue = s.sqlite.prepare(
    "SELECT target_type, target_id, status, priority FROM static_rebuild_queue",
  ).get();
  assert.equal(queue.target_type, "video");
  assert.equal(queue.target_id, "v1");
  assert.equal(queue.status, "pending");
  assert.equal(queue.priority, "high");
});

test("MIG-0643 S3: sibling static routes cannot double-charge backfill CostGuard", async () => {
  const s = setup();
  const item = CASES.find((candidate) => candidate.name === "SA-069 backfill");
  assert.ok(item);
  const res = await s.request(item);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.backfill_kind, "event_crew");
  assert.equal(payload.backfill_done, "1");
  assert.equal(s.stats.reads, 3,
    "real admin writeGuard (1) + exactly one CostGuard (1) + bounded backfill count/page (1)");
  assert.equal(s.stats.batches, 0, "empty backfill writes no queue");
  assert.equal(s.auditCount(), 0);
});

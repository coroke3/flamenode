import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { AdminYoutubeResyncVideoIdSchema, AdminYoutubeResyncResultSchema } from "@flamenode/contracts";
import { youtubeSyncAdminRoutes } from "../src/routes/admin/youtubeSync.ts";
import { originGuardMiddleware, writeGuardMiddleware, onlyMutating } from "../src/middleware/writeOrigin.ts";
import { dbMiddleware } from "../src/middleware/db.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const ADMIN = { id: "admin-1", name: "Admin", role: "admin", is_banned: 0 };
const METADATA_COLUMNS = [
  "video_id", "youtube_privacy_status", "youtube_availability_status",
  "duration_seconds", "view_count", "synced_at", "sync_status",
  "sync_error", "updated_at",
];

function setup({ mutateBeforeBatch } = {}) {
  const fake = createAdminD1();
  seedBase(fake.sqlite);
  fake.sqlite.exec(`
    CREATE TABLE videos (id TEXT PRIMARY KEY);
    CREATE TABLE video_youtube_metadata (
      video_id TEXT PRIMARY KEY, youtube_privacy_status TEXT, youtube_availability_status TEXT,
      duration_seconds INTEGER, view_count INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
      sync_status TEXT NOT NULL DEFAULT 'pending', sync_error TEXT, updated_at INTEGER NOT NULL
    );
  `);
  fake.sqlite.prepare("INSERT INTO videos (id) VALUES (?)").run("vid-1");
  const d1 = mutateBeforeBatch
    ? { ...fake.db, batch: async (statements) => {
        mutateBeforeBatch(fake.sqlite);
        return fake.db.batch(statements);
      } }
    : fake.db;
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", ADMIN);
    c.set("db", drizzle(d1, { schema }));
    c.set("actorSnapshotJsonById", {});
    await next();
  });
  app.route("/api/admin/youtube-sync", youtubeSyncAdminRoutes);
  const request = (videoId = "vid-1") => app.request(
    "/api/admin/youtube-sync/videos/" + encodeURIComponent(videoId) + "/resync",
    { method: "POST" },
    { DB: d1 },
  );
  const audit = () => fake.sqlite.prepare("SELECT * FROM audit_logs ORDER BY created_at").all();
  const metadata = () => fake.sqlite.prepare(
    "SELECT * FROM video_youtube_metadata WHERE video_id='vid-1'",
  ).get() ?? null;
  const seedMetadata = (overrides = {}) => {
    const r = {
      video_id: "vid-1", youtube_privacy_status: "public",
      youtube_availability_status: "available", duration_seconds: 10,
      view_count: 25, synced_at: 100, sync_status: "failed",
      sync_error: "quota", updated_at: 1700000000, ...overrides,
    };
    fake.sqlite.prepare(`INSERT INTO video_youtube_metadata (${METADATA_COLUMNS.join(", ")})
      VALUES (${METADATA_COLUMNS.map(() => "?").join(", ")})`)
      .run(...METADATA_COLUMNS.map((k) => r[k]));
    return r;
  };
  return { ...fake, request, audit, metadata, seedMetadata };
}

test("MIG-0643 U04: invalid video IDs rejected without D1 mutations", async () => {
  assert.equal(AdminYoutubeResyncVideoIdSchema.safeParse(" ").success, false);
  assert.equal(AdminYoutubeResyncVideoIdSchema.safeParse("x".repeat(129)).success, false);
  const s = setup();
  for (const id of [" ", "x".repeat(129)]) {
    const response = await s.request(id);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, message: "対象作品が不正です。" });
  }
  assert.equal(s.stats.batches, 0);
  assert.equal(s.audit().length, 0);
});

test("MIG-0643 U04: missing video returns 404 with zero writes", async () => {
  const s = setup();
  const response = await s.request("missing");
  assert.equal(response.status, 404);
  assert.equal(s.stats.batches, 0);
  assert.equal(s.audit().length, 0);
});

test("MIG-0643 U04: missing metadata creates one pending row and strict audit in one batch", async () => {
  const s = setup();
  const response = await s.request();
  assert.equal(response.status, 200);
  assert.equal(AdminYoutubeResyncResultSchema.safeParse(await response.json()).success, true);
  const row = s.metadata();
  assert.equal(row.sync_status, "pending");
  assert.equal(row.sync_error, null);
  assert.equal(row.view_count, 0);
  assert.equal(s.stats.reads, 2, "CostGuard and one left-join; writer provides actor snapshot");
  assert.equal(s.stats.batches, 1);
  const audit = s.audit();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].table_name, "video_youtube_metadata");
  assert.equal(audit[0].operation, "CREATE");
  assert.equal(audit[0].context, "admin_youtube_sync");
  assert.equal(audit[0].reason, "YouTubeメタデータ再同期を予約");
  assert.equal(audit[0].actor_user_id, ADMIN.id);
  assert.deepEqual(JSON.parse(audit[0].after_json), row);
});

test("MIG-0643 U04: pending metadata is idempotent, zero batch/audit", async () => {
  const s = setup();
  s.seedMetadata({ sync_status: "pending" });
  const original = s.metadata();
  const response = await s.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, already_pending: true });
  assert.deepEqual(s.metadata(), original);
  assert.equal(s.stats.batches, 0);
  assert.equal(s.audit().length, 0);
});

test("MIG-0643 U04: failed metadata is rescheduled without losing other fields", async () => {
  const s = setup();
  const before = s.seedMetadata({ updated_at: 2000000000 });
  const response = await s.request();
  assert.equal(response.status, 200);
  const after = s.metadata();
  assert.equal(after.sync_status, "pending");
  assert.equal(after.synced_at, null);
  assert.equal(after.sync_error, null);
  assert.equal(after.updated_at, before.updated_at + 1);
  assert.equal(after.view_count, before.view_count);
  assert.equal(after.youtube_privacy_status, before.youtube_privacy_status);
  assert.equal(s.stats.reads, 2);
  assert.equal(s.stats.batches, 1);
  const audit = s.audit();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].operation, "UPDATE");
  assert.deepEqual(JSON.parse(audit[0].before_json), before);
  assert.deepEqual(JSON.parse(audit[0].after_json), after);
});

test("MIG-0643 U04: concurrent CAS conflict rolls back audit and mutation", async () => {
  let injected = false;
  const s = setup({ mutateBeforeBatch(sqlite) {
    if (injected) return;
    injected = true;
    sqlite.prepare("UPDATE video_youtube_metadata SET sync_error='raced' WHERE video_id='vid-1'").run();
  } });
  s.seedMetadata();
  const response = await s.request();
  assert.ok([409, 500].includes(response.status));
  assert.equal((await response.json()).ok, false);
  assert.equal(s.metadata().sync_error, "raced");
  assert.equal(s.audit().length, 0);
});

const SITE = "https://app.flamenode.example";

function protectedSetup({ user = ADMIN } = {}) {
  const fixture = setup();
  const app = new Hono();
  const originOptions = { loadSiteUrl: () => SITE, allowLocalPreview: () => false };
  app.use("*", onlyMutating(originGuardMiddleware(originOptions)));
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("sessionState", user ? "user" : "none");
    await next();
  });
  app.use("*", onlyMutating(writeGuardMiddleware(originOptions)));
  app.use("*", onlyMutating(dbMiddleware));
  app.route("/api/admin/youtube-sync", youtubeSyncAdminRoutes);
  const request = (origin = SITE) => app.request(
    "/api/admin/youtube-sync/videos/vid-1/resync",
    { method: "POST", headers: { Origin: origin } },
    { DB: fixture.db, NEXT_PUBLIC_SITE_URL: SITE },
  );
  return { ...fixture, request };
}

test("MIG-0643 U04: parent guard rejects cross-origin before DB read or write", async () => {
  const s = protectedSetup();
  const response = await s.request("https://attacker.example");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, "invalid_origin");
  assert.equal(s.stats.reads, 0);
  assert.equal(s.stats.batches, 0);
});

test("MIG-0643 U04: parent guard rejects no session and non-admin with zero writes", async () => {
  for (const [user, status] of [
    [null, 401],
    [{ ...ADMIN, role: "user" }, 403],
    [{ ...ADMIN, is_banned: 1 }, 403],
  ]) {
    const s = protectedSetup({ user });
    const response = await s.request();
    assert.equal(response.status, status);
    assert.equal(s.stats.batches, 0);
    assert.equal(s.audit().length, 0);
  }
});

test("MIG-0643 U04: CostGuard maintenance blocks before video mutation", async () => {
  const s = protectedSetup();
  s.sqlite.prepare("UPDATE system_settings SET operation_mode='maintenance'").run();
  const response = await s.request();
  assert.equal(response.status, 503);
  assert.equal(s.stats.batches, 0);
  assert.equal(s.audit().length, 0);
});

test("MIG-0643 U04: protected Hono stack uses S3 <=3 pre-reads and one batch", async () => {
  const s = protectedSetup();
  const response = await s.request();
  assert.equal(response.status, 200);
  assert.equal(s.stats.reads, 3);
  assert.equal(s.stats.batches, 1);
  assert.equal(s.audit().length, 1);
});

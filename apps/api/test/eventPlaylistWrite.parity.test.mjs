// MIG-0655 U03 / SA-039: Hono+SQLite playlist manual sync write parity.
// The request intentionally does not contact remote YouTube or send a Queue wake.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { playlistWriteRoutes } from "../src/routes/manage/playlistWrite.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", role: "admin", is_banned: 0 };
function setup({ user = ADMIN, enabled = 1, lease = null, staff = false } = {}) {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite);
  seedEvent(sqlite);
  sqlite.exec(`
    CREATE TABLE event_staff (event_id TEXT, x_user_id TEXT, permission_preset TEXT,
      custom_permission_keys_json TEXT);
    CREATE TABLE event_youtube_playlist_sync (
      event_id TEXT PRIMARY KEY, playlist_id TEXT, enabled INTEGER, sync_mode TEXT,
      sync_interval_minutes INTEGER, sync_status TEXT, next_sync_at INTEGER,
      last_synced_at INTEGER, last_full_scan_at INTEGER, scan_started_at INTEGER,
      scan_page_token TEXT, last_error TEXT, last_attempt_at INTEGER, last_run_id TEXT,
      last_duration_ms INTEGER, run_lease_token TEXT, run_lease_expires_at INTEGER,
      pending_trigger TEXT, created_at INTEGER, updated_at INTEGER
    );
  `);
  sqlite.prepare(`INSERT INTO event_youtube_playlist_sync
    (event_id,playlist_id,enabled,sync_mode,sync_interval_minutes,sync_status,
     next_sync_at,last_synced_at,last_full_scan_at,run_lease_token,run_lease_expires_at,
     pending_trigger,created_at,updated_at)
    VALUES ('ev-1','PLTEST',?,'mirror',720,'synced',111,100,99,?,?,'scheduled',10,20)`)
    .run(enabled, lease, lease ? Math.floor(Date.now()/1000)+3600 : null);
  if (staff) {
    sqlite.prepare("INSERT INTO x_users (id,approval_status) VALUES (?,?)").run("x1","approved");
    sqlite.prepare("INSERT INTO x_user_account_links VALUES (?,?)").run(user.id,"x1");
    sqlite.prepare("INSERT INTO event_staff VALUES (?,?,?,?)").run("ev-1","x1","manager",null);
  }
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("sessionState", user ? "user" : "none");
    c.set("db", drizzle(c.env.DB, { schema }));
    if (user) c.set("actorSnapshotJsonById", { [user.id]: JSON.stringify({id:user.id,role:user.role}) });
    await next();
  });
  app.route("/api/manage/events/:id/youtube-playlist", playlistWriteRoutes);
  const post = (id = "ev-1") => app.request(`${SITE}/api/manage/events/${id}/youtube-playlist/sync`,
    { method: "POST", headers: { Origin: SITE } },
    { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { sqlite, stats, post, count };
}

test("SA-039 manual sync: atomic UPDATE+strict audit, no Queue wake", async () => {
  const s = setup();
  const response = await s.post();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, queued: true });
  const row = s.sqlite.prepare("SELECT * FROM event_youtube_playlist_sync").get();
  assert.equal(row.sync_status, "idle");
  assert.equal(row.pending_trigger, "manual");
  assert.equal(row.last_full_scan_at, null);
  assert.equal(row.run_lease_token, null);
  assert.equal(row.last_synced_at, 100);
  assert.equal(s.count("audit_logs"), 1);
  const a = s.sqlite.prepare("SELECT * FROM audit_logs").get();
  assert.equal(a.table_name, "event_youtube_playlist_sync");
  assert.equal(a.operation, "UPDATE");
  assert.equal(a.reason, "event-youtube-playlist-queue");
  assert.equal(a.context, "event:ev-1");
  assert.equal(JSON.parse(a.before_json).sync_status, "synced");
  assert.equal(JSON.parse(a.after_json).pending_trigger, "manual");
  assert.equal(s.stats.batches, 1);
  assert.ok(s.stats.reads <= 3, `S3 pre-read budget exceeded: ${s.stats.reads}`);
});

test("SA-039 forbids non-staff, permits linked approved event.publish manager", async () => {
  const user = { id: "viewer-1", role: "user", is_banned: 0 };
  const denied = setup({ user });
  assert.equal((await denied.post()).status, 403);
  assert.equal(denied.count("audit_logs"), 0);
  const allowed = setup({ user, staff: true });
  assert.equal((await allowed.post()).status, 200);
  assert.equal(allowed.count("audit_logs"), 1);
});

test("SA-039 rejects disabled sync and active lease without audit", async () => {
  const disabled = setup({ enabled: 0 });
  assert.equal((await disabled.post()).status, 409);
  assert.equal(disabled.count("audit_logs"), 0);
  const running = setup({ lease: "other-worker" });
  assert.equal((await running.post()).status, 409);
  assert.equal(running.count("audit_logs"), 0);
  assert.equal(running.sqlite.prepare("SELECT run_lease_token FROM event_youtube_playlist_sync").get().run_lease_token,"other-worker");
});

test("SA-039 rollback on audit insertion error preserves the scheduled state", async () => {
  const s = setup();
  s.sqlite.exec("DROP TABLE audit_logs");
  const response = await s.post();
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const row = s.sqlite.prepare("SELECT sync_status, pending_trigger, next_sync_at FROM event_youtube_playlist_sync").get();
  assert.deepEqual(row,{sync_status:"synced",pending_trigger:"scheduled",next_sync_at:111});
});

test("SA-039 malformed event ID has no effects", async () => {
  const s = setup();
  assert.equal((await s.post("bad%20id")).status, 400);
  assert.equal(s.count("audit_logs"), 0);
});

// MIG-0662 U03: SA-011 CURRENT shared-core vs Hono SQLite parity.
// Exercises the actual admin middleware chain and D1-atomic restore mutation.
import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { getTableColumns } from "drizzle-orm";
import { videos } from "@flamenode/db/schema";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { restoreAuditLog } from "@flamenode/server-core/audit/restore";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = {
  id: "admin-1", name: "Admin", email: null, image: null,
  role: "admin", is_banned: 0, active_x_user_id: null,
};
const RESTORE = "/api/admin/audit/restore";

function setup({ user = ADMIN, role = "admin", disabled = [] } = {}) {
  const { sqlite, db, stats } = createAdminD1();
  seedBase(sqlite, { role });
  if (disabled.length) {
    sqlite.prepare("UPDATE system_settings SET disabled_features_json = ? WHERE id = 'default'")
      .run(JSON.stringify(disabled));
  }
  const app = new Hono();
  app.route("/api/admin", createAdminRoutes({
    session: async (c, next) => {
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  }));
  const request = (body, headers = { Origin: SITE }, extraEnv = {}) => app.request(
    RESTORE, {
      method: "POST", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE, ...extraEnv },
  );
  return { sqlite, db, stats, request };
}

function seedRestorableAnnouncement(sqlite, { currentTitle = "Current Title" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const before = {
    id: "anc-1", title: "Old Title", body: "Old Body", severity: "info",
    is_published: 1, publish_at: now, expire_at: now + 10000,
    target_audience: "all", created_by_user_id: "admin-1",
    created_at: now - 100, updated_at: now - 50,
  };
  const after = { ...before, title: "Current Title", body: "Current Body", updated_at: now - 10 };
  const persisted = { ...after, title: currentTitle };
  sqlite.prepare(`INSERT INTO announcements
    (id,title,body,severity,is_published,publish_at,expire_at,target_audience,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      ...["id","title","body","severity","is_published","publish_at","expire_at",
        "target_audience","created_by_user_id","created_at","updated_at"].map((key) => persisted[key]),
    );
  sqlite.prepare(`INSERT INTO audit_logs
    (id,table_name,target_id,operation,restore_strategy,restore_status,before_json,after_json,created_at,actor_user_id)
    VALUES ('audit-1','announcements','anc-1','UPDATE','update_before','restorable',?,?,?,'admin-1')`)
    .run(JSON.stringify(before), JSON.stringify(after), now - 10);
  return { before, after };
}

function changes(sqlite) {
  return {
    row: sqlite.prepare("SELECT title,body,updated_at FROM announcements WHERE id = 'anc-1'").get(),
    runs: sqlite.prepare("SELECT status,reason FROM audit_restore_runs ORDER BY status").all().map((run) => ({ status: run.status, reason: run.reason })),
    restored: sqlite.prepare("SELECT restore_status FROM audit_logs WHERE id = 'audit-1'").get()?.restore_status,
    auditCount: sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
  };
}

const body = (extra = {}) => ({
  audit_id: "audit-1", reason: "業務上の監査復元",
  confirm_text: "RESTORE audit-1", ...extra,
});

test("T01 admin origin, session, role and BAN guards reject before any restore write", async () => {
  for (const opts of [
    { user: null, status: 401 },
    { user: { ...ADMIN, role: "moderator" }, role: "moderator", status: 403 },
    { user: { ...ADMIN, is_banned: 1 }, status: 403 },
  ]) {
    const ctx = setup(opts);
    seedRestorableAnnouncement(ctx.sqlite);
    const res = await ctx.request(body());
    assert.equal(res.status, opts.status);
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
  }
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  const res = await ctx.request(body(), { Origin: "https://external.example" });
  assert.equal(res.status, 403);
  assert.equal(ctx.stats.reads, 0);
  assert.equal(changes(ctx.sqlite).runs.length, 0);
});

test("T02 invalid body and oversized JSON return 400/413 without D1 mutation", async () => {
  const ctx = setup();
  const invalid = [
    { audit_id: "", reason: "test" },
    body({ reason: "" }),
    body({ reason: "x".repeat(501) }),
    body({ force_overwrite: 2 }),
    body({ force_overwrite: -1 }),
  ];
  for (const data of invalid) {
    const res = await ctx.request(data);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
  const huge = await ctx.request(body({ reason: "x".repeat(70000) }));
  assert.equal(huge.status, 413);
  assert.deepEqual(await huge.json(), {
    ok: false, message: "リクエストが大きすぎます。",
  });
  assert.equal(ctx.stats.batches, 0);
});

test("T05 restore responses are private no-store across validation, rejection, and success", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  const scenarios = [
    { payload: body({ reason: "" }), status: 400, ok: false },
    { payload: body({ reason: "x".repeat(70000) }), status: 413, ok: false },
    { payload: body({ confirm_text: "incorrect" }), status: 200, ok: false },
    { payload: body(), status: 200, ok: true },
  ];
  for (const item of scenarios) {
    const response = await ctx.request(item.payload);
    assert.equal(response.status, item.status);
    assert.equal(
      response.headers.get("Cache-Control"),
      "private, no-store",
      "audit restore snapshots/diffs must never be cached",
    );
    assert.equal((await response.json()).ok, item.ok);
  }
});

test("T03 confirmation text is mandatory; no accidental restore writes", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  for (const data of [body({ confirm_text: undefined }), body({ confirm_text: "RESTORE someone-else" })]) {
    const res = await ctx.request(data);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, false);
    assert.equal(changes(ctx.sqlite).runs.length, 0);
    assert.equal(changes(ctx.sqlite).row.title, "Current Title");
  }
});

test("T03 missing audit log matches CURRENT 200 ok:false and no restore row", async () => {
  const ctx = setup();
  const res = await ctx.request({ audit_id: "missing", reason: "test", confirm_text: "RESTORE missing" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false, message: "監査ログが見つかりません。" });
  assert.equal(ctx.stats.batches, 0);
});

test("T03 no-conflict restore is atomic and gives no second restore", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite);
  const response = await ctx.request(body());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(typeof result.restore_run_id, "string");
  const state = changes(ctx.sqlite);
  assert.equal(state.row.title, "Old Title");
  assert.equal(state.row.body, "Old Body");
  assert.equal(state.restored, "restored");
  assert.deepEqual(state.runs, [{ status: "success", reason: "業務上の監査復元" }]);
  assert.ok(state.auditCount >= 2);
  recordRestoreD1Budget("announcements_success", ctx.stats);
  const second = await ctx.request(body());
  assert.equal(second.status, 200);
  assert.equal((await second.json()).ok, false);
  assert.equal(changes(ctx.sqlite).runs.length, 1);
});

test("T03 conflict is rejected without force and allowed with explicit force_overwrite=1", async () => {
  const ctx = setup();
  seedRestorableAnnouncement(ctx.sqlite, { currentTitle: "Concurrent edit" });
  let res = await ctx.request(body());
  assert.equal(res.status, 200);
  const first = await res.json();
  assert.equal(first.ok, false);
  assert.ok(first.diff?.conflicts.includes("title"));
  assert.equal(changes(ctx.sqlite).row.title, "Concurrent edit");
  assert.equal(changes(ctx.sqlite).runs[0].status, "failed");

  res = await ctx.request(body({ force_overwrite: 1 }));
  assert.equal(res.status, 200);
  const second = await res.json();
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(changes(ctx.sqlite).row.title, "Old Title");
  assert.equal(changes(ctx.sqlite).runs.find((r) => r.status === "success")?.status, "success");
});

test("T03 CURRENT shared core and Hono response/state parity for nonvisibility restore", async () => {
  const a = setup();
  seedRestorableAnnouncement(a.sqlite);
  const http = await (await a.request(body())).json();
  const b = setup();
  seedRestorableAnnouncement(b.sqlite);
  const unused = () => { throw new Error("restore_host_not_expected_for_announcements"); };
  const result = await restoreAuditLog(
    drizzle(b.db),
    {
      auditId: "audit-1", userId: "admin-1", reason: "業務上の監査復元",
      confirmText: "RESTORE audit-1", forceOverwrite: false, dry_run: false,
    },
    {
      manifest: { read: unused, write: unused },
      publicCacheKeys: { staticObjectKeys: [], userMaxPages: 0, eventObjectKeys: unused },
      deletePublicJsonCaches: unused, invalidateEventExportCache: unused,
      loadQueueWakeHost: unused,
    },
  );
  assert.deepEqual(
    { ok: http.ok, message: http.message, hasId: !!http.restore_run_id },
    { ok: result.ok, message: result.message, hasId: !!result.restore_run_id },
  );
  assert.deepEqual(changes(a.sqlite), changes(b.sqlite));
});

test("T05 CostGuard disabled blocks SA-011 before any mutation", async () => {
  const ctx = setup({ disabled: ["admin_permissions"] });
  seedRestorableAnnouncement(ctx.sqlite);
  const res = await ctx.request(body());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "cost_guard_blocked");
  assert.equal(changes(ctx.sqlite).runs.length, 0);
});

function seedVisibilityRestore(ctx) {
  const { sqlite } = ctx;
  sqlite.exec(`CREATE TABLE public_visibility_fences (
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, fence_token TEXT NOT NULL,
    state TEXT NOT NULL, reason TEXT, requirements_json TEXT,
    blocked_at INTEGER, release_requested_at INTEGER,
    requested_by_auth_user_id TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY(entity_type, entity_id)
  )`);
  seedEvent(sqlite, { id: "ev-1", visibility_status: "public" });
  const after = { ...sqlite.prepare("SELECT * FROM events WHERE id = 'ev-1'").get() };
  const before = { ...after, visibility_status: "private" };
  const now = Math.floor(Date.now() / 1000);
  sqlite.prepare(`INSERT INTO audit_logs
    (id,table_name,target_id,operation,restore_strategy,restore_status,before_json,after_json,created_at,actor_user_id)
    VALUES ('event-audit','events','ev-1','UPDATE','update_before','restorable',?,?,?,'admin-1')`)
    .run(JSON.stringify(before), JSON.stringify(after), now);
}

function visibilityManifestBucket() {
  const state = {
    manifest: { schema_version: 1, revision: 0, generated_at: Math.floor(Date.now() / 1000), entities: [] },
    etag: "etag-initial",
    puts: 0,
  };
  const bucket = {
    get: async (key) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      const text = JSON.stringify(state.manifest);
      return { etag: state.etag, size: Buffer.byteLength(text), text: async () => text };
    },
    put: async (key, value, options) => {
      assert.equal(key, "visibility/blocked-entities.v1.json");
      assert.equal(options?.onlyIf?.etagMatches, state.etag);
      assert.equal(options?.httpMetadata?.cacheControl, "no-store");
      state.manifest = JSON.parse(value);
      state.etag = "etag-next-" + (++state.puts);
      return { etag: state.etag };
    },
  };
  return { state, bucket };
}

test("T04 public event -> private restore commits R2 CAS fence and D1 atomically, invalidates all public caches", async () => {
  const ctx = setup();
  seedVisibilityRestore(ctx);
  const { state, bucket } = visibilityManifestBucket();
  const previous = globalThis.caches;
  const deleted = [];
  globalThis.caches = { default: {
    delete: async (url) => { deleted.push(decodeURIComponent(url)); return true; },
  } };
  try {
    const res = await ctx.request({
      audit_id: "event-audit", reason: "公開状態を取り消す",
      confirm_text: "RESTORE event-audit",
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ctx.sqlite.prepare("SELECT visibility_status FROM events WHERE id = 'ev-1'").get().visibility_status, "private");
    const fence = ctx.sqlite.prepare(
      "SELECT state,fence_token FROM public_visibility_fences WHERE entity_type = 'event' AND entity_id = 'ev-1'",
    ).get();
    assert.equal(fence.state, "blocked");
    assert.equal(state.puts, 1);
    assert.equal(state.manifest.entities.length, 1);
    assert.equal(state.manifest.entities[0].entity_type, "event");
    assert.equal(state.manifest.entities[0].entity_id, "ev-1");
    assert.equal(state.manifest.entities[0].fence_token, fence.fence_token);
    assert.ok(deleted.some((url) => url.endsWith("events/ev-1.json")));
    assert.ok(deleted.some((url) => url.endsWith("events/index.json")));
    assert.ok(deleted.some((url) => url.includes("public-event-export:9:ev-1:v5:15")));
    assert.ok(deleted.some((url) => url.includes("public-event-export:9:ev-1:legacy:1440")));
    assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'").get().n, 1);
  recordRestoreD1Budget("events_private_restore_success", ctx.stats);
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

test("T04 R2 binding failure prevents an event visibility restore and preserves public state", async () => {
  const ctx = setup();
  seedVisibilityRestore(ctx);
  const res = await ctx.request({
    audit_id: "event-audit", reason: "公開状態を取り消す",
    confirm_text: "RESTORE event-audit",
  }, { Origin: SITE }, { PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.ok, false);
  assert.equal(ctx.sqlite.prepare("SELECT visibility_status FROM events WHERE id='ev-1'").get().visibility_status, "public");
  assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM public_visibility_fences").get().n, 0);
  assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'").get().n, 0);
  recordRestoreD1Budget("events_missing_r2_fail_closed", ctx.stats);
});

// MIG-0662 T04 video variant. Keep the test table column names in lockstep
// with the shared DB schema: a new video column will be selected by the
// restore adapter and must also exist in the SQLite D1 fixture.
function seedVideoVisibilityRestore(ctx) {
  const { sqlite } = ctx;
  const fields = Object.values(getTableColumns(videos));
  const declarations = fields.map((column) => {
    const sqlType = column.columnType === "SQLiteReal"
      ? "REAL"
      : column.columnType === "SQLiteInteger" ? "INTEGER" : "TEXT";
    return `"${column.name}" ${sqlType}`;
  });
  sqlite.exec(`CREATE TABLE videos (${declarations.join(", ")})`);
  sqlite.exec(`CREATE TABLE video_events (
    video_id TEXT NOT NULL, event_id TEXT NOT NULL,
    PRIMARY KEY(video_id, event_id)
  )`);
  sqlite.exec(`CREATE TABLE public_visibility_fences (
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, fence_token TEXT NOT NULL,
    state TEXT NOT NULL, reason TEXT, requirements_json TEXT,
    blocked_at INTEGER, release_requested_at INTEGER,
    requested_by_auth_user_id TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY(entity_type, entity_id)
  )`);
  const now = Math.floor(Date.now() / 1000);
  const video = {
    id: "vid-restore", submitted_by_user_id: "admin-1",
    collaboration_type: "individual", source_type: "youtube",
    creator_display_name: "Video Owner", creator_x_user_id: "creator-1",
    primary_event_id: "ev-1", title: "Original",
    youtube_video_id: "yt-restore-1", visibility_status: "public",
    app_like_count: 0, score: 0, created_at: now - 100, updated_at: now,
  };
  const columnNames = Object.keys(video);
  sqlite.prepare(`INSERT INTO videos (${columnNames.map((n) => `"${n}"`).join(",")})
    VALUES (${columnNames.map(() => "?").join(",")})`)
    .run(...columnNames.map((k) => video[k]));
  const after = { ...sqlite.prepare("SELECT * FROM videos WHERE id='vid-restore'").get() };
  const before = { ...after, visibility_status: "private" };
  sqlite.prepare(`INSERT INTO audit_logs
    (id,table_name,target_id,operation,restore_strategy,restore_status,before_json,after_json,created_at,actor_user_id)
    VALUES ('video-audit','videos','vid-restore','UPDATE','update_before','restorable',?,?,?,'admin-1')`)
    .run(JSON.stringify(before), JSON.stringify(after), now);
}

test("T04 video public->private restore commits D1+R2 CAS and invalidates full public key fanout", async () => {
  const ctx = setup();
  seedVideoVisibilityRestore(ctx);
  const { state, bucket } = visibilityManifestBucket();
  const previous = globalThis.caches;
  const deleted = [];
  globalThis.caches = { default: {
    delete: async (url) => { deleted.push(decodeURIComponent(url)); return true; },
  } };
  try {
    const res = await ctx.request({
      audit_id: "video-audit", reason: "動画公開の取り消し",
      confirm_text: "RESTORE video-audit",
    }, { Origin: SITE }, { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(ctx.sqlite.prepare(
      "SELECT visibility_status FROM videos WHERE id='vid-restore'",
    ).get().visibility_status, "private");
    const fence = ctx.sqlite.prepare(
      "SELECT state,fence_token FROM public_visibility_fences WHERE entity_type='video' AND entity_id='vid-restore'",
    ).get();
    assert.equal(fence.state, "blocked");
    assert.equal(state.puts, 1);
    assert.equal(state.manifest.entities.length, 1);
    assert.equal(state.manifest.entities[0].entity_type, "video");
    assert.equal(state.manifest.entities[0].entity_id, "vid-restore");
    assert.equal(state.manifest.entities[0].fence_token, fence.fence_token);
    for (const suffix of [
      "videos/vid-restore.json", "videos/yt-restore-1.json",
      "videos/random-pool.v1.json", "youtube/related-blocklist.v1.json",
      "top/sections/recommended.v1.json", "top/sections/latest.v1.json",
      "list/recent.json", "list/popular.json", "search-index-lite.json",
      "users/creator-1.json", "users/creator-1/works/2.json",
      "events/ev-1.json", "events/ev-1/base.v1.json",
    ]) {
      assert.ok(deleted.some((url) => url.endsWith(suffix)), `not evicted: ${suffix}`);
    }
    assert.equal(ctx.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'",
    ).get().n, 1);
    assert.equal(ctx.stats.batches, 1, "RESTORE mutation, audit and queue must use one atomic D1 batch");
  recordRestoreD1Budget("videos_private_restore_success", ctx.stats);
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});

test("T04 video restore fails closed when enforced visibility R2 bucket is unavailable", async () => {
  const ctx = setup();
  seedVideoVisibilityRestore(ctx);
  const response = await ctx.request({
    audit_id: "video-audit", reason: "動画公開の取り消し",
    confirm_text: "RESTORE video-audit",
  }, { Origin: SITE }, { PUBLIC_VISIBILITY_GUARD_MODE: "enforce" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, false);
  assert.equal(ctx.sqlite.prepare(
    "SELECT visibility_status FROM videos WHERE id='vid-restore'",
  ).get().visibility_status, "public");
  assert.equal(ctx.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM public_visibility_fences",
  ).get().n, 0);
  assert.equal(ctx.sqlite.prepare(
    "SELECT COUNT(*) AS n FROM audit_restore_runs WHERE status='success'",
  ).get().n, 0);
  recordRestoreD1Budget("videos_missing_r2_fail_closed", ctx.stats);
});

// The Hono route test injects an in-memory session middleware, not Auth.js.
// These counts therefore form a *lower bound*, not a production D1 profile.
// Reports remain observational until the approved S3 <=3 pre-read gate is met.
function recordRestoreD1Budget(scenario, stats) {
  const record = {
    scenario, mocked_session: true,
    d1_reads: stats.reads, d1_batches: stats.batches,
    s3_max_pre_reads: 3, s3_max_batches: 1,
    over_s3_budget: stats.reads > 3 || stats.batches > 1,
  };
  assert.ok(Number.isInteger(record.d1_reads));
  assert.ok(Number.isInteger(record.d1_batches));
  console.info("MIG-0662_S3_BUDGET " + JSON.stringify(record));
  return record;
}

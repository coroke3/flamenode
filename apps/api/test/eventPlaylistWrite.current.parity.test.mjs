// MIG-0655 T03/T04 differential parity: the REAL CURRENT Server Actions
// (src/lib/actions/event-youtube-playlist.ts saveEventYoutubePlaylistSettings /
// queueEventYoutubePlaylistSync) and the Hono routes (PUT/POST
// /api/manage/events/:id/youtube-playlist[/sync] through the full app stack:
// Origin -> Auth.js session -> requireAuth -> writeGuard -> db -> CostGuard) run
// against identically seeded SQLite databases built from every migration
// (real constraints, foreign keys ON like D1).
//
// Only the platform edges of CURRENT are stubbed: `writeGuard` (returns the
// seeded user + a drizzle db over that side's database), Next redirect /
// revalidatePath, and the Queue wake host (counted, never sent). Permission
// resolution (resolveEventEditPermissions -> getCollaboratorPermissions),
// playlist parsing, static rebuild planning and the audited batch are CURRENT's
// real code.
//
// Response mapping (CURRENT redirects, Hono returns JSON):
//   redirect ...?error=<m>  <->  { ok:false, message:<m> }
//   redirect ...?saved=1    <->  { ok:true, saved:true }
//   redirect ...?queued=1   <->  { ok:true, queued:true }
// The HTTP statuses are Hono-only and listed in docs/migration/work-items/MIG-0655.md
// ("Known differences"). Queue wakes: CURRENT n, Hono 0 (DOCUMENTED DIFFERENCE
// D-15-6 / D-0603-1).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { NOW, seed } from "./support/manageSeed.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const STUBS = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath(p) { (globalThis.__mig0655Cur?.revalidated ?? []).push(p); }",
    "next/navigation": `
      export function redirect(url) { const e = new Error("NEXT_REDIRECT"); e.__redirect = url; throw e; }
      export function unstable_rethrow(error) { if (error && error.__redirect) throw error; }
    `,
    "@/lib/auth/writeGuard": `
      export async function writeGuard(options) {
        const s = globalThis.__mig0655Cur;
        if (!s) throw new Error("writeGuard outside CURRENT parity case");
        s.features.push(options.feature);
        return { ok: true, db: s.db, user: s.user, activeXId: null, approvedXIds: [], hasPendingXRequest: false };
      }
      export async function requireAdminWrite(feature) { return writeGuard({ feature, requiredRole: "admin" }); }
    `,
    "@/lib/queues/youtubePlaylistSyncWake": `
      export async function sendYoutubePlaylistSyncWakeBestEffort(source) {
        globalThis.__mig0655Cur.playlistWakes.push(source);
        return { sent: false, reason: "test" };
      }
    `,
    "@/lib/serverCore/nextPorts": `
      export const nextQueueWakeHost = {
        readEnv: () => { globalThis.__mig0655Cur?.staticWakeHostReads.push(1); return null; },
        readWaitUntil: () => null,
        readKv: () => null,
      };
      export const nextRethrowFrameworkControl = (error) => { if (error && error.__redirect) throw error; };
    `,
  };
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
        return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const actions = await import("../../../src/lib/actions/event-youtube-playlist.ts");
  const playlistLib = await import("../../../src/lib/youtube/playlist.ts");
  const { parsePlaylistSettings } = await import("../src/routes/manage/playlistWrite.ts");
  const { app } = await import("../src/app.ts");
  const { EventPlaylistSettingsResultSchema, EventPlaylistSyncResultSchema } = await import("@flamenode/contracts");

  const SITE = "https://app.flamenode.example";
  const NOW_MS = NOW * 1000;

  function freeze() {
    let n = 0;
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    Date.now = () => NOW_MS;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  }

  /** One database per side: every migration, the manage seed, playlist rows, FK ON (D1 default). */
  function database(extra) {
    const sqlite = createSqlite();
    seed(sqlite);
    sqlite.exec(`UPDATE "user" SET is_tos_accepted = 1`);
    sqlite.exec(`UPDATE system_settings SET operation_mode = 'normal', disabled_features_json = NULL WHERE id = 'default'`);
    // Replace the manage seed's playlist rows with a fully populated state.
    sqlite.exec("DELETE FROM event_youtube_playlist_items; DELETE FROM event_youtube_playlist_sync;");
    insert(sqlite, "event_youtube_playlist_sync", {
      event_id: "evA", playlist_id: "PLexistingAAAA", enabled: 1, sync_mode: "mirror",
      sync_interval_minutes: 720, sync_status: "synced", next_sync_at: NOW + 600, last_synced_at: NOW - 100,
      last_full_scan_at: NOW - 200, scan_started_at: null, scan_page_token: "tok", last_error: "old",
      last_attempt_at: NOW - 50, last_run_id: "run-1", last_duration_ms: 1234, run_lease_token: null,
      run_lease_expires_at: null, pending_trigger: "scheduled", created_at: NOW - 1000, updated_at: NOW - 100,
    });
    insert(sqlite, "event_youtube_playlist_sync", {
      event_id: "evC", playlist_id: "PLotherEventCC", enabled: 1, sync_mode: "append_only",
      sync_interval_minutes: 60, sync_status: "idle", created_at: NOW - 1000, updated_at: NOW - 1000,
    });
    for (const [id, video] of [["item-1", "vid1"], ["item-2", "vid2"]]) {
      insert(sqlite, "event_youtube_playlist_items", { event_id: "evA", playlist_item_id: id, youtube_video_id: video, seen_at: NOW - 10, created_at: NOW - 10 });
    }
    extra?.(sqlite);
    sqlite.exec("PRAGMA foreign_keys = ON");
    return sqlite;
  }

  /** D1 look-alike: atomic batch (BEGIN/ROLLBACK like D1), counts reads/batches. */
  function d1(sqlite) {
    const stats = { reads: 0, batches: 0 };
    const make = (text, params) => ({
      _sql: text,
      _params: params,
      bind: (...values) => make(text, values),
      first: async () => { stats.reads += 1; return sqlite.prepare(text).get(...params) ?? null; },
      all: async () => { stats.reads += 1; return { results: sqlite.prepare(text).all(...params), success: true, meta: {} }; },
      run: async () => ({ results: sqlite.prepare(text).all(...params), success: true, meta: {} }),
      raw: async () => {
        stats.reads += 1;
        const prepared = sqlite.prepare(text);
        prepared.setReturnArrays(true);
        try { return prepared.all(...params).map((row) => [...row]); } finally { prepared.setReturnArrays(false); }
      },
    });
    return {
      stats,
      prepare: (text) => make(text, []),
      batch: async (statements) => {
        stats.batches += 1;
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((s) => ({ results: sqlite.prepare(s._sql).all(...s._params), success: true, meta: {} }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function execute(sqlite, text, params, method) {
    const statement = sqlite.prepare(text);
    if (method === "run") { statement.run(...params); return []; }
    statement.setReturnArrays(true);
    if (method === "get") return statement.get(...params);
    return statement.all(...params);
  }

  function drizzleOver(sqlite) {
    return drizzle(
      async (text, params, method) => ({ rows: execute(sqlite, text, params, method) }),
      async (queries) => {
        sqlite.exec("BEGIN");
        try {
          const results = queries.map(({ sql: text, params, method }) => ({ rows: execute(sqlite, text, params, method) }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    );
  }

  const userRow = (sqlite, name) => sqlite.prepare(`SELECT id, role FROM "user" WHERE id = ?`).get(`u_${name}`);

  /** CURRENT: real Server Action, FormData in, redirect URL out. */
  async function runCurrent(sqlite, name, action, fields) {
    const state = {
      db: drizzleOver(sqlite),
      user: { ...userRow(sqlite, name) },
      features: [], playlistWakes: [], staticWakeHostReads: [], revalidated: [],
    };
    globalThis.__mig0655Cur = state;
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    const restore = freeze();
    let location = null;
    try {
      await actions[action](form);
    } catch (error) {
      if (!error?.__redirect) throw error;
      location = error.__redirect;
    } finally {
      restore();
      delete globalThis.__mig0655Cur;
    }
    return { location, ...state };
  }

  /** Hono: the real app, session cookie, same-origin unless overridden. */
  async function runHono(sqlite, name, method, path, body, { origin = SITE } = {}) {
    const db = d1(sqlite);
    const restore = freeze();
    try {
      const headers = { ...(name ? cookie(`tok-${name}`) : {}), ...(origin ? { Origin: origin } : {}) };
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await app.request(
        path,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        { DB: db, AUTH_SECRET: "test-secret", NEXT_PUBLIC_SITE_URL: SITE },
      );
      const text = await res.text();
      return { status: res.status, cache: res.headers.get("cache-control"), body: text ? JSON.parse(text) : null, stats: db.stats };
    } finally {
      restore();
    }
  }

  /** CURRENT redirect -> the JSON body the Hono API returns for the same outcome. */
  function currentAsJson(location) {
    const url = new URL(location, SITE);
    if (url.pathname === "/manage") return { redirect: "/manage" };
    const error = url.searchParams.get("error");
    if (error !== null) return { ok: false, message: error };
    if (url.searchParams.get("saved") === "1") return { ok: true, saved: true };
    if (url.searchParams.get("queued") === "1") return { ok: true, queued: true };
    return { unexpected: location };
  }

  const TABLES = {
    event_youtube_playlist_sync: "SELECT * FROM event_youtube_playlist_sync ORDER BY event_id",
    event_youtube_playlist_items: "SELECT * FROM event_youtube_playlist_items ORDER BY event_id, playlist_item_id",
    static_rebuild_queue: "SELECT * FROM static_rebuild_queue ORDER BY id",
  };
  const rows = (sqlite, table) => sqlite.prepare(TABLES[table]).all().map((r) => ({ ...r }));
  /** Audit rows with JSON payloads parsed (key order is not a contract). */
  const audits = (sqlite) =>
    sqlite.prepare("SELECT * FROM audit_logs WHERE table_name = 'event_youtube_playlist_sync' ORDER BY id").all().map((r) => {
      const out = { ...r };
      for (const k of Object.keys(out)) {
        if (k.endsWith("_json") && typeof out[k] === "string") out[k] = JSON.parse(out[k]);
      }
      return out;
    });

  function assertSameState(cur, hono, label) {
    for (const table of Object.keys(TABLES)) {
      assert.deepStrictEqual(rows(hono, table), rows(cur, table), `${label}: ${table} differs`);
    }
    assert.deepStrictEqual(audits(hono), audits(cur), `${label}: audit_logs differ`);
  }

  async function both({ user, action, eventId, fields, honoBody }) {
    const curDb = database();
    const honoDb = database();
    const cur = await runCurrent(curDb, user, action, { event_id: eventId, ...fields });
    const path = `/api/manage/events/${encodeURIComponent(eventId)}/youtube-playlist${action === "queueEventYoutubePlaylistSync" ? "/sync" : ""}`;
    const method = action === "queueEventYoutubePlaylistSync" ? "POST" : "PUT";
    const hono = await runHono(honoDb, user, method, path, action === "queueEventYoutubePlaylistSync" ? undefined : honoBody ?? fields);
    return { curDb, honoDb, cur, hono, curJson: currentAsJson(cur.location) };
  }

  // ---------------- SA-038 settings ----------------

  const SETTINGS_CASES = [
    ["admin changes playlist (items reset, CREATE->UPDATE audit)", "admin", "evA", { playlist_id: "https://www.youtube.com/playlist?list=PLnewPlaylist01", sync_mode: "append_only", sync_interval_minutes: "90" }],
    ["owner keeps playlist (last_synced_at kept, no item reset)", "owner", "evA", { playlist_id: "PLexistingAAAA", sync_mode: "mirror", sync_interval_minutes: "720" }],
    ["manager disables sync (off keeps playlist, enabled=0)", "mgr", "evA", { playlist_id: "PLexistingAAAA", sync_mode: "off", sync_interval_minutes: "720" }],
    ["two (second approved X is owner) via youtu.be URL", "two", "evA", { playlist_id: "https://youtu.be/abc?list=PLyoutubeShort1", sync_mode: "mirror", sync_interval_minutes: "99999" }],
    ["admin creates settings on event without a row", "admin", "evB", { playlist_id: "PLbrandNewBBBB", sync_mode: "mirror", sync_interval_minutes: "1.5" }],
    ["admin clears playlist with mode off", "admin", "evA", { playlist_id: "", sync_mode: "off", sync_interval_minutes: "" }],
    ["reviewer lacks event.publish", "rev", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["custom preset without event.publish", "custom", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["pending X approval owner", "pending", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["removed staff (approved X, no staff row)", "removed", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["plain user without X", "plain", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["public_staff preset", "pubstaff", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["owner of another event (IDOR)", "outsider", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["non-staff on unknown event (no existence oracle)", "plain", "noSuchEvent", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
    ["non-staff with invalid playlist: permission message first", "rev", "evA", { playlist_id: "https://evil.example/?list=PLnewPlaylist01", sync_mode: "mirror" }],
    ["admin, unknown event, invalid playlist: validation message first", "admin", "noSuchEvent", { playlist_id: "bad id!", sync_mode: "mirror" }],
    ["invalid playlist host", "admin", "evA", { playlist_id: "https://evil.example/playlist?list=PLnewPlaylist01", sync_mode: "mirror" }],
    ["mode on without playlist", "admin", "evA", { playlist_id: "", sync_mode: "mirror" }],
    ["playlist already used by another event (UNIQUE)", "admin", "evA", { playlist_id: "PLotherEventCC", sync_mode: "mirror", sync_interval_minutes: "720" }],
  ];

  for (const [label, user, eventId, fields] of SETTINGS_CASES) {
    test(`SA-038 CURRENT vs Hono: ${label}`, async () => {
      const r = await both({ user, action: "saveEventYoutubePlaylistSettings", eventId, fields });
      assert.deepStrictEqual(r.hono.body, r.curJson, `${label}: body (Hono ${r.hono.status})`);
      assert.ok(EventPlaylistSettingsResultSchema.safeParse(r.hono.body).success, "contract shape");
      assert.equal(r.hono.cache, "private, no-store");
      assertSameState(r.curDb, r.honoDb, label);
      assert.deepStrictEqual(r.cur.features, ["manage_event_update"]);
      if (r.curJson.ok) {
        assert.equal(r.hono.status, 200);
        assert.equal(r.hono.stats.batches, 1, "Hono: one audited D1 batch");
        // D-15-6 / D-0603-1: CURRENT wakes the playlist Queue when enabled and the
        // static rebuild Queue after commit; Hono sends 0 wakes (no Queue binding).
        const enabled = fields.sync_mode !== "off";
        assert.equal(r.cur.playlistWakes.length, enabled ? 1 : 0, "CURRENT playlist wakes");
        assert.ok(r.cur.staticWakeHostReads.length >= 1, "CURRENT asked for the static wake host");
      } else {
        // "Nothing written" is the table/audit equality above (a UNIQUE failure
        // reaches the batch and rolls back on both sides).
        assert.equal(r.cur.playlistWakes.length, 0);
      }
    });
  }

  test("SA-038 HTTP statuses for the CURRENT outcomes (Hono-only, documented)", async () => {
    const status = async (user, eventId, fields) =>
      (await both({ user, action: "saveEventYoutubePlaylistSettings", eventId, fields })).hono.status;
    assert.equal(await status("rev", "evA", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }), 403);
    assert.equal(await status("plain", "noSuchEvent", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }), 403);
    assert.equal(await status("admin", "evA", { playlist_id: "bad id!", sync_mode: "mirror" }), 400);
    assert.equal(await status("admin", "evA", { playlist_id: "PLotherEventCC", sync_mode: "mirror" }), 409);
  });

  test("SA-038 lease held by a running worker: same message, nothing written", async () => {
    const lease = (sqlite) => sqlite.exec(`UPDATE event_youtube_playlist_sync SET run_lease_token = 'w1', run_lease_expires_at = ${NOW + 3600} WHERE event_id = 'evA'`);
    const curDb = database(lease);
    const honoDb = database(lease);
    const fields = { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" };
    const cur = await runCurrent(curDb, "admin", "saveEventYoutubePlaylistSettings", { event_id: "evA", ...fields });
    const hono = await runHono(honoDb, "admin", "PUT", "/api/manage/events/evA/youtube-playlist", fields);
    assert.deepStrictEqual(hono.body, currentAsJson(cur.location));
    assert.equal(hono.status, 409);
    assertSameState(curDb, honoDb, "lease");
  });

  test("SA-038 admin on an unknown event: CURRENT fails at the FK, Hono 404 (documented difference)", async () => {
    const r = await both({ user: "admin", action: "saveEventYoutubePlaylistSettings", eventId: "noSuchEvent", fields: { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" } });
    assert.equal(r.curJson.ok, false);
    assert.match(r.curJson.message, /設定を保存できませんでした/);
    assert.equal(r.hono.status, 404);
    assert.deepStrictEqual(r.hono.body, { ok: false, message: "イベントが見つかりません。" });
    assertSameState(r.curDb, r.honoDb, "unknown event");
  });

  test("SA-038 playlist parser equals CURRENT src/lib/youtube/playlist.ts on a table of inputs", () => {
    const ids = [
      "", "  ", "PLshort", "PL1234567890", "PL_-abcdefgh", "a".repeat(100), "a".repeat(101), "bad id!!!!!!",
      "https://www.youtube.com/playlist?list=PL1234567890", "http://youtube.com/watch?v=x&list=PL1234567890",
      "https://m.youtube.com/playlist?list=PL1234567890", "https://music.youtube.com/playlist?list=PL1234567890",
      "https://youtu.be/xyz?list=PL1234567890", "https://youtube.com.evil.example/playlist?list=PL1234567890",
      "https://evil.example/?list=PL1234567890", "ftp://youtube.com/playlist?list=PL1234567890",
      "https://youtube.com/playlist", "https://youtube.com/playlist?list=short", "javascript:alert(1)",
      " PL1234567890 ", "https://www.youtube.com/playlist?list=%20PL1234567890%20",
    ];
    const modes = [undefined, "", "off", "append_only", "mirror", "MIRROR", "constructor"];
    const intervals = [undefined, "", "0", "59", "60", "61", "720", "10080", "10081", "1.5", "abc", "-5", "1e3", " 90 "];
    for (const id of ids) {
      for (const mode of modes) {
        for (const interval of intervals) {
          const input = { playlist_id: id, sync_mode: mode, sync_interval_minutes: interval };
          // CURRENT action: String(formData.get(x) ?? default) with missing fields absent.
          const curMode = playlistLib.parsePlaylistSyncMode(String(mode ?? "off"));
          const raw = String(id ?? "").trim();
          const curId = playlistLib.extractYoutubePlaylistId(raw);
          const curInterval = playlistLib.parsePlaylistSyncInterval(String(interval ?? "720"));
          let expected;
          if (raw && !curId) expected = { ok: false, message: "YouTube再生リストのURLまたはIDが正しくありません。" };
          else if (curMode !== "off" && !curId) expected = { ok: false, message: "同期を有効にするには再生リストURLまたはIDが必要です。" };
          else expected = { ok: true, playlistId: curId, mode: curMode, interval: curInterval };
          assert.deepStrictEqual(parsePlaylistSettings(input), expected, JSON.stringify(input));
        }
      }
    }
  });

  // ---------------- SA-039 manual sync ----------------

  const SYNC_CASES = [
    ["admin queues enabled playlist", "admin", "evA"],
    ["owner queues", "owner", "evA"],
    ["manager queues", "mgr", "evA"],
    ["reviewer lacks event.publish", "rev", "evA"],
    ["plain user", "plain", "evA"],
    ["outsider (IDOR)", "outsider", "evA"],
    ["admin on event without settings", "admin", "evB"],
    ["admin on unknown event", "admin", "noSuchEvent"],
  ];
  for (const [label, user, eventId] of SYNC_CASES) {
    test(`SA-039 CURRENT vs Hono: ${label}`, async () => {
      const r = await both({ user, action: "queueEventYoutubePlaylistSync", eventId, fields: {} });
      assert.deepStrictEqual(r.hono.body, r.curJson, `${label}: body (Hono ${r.hono.status})`);
      assert.ok(EventPlaylistSyncResultSchema.safeParse(r.hono.body).success, "contract shape");
      assertSameState(r.curDb, r.honoDb, label);
      if (r.curJson.ok) {
        assert.equal(r.hono.status, 200);
        assert.equal(r.cur.playlistWakes.length, 1, "CURRENT sends one playlist wake");
        assert.equal(r.hono.stats.batches, 1);
      } else {
        assert.ok([403, 409].includes(r.hono.status), `${label}: ${r.hono.status}`);
        assert.equal(r.hono.stats.batches, 0);
      }
    });
  }

  test("SA-039 disabled sync and running lease: same messages, nothing written", async () => {
    for (const [label, mutate] of [
      ["disabled", (s) => s.exec("UPDATE event_youtube_playlist_sync SET enabled = 0 WHERE event_id = 'evA'")],
      ["lease", (s) => s.exec(`UPDATE event_youtube_playlist_sync SET run_lease_token = 'w', run_lease_expires_at = ${NOW + 60} WHERE event_id = 'evA'`)],
      ["expired lease is overridden", (s) => s.exec(`UPDATE event_youtube_playlist_sync SET run_lease_token = 'w', run_lease_expires_at = ${NOW - 1} WHERE event_id = 'evA'`)],
    ]) {
      const curDb = database(mutate);
      const honoDb = database(mutate);
      const cur = await runCurrent(curDb, "admin", "queueEventYoutubePlaylistSync", { event_id: "evA" });
      const hono = await runHono(honoDb, "admin", "POST", "/api/manage/events/evA/youtube-playlist/sync");
      assert.deepStrictEqual(hono.body, currentAsJson(cur.location), label);
      assertSameState(curDb, honoDb, label);
    }
  });

  // ---------------- T04 write stack (Hono-side; CURRENT origin check is the Next Server Action framework) ----------------

  test("T04 cross-origin / missing Origin: 403 before any D1 read, nothing written", async () => {
    for (const [method, path, body] of [
      ["PUT", "/api/manage/events/evA/youtube-playlist", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" }],
      ["POST", "/api/manage/events/evA/youtube-playlist/sync", undefined],
    ]) {
      for (const origin of [null, "https://evil.example"]) {
        const sqlite = database();
        const r = await runHono(sqlite, "admin", method, path, body, { origin });
        assert.equal(r.status, 403, `${method} origin=${origin}`);
        assert.equal(r.stats.reads, 0, "no D1 read before Origin");
        assert.equal(r.stats.batches, 0);
      }
    }
  });

  test("T04 anonymous 401, banned 403, ToS not accepted 403, maintenance 503: nothing written", async () => {
    const path = "/api/manage/events/evA/youtube-playlist/sync";
    const anon = await runHono(database(), null, "POST", path);
    assert.equal(anon.status, 401);
    assert.equal(anon.stats.batches, 0);

    const banned = await runHono(database(), "banned", "POST", path);
    assert.equal(banned.status, 403);
    assert.equal(banned.stats.batches, 0);

    const tos = await runHono(database((s) => s.exec(`UPDATE "user" SET is_tos_accepted = 0 WHERE id = 'u_owner'`)), "owner", "POST", path);
    assert.equal(tos.status, 403);
    assert.equal(tos.stats.batches, 0);

    const maintenanceDb = database((s) => s.exec(`UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'`));
    const maintenance = await runHono(maintenanceDb, "owner", "PUT", "/api/manage/events/evA/youtube-playlist", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" });
    assert.equal(maintenance.status, 503);
    assert.equal(maintenance.stats.batches, 0);
    assert.equal(rows(maintenanceDb, "event_youtube_playlist_sync").find((r) => r.event_id === "evA").playlist_id, "PLexistingAAAA");
  });

  test("T04 GET /youtube-playlist (MIG-0624 read) is not affected by the write stack", async () => {
    const r = await runHono(database(), "owner", "GET", "/api/manage/events/evA/youtube-playlist", undefined, { origin: null });
    assert.equal(r.status, 200);
    assert.equal(r.stats.batches, 0);
  });

  test("unexpected storage failure is 503 (not 409) and leaves state unchanged", async () => {
    const sqlite = database((s) => s.exec("DROP TABLE static_rebuild_queue"));
    const before = rows(sqlite, "event_youtube_playlist_sync");
    const r = await runHono(sqlite, "admin", "PUT", "/api/manage/events/evA/youtube-playlist", { playlist_id: "PLnewPlaylist01", sync_mode: "mirror" });
    assert.equal(r.status, 503);
    assert.deepStrictEqual(r.body, { ok: false, message: "設定を保存できませんでした。同じ再生リストが別イベントに設定されていないか確認してください。" });
    assert.deepStrictEqual(rows(sqlite, "event_youtube_playlist_sync"), before);
  });

}

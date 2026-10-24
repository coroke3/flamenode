import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/personalSeed.mjs";

// MIG-0604 U01 (RH-014) parity: the REAL CURRENT route handler
// (app/api/events/[id]/slots/viewer-overlay/route.ts -> src/lib/slots/slotViewerOverlay.ts, real getCurrentUser /
// getOnboardingState / resolveReservationXIdentity / slot identity code) runs over node:sqlite through a drizzle
// proxy. Only `@/lib/cloudflare` (D1 binding) and `@/lib/auth/session` (Auth.js) are replaced, by stubs that hand the
// same database and the same session to CURRENT. The Hono route is then compared against it response by response.
if (runUnderRootTsx(import.meta.url)) {
  const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const CLOUDFLARE_STUB = stub(`
    export async function withDatabaseRead(fn) {
      const r = globalThis.__ovRef; r.calls += 1;
      if (r.failAt === r.calls) throw new Error("boom");
      return fn(r.db);
    }
    export const withDatabase = withDatabaseRead;
    export async function withDatabaseWrite(fn) { return fn(globalThis.__ovRef.db); }
    export function getDatabase() { return globalThis.__ovRef.db; }
  `);
  const SESSION_STUB = stub(`
    export async function getAuthSession() {
      const r = globalThis.__ovRef;
      if (r.sessionError) throw new Error("auth down");
      return r.session;
    }
    export const loadAuthSessionUncached = getAuthSession;
  `);
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      if (specifier === "@/lib/cloudflare") return { url: CLOUDFLARE_STUB, shortCircuit: true };
      if (specifier === "@/lib/auth/session") return { url: SESSION_STUB, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { app } = await import("../src/app.ts");
  const { MAX_VIEWER_SLOTS, MAX_VIEWER_SLOTS_JSON_BYTES, VIEWER_OVERLAY_CACHE_CONTROL } = await import(
    "../src/routes/events/viewerOverlay.ts"
  );
  const { GET: currentGet } = await import("../../../app/api/events/[id]/slots/viewer-overlay/route.ts");
  const { SlotViewerOverlayResponseSchema, SlotViewerOverlayErrorSchema } = await import("@flamenode/contracts");

  const sqlite = createSqlite();
  seed(sqlite);
  const ins = (table, row) => insert(sqlite, table, row);

  // ---- events / videos / slots for this route (users, terms, X links, pending requests come from the shared seed)
  const event = (id, o = {}) =>
    ins("events", { id, title: id, visibility_status: "public", slot_visibility_mode: "public_name", ...o });
  event("ov-pub");
  event("ov-anon", { slot_visibility_mode: "anonymous" });
  event("ov-hidden", { slot_visibility_mode: "hidden" });
  event("ov-priv", { visibility_status: "private" });
  // Entry window not open yet and event not over: the case canUseSlotOperatorOverride would allow if the row
  // carried visibility_status (it does not in CURRENT, so the answer stays false even for an admin).
  event("ov-window", { start_time: 4_000_000_000, end_time: 4_000_100_000, entry_start_time: 4_000_000_000 - 100 });
  event("ov-big", { slot_visibility_mode: "anonymous" });
  event("ov-over");
  event("ov-bytes");

  const video = (id, icon) =>
    ins("videos", {
      id,
      title: `Title ${id}`,
      submitted_by_user_id: "u_alice",
      creator_display_name: `Name ${id}`,
      creator_icon_url: icon,
      youtube_video_id: `yt${id}`,
      visibility_status: "public",
      scheduled_time: 1,
      created_at: 1,
      app_like_count: 0,
    });
  video("ov-v-icon", "https://ic.test/a.png");
  video("ov-v-null", null);
  video("ov-v-empty", "");

  let seq = 0;
  const slot = (eventId, id, o) => {
    seq += 1;
    ins("slots", { id, event_id: eventId, status: "reserved", sort_order: seq, start_time: 1000 + seq * 10, ...o });
  };
  for (const eventId of ["ov-pub", "ov-anon", "ov-hidden"]) {
    // alice: active X alice_x. Mixed relations, groups, statuses, icons (insertion order is NOT start_time order for a5).
    slot(eventId, `${eventId}-a1`, { reserved_by_user_id: "u_alice", x_user_id: "alice_x", reserved_x_id_snapshot: "alice_x", reservation_group_id: "g1", display_name: "A1" });
    slot(eventId, `${eventId}-a2`, { reserved_by_user_id: "u_alice", x_user_id: null, reservation_group_id: "g1", display_name: "A2" });
    slot(eventId, `${eventId}-a3`, { reserved_by_user_id: "u_alice", x_user_id: "alice_y", reservation_group_id: "g2", display_name: "A3", status: "submitted", video_id: "ov-v-icon" });
    slot(eventId, `${eventId}-a4`, { reserved_by_user_id: "u_alice", x_user_id: "alice_y", display_name: "A4", status: "submitted", video_id: "ov-v-null" });
    slot(eventId, `${eventId}-a5`, { reserved_by_user_id: "u_alice", x_user_id: "alice_x", reservation_group_id: "g3", display_name: "A5", status: "submitted", video_id: "ov-v-empty", start_time: 1005 });
    slot(eventId, `${eventId}-a6`, { reserved_by_user_id: "u_alice", x_user_id: "alice_x", reservation_group_id: "g2", display_name: "A6", reserved_x_id_snapshot: "snap-x" });
    slot(eventId, `${eventId}-a7`, { reserved_by_user_id: "u_alice", x_user_id: null, display_name: null, status: "available" });
    // other viewers
    slot(eventId, `${eventId}-b1`, { reserved_by_user_id: "u_bob", x_user_id: "bob_x", display_name: "B1" });
    slot(eventId, `${eventId}-e1`, { reserved_by_user_id: "u_erin", x_user_id: null, display_name: "E1" });
    slot(eventId, `${eventId}-e2`, { reserved_by_user_id: "u_erin", x_user_id: "erin_new", display_name: "E2" });
    slot(eventId, `${eventId}-f1`, { reserved_by_user_id: "u_frank", x_user_id: "frank_a", display_name: "F1" });
    slot(eventId, `${eventId}-f2`, { reserved_by_user_id: "u_frank", x_user_id: "frank_b", display_name: "F2" });
    slot(eventId, `${eventId}-i1`, { reserved_by_user_id: "u_ivy", x_user_id: "ivy_x", display_name: "I1", reservation_group_id: "gi" });
    slot(eventId, `${eventId}-c1`, { reserved_by_user_id: "u_carol", x_user_id: null, display_name: "C1" });
    slot(eventId, `${eventId}-d1`, { reserved_by_user_id: "u_dave", x_user_id: "dave_r", display_name: "D1" });
    slot(eventId, `${eventId}-n1`, { reserved_by_user_id: "u_banned", x_user_id: null, display_name: "N1" });
    slot(eventId, `${eventId}-z1`, { reserved_by_user_id: "u_zed_user", x_user_id: "zed", display_name: "Z1" });
  }
  slot("ov-window", "ov-window-c1", { reserved_by_user_id: "u_carol", x_user_id: null, display_name: "C1" });
  slot("ov-priv", "ov-priv-a1", { reserved_by_user_id: "u_alice", x_user_id: "alice_x", display_name: "P1" });
  for (let i = 0; i < MAX_VIEWER_SLOTS; i += 1) {
    slot("ov-big", `ov-big-${String(i).padStart(3, "0")}`, { reserved_by_user_id: "u_many", x_user_id: "many_0", display_name: `M${i}`, reservation_group_id: `mg${i % 7}` });
  }
  for (let i = 0; i < MAX_VIEWER_SLOTS + 1; i += 1) {
    slot("ov-over", `ov-over-${String(i).padStart(3, "0")}`, { reserved_by_user_id: "u_ivy", x_user_id: "ivy_x", display_name: `O${i}` });
  }
  for (let i = 0; i < MAX_VIEWER_SLOTS; i += 1) {
    slot("ov-bytes", `ov-bytes-${String(i).padStart(3, "0")}`, { reserved_by_user_id: "u_frank", x_user_id: "frank_a", display_name: "あ".repeat(260) });
  }

  // ---- harness
  const refDb = drizzle(async (text, params, method) => {
    const statement = sqlite.prepare(text);
    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }
    const rows = statement.all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });

  const NO_STORE = VIEWER_OVERLAY_CACHE_CONTROL;
  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));
  const stats = [];

  /** The real CURRENT route handler. `user` is the Auth.js session user (null = signed out). */
  async function current(eventId, user, options = {}) {
    globalThis.__ovRef = {
      db: refDb,
      calls: 0,
      failAt: options.failAt ?? 0,
      sessionError: options.sessionError ?? false,
      session: user ? { user: { id: `u_${user}` } } : null,
    };
    const response = await currentGet(new Request(`https://x.test/api/events/${eventId}/slots/viewer-overlay`), {
      params: Promise.resolve({ id: decodeURIComponent(eventId) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }

  async function hono(eventId, user, options = {}) {
    const d1 = options.d1 ?? createD1(sqlite);
    const response = await app.request(`/api/events/${eventId}/slots/viewer-overlay`, { headers: user ? cookie(`tok-${user}`) : {} }, { DB: d1 });
    const text = await response.text();
    stats.push({ statements: d1.stats.statements, maxBinds: d1.stats.maxBinds, bytes: Buffer.byteLength(text), writes: d1.stats.writes });
    return { status: response.status, headers: response.headers, body: JSON.parse(text), stats: d1.stats };
  }

  const HEADER_NAMES = ["cache-control", "pragma", "expires", "retry-after"];
  const headersOf = (r) => Object.fromEntries(HEADER_NAMES.map((n) => [n, r.headers.get(n)]));

  async function assertParity(eventId, user, label, options = {}) {
    const [cur, got] = await Promise.all([current(eventId, user, options.current), hono(eventId, user, options.hono)]);
    assert.equal(got.status, cur.status, `${label}: status`);
    assert.deepEqual(canon(got.body), canon(cur.body), `${label}: body`);
    assert.deepEqual(headersOf(got), headersOf(cur), `${label}: headers`);
    return { cur, got };
  }

  const VIEWERS = ["alice", "bob", "carol", "dave", "erin", "frank", "ivy", "banned", "many", "zed_user", null];

  test("the stubbed CURRENT handler really runs: alice sees her own slots and groups", async () => {
    const cur = await current("ov-anon", "alice");
    assert.equal(cur.status, 200);
    assert.equal(cur.body.loggedIn, true);
    assert.equal(cur.body.slots.length, 7);
    assert.ok(cur.body.slots.some((s) => s.group_key === "viewer-group-1"));
    assert.ok(cur.body.slots.some((s) => s.submitted_icon_url?.startsWith("/api/media/slot-submission-icon/")));
  });

  test("parity: every viewer on public_name / anonymous / hidden events (status, body, headers)", async () => {
    for (const eventId of ["ov-pub", "ov-anon", "ov-hidden"]) {
      for (const user of VIEWERS) {
        const { got } = await assertParity(eventId, user, `${eventId} as ${user ?? "anonymous"}`);
        assert.equal(got.status, 200);
        assert.equal(SlotViewerOverlayResponseSchema.safeParse(got.body).success, true, `${eventId} ${user}: schema`);
      }
    }
  });

  test("parity: viewers covering each onboarding / identity branch produce non-trivial results", async () => {
    const bob = (await assertParity("ov-pub", "bob", "bob")).got.body;
    assert.equal(bob.needsTermsAcceptance, true); // reaccept required on a newer major
    assert.equal(bob.canReserveSlot, false);
    const erin = (await assertParity("ov-pub", "erin", "erin")).got.body;
    assert.equal(erin.canReserveSlot, true);
    assert.equal(erin.canPost, false);
    assert.equal(erin.viewerXId, null); // two distinct pending requests -> Discord-only
    const alice = (await assertParity("ov-pub", "alice", "alice")).got.body;
    assert.equal(alice.viewerXId, "alice_x");
    assert.equal(alice.canPost, true);
    const banned = (await assertParity("ov-pub", "banned", "banned")).got.body;
    assert.equal(banned.isBanned, true);
    assert.deepEqual(banned.slots, []);
    const carol = (await assertParity("ov-pub", "carol", "carol")).got.body;
    assert.equal(carol.needsTermsAcceptance, true);
    const frank = (await assertParity("ov-pub", "frank", "frank")).got.body;
    assert.equal(frank.canPost, false);
    assert.ok(frank.slots.length > 0);
  });

  test("parity: id handling (private / unknown / trimmed / blank / overlong) and the error bodies", async () => {
    for (const [eventId, status, error] of [
      ["ov-priv", 404, "event_not_found"],
      ["nope", 404, "event_not_found"],
      ["%20", 400, "invalid_event_id"],
      [`${"x".repeat(200)}`, 404, "event_not_found"],
    ]) {
      const { got } = await assertParity(eventId, "alice", `id ${eventId.slice(0, 12)}`);
      assert.equal(got.status, status);
      assert.deepEqual(got.body, { error });
      assert.equal(SlotViewerOverlayErrorSchema.safeParse(got.body).success, true);
      assert.equal(got.headers.get("cache-control"), NO_STORE);
    }
    // " ov-pub " is trimmed by CURRENT and by the route
    const { got } = await assertParity("%20ov-pub%20", "alice", "trimmed id");
    assert.equal(got.status, 200);
    // an id longer than 128 chars is truncated (not rejected): a 128-char prefix is looked up
    ins("events", { id: "z".repeat(128), title: "long", visibility_status: "public" });
    assert.equal((await assertParity("z".repeat(200), null, "truncated id")).got.status, 200);
  });

  test("parity: signed-out, expired session and a session whose user row is gone", async () => {
    sqliteInsertGhost();
    const anon = (await assertParity("ov-pub", null, "no cookie")).got;
    assert.deepEqual(anon.body, canon((await current("ov-pub", null)).body));
    assert.equal(anon.body.loggedIn, false);
    assert.equal(anon.stats.statements, 1); // anonymous: statement 1 only, no session lookup
    // expired session cookie: Hono resolves it to no user; CURRENT is signed out
    const d1 = createD1(sqlite);
    const response = await app.request("/api/events/ov-pub/slots/viewer-overlay", { headers: cookie("tok-expired") }, { DB: d1 });
    assert.deepEqual(await response.json(), (await current("ov-pub", null)).body);
    // user row deleted after the session was issued
    const ghost = await hono("ov-pub", "ghost");
    assert.deepEqual(ghost.body, (await current("ov-pub", "ghost")).body);
    assert.equal(ghost.body.loggedIn, false);
  });
  function sqliteInsertGhost() {
    try {
      ins("session", { sessionToken: "tok-ghost", userId: "u_ghost", expires: Date.now() + 3_600_000 });
    } catch {
      // already inserted
    }
  }

  test("parity: D1 / auth failures (event read fails, user read fails, session lookup fails)", async () => {
    // event statement fails -> 503 + Retry-After 3 (CURRENT: first DB call throws)
    const failEvent = createD1(sqlite);
    const realPrepare = failEvent.prepare;
    failEvent.prepare = (sql) => {
      if (/FROM events e WHERE/.test(sql)) throw new Error("boom");
      return realPrepare(sql);
    };
    const a = await assertParity("ov-pub", "alice", "event read fails", { current: { failAt: 1 }, hono: { d1: failEvent } });
    assert.equal(a.got.status, 503);
    assert.deepEqual(a.got.body, { error: "viewer_overlay_unavailable" });
    assert.equal(a.got.headers.get("retry-after"), "3");

    // viewer statement fails -> authUnavailable overlay (CURRENT: getCurrentUser throws database_unavailable)
    const failViewer = createD1(sqlite);
    const prepare2 = failViewer.prepare;
    failViewer.prepare = (sql) => {
      if (/FROM "user" u WHERE u.id = \?/.test(sql)) throw new Error("boom");
      return prepare2(sql);
    };
    const b = await assertParity("ov-pub", "alice", "user read fails", { current: { failAt: 2 }, hono: { d1: failViewer } });
    assert.equal(b.got.status, 200);
    assert.equal(b.got.body.authUnavailable, true);
    assert.equal(b.got.body.loggedIn, false);

    // session lookup fails (CURRENT: auth() throws) -> authUnavailable overlay, but a missing event is still 404
    const failSession = createD1(sqlite);
    const prepare3 = failSession.prepare;
    failSession.prepare = (sql) => {
      if (/FROM "session" s/.test(sql)) throw new Error("boom");
      return prepare3(sql);
    };
    const c = await assertParity("ov-pub", "alice", "session lookup fails", { current: { sessionError: true }, hono: { d1: failSession } });
    assert.equal(c.got.body.authUnavailable, true);
    const d = await assertParity("nope", "alice", "session lookup fails, unknown event", { current: { sessionError: true }, hono: { d1: failSession } });
    assert.equal(d.got.status, 404);
  });

  test("parity: operatorOverrideAllowed is false for everyone (CURRENT selects the event without visibility_status)", async () => {
    const admin = await assertParity("ov-window", "carol", "admin in the pre-entry window");
    assert.equal(admin.got.body.operatorOverrideAllowed, false);
    assert.equal(admin.got.body.loggedIn, true);
  });

  test("S2 limits: exactly MAX_VIEWER_SLOTS own slots matches CURRENT; one more fails closed; a >64 KiB column fails closed", async () => {
    const big = await assertParity("ov-big", "many", "100 own slots");
    assert.equal(big.got.body.slots.length, MAX_VIEWER_SLOTS);
    assert.ok(big.got.body.slots.some((s) => s.group_key === "viewer-group-7"));
    assert.ok(Buffer.byteLength(JSON.stringify(big.got.body)) <= 64 * 1024, "response <= 64 KiB");

    // KNOWN DELTA: CURRENT returns all 101; the route returns the CURRENT "unavailable for this viewer" shape.
    const over = await hono("ov-over", "ivy");
    const overCurrent = await current("ov-over", "ivy");
    assert.equal(overCurrent.body.slots.length, MAX_VIEWER_SLOTS + 1);
    assert.equal(over.status, 200);
    assert.deepEqual(over.body, {
      loggedIn: true,
      authUnavailable: true,
      isBanned: false,
      needsTermsAcceptance: false,
      canReserveSlot: false,
      canPost: false,
      operatorOverrideAllowed: false,
      viewerXId: null,
      viewerXIdNotice: null,
      slots: [],
    });

    // KNOWN DELTA: 100 slots whose JSON exceeds MAX_VIEWER_SLOTS_JSON_BYTES.
    const bytes = await hono("ov-bytes", "frank");
    assert.ok(MAX_VIEWER_SLOTS * 260 * 3 > MAX_VIEWER_SLOTS_JSON_BYTES);
    assert.equal(bytes.body.authUnavailable, true);
    assert.deepEqual(bytes.body.slots, []);
  });

  test("S2 budget: statements (session + 2), binds, response bytes, no writes", async () => {
    stats.length = 0;
    for (const eventId of ["ov-pub", "ov-anon", "ov-hidden", "ov-big"]) {
      for (const user of VIEWERS) await hono(eventId, user);
    }
    assert.ok(stats.length > 0);
    for (const s of stats) {
      assert.ok(s.statements <= 3, `statements ${s.statements}`);
      assert.ok(s.maxBinds <= 100, `binds ${s.maxBinds}`);
      assert.ok(s.bytes <= 64 * 1024, `bytes ${s.bytes}`);
      assert.equal(s.writes, 0);
    }
    const signedIn = await hono("ov-pub", "alice");
    assert.equal(signedIn.stats.statements, 3);
    assert.equal(signedIn.stats.batches, 0);
  });
}

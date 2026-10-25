import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1, insert } from "./support/publicEventsHarness.mjs";
import { seed } from "./support/personalSeed.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const CLOUDFLARE_STUB = stub(`
    export class CloudflareBindingsUnavailableError extends Error {
      constructor(missing = [], cause) {
        super("Cloudflare bindings unavailable: " + missing.join(", "));
        this.name = "CloudflareBindingsUnavailableError";
        this.missing = missing;
        this.cause = cause;
      }
    }
    export async function withDatabaseRead(fn) {
      const r = globalThis.__pubRef; r.calls += 1;
      if (r.dbError) throw new Error("db_down");
      return fn(r.db);
    }
    export const withDatabase = withDatabaseRead;
    export async function withDatabaseWrite(fn) { return fn(globalThis.__pubRef.db); }
    export function getDatabase() {
      const r = globalThis.__pubRef;
      if (r.dbError) throw new Error("db_down");
      return r.db;
    }
    export function getEnv() { return globalThis.__pubRef.env; }
  `);

  const NEXT_PORTS_STUB = stub(`
    export async function nextQueueWakeHost() {
      return {
        async sendWake() { return { result: "ok" }; }
      };
    }
    export function nextRethrowFrameworkControl() {}
  `);

  const OPENNEXT_STUB = stub(`
    export function getCloudflareContext() {
      const r = globalThis.__pubRef;
      return {
        env: r.env,
        waitUntil: (p) => { r.waitUntilPromises.push(p); },
      };
    }
  `);

  const SESSION_STUB = stub(`
    export async function getAuthSession() {
      const r = globalThis.__pubRef;
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
      if (specifier === "@/lib/serverCore/nextPorts") return { url: NEXT_PORTS_STUB, shortCircuit: true };
      if (specifier === "@opennextjs/cloudflare") return { url: OPENNEXT_STUB, shortCircuit: true };
      if (specifier === "@/lib/auth/session") return { url: SESSION_STUB, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { schema } = await import("@flamenode/db");
  const { app } = await import("../src/app.ts");
  const { GET: currentViewerOverlayGet } = await import("../../../app/api/videos/[id]/viewer-overlay/route.ts");
  const { VideoViewerOverlayResponseSchema } = await import("@flamenode/contracts");
  const { resetOperationModeCachesForTests } = await import("../src/routes/live/operationMode.ts");
  const { resetPublicJsonIsolateCacheForTests } = await import("../../../src/lib/publicData/publicCacheIsolate.ts");
  const { resetPublicOperationModeCacheForTests } = await import("../../../src/lib/operationMode/publicModeCore.ts");

  function setupTestEnv() {
    resetOperationModeCachesForTests();
    resetPublicJsonIsolateCacheForTests();
    resetPublicOperationModeCacheForTests();

    const sqlite = createSqlite();
    seed(sqlite);
    const d1 = createD1(sqlite);
    const db = drizzle(d1, { schema });
    const bucket = createFakeBucket();
    const kv = createFakeKv();

    // Additional users & staff for video tests
    insert(sqlite, "user", {
      id: "u_staff",
      name: "Staff User",
      email: "staff@example.test",
      role: "user",
      is_tos_accepted: 1,
      accepted_terms_version_id: "T2",
      active_x_user_id: "staff_x",
      is_banned: 0,
      created_at: 1000,
    });
    insert(sqlite, "session", {
      sessionToken: "tok-staff",
      userId: "u_staff",
      expires: Date.now() + 3600_000,
    });
    insert(sqlite, "x_users", {
      id: "staff_x",
      x_name: "Staff X",
      icon_url: "https://x.test/staff.png",
      approval_status: "approved",
    });
    insert(sqlite, "x_user_account_links", {
      auth_user_id: "u_staff",
      x_user_id: "staff_x",
      link_role: "owner",
      created_at: 1000,
    });

    // Events
    insert(sqlite, "events", {
      id: "evt-1",
      title: "Event One",
      visibility_status: "public",
      slot_visibility_mode: "public_name",
    });

    // Event staff: staff_x is manager on evt-1 (grants video.chapter_admin)
    insert(sqlite, "event_staff", {
      id: "staff-1",
      event_id: "evt-1",
      x_user_id: "staff_x",
      display_name: "Staff Name",
      permission_preset: "manager",
      is_public: 1,
      created_at: 1000,
      updated_at: 1000,
    });

    // Videos
    insert(sqlite, "videos", {
      id: "vid-pub",
      title: "Public Video",
      creator_display_name: "Alice",
      primary_event_id: "evt-1",
      creator_x_user_id: "alice_x",
      submitted_by_user_id: "u_alice",
      youtube_video_id: "yt_pub",
      visibility_status: "public",
      scheduled_time: 2000,
      created_at: 1000,
      updated_at: 1000,
    });
    insert(sqlite, "video_events", {
      video_id: "vid-pub",
      event_id: "evt-1",
    });

    insert(sqlite, "videos", {
      id: "vid-priv",
      title: "Private Video",
      creator_display_name: "Alice",
      primary_event_id: "evt-1",
      creator_x_user_id: "alice_x",
      submitted_by_user_id: "u_alice",
      youtube_video_id: "yt_priv",
      visibility_status: "private",
      scheduled_time: 2000,
      created_at: 1000,
      updated_at: 1000,
    });

    // Chapters on vid-pub
    insert(sqlite, "video_chapters", {
      id: "chap-pub",
      video_id: "vid-pub",
      x_user_id: "alice_x",
      chapter_time: 10,
      chapter_label: "Public Chapter",
      note: "Public Note",
      visibility: "public",
      created_at: 1000,
      updated_at: 1000,
    });
    insert(sqlite, "video_chapters", {
      id: "chap-priv-alice",
      video_id: "vid-pub",
      x_user_id: "alice_x",
      chapter_time: 20,
      chapter_label: "Alice Private Chapter",
      note: "Alice Note",
      visibility: "private",
      created_at: 1000,
      updated_at: 1000,
    });
    insert(sqlite, "video_chapters", {
      id: "chap-priv-staff",
      video_id: "vid-pub",
      x_user_id: "staff_x",
      chapter_time: 30,
      chapter_label: "Staff Private Chapter",
      note: "Staff Note",
      visibility: "private",
      created_at: 1000,
      updated_at: 1000,
    });
    insert(sqlite, "video_chapters", {
      id: "chap:member:1",
      video_id: "vid-pub",
      x_user_id: "alice_x",
      chapter_time: 40,
      chapter_label: "Member Chapter",
      note: null,
      visibility: "private",
      created_at: 1000,
      updated_at: 1000,
    });

    // Interactions for alice on vid-pub
    insert(sqlite, "video_interactions_auth", {
      auth_user_id: "u_alice",
      video_id: "vid-pub",
      interaction_type: "like",
      created_at: 1000,
    });
    insert(sqlite, "video_interactions_auth", {
      auth_user_id: "u_alice",
      video_id: "vid-pub",
      interaction_type: "bookmark",
      created_at: 1000,
    });

    // Artifacts in bucket
    const pubVideoArtifact = {
      version: 1,
      generated_at: 1000,
      video: {
        id: "vid-pub",
        title: "Public Video",
        visibility_status: "public",
        scheduled_time: 2000,
        primary_event_id: "evt-1",
        creator_x_user_id: "alice_x",
        creator_display_name: "Alice",
      },
      public_events: [
        {
          id: "evt-1",
          title: "Event One",
          visibility_status: "public",
        },
      ],
      public_chapters: [],
    };
    bucket.put("videos/vid-pub.json", JSON.stringify(pubVideoArtifact));

    const privVideoArtifact = {
      version: 1,
      generated_at: 1000,
      video: {
        id: "vid-priv",
        title: "Private Video",
        visibility_status: "private",
        scheduled_time: 2000,
        primary_event_id: "evt-1",
      },
      public_events: [],
      public_chapters: [],
    };
    bucket.put("videos/vid-priv.json", JSON.stringify(privVideoArtifact));

    const eventPlaylistArtifact = {
      schema_version: 1,
      generated_at: 1000,
      event_id: "evt-1",
      complete: true,
      items: [
        {
          id: "vid-pub",
          title: "Public Video",
          youtube_video_id: "yt_pub",
          display_name: "Alice",
        },
        {
          id: "vid-other",
          title: "Other Video",
          youtube_video_id: "yt_other",
          display_name: "Bob",
        },
      ],
    };
    bucket.put("events/evt-1/playlist.v1.json", JSON.stringify(eventPlaylistArtifact));

    const env = {
      DB: d1,
      BUCKET: bucket,
      KV: kv,
      PUBLIC_VISIBILITY_GUARD_MODE: "off",
    };

    const pubRef = {
      env,
      db,
      calls: 0,
      dbError: false,
      session: null,
      waitUntilPromises: [],
    };
    globalThis.__pubRef = pubRef;

    return { sqlite, d1, db, bucket, kv, env, pubRef };
  }

  test("T06: RH-031 unauthenticated returns loggedIn: false and empty overlay", async () => {
    const { env, d1 } = setupTestEnv();
    d1.stats.statements = 0;

    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {}, env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");

    const json = await res.json();
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
    assert.equal(json.loggedIn, false);
    assert.equal(json.isBanned, false);
    assert.equal(json.likeActive, false);
    assert.equal(json.bookmarkActive, false);
    assert.deepEqual(json.privateChapters, []);

    // T08: Unauthenticated makes 0 D1 statements
    assert.equal(d1.stats.statements, 0);
  });

  test("T06: RH-031 authenticated normal user sees own private chapters and interaction status", async () => {
    const { env, d1 } = setupTestEnv();
    d1.stats.statements = 0;

    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
    assert.equal(json.loggedIn, true);
    assert.equal(json.isBanned, false);
    assert.equal(json.likeActive, true);
    assert.equal(json.bookmarkActive, true);
    assert.equal(json.viewerXApproved, true);

    // Alice sees only her own private chapter, not staff's, not member's
    assert.equal(json.privateChapters.length, 1);
    assert.equal(json.privateChapters[0].id, "chap-priv-alice");
    assert.equal(json.privateChapters[0].author_name, "X alice_x");

    // T08: Authenticated takes <= session (1) + 2 D1 statements (total <= 3)
    assert.ok(d1.stats.statements <= 3, `Expected statements <= 3, got ${d1.stats.statements}`);
  });

  test("T06: RH-031 admin user sees all private chapters", async () => {
    const { env, d1 } = setupTestEnv();
    d1.stats.statements = 0;

    // carol is admin in personalSeed
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-carol" },
    }, env);

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
    assert.equal(json.loggedIn, true);
    // Carol sees both alice's and staff's private chapters (member excluded)
    assert.equal(json.privateChapters.length, 2);
    const ids = json.privateChapters.map((c) => c.id);
    assert.ok(ids.includes("chap-priv-alice"));
    assert.ok(ids.includes("chap-priv-staff"));
  });

  test("T06: RH-031 event staff with video.chapter_admin sees all private chapters", async () => {
    const { env, d1 } = setupTestEnv();
    d1.stats.statements = 0;

    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
    assert.equal(json.loggedIn, true);
    // Staff user has manager preset on evt-1 -> canAdministerChapters allows seeing all private chapters
    assert.equal(json.privateChapters.length, 2);
    const ids = json.privateChapters.map((c) => c.id);
    assert.ok(ids.includes("chap-priv-alice"));
    assert.ok(ids.includes("chap-priv-staff"));
  });

  test("T06: RH-031 banned user returns isBanned: true and 0 D1 query for overlay", async () => {
    const { env, d1 } = setupTestEnv();
    d1.stats.statements = 0;

    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-banned" },
    }, env);

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.loggedIn, true);
    assert.equal(json.isBanned, true);
    assert.equal(json.likeActive, false);
    assert.equal(json.bookmarkActive, false);
    assert.deepEqual(json.privateChapters, []);

    // Session resolution is 1 statement, no additional D1 queries made for banned user
    assert.equal(d1.stats.statements, 1);
  });

  test("T06/T07: RH-031 non-public video (404) and missing artifact (503) with headers", async () => {
    const { env } = setupTestEnv();

    const privRes = await app.request("/api/videos/vid-priv/viewer-overlay", {}, env);
    assert.equal(privRes.status, 404);
    assert.equal(privRes.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
    assert.deepEqual(await privRes.json(), { error: "video_not_found" });

    // D-13-46 fail-closed: missing R2 artifact returns 503 viewer_overlay_unavailable with Retry-After: 3
    const missingRes = await app.request("/api/videos/vid-nonexistent/viewer-overlay", {}, env);
    assert.equal(missingRes.status, 503);
    assert.equal(missingRes.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
    assert.equal(missingRes.headers.get("Retry-After"), "3");
    assert.deepEqual(await missingRes.json(), { error: "viewer_overlay_unavailable" });

    const emptyIdRes = await app.request("/api/videos/%20/viewer-overlay", {}, env);
    assert.equal(emptyIdRes.status, 400);
    assert.equal(emptyIdRes.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
    assert.deepEqual(await emptyIdRes.json(), { error: "invalid_video_id" });
  });

  test("T06: RH-031 playlist query for event上映順 returns playlist items", async () => {
    const { env } = setupTestEnv();

    const res = await app.request("/api/videos/vid-pub/viewer-overlay?playlist=evt-1", {}, env);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.playlistLabel, "Event One 上映順");
    assert.equal(json.playlistItems.length, 2);
    assert.equal(json.playlistItems[0].id, "vid-pub");
    assert.equal(json.playlistItems[0].title, "Public Video");
    assert.equal(json.playlistItems[1].id, "vid-other");
  });

  test("T06: RH-031 playlist query for lib-like returns user's liked videos", async () => {
    const { env } = setupTestEnv();

    const res = await app.request("/api/videos/vid-pub/viewer-overlay?playlist=lib-like", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.playlistLabel, "いいねした作品");
    assert.ok(json.playlistItems.length >= 1);
    assert.ok(json.playlistItems.some((item) => item.id === "vid-pub"));
  });

  test("T08/T09: RH-031 D1 statement count and response byte size", async () => {
    const { env, d1 } = setupTestEnv();
    d1.stats.statements = 0;
    d1.stats.writes = 0;

    const res = await app.request("/api/videos/vid-pub/viewer-overlay?playlist=lib-like", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(res.status, 200);
    const text = await res.text();
    const bytes = Buffer.byteLength(text, "utf8");

    // ZERO_1102 S2: 0 writes, statements <= 3
    assert.equal(d1.stats.writes, 0);
    assert.ok(d1.stats.statements <= 3, `Expected statements <= 3, got ${d1.stats.statements}`);
    assert.ok(bytes < 16 * 1024, `Expected response < 16KB, got ${bytes} bytes`);
  });
}

import assert from "node:assert/strict";
import { inspect } from "node:util";
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
    // CURRENT reads through drizzle's sqlite-proxy over the same node:sqlite database (not counted in d1.stats).
    const db = drizzle(async (text, params, method) => {
      const statement = sqlite.prepare(text);
      if (method === "run") {
        statement.run(...params);
        return { rows: [] };
      }
      const rows = statement.all(...params).map((row) => Object.values(row));
      return { rows: method === "get" ? rows[0] : rows };
    }, { schema });
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
    // An event id outside CURRENT's /^[A-Za-z0-9_-]{1,64}$/ is never read, even when an object exists.
    bucket.put("events/evt.1/playlist.v1.json", JSON.stringify({ ...eventPlaylistArtifact, event_id: "evt.1" }));

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
    assert.equal(json.viewerCanEditChapters, false);
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
    assert.equal(json.viewerCanEditChapters, false, "approved X alone does not grant management");

    // Alice sees only her own private chapter, not staff's, not member's
    assert.equal(json.privateChapters.length, 1);
    assert.equal(json.privateChapters[0].id, "chap-priv-alice");
    assert.equal(json.privateChapters[0].viewerCanManage, true, "active X chapter owner can edit without admin role");
    assert.equal("chapter_owner_x_id" in json.privateChapters[0], false, "raw owner X ID must not leak");
    assert.equal(json.privateChapters[0].author_name, "X alice_x");

    // T08: Authenticated takes <= session (1) + 2 D1 statements (total <= 3)
    assert.ok(d1.stats.statements <= 3, `Expected statements <= 3, got ${d1.stats.statements}`);
  });

  test("Issue #661: editable public chapters carry complete notes and explicit server grants", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    insert(sqlite, "video_chapters", {
      id: "chap-pub-staff", video_id: "vid-pub", x_user_id: "staff_x",
      chapter_time: 12, chapter_label: "Staff public", note: "Staff note",
      visibility: "public", created_at: 1000, updated_at: 1000,
    });
    // An ordinary approved owner can edit their own row, but not staff's.
    d1.stats.statements = 0;
    const aliceNormal = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(aliceNormal.status, 200);
    assert.deepEqual((await aliceNormal.json()).editablePublicChapters, [],
      "normal viewer loads never fetch public chapter notes");
    d1.stats.statements = 0;
    const alice = await app.request("/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(alice.status, 200);
    const mine = await alice.json();
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(mine).success, true);
    assert.deepEqual(mine.editablePublicChapters.map((chapter) => chapter.id), ["chap-pub"]);
    assert.equal(mine.editablePublicChapters[0].note, "Public Note",
      "editing must preserve the D1 note rather than overwrite it with a blank SSG field");
    assert.equal(mine.editablePublicChapters[0].visibility, "public");
    assert.equal(mine.editablePublicChapters[0].viewerCanManage, true);
    assert.ok(mine.editablePublicChapters.every((c) => !("chapter_owner_x_id" in c)));
    assert.ok(d1.stats.statements <= 3, "the public editor may not add an extra D1 request");

    // A staff member with video.chapter_admin and approved Active X manages all.
    const staffNormal = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.deepEqual((await staffNormal.json()).editablePublicChapters, []);
    const staff = await app.request("/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    const managed = await staff.json();
    assert.equal(managed.viewerCanEditChapters, true);
    assert.deepEqual(managed.editablePublicChapters.map((c) => c.id), ["chap-pub"]);
    assert.ok(managed.editablePublicChapters.every((c) => c.viewerCanManage === true &&
      !("chapter_owner_x_id" in c)));
    const staffOwn = await app.request("/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub-staff", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.deepEqual((await staffOwn.json()).editablePublicChapters.map((c) => c.id),
      ["chap-pub-staff"], "manager may select a different row by ID but not enumerate all");

    // Switching Active X to a different approved identity must revoke the
    // former owner's edit grant even though both remain readable elsewhere.
    sqlite.prepare('UPDATE "user" SET "active_x_user_id" = ? WHERE "id" = ?')
      .run("alice_y", "u_alice");
    const switched = await app.request("/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.deepEqual((await switched.json()).editablePublicChapters, [],
      "changing approved Active X must deny a targeted edit");

    sqlite.prepare('UPDATE "user" SET "is_tos_accepted" = 0 WHERE "id" = ?').run("u_staff");
    const revoked = await app.request("/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.deepEqual((await revoked.json()).editablePublicChapters, [],
      "TOS revocation denies public edit, even for an event manager");

    // R2/SSG can still carry the public video while canonical D1 is already
    // private. Treat this mismatch as a deny, not an owner/admin edit grant.
    sqlite.prepare('UPDATE "user" SET "is_tos_accepted" = 1 WHERE "id" = ?').run("u_staff");
    sqlite.prepare('UPDATE "videos" SET "visibility_status" = ? WHERE "id" = ?')
      .run("private", "vid-pub");
    const stale = await app.request("/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.equal(stale.status, 200);
    const staleBody = await stale.json();
    assert.deepEqual(staleBody.editablePublicChapters, [],
      "canonical D1 private video must not lend edit authority via stale R2");
    assert.equal(staleBody.viewerCanEditChapters, false,
      "stale R2 public must not advertise a bulk editor after D1 private transition");
    assert.ok(staleBody.privateChapters.every((chapter) => chapter.viewerCanManage === false),
      "stale R2 public must not advertise private-row mutation controls");
  });

  test("Issue #661: normal viewer never enumerates a large public editing collection", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    const bulkNote = "あ".repeat(800);
    for (let i = 0; i < 45; i++) {
      insert(sqlite, "video_chapters", {
        id: `chap-public-large-${i}`, video_id: "vid-pub", x_user_id: "staff_x",
        chapter_time: 100 + i, chapter_label: `Chapter ${i}`, note: bulkNote,
        visibility: "public", created_at: 1000, updated_at: 1000,
      });
    }
    d1.stats.statements = 0;
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.equal(res.status, 200, "large optional edit data must not make likes/bookmarks unavailable");
    assert.equal(res.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
    const bodyText = await res.text();
    assert.ok(new TextEncoder().encode(bodyText).byteLength <= 64 * 1024);
    const body = JSON.parse(bodyText);
    assert.deepEqual(body.editablePublicChapters, [], "normal viewer must not enumerate public notes");
    assert.equal(body.loggedIn, true);
    assert.equal(body.viewerCanEditChapters, true, "bulk authorization remains independent");
    assert.equal(body.privateChapters.length, 2, "private chapter reads survive optional-edit degradation");
    assert.ok(d1.stats.statements <= 3, "size fallback may not issue another D1 statement");
    assert.ok(bulkNote.length < 1000, "the fixture uses a valid complete chapter note");
    const targeted = await app.request(
      "/api/videos/vid-pub/viewer-overlay?editChapterId=chap-public-large-44", {
        headers: { cookie: "authjs.session-token=tok-staff" },
      }, env);
    assert.equal(targeted.status, 200);
    const targetedBody = await targeted.json();
    assert.deepEqual(targetedBody.editablePublicChapters.map((c) => c.id),
      ["chap-public-large-44"], "the single-row edit read can reach beyond the large default payload");
    assert.equal(targetedBody.editablePublicChapters[0].note, bulkNote,
      "on-demand editor must return complete original note");
    assert.deepEqual(targetedBody.privateChapters, [],
      "on-demand read does not waste its byte budget on unrelated private rows");
  });

  test("Issue #661: pathological legacy note cannot leak an oversized editable one-row DTO", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    // Written directly to simulate old/unvalidated stored content, not a valid
    // SA-012 body. Do not trim it into a PUT-ready note on retrieval.
    sqlite.prepare('UPDATE "video_chapters" SET "note" = ? WHERE "id" = ?')
      .run("あ".repeat(25_000), "chap-pub");
    d1.stats.statements = 0;
    const res = await app.request(
      "/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
    assert.equal(res.status, 200, "optional oversized edit data must not break interactions");
    const body = await res.text();
    assert.ok(new TextEncoder().encode(body).byteLength <= 64 * 1024);
    const dto = JSON.parse(body);
    assert.deepEqual(dto.editablePublicChapters, [],
      "a too-large stored note must not become a truncated editable row");
    assert.deepEqual(dto.privateChapters, [], "a one-row read excludes unrelated private notes");
    assert.equal(dto.likeActive, true, "ordinary interactions remain available");
    assert.ok(d1.stats.statements <= 3);
  });

  test("Issue #661: oversized required private data returns safe 503 instead of >64KiB payload", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    for (let i = 0; i < 45; i++) {
      insert(sqlite, "video_chapters", {
        id: `chap-private-large-${i}`, video_id: "vid-pub", x_user_id: "staff_x",
        chapter_time: 100 + i, chapter_label: `Private ${i}`, note: "あ".repeat(800),
        visibility: "private", created_at: 1000, updated_at: 1000,
      });
    }
    d1.stats.statements = 0;
    const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.equal(response.status, 503, "mandatory oversized private payload cannot be serialized to client");
    assert.equal(response.headers.get("Retry-After"), "3");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
    assert.deepEqual(await response.json(), { error: "viewer_overlay_unavailable" });
    assert.ok(d1.stats.statements <= 3);
  });

  test("Issue #709: huge required private chapter label fails before oversized JSON serialization", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    const hugeChapterLabel = "非公開チャプター".repeat(18_000);
    sqlite.prepare('UPDATE "video_chapters" SET "chapter_label" = ? WHERE "id" = ?')
      .run(hugeChapterLabel, "chap-priv-alice");
    const originalStringify = JSON.stringify;
    let oversizedDtoAttempts = 0;
    JSON.stringify = function(value, replacer, space) {
      if (value && typeof value === "object" &&
          Array.isArray(value.privateChapters) &&
          value.privateChapters.some((chapter) => chapter.chapter_label === hugeChapterLabel)) {
        oversizedDtoAttempts += 1;
        throw new Error("oversized_private_chapter_dto_stringified");
      }
      return originalStringify.call(JSON, value, replacer, space);
    };
    let response;
    try {
      d1.stats.statements = 0;
      response = await app.request("/api/videos/vid-pub/viewer-overlay", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
    } finally {
      JSON.stringify = originalStringify;
    }
    assert.equal(oversizedDtoAttempts, 0,
      "large required chapter fields must fail before serializing a huge DTO");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    assert.equal(response.headers.get("Retry-After"), "3");
    assert.deepEqual(await response.json(), { error: "viewer_overlay_unavailable" });
    assert.ok(d1.stats.statements <= 3, "S2 read budget must still hold");
  });

  test("Issue #709: oversized approved active X id fails before JSON serialization", async () => {
    const { env, d1 } = setupTestEnv();
    const hugeXId = "legacy-x-".repeat(20_000);
    const userJson = JSON.stringify({
      is_tos_accepted: 1,
      terms_reaccept_required: 0,
      active_x_id: hugeXId,
      approved_x_ids: JSON.stringify([hugeXId]),
    });
    // Emulate a legacy D1 row whose approved X link violates the current
    // identifier-size expectation without modifying any live schema or data.
    const originalPrepare = env.DB.prepare.bind(env.DB);
    let intercepted = 0;
    env.DB.prepare = (sql) => {
      const stmt = originalPrepare(sql);
      if (!sql.includes("AS video_json") || !sql.includes("AS user_json")) return stmt;
      intercepted += 1;
      const originalBind = stmt.bind.bind(stmt);
      stmt.bind = (...args) => {
        const bound = originalBind(...args);
        bound.first = async () => ({ video_json: null, user_json: userJson });
        return bound;
      };
      return stmt;
    };
    const originalStringify = JSON.stringify;
    let oversizedDtoAttempts = 0;
    JSON.stringify = function(value, replacer, space) {
      if (value && typeof value === "object" && value.activeXId === hugeXId) {
        oversizedDtoAttempts += 1;
        throw new Error("oversized_active_x_dto_stringified");
      }
      return originalStringify.call(JSON, value, replacer, space);
    };
    let response;
    try {
      d1.stats.statements = 0;
      response = await app.request("/api/videos/vid-pub/viewer-overlay", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
    } finally {
      JSON.stringify = originalStringify;
    }
    assert.equal(intercepted, 1, "exercise the actual signed-in D1 user projection");
    assert.equal(oversizedDtoAttempts, 0, "do not stringify a giant mandatory identity");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    assert.equal(response.headers.get("Retry-After"), "3");
    assert.deepEqual(await response.json(), { error: "viewer_overlay_unavailable" });
    assert.ok(d1.stats.statements <= 3);
  });

  test("Issue #709: approved-X fanout is bounded to 100 plus sentinel with no authorization truncation", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    const existing = sqlite.prepare(`
      SELECT COUNT(*) AS n FROM x_user_account_links l
      INNER JOIN x_users x ON x.id = l.x_user_id
      WHERE l.auth_user_id = 'u_alice' AND x.approval_status = 'approved'
    `).get().n;
    assert.ok(existing > 0 && existing < 100, "fixture must start below the X-link budget");
    for (let n = existing; n < 100; n++) {
      const id = `approved_x_limit_${n}`;
      insert(sqlite, "x_users", { id, x_name: id, approval_status: "approved" });
      insert(sqlite, "x_user_account_links", {
        auth_user_id: "u_alice", x_user_id: id, link_role: "manager", created_at: 1000,
      });
    }

    let checkedQuery = 0;
    const originalPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql) => {
      if (sql.includes("'approved_x_ids'")) {
        checkedQuery++;
        assert.match(sql, /LIMIT 101/, "real correlated JSON subquery must cap at 100 + 1");
      }
      return originalPrepare(sql);
    };

    d1.stats.statements = 0;
    const withinBudget = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(withinBudget.status, 200, "exactly 100 links must preserve existing rights");
    const dto = await withinBudget.json();
    assert.equal(dto.activeXId, "alice_x", "current approved Active X must stay selected");
    assert.equal(dto.viewerXApproved, true, "boundary must not strip an approved X");
    assert.equal(dto.loggedIn, true);
    assert.ok(d1.stats.statements <= 3);

    const overflowId = "x_limit_overflow";
    assert.match(overflowId, /^[a-z0-9_]{1,20}$/, "overflow link must be a valid X ID");
    insert(sqlite, "x_users", { id: overflowId, x_name: overflowId, approval_status: "approved" });
    insert(sqlite, "x_user_account_links", {
      auth_user_id: "u_alice", x_user_id: overflowId, link_role: "manager", created_at: 1000,
    });
    d1.stats.statements = 0;
    const overBudget = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(overBudget.status, 503, "101 approvals must not silently truncate authorization");
    assert.equal(overBudget.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    assert.equal(overBudget.headers.get("Retry-After"), "3");
    assert.deepEqual(await overBudget.json(), { error: "viewer_overlay_unavailable" });
    assert.ok(checkedQuery >= 2, "both boundary requests must exercise the capped D1 query");
    assert.ok(d1.stats.statements <= 3, "reject must not add an extra D1 read");
  });

  test("Issue #709: legacy giant selected Active X ID is bounded at the D1 projection", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    const hugeActiveXId = "legacy_active_x_".repeat(12_000);
    // Keep the ordinary small approved alice_x linked. An invalid selected
    // legacy ID must not materialize into the signed-in auth JSON or silently
    // switch to the only approved X as a substitute for validation.
    sqlite.prepare('UPDATE "user" SET "active_x_user_id" = ? WHERE "id" = ?')
      .run(hugeActiveXId, "u_alice");

    const originalPrepare = env.DB.prepare.bind(env.DB);
    let checkedRealD1Row = false;
    env.DB.prepare = (sql) => {
      const stmt = originalPrepare(sql);
      if (!sql.includes("'approved_x_ids'")) return stmt;
      assert.ok(sql.includes('instr(u."active_x_user_id", char(0)) > 0') &&
        sql.includes('length(CAST(u."active_x_user_id" AS BLOB)) > 512'),
        "selected X ID must be NUL-safe and byte-bounded inside D1 json_object");
      const originalBind = stmt.bind.bind(stmt);
      stmt.bind = (...params) => {
        const bound = originalBind(...params);
        const originalFirst = bound.first.bind(bound);
        bound.first = async () => {
          const row = await originalFirst();
          assert.ok(row?.user_json, "must exercise the actual D1 user projection");
          checkedRealD1Row = true;
          assert.ok(Buffer.byteLength(row.user_json, "utf8") < 12_000,
            "malformed selected X ID must not inflate signed-in D1 JSON");
          assert.equal(row.user_json.includes(hugeActiveXId), false);
          const projected = JSON.parse(row.user_json);
          assert.equal(projected.invalid_active_x_id, 1);
          assert.equal(projected.active_x_id, null);
          return row;
        };
        return bound;
      };
      return stmt;
    };

    d1.stats.statements = 0;
    const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(checkedRealD1Row, true, "must execute real SQLite/Hono route");
    assert.equal(response.status, 503, "invalid selected X ID must fail closed");
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    assert.equal(response.headers.get("Retry-After"), "3");
    assert.deepEqual(await response.json(), { error: "viewer_overlay_unavailable" });
    assert.ok(d1.stats.statements <= 3, "do not issue another D1 query");
  });

  test("Issue #709: legacy giant approved X ID is not serialized into auth D1 JSON", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    const hugeLinkedId = "bad_x_".repeat(30_000);
    // A legacy TEXT primary key has no application-level shape guarantee.
    // Keep ALICE_X selected while another approved linked identity is invalid.
    insert(sqlite, "x_users", {
      id: hugeLinkedId, x_name: "Legacy malformed", approval_status: "approved",
    });
    insert(sqlite, "x_user_account_links", {
      auth_user_id: "u_alice", x_user_id: hugeLinkedId,
      link_role: "owner", created_at: 1000,
    });

    const originalPrepare = env.DB.prepare.bind(env.DB);
    let checkedActualRow = false;
    env.DB.prepare = (sql) => {
      const stmt = originalPrepare(sql);
      if (!sql.includes("'approved_x_ids'")) return stmt;
      assert.ok(sql.includes('instr(a."id", char(0)) > 0') &&
        sql.includes('length(CAST(a."id" AS BLOB)) > 512'),
        "linked X IDs must become a NUL-safe D1-side invalidity sentinel");
      const originalBind = stmt.bind.bind(stmt);
      stmt.bind = (...params) => {
        const bound = originalBind(...params);
        const originalFirst = bound.first.bind(bound);
        bound.first = async () => {
          const row = await originalFirst();
          assert.ok(row?.user_json, "the signed-in D1 projection must return a real row");
          checkedActualRow = true;
          assert.ok(Buffer.byteLength(row.user_json, "utf8") < 12_000,
            "the giant legacy ID must not be materialized into the auth JSON");
          assert.equal(row.user_json.includes(hugeLinkedId), false);
          return row;
        };
        return bound;
      };
      return stmt;
    };

    d1.stats.statements = 0;
    const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(checkedActualRow, true, "exercise the mounted D1 aggregation");
    assert.equal(response.status, 503, "legacy malformed approved links fail closed");
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    assert.equal(response.headers.get("Retry-After"), "3");
    assert.deepEqual(await response.json(), { error: "viewer_overlay_unavailable" });
    assert.ok(d1.stats.statements <= 3, "no extra D1 read for the invalid identity");
  });


  // The D1/SQLite JSON projection is inspected before Hono parses it. This
  // catches resource-budget bypasses that a final HTTP size cap cannot detect.
  function inspectFirstUserProjection(env, inspect) {
    let projections = 0;
    const originalPrepare = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql) => {
      const stmt = originalPrepare(sql);
      if (!sql.includes("'approved_x_ids'")) return stmt;
      assert.ok(sql.includes("length(CAST("), "SQL must measure full UTF-8 bytes");
      const originalBind = stmt.bind.bind(stmt);
      stmt.bind = (...params) => {
        const bound = originalBind(...params);
        const originalFirst = bound.first.bind(bound);
        bound.first = async () => {
          const row = await originalFirst();
          projections++;
          assert.ok(row?.user_json, "read the real first D1 auth projection");
          assert.ok(Buffer.byteLength(row.user_json, "utf8") < 12_000,
            "D1 user JSON must stay small even for malformed legacy IDs");
          inspect(JSON.parse(row.user_json), row.user_json);
          return row;
        };
        return bound;
      };
      return stmt;
    };
    return () => assert.equal(projections, 1, "inspect exactly one D1 user projection");
  }

  for (const [name, malformedId] of [
    ["leading NUL and 180K tail", "\u0000" + "x".repeat(180_000)],
    ["short embedded NUL", "a\u0000x"],
  ]) {
    test("Issue #715: invalid selected Active X ID (" + name + ") is rejected before D1 JSON", async () => {
      const { env, sqlite, d1 } = setupTestEnv();
      sqlite.prepare('UPDATE "user" SET "active_x_user_id" = ? WHERE "id" = ?')
        .run(malformedId, "u_alice");
      const inspected = inspectFirstUserProjection(env, (authJson, rawJson) => {
        assert.equal(authJson.active_x_id, null);
        assert.equal(authJson.invalid_active_x_id, 1,
          "NUL-bearing identities must not pass the invalidity sentinel");
        assert.equal(rawJson.includes(malformedId), false);
      });
      d1.stats.statements = 0;
      const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
      inspected();
      assert.equal(response.status, 503, "do not fall back to another approved identity");
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
      assert.equal(response.headers.get("Retry-After"), "3");
      assert.deepEqual(await response.json(), { error: "viewer_overlay_unavailable" });
      assert.ok(d1.stats.statements <= 3);
    });

    test("Issue #715: invalid linked approved X ID (" + name + ") is bounded in D1 JSON", async () => {
      const { env, sqlite, d1 } = setupTestEnv();
      insert(sqlite, "x_users", {
        id: malformedId, x_name: "Corrupt legacy link", approval_status: "approved",
      });
      insert(sqlite, "x_user_account_links", {
        auth_user_id: "u_alice", x_user_id: malformedId,
        link_role: "owner", created_at: 1000,
      });
      const inspected = inspectFirstUserProjection(env, (authJson, rawJson) => {
        assert.ok(authJson.approved_x_ids.includes(null),
          "SQL must insert a null sentinel instead of silently dropping a linked identity");
        assert.equal(rawJson.includes(malformedId), false);
      });
      d1.stats.statements = 0;
      const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
      inspected();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
      assert.equal(response.headers.get("Retry-After"), "3");
      assert.deepEqual(await response.json(), { error: "viewer_overlay_unavailable" });
      assert.ok(d1.stats.statements <= 3);
    });
  }

  test("Issue #715: 128-codepoint ASCII/Unicode identities and NULL remain valid", async () => {
    for (const validId of ["a".repeat(128), "あ".repeat(128), "😀".repeat(128)]) {
      const { env, sqlite, d1 } = setupTestEnv();
      insert(sqlite, "x_users", {
        id: validId, x_name: "Legacy valid", approval_status: "approved",
      });
      insert(sqlite, "x_user_account_links", {
        auth_user_id: "u_alice", x_user_id: validId, link_role: "owner", created_at: 1000,
      });
      sqlite.prepare('UPDATE "user" SET "active_x_user_id" = ? WHERE "id" = ?')
        .run(validId, "u_alice");
      const inspected = inspectFirstUserProjection(env, (authJson) => {
        assert.equal(authJson.active_x_id, validId);
        assert.equal(authJson.invalid_active_x_id, 0);
        assert.ok(authJson.approved_x_ids.includes(validId));
      });
      d1.stats.statements = 0;
      const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
      inspected();
      assert.equal(response.status, 200, "128 valid Unicode codepoints must retain selection");
      const dto = await response.json();
      assert.equal(dto.activeXId, validId);
      assert.equal(dto.viewerXApproved, true);
      assert.ok(d1.stats.statements <= 3);
    }

    const { env, sqlite, d1 } = setupTestEnv();
    sqlite.prepare('UPDATE "user" SET "active_x_user_id" = NULL WHERE "id" = ?')
      .run("u_alice");
    const inspected = inspectFirstUserProjection(env, (authJson) => {
      assert.equal(authJson.active_x_id, null);
      assert.equal(authJson.invalid_active_x_id, 0);
    });
    d1.stats.statements = 0;
    const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    inspected();
    assert.equal(response.status, 200);
    const multiX = await response.json();
    assert.equal(multiX.activeXId, null,
      "CURRENT never silently chooses among multiple approved X IDs when selected X is NULL");
    assert.equal(multiX.viewerXApproved, false);
    assert.ok(d1.stats.statements <= 3);

    // Exercise the distinct CURRENT fallback case: exactly one approved X.
    sqlite.prepare(
      'DELETE FROM "x_user_account_links" WHERE "auth_user_id" = ? AND "x_user_id" <> ?',
    ).run("u_alice", "alice_x");
    const approvedCount = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM "x_user_account_links" l
       INNER JOIN "x_users" x ON x."id" = l."x_user_id"
       WHERE l."auth_user_id" = ? AND x."approval_status" = 'approved'`,
    ).get("u_alice").n;
    assert.equal(approvedCount, 1, "single-approved-link control must have exactly one X");
    d1.stats.statements = 0;
    const onlyXResponse = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(onlyXResponse.status, 200);
    const singleX = await onlyXResponse.json();
    assert.equal(singleX.activeXId, "alice_x", "single approved link preserves CURRENT fallback");
    assert.equal(singleX.viewerXApproved, true);
    assert.ok(d1.stats.statements <= 3);
  });

  test("Issue #661: default public edit projection is empty; any of 125 rows can be checked on demand", async () => {
    const { env, sqlite } = setupTestEnv();
    for (let i = 0; i < 125; i++) {
      insert(sqlite, "video_chapters", {
        id: `chap-public-extra-${i}`, video_id: "vid-pub", x_user_id: "staff_x",
        chapter_time: 100 + i, chapter_label: `Extra ${i}`, note: null,
        visibility: "public", created_at: 1000, updated_at: 1000,
      });
    }
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.editablePublicChapters, [],
      "even a manager must not fetch 100 full notes before a user requests an edit");
    const targeted = await app.request(
      "/api/videos/vid-pub/viewer-overlay?editChapterId=chap-public-extra-124", {
        headers: { cookie: "authjs.session-token=tok-staff" },
      }, env);
    assert.equal(targeted.status, 200);
    const targetBody = await targeted.json();
    assert.deepEqual(targetBody.editablePublicChapters.map((row) => row.id),
      ["chap-public-extra-124"], "single-row lookup reaches the chapter beyond the first 100");
    assert.deepEqual(targetBody.privateChapters, [], "single-row lookup is resource bounded");
    const denied = await app.request(
      "/api/videos/vid-pub/viewer-overlay?editChapterId=chap-public-extra-124", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
    assert.equal(denied.status, 200);
    assert.deepEqual((await denied.json()).editablePublicChapters, [],
      "a targeted ID never overrides per-user public chapter authorization");
  });

  test("Issue #661: explicit one-row edit skips event playlist R2 reads", async () => {
    const { env } = setupTestEnv();
    const originalGet = env.BUCKET.get.bind(env.BUCKET);
    const readKeys = [];
    env.BUCKET.get = async (key) => {
      readKeys.push(key);
      return originalGet(key);
    };
    const res = await app.request(
      "/api/videos/vid-pub/viewer-overlay?playlist=evt-1&editChapterId=chap-pub", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
    assert.equal(res.status, 200);
    const dto = await res.json();
    assert.deepEqual(dto.editablePublicChapters.map((chapter) => chapter.id), ["chap-pub"]);
    assert.deepEqual(dto.playlistItems, [], "editor lookup omits unrelated event playlist");
    assert.equal(readKeys.some((key) => String(key).includes("playlist")), false,
      "single-row authorization must not fetch the event playlist artifact");
    assert.ok(readKeys.some((key) => String(key).startsWith("videos/")),
      "public video gate is still required");

    const ordinaryLibrary = await app.request(
      "/api/videos/vid-pub/viewer-overlay?playlist=lib-like", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
    assert.equal(ordinaryLibrary.status, 200);
    assert.ok((await ordinaryLibrary.json()).playlistItems.length > 0,
      "ordinary personal library behavior must remain intact");
    const targetedLibrary = await app.request(
      "/api/videos/vid-pub/viewer-overlay?playlist=lib-like&editChapterId=chap-pub", {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, env);
    assert.equal(targetedLibrary.status, 200);
    const targetedDto = await targetedLibrary.json();
    assert.deepEqual(targetedDto.editablePublicChapters.map((c) => c.id), ["chap-pub"]);
    assert.deepEqual(targetedDto.playlistItems, [],
      "targeted editor does not enumerate unrelated personal library items");

    const duplicated = await app.request(
      "/api/videos/vid-pub/viewer-overlay?editChapterId=chap-pub&editChapterId=chap-pub-staff", {
        headers: { cookie: "authjs.session-token=tok-staff" },
      }, env);
    assert.equal(duplicated.status, 200);
    assert.deepEqual((await duplicated.json()).editablePublicChapters, [],
      "ambiguous duplicate edit IDs must not select the first target");
  });

  test("Issue #661: malformed or overlong targeted ID never unlocks public editing", async () => {
    const { env } = setupTestEnv();
    for (const id of ["%20chap-pub", "chap-pub%20", "x".repeat(129)]) {
      const res = await app.request(`/api/videos/vid-pub/viewer-overlay?editChapterId=${id}`, {
        headers: { cookie: "authjs.session-token=tok-staff" },
      }, env);
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).editablePublicChapters, [],
        "an invalid targeted ID must not fall back to enumerating public editing notes");
    }
  });

  test("RH-031 selecting a different approved X must not lend owner-edit capability", async () => {
    const { env, sqlite } = setupTestEnv();
    // A linked account may read chapters from all of its approved identities,
    // but only the currently selected approved X is authorized to write its own.
    sqlite.prepare('UPDATE "user" SET "active_x_user_id" = ? WHERE "id" = ?').run("alice_y", "u_alice");
    const switched = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(switched.status, 200);
    const body = await switched.json();
    assert.equal(body.viewerXApproved, true);
    assert.equal(body.viewerCanEditChapters, false);
    assert.ok(body.privateChapters.some((chapter) => chapter.id === "chap-priv-alice"));
    assert.ok(body.privateChapters.every((chapter) => chapter.viewerCanManage === false),
      "approval of another linked X is not the active chapter owner's grant");
    assert.ok(body.privateChapters.every((chapter) => !("chapter_owner_x_id" in chapter)),
      "the owner identifier must never leave the API");
  });

  test("RH-031 switching to a second approved X revokes edit of the first identity's chapter", async () => {
    const { env, sqlite } = setupTestEnv();
    // alice owns both approved X IDs, but the chapter belongs only to alice_x.
    // A linked account is not an ownership grant for the currently selected X.
    sqlite.prepare('UPDATE "user" SET "active_x_user_id" = ? WHERE "id" = ?').run("alice_y", "u_alice");
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-alice" },
    }, env);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.activeXId, "alice_y");
    assert.equal(json.viewerCanEditChapters, false);
    assert.ok(json.privateChapters.some((chapter) => chapter.id === "chap-priv-alice"));
    assert.ok(json.privateChapters.every((chapter) => chapter.viewerCanManage === false));
    assert.ok(json.privateChapters.every((chapter) => !("chapter_owner_x_id" in chapter)));
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
    assert.equal(json.viewerCanEditChapters, false, "admin without TOS consent must not gain chapter management");
    assert.ok(json.privateChapters.every((chapter) => chapter.viewerCanManage === false), "unconsented admin cannot manage individual chapters");
    // Carol sees both alice's and staff's private chapters (member excluded)
    assert.equal(json.privateChapters.length, 2);
    const ids = json.privateChapters.map((c) => c.id);
    assert.ok(ids.includes("chap-priv-alice"));
    assert.ok(ids.includes("chap-priv-staff"));
  });

  test("RH-031 consenting admin without active approved X retains read but not write capability", async () => {
    const { env, sqlite } = setupTestEnv();
    // The shared personalSeed baseline deliberately leaves carol unconsented;
    // assert the positive admin capability only after explicit TOS acceptance.
    sqlite.prepare('UPDATE "user" SET "is_tos_accepted" = 1, "accepted_terms_version_id" = ? WHERE "id" = ?')
      .run("T2", "u_carol");
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-carol" },
    }, env);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.loggedIn, true);
    assert.equal(json.isTosAccepted, true);
    assert.equal(json.termsReacceptRequired, false);
    assert.equal(json.activeXId, null, "seed admin has no active approved X");
    assert.equal(json.viewerXApproved, false);
    assert.equal(json.viewerCanEditChapters, false,
      "admin can read private chapters but cannot write without approved active X");
    assert.ok(json.privateChapters.length > 0, "admin private read access is preserved");
    assert.ok(json.privateChapters.every((chapter) => chapter.viewerCanManage === false),
      "per-row edit capability must also require approved active X");
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
  });

  test("RH-031 consenting admin with approved active X can manage private chapters", async () => {
    const { env, sqlite } = setupTestEnv();
    // A different approved identity is necessary: admin role alone cannot
    // satisfy the chapter write guard's active-X prerequisite.
    insert(sqlite, "x_users", {
      id: "carol_x", x_name: "X carol_x", approval_status: "approved",
    });
    insert(sqlite, "x_user_account_links", {
      x_user_id: "carol_x", auth_user_id: "u_carol", link_role: "owner",
      created_at: 1_700_000_000, updated_at: 1_700_000_000,
    });
    sqlite.prepare('UPDATE "user" SET "is_tos_accepted" = 1, "accepted_terms_version_id" = ?, "active_x_user_id" = ? WHERE "id" = ?')
      .run("T2", "carol_x", "u_carol");
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-carol" },
    }, env);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.activeXId, "carol_x");
    assert.equal(json.viewerXApproved, true);
    assert.equal(json.viewerCanEditChapters, true,
      "consented admin with approved active X may perform chapter writes");
    assert.equal(json.privateChapters.length, 2);
    assert.ok(json.privateChapters.every((chapter) => chapter.viewerCanManage === true),
      "admin's already-authorized private chapter rows remain editable");
    assert.ok(json.privateChapters.every((chapter) => !("chapter_owner_x_id" in chapter)),
      "the response must not leak chapter owner X IDs");
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
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
    assert.equal(json.viewerCanEditChapters, true, "event staff chapter management");
    assert.ok(json.privateChapters.every((chapter) => chapter.viewerCanManage === true), "staff may manage authorized private chapters");
    // Staff user has manager preset on evt-1 -> canAdministerChapters allows seeing all private chapters
    assert.equal(json.privateChapters.length, 2);
    const ids = json.privateChapters.map((c) => c.id);
    assert.ok(ids.includes("chap-priv-alice"));
    assert.ok(ids.includes("chap-priv-staff"));
  });

  test("RH-031 chapter management capability fails closed when terms are not accepted", async () => {
    const { env, sqlite } = setupTestEnv();
    // An event manager would normally obtain this capability. With revoked TOS,
    // the API must not allow the viewer client to render privileged controls.
    sqlite.prepare('UPDATE "user" SET "is_tos_accepted" = 0 WHERE "id" = ?').run("u_staff");
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.loggedIn, true);
    assert.equal(json.isTosAccepted, false);
    assert.equal(json.viewerCanEditChapters, false);
    assert.ok(json.privateChapters.length > 0, "permission test must include private chapter rows");
    assert.ok(json.privateChapters.every((chapter) => chapter.viewerCanManage === false),
      "TOS revocation must deny all per-chapter edit permissions too");
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
  });

  test("RH-031 banned approved chapter manager cannot receive read or write capabilities", async () => {
    const { env, sqlite, d1 } = setupTestEnv();
    // Staff is a positive approved-X manager in the unbanned fixture. Explicit
    // ban must override every write grant and prevent loading private chapters.
    sqlite.prepare('UPDATE "user" SET "is_banned" = 1 WHERE "id" = ?').run("u_staff");
    d1.stats.statements = 0;
    const response = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.loggedIn, true);
    assert.equal(json.isBanned, true);
    assert.equal(json.viewerCanEditChapters, false);
    assert.deepEqual(json.privateChapters, []);
    assert.equal(json.likeActive, false);
    assert.equal(json.bookmarkActive, false);
    assert.equal(d1.stats.statements, 2, "banned staff must not run the private-data read");
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
  });

  test("RH-031 chapter management capability fails closed without a working DB binding", async () => {
    const { env } = setupTestEnv();
    // Session resolution and viewer permissions must not fall back to privileged
    // defaults when the signed-in request cannot read D1.
    env.DB = undefined;
    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-staff" },
    }, env);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.authUnavailable, true);
    assert.equal(json.viewerCanEditChapters, false);
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(json).success, true);
  });

  test("T06: RH-031 banned user returns isBanned: true and only the viewer read", async () => {
    const { env, d1 } = setupTestEnv();
    d1.stats.statements = 0;

    const res = await app.request("/api/videos/vid-pub/viewer-overlay", {
      headers: { cookie: "authjs.session-token=tok-banned" },
    }, env);

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.loggedIn, true);
    assert.equal(json.isBanned, true);
    assert.equal(json.viewerCanEditChapters, false);
    assert.equal(json.likeActive, false);
    assert.equal(json.bookmarkActive, false);
    assert.deepEqual(json.privateChapters, []);
    assert.equal(json.viewerCanEditChapters, false, "banned user has no bulk-management capability");

    // Session + the viewer read (CURRENT reports the banned viewer's terms state and active X):
    // no chapter / interaction read.
    assert.equal(d1.stats.statements, 2);
    assert.equal(json.isTosAccepted, true);
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

  test("RH-031: D1 provider exceptions are redacted without changing degraded HTTP semantics", async () => {
    // Provider errors can embed bound SQL parameters, credentials or a nested
    // cause. Test both the first (identity) and second (private data) queries.
    const privateCanary = "RH031_PRIVATE_PROVIDER_ERROR_SECRET_20261122";
    assert.ok(inspect(new Error(privateCanary)).includes(privateCanary),
      "test sink must expose Error.message if provider exceptions are logged");
    for (const [caseName, marker, expectedLoggedIn] of [
      ["first D1 projection", "'approved_x_ids'", false],
      ["second D1 projection", "AS chapters_json", true],
    ]) {
      const { env, d1 } = setupTestEnv();
      const originalPrepare = env.DB.prepare.bind(env.DB);
      let injected = 0;
      env.DB.prepare = (sql) => {
        if (String(sql).includes(marker)) {
          injected += 1;
          throw new Error("D1 statement leaked " + privateCanary, {
            cause: new Error("nested provider credentials: " + privateCanary),
          });
        }
        return originalPrepare(sql);
      };

      const captured = [];
      const originalError = console.error;
      console.error = (...args) => captured.push(args.map((arg) =>
        inspect(arg, { depth: 6 })).join(" "));
      let response;
      try {
        response = await app.request("/api/videos/vid-pub/viewer-overlay", {
          headers: { cookie: "authjs.session-token=tok-alice" },
        }, env);
      } finally {
        console.error = originalError;
      }

      assert.equal(injected, 1, caseName + ": test must hit the actual route SQL");
      assert.equal(response.status, 200, caseName + ": CURRENT degraded status");
      assert.equal(response.headers.get("Cache-Control"),
        "private, no-store, no-cache, must-revalidate");
      const body = await response.json();
      assert.equal(VideoViewerOverlayResponseSchema.safeParse(body).success, true);
      assert.equal(body.loggedIn, expectedLoggedIn);
      assert.equal(body.authUnavailable, true);
      assert.equal(body.viewerCanEditChapters, false);
      assert.deepEqual(body.privateChapters, []);
      assert.ok(d1.stats.statements <= 3, caseName + ": never add a D1 read");
      assert.ok(captured.some((line) => line.includes("[video-viewer-overlay]") &&
        line.includes("provider_error")), caseName + ": emit fixed diagnostics");
      assert.ok(!captured.join("\n").includes(privateCanary),
        caseName + ": no provider error/cause in logs");
    }
  });

  test("Issue #709: valid 300K-char playlist never serializes an oversized viewer DTO", async () => {
    const { env, bucket, d1 } = setupTestEnv();
    const hugeTitle = "Very long valid public title ".repeat(12_000);
    const artifact = {
      schema_version: 1, generated_at: 1000, event_id: "evt-1",
      complete: true, items: [
        { id: "vid-pub", title: hugeTitle, youtube_video_id: "yt_pub", display_name: "Alice" },
        { id: "vid-other", title: "Other", youtube_video_id: "yt_other", display_name: "Bob" },
      ],
    };
    const artifactJson = JSON.stringify(artifact);
    assert.ok(Buffer.byteLength(artifactJson, "utf8") > 64 * 1024);
    assert.ok(Buffer.byteLength(artifactJson, "utf8") < 8 * 1024 * 1024,
      "test must use a schema-valid R2 object below its 8MiB read cap");
    await bucket.put("events/evt-1/playlist.v1.json", artifactJson);

    // Fail the mounted HTTP request if any implementation tries to stringify
    // the full ~300K-char playlist DTO; JSON.stringify can still be used for
    // the small, bounded response and framework-internal objects.
    const originalStringify = JSON.stringify;
    let oversizedDtoAttempts = 0;
    JSON.stringify = function(value, replacer, space) {
      if (value && typeof value === "object" &&
          Array.isArray(value.playlistItems) &&
          value.playlistItems.some((item) => item?.title === hugeTitle)) {
        oversizedDtoAttempts += 1;
        throw new Error("oversized_viewer_dto_was_stringified");
      }
      return originalStringify.call(JSON, value, replacer, space);
    };
    let response;
    try {
      d1.stats.statements = 0;
      response = await app.request(
        "/api/videos/vid-pub/viewer-overlay?playlist=evt-1", {}, env);
    } finally {
      JSON.stringify = originalStringify;
    }
    assert.equal(oversizedDtoAttempts, 0,
      "preflight must skip the large DTO before calling JSON.stringify");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    const raw = await response.text();
    assert.ok(Buffer.byteLength(raw, "utf8") <= 64 * 1024);
    const dto = JSON.parse(raw);
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(dto).success, true);
    assert.deepEqual(dto.playlistItems, []);
    assert.equal(dto.playlistLabel, "再生リスト");
    assert.equal(dto.authUnavailable, false);
    assert.equal(d1.stats.statements, 0, "anonymous path should perform 0 D1 reads");
  });

  test("Issue #709: a huge public event playlist label is rejected before DTO serialization", async () => {
    const { env, bucket, d1 } = setupTestEnv();
    const hugeEventTitle = "公開イベント".repeat(25_000);
    const hugeLabel = hugeEventTitle + " 上映順";
    const storedVideo = await (await bucket.get("videos/vid-pub.json")).json();
    storedVideo.public_events[0].title = hugeEventTitle;
    await bucket.put("videos/vid-pub.json", JSON.stringify(storedVideo));
    // The event playlist itself has only two small, schema-valid entries.
    // Previously a long *label* alone bypassed the pre-stringify guard.
    const originalStringify = JSON.stringify;
    let hugeDtoAttempts = 0;
    JSON.stringify = function(value, replacer, space) {
      if (value && typeof value === "object" && value.playlistLabel === hugeLabel) {
        hugeDtoAttempts += 1;
        throw new Error("huge_playlist_label_dto_stringified");
      }
      return originalStringify.call(JSON, value, replacer, space);
    };
    let response;
    try {
      d1.stats.statements = 0;
      response = await app.request("/api/videos/vid-pub/viewer-overlay?playlist=evt-1", {}, env);
    } finally {
      JSON.stringify = originalStringify;
    }
    assert.equal(hugeDtoAttempts, 0, "do not serialize the oversized event label");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    const raw = await response.text();
    assert.ok(Buffer.byteLength(raw, "utf8") <= 64 * 1024);
    const dto = JSON.parse(raw);
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(dto).success, true);
    assert.equal(dto.playlistLabel, "再生リスト");
    assert.deepEqual(dto.playlistItems, [], "small playlist is an optional fallback when label is huge");
    assert.equal(d1.stats.statements, 0, "anonymous response must not add any D1 reads");
  });

  test("Issue #709: UTF-8 can exceed 64KiB even when JSON has fewer than 64K UTF-16 units", async () => {
    const { env, bucket, d1 } = setupTestEnv();
    const artifact = {
      schema_version: 1, generated_at: 1000, event_id: "evt-1", complete: true,
      items: Array.from({ length: 160 }, (_, i) => ({
        id: "utf8-video-" + i, title: "あ".repeat(150),
        youtube_video_id: "yt_" + i, display_name: "Bob",
      })),
    };
    const artifactJson = JSON.stringify(artifact);
    assert.ok(artifactJson.length < 64 * 1024, "UTF-16 units are under the budget");
    assert.ok(Buffer.byteLength(artifactJson, "utf8") > 64 * 1024,
      "UTF-8 bytes exceed the same budget for valid Japanese titles");
    await bucket.put("events/evt-1/playlist.v1.json", artifactJson);
    d1.stats.statements = 0;
    const response = await app.request(
      "/api/videos/vid-pub/viewer-overlay?playlist=evt-1", {}, env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    const jsonText = await response.text();
    assert.ok(Buffer.byteLength(jsonText, "utf8") <= 64 * 1024,
      "byte budget must not be approximated using JavaScript string.length");
    const dto = JSON.parse(jsonText);
    assert.equal(VideoViewerOverlayResponseSchema.safeParse(dto).success, true);
    assert.deepEqual(dto.playlistItems, [], "oversized Japanese playlist must be omitted");
    assert.equal(dto.playlistLabel, "再生リスト");
    assert.equal(d1.stats.statements, 0, "anonymous public viewer must not query D1");
  });

  test("Issue #709: 500 valid multibyte public playlist rows stay <=64KiB on every RH-031 early-return", async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: "large-video-" + i,
      title: "あ".repeat(120),
      youtube_video_id: "yt_" + i,
      display_name: "表示名".repeat(40),
    }));
    const artifact = {
      schema_version: 1, generated_at: 1000, event_id: "evt-1",
      complete: true, items,
    };
    assert.ok(Buffer.byteLength(JSON.stringify(artifact), "utf8") > 64 * 1024,
      "a valid complete 500-item artifact must exceed the S2 byte ceiling");

    const cases = [
      "static-only", "anonymous", "session-unavailable", "missing-user-row",
      "banned", "db-read-degraded", "authenticated",
    ];
    for (const name of cases) {
      const { env, bucket, d1 } = setupTestEnv();
      await bucket.put("events/evt-1/playlist.v1.json", JSON.stringify(artifact));
      const headers = ["session-unavailable", "missing-user-row", "db-read-degraded", "authenticated"].includes(name)
        ? { cookie: "authjs.session-token=tok-alice" }
        : name === "banned" ? { cookie: "authjs.session-token=tok-banned" } : {};
      if (name === "static-only") env.FORCE_STATIC_ONLY = "1";
      if (name === "session-unavailable") env.DB = undefined;
      let intercepted = 0;
      if (name === "missing-user-row" || name === "db-read-degraded") {
        const originalPrepare = env.DB.prepare.bind(env.DB);
        env.DB.prepare = (sql) => {
          const stmt = originalPrepare(sql);
          const match = name === "missing-user-row"
            ? sql.includes("AS video_json") && sql.includes("AS user_json")
            : sql.includes("AS interactions_json");
          if (!match) return stmt;
          intercepted += 1;
          const originalBind = stmt.bind.bind(stmt);
          stmt.bind = (...args) => {
            const bound = originalBind(...args);
            bound.first = name === "missing-user-row"
              ? async () => ({ video_json: null, user_json: null })
              : async () => { throw new Error("injected D1 read failure"); };
            return bound;
          };
          return stmt;
        };
      }

      d1.stats.statements = 0;
      const response = await app.request(
        "/api/videos/vid-pub/viewer-overlay?playlist=evt-1", { headers }, env);
      const raw = await response.text();
      assert.equal(response.status, 200, name);
      assert.ok(Buffer.byteLength(raw, "utf8") <= 64 * 1024,
        name + ": actual HTTP UTF-8 response exceeds S2 64KiB");
      assert.equal(response.headers.get("Cache-Control"),
        "private, no-store, no-cache, must-revalidate", name);
      const dto = JSON.parse(raw);
      assert.equal(VideoViewerOverlayResponseSchema.safeParse(dto).success, true, name);
      assert.deepEqual(dto.playlistItems, [], name + ": oversized optional playlist must be removed");
      assert.equal(dto.playlistLabel, "再生リスト", name);
      assert.deepEqual(dto.editablePublicChapters, [], name + ": no unauthorized public editor");
      if (name === "static-only" || name === "anonymous") {
        assert.equal(d1.stats.statements, 0, name + ": no D1 read required");
        assert.equal(dto.loggedIn, false, name);
      }
      if (name === "session-unavailable" || name === "db-read-degraded")
        assert.equal(dto.authUnavailable, true, name);
      if (name === "banned") {
        assert.equal(dto.isBanned, true);
        assert.equal(dto.viewerCanEditChapters, false);
      }
      if (name === "authenticated") {
        assert.equal(dto.loggedIn, true);
        assert.ok(dto.privateChapters.length > 0, "required private chapter DTO survives playlist drop");
      }
      if (name === "missing-user-row" || name === "db-read-degraded")
        assert.equal(intercepted, 1, name + ": must hit the intended D1 failure branch");
      assert.ok(d1.stats.statements <= 3, name + ": S2 D1 read budget");
    }
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

  // T06 parity: the real CURRENT route handler (app/api/videos/[id]/viewer-overlay/route.ts) and the Hono
  // route answer the same request over the same D1 / R2, response by response.
  async function current(id, user, query = "") {
    const ctx = setupTestEnv();
    ctx.pubRef.session = user ? { user: { id: `u_${user}` } } : null;
    const response = await currentViewerOverlayGet(
      new Request(`https://x.test/api/videos/${id}/viewer-overlay${query}`),
      { params: Promise.resolve({ id }) },
    );
    return { status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json() };
  }

  async function hono(id, user, query = "") {
    const ctx = setupTestEnv();
    ctx.d1.stats.statements = 0;
    const headers = user ? { cookie: `authjs.session-token=tok-${user}` } : {};
    const response = await app.request(`/api/videos/${id}/viewer-overlay${query}`, { headers }, ctx.env);
    return {
      status: response.status,
      cache: response.headers.get("Cache-Control"),
      body: await response.json(),
      statements: ctx.d1.stats.statements,
      writes: ctx.d1.stats.writes,
    };
  }

  test("T06 parity: every viewer x playlist matches CURRENT (DTO, status, headers)", async () => {
    // anon, normal user with approved X (alice), no X (bob), admin without X (carol), only a rejected X as
    // active (dave), one approved X but no active X (ivy), event staff, banned.
    const users = [null, "alice", "bob", "carol", "dave", "ivy", "staff", "banned"];
    const queries = ["", "?playlist=evt-1", "?playlist=lib-like", "?playlist=lib-bookmark", "?playlist=evt.1"];
    for (const user of users) {
      for (const query of queries) {
        const cur = await current("vid-pub", user, query);
        const got = await hono("vid-pub", user, query);
        const label = `${user ?? "anon"} ${query || "(no playlist)"}`;
        assert.equal(got.status, cur.status, label);
        assert.equal(got.cache, cur.cache, label);
        const { viewerCanEditChapters, editablePublicChapters, ...honoLegacyDto } = got.body;
        assert.equal(typeof viewerCanEditChapters, "boolean", `${label}: capability must be explicit`);
        assert.ok(Array.isArray(editablePublicChapters), `${label}: public edit projection exists`);
        assert.ok(editablePublicChapters.every((row) => row.viewerCanManage === true &&
          !("chapter_owner_x_id" in row)), `${label}: public edit DTO must not leak owner ids`);
        // Compare all CURRENT fields, stripping only Hono's additive capability bits.
        const legacyPrivate = honoLegacyDto.privateChapters.map(({ viewerCanManage, ...chapter }) => {
          assert.equal(typeof viewerCanManage, "boolean", `${label}: per-chapter permission explicit`);
          assert.equal("chapter_owner_x_id" in chapter, false, `${label}: owner ID must not leak`);
          return chapter;
        });
        assert.deepEqual({ ...honoLegacyDto, privateChapters: legacyPrivate }, cur.body, label);
        assert.equal(VideoViewerOverlayResponseSchema.safeParse(got.body).success, true, label);
        // T08: session + 2 statements at most, never a write
        assert.ok(got.statements <= 3, `${label}: ${got.statements} statements`);
        assert.equal(got.writes, 0, label);
      }
    }
    for (const id of ["vid-priv"]) {
      const cur = await current(id, "alice");
      const got = await hono(id, "alice");
      assert.equal(got.status, cur.status, id);
      assert.equal(got.cache, cur.cache, id);
      assert.deepEqual(got.body, cur.body, id);
    }
  });

  test("T08: artifact gate runs before the session lookup (signed-in 404 / 503 read no D1)", async () => {
    for (const [id, status] of [["vid-priv", 404], ["vid-missing", 503]]) {
      const ctx = setupTestEnv();
      ctx.d1.stats.statements = 0;
      const res = await app.request(`/api/videos/${id}/viewer-overlay`, {
        headers: { cookie: "authjs.session-token=tok-alice" },
      }, ctx.env);
      assert.equal(res.status, status, id);
      assert.equal(res.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate", id);
      assert.equal(ctx.d1.stats.statements, 0, id);
    }
  });

  // CURRENT answers an artifact miss through loadStaticVideoDetail's degradedFetcher (D1): a YouTube id or
  // a video whose artifact is missing gets 200, an unknown id 404. D-13-46 removes that D1 fallback.
  test("T06 DOCUMENTED DIFFERENCE D-13-46: artifact miss -> CURRENT degraded D1 (200 / 404), Hono 503", async () => {
    for (const [id, currentStatus] of [["vid-missing", 404], ["yt_pub", 200]]) {
      const cur = await current(id, "alice");
      assert.equal(cur.status, currentStatus, id);
      const ctx = setupTestEnv();
      ctx.d1.stats.statements = 0;
      const res = await app.request(`/api/videos/${id}/viewer-overlay`, {}, ctx.env);
      assert.equal(res.status, 503, id);
      assert.equal(res.headers.get("Retry-After"), "3", id);
      assert.deepEqual(await res.json(), { error: "viewer_overlay_unavailable" }, id);
      assert.equal(ctx.d1.stats.statements, 0, id);
    }
  });
}

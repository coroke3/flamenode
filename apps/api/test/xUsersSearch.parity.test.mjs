import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";

// RH-019 CURRENT-vs-target route contract, without touching the app.ts mount
// owned by another PR. The Hono route is mounted on the same URL in this test.
if (runUnderRootTsx(import.meta.url)) {
  const { Hono } = await import("hono");
  const { xUsersSearchRoutes } = await import("../src/routes/internal/xUsersSearch.ts");
  const { searchMemberSuggestions } = await import("../../../src/lib/video/memberSuggestionSearch.ts");
  const {
    buildMemberSuggestionArtifacts,
    MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
    memberSuggestionsIndexObjectKey,
  } = await import("../../../src/lib/video/memberSuggestionsCore.ts");
  const {
    buildMemberSuggestionsV2Artifacts,
    memberSuggestionPostingBucket,
    MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
    memberSuggestionsV2DirectoryObjectKey,
    memberSuggestionsV2PageObjectKey,
  } = await import("../../../src/lib/video/memberSuggestionsPostingsV2.ts");
  const { resetMemberSuggestionsCacheForTest } = await import("../../../packages/server-core/src/memberSuggestion/loader.ts");
  const { resetMemberSuggestionsV2CacheForTest } = await import("../../../packages/server-core/src/memberSuggestion/v2Loader.ts");

  // Import the real Next RH-019 handler under controlled Auth/Cloudflare ports.
  // The source ranking/loaders remain the actual CURRENT implementation.
  const { registerHooks } = await import("node:module");
  const asStub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
  const legacyGuardStub = asStub(
    "export async function requireRouteUser() { return globalThis.__mig0648LegacyTest.guard; }"
  );
  const legacyEnvStub = asStub(
    "export function getEnv() { return globalThis.__mig0648LegacyTest.env; }"
  );
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/auth/routeGuard") {
        return { url: legacyGuardStub, shortCircuit: true };
      }
      if (specifier === "@/lib/cloudflare") {
        return { url: legacyEnvStub, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const { GET: legacyGET } = await import("../../../app/api/internal/x-users/search/route.ts");
  const {
    resetMemberSuggestionsCacheForTest: resetLegacyV1,
  } = await import("../../../src/lib/video/memberSuggestionsLoader.ts");
  const {
    resetMemberSuggestionsV2CacheForTest: resetLegacyV2,
  } = await import("../../../src/lib/video/memberSuggestionsV2Loader.ts");

  const URL_BASE = "https://flamenode.example/api/internal/x-users/search";
  const COOKIE = "__Secure-authjs.session-token=test-session-token";
  const REFINE_HINT = "候補が多いため、名前またはX IDを追加で入力してください。";
  const members = [
    { x_user_id: "alice", name: "Alice", xAliases: [], nameAliases: [], occurrenceCount: 0, lastSeenAt: null, approvalStatus: "approved" },
    { x_user_id: "alice_artist", name: "Popular Alice", xAliases: [], nameAliases: ["あいりす"], occurrenceCount: 10, lastSeenAt: null, approvalStatus: "approved" },
    { x_user_id: "alice_pending", name: "Alice Pending", xAliases: [], nameAliases: [], occurrenceCount: 2, lastSeenAt: null, approvalStatus: "pending" },
    { x_user_id: "mochi", name: "モチ", xAliases: ["mochi_old"], nameAliases: ["もち"], occurrenceCount: 0, lastSeenAt: null, approvalStatus: "approved" },
  ];

  function artifacts() {
    const generation = "golden-rh-019";
    const generatedAt = 1800000000;
    const v1 = buildMemberSuggestionArtifacts({ items: members, generation, generatedAt });
    const v2 = buildMemberSuggestionsV2Artifacts({ items: members, generation, generatedAt });
    const map = new Map([
      [MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, v1.manifest],
      [memberSuggestionsIndexObjectKey(generation), v1.index],
      [MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY, v2.manifest],
    ]);
    for (const { bucket, directory } of v2.directories) {
      map.set(memberSuggestionsV2DirectoryObjectKey(generation, bucket), directory);
    }
    for (const { bucket, page } of v2.pages) {
      map.set(memberSuggestionsV2PageObjectKey(generation, bucket, page.page), page);
    }
    return map;
  }

  /** Well-formed v1/v2 commit points with an over-budget posting directory.
   * No page objects are needed: the 9-page guard must reject before any page GET.
   */
  function pageBudgetExceededArtifacts() {
    const objects = artifacts();
    const generation = "golden-rh-019";
    const gram = "aa";
    const bucketId = memberSuggestionPostingBucket(gram);
    const v1 = objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
    const v2 = objects.get(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
    objects.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, { ...v1, total: 2000 });
    objects.set(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY, { ...v2, total: 2000 });
    objects.set(memberSuggestionsV2DirectoryObjectKey(generation, bucketId), {
      schema_version: 1,
      generation,
      bucket: bucketId,
      grams: { [gram]: { pages: [1, 2, 3, 4, 5, 6, 7, 8, 9], total: 2000 } },
    });
    return objects;
  }

  function makeEnv({ banned = false, userFound = true, dbFailure = false, noBucket = false, throwBucketGetter = false, noDb = false, objects = artifacts() } = {}) {
    const stats = { reads: 0, sql: [], gets: [], writes: 0 };
    const DB = {
      prepare(sql) {
        stats.sql.push(sql);
        if (!/^\s*SELECT/i.test(sql)) stats.writes++;
        return {
          bind(sessionToken) {
            assert.equal(sessionToken, "test-session-token");
            return {
              async first() {
                stats.reads++;
                if (dbFailure) throw new Error("secret-db-message-not-for-client");
                if (!userFound) return null;
                return {
                  session_expires: Date.now() + 3600_000,
                  user_id: "user-1",
                  user_name: "User",
                  user_email: null,
                  user_image: null,
                  user_role: "user",
                  user_is_banned: banned ? 1 : 0,
                  user_active_x_user_id: null,
                };
              },
            };
          },
        };
      },
    };
    const BUCKET = {
      async get(key) {
        stats.gets.push(key);
        const value = objects.get(key);
        if (value === undefined) return null;
        const serialized = JSON.stringify(value);
        return {
          size: Buffer.byteLength(serialized, "utf8"),
          body: { async cancel() {} },
          async json() { return JSON.parse(serialized); },
        };
      },
    };
    const env = { ...(noDb ? {} : { DB }), ...(noBucket ? {} : { BUCKET }) };
    if (throwBucketGetter) {
      Object.defineProperty(env, "BUCKET", {
        get() { throw new Error("R2_BINDING_ACCESS_FAILURE_DO_NOT_EXPOSE"); },
        configurable: true,
      });
    }
    return { env, stats, objects };
  }

  async function request(path, options = {}) {
    resetMemberSuggestionsCacheForTest();
    resetMemberSuggestionsV2CacheForTest();
    const app = new Hono();
    app.route("/api/internal/x-users/search", xUsersSearchRoutes);
    const { env, stats } = makeEnv(options);
    const response = await app.request(URL_BASE + path, {
      headers: options.anonymous ? {} : { Cookie: COOKIE },
    }, env);
    return { response, body: await response.json(), stats };
  }

  function verifyPrivate(response, unavailable = false) {
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
    assert.equal(response.headers.get("Pragma"), "no-cache");
    assert.equal(response.headers.get("Expires"), "0");
    assert.equal(response.headers.get("Retry-After"), unavailable ? "3" : null);
  }

  test("T01: anonymous, expired, banned and unavailable sessions preserve CURRENT guard codes", async () => {
    const anonymous = await request("?q=alice", { anonymous: true });
    assert.equal(anonymous.response.status, 401);
    assert.deepEqual(anonymous.body, { error: "unauthorized" });
    verifyPrivate(anonymous.response);
    assert.equal(anonymous.stats.reads, 0);
    assert.equal(anonymous.stats.gets.length, 0);

    const expired = await request("?q=alice", { userFound: false });
    assert.equal(expired.response.status, 401);
    assert.deepEqual(expired.body, { error: "unauthorized" });
    assert.equal(expired.stats.reads, 1);
    assert.equal(expired.stats.gets.length, 0);

    const banned = await request("?q=alice", { banned: true });
    assert.equal(banned.response.status, 403);
    assert.deepEqual(banned.body, { error: "account_disabled" });
    assert.equal(banned.stats.reads, 1);
    assert.equal(banned.stats.gets.length, 0);

    for (const options of [{ dbFailure: true }, { noDb: true }]) {
      const unavailable = await request("?q=alice", options);
      assert.equal(unavailable.response.status, 503);
      assert.deepEqual(unavailable.body, { error: "database_unavailable" });
      verifyPrivate(unavailable.response);
      assert.equal(unavailable.stats.gets.length, 0);
    }
  });

  test("T02: empty/one-character queries return exact CURRENT envelopes without R2 reads", async () => {
    for (const [path, hint] of [["", null], ["?q=@", "search_too_short"], ["?q=%EF%BC%A1", "search_too_short"]]) {
      const { response, body, stats } = await request(path);
      assert.equal(response.status, 200);
      verifyPrivate(response);
      assert.deepEqual(body, {
        items: [], query: path ? new URL(URL_BASE + path).searchParams.get("q") ?? "" : "",
        limit: 20, offset: 0, nextOffset: null, hasMore: false, hint,
      });
      assert.equal(stats.reads, 1);
      assert.equal(stats.gets.length, 0);
    }
  });

  test("T02/T04: two-character V2 query matches CURRENT ranking, DTO and one D1 statement", async () => {
    const { response, body, stats } = await request("?q=al&limit=2&offset=0&onlyApproved=1");
    assert.equal(response.status, 200);
    verifyPrivate(response);
    assert.equal(body.source, "v2");
    const current = searchMemberSuggestions(members, { query: "al", limit: 2, offset: 0, onlyApproved: true });
    assert.deepEqual(body.items, current.items.map((item) => ({
      id: item.x_user_id, x_name: item.name, score: item.score, matchedBy: item.matchedBy,
    })));
    assert.equal(body.nextOffset, current.nextOffset);
    assert.equal(body.hasMore, current.hasMore);
    assert.equal(body.hint, current.hasMore ? REFINE_HINT : null);
    assert.equal(stats.reads, 1);
    assert.equal(stats.sql.length, 1);
    assert.equal(stats.writes, 0);
    assert.ok(stats.gets.every((key) => key.startsWith("internal/member-suggestions/")));
  });

  test("T02: longer queries use V1 compatibility ranking and preserve paging/parameters", async () => {
    const { response, body, stats } = await request("?q=alice&limit=20&offset=1");
    assert.equal(response.status, 200);
    verifyPrivate(response);
    assert.equal(body.source, "v1");
    const current = searchMemberSuggestions(members, { query: "alice", limit: 20, offset: 1 });
    assert.deepEqual(body.items, current.items.map((item) => ({
      id: item.x_user_id, x_name: item.name, score: item.score, matchedBy: item.matchedBy,
    })));
    assert.equal(body.nextOffset, current.nextOffset);
    assert.equal(body.hasMore, current.hasMore);
    assert.equal(stats.reads, 1);
    assert.ok(stats.gets.some((key) => key.endsWith("/index.json")));
  });

  test("T02: malformed/bounded numeric params and 64-character query truncation remain compatible", async () => {
    const { body } = await request("?q=al&limit=-1&offset=not-a-number");
    assert.equal(body.limit, 20);
    assert.equal(body.offset, 0);

    const over = await request("?q=al&limit=99999999&offset=99999999");
    assert.equal(over.body.limit, 50);
    assert.equal(over.body.offset, 5000);

    const long = await request("?q=" + "a".repeat(80));
    assert.equal(long.body.query, "a".repeat(64));
    assert.ok(["v1", "v2"].includes(long.body.source));
  });

  test("T03: V2 posting page budget exceeds eight pages -> query refinement without partial ranking", async () => {
    const { response, body, stats } = await request("?q=aa&limit=2&offset=1", {
      objects: pageBudgetExceededArtifacts(),
    });
    assert.equal(response.status, 200);
    verifyPrivate(response);
    assert.deepEqual(body, {
      items: [],
      query: "aa",
      limit: 2,
      offset: 1,
      nextOffset: null,
      hasMore: true,
      hint: REFINE_HINT,
      source: "v2",
    });
    assert.equal(stats.reads, 1);
    assert.equal(stats.writes, 0);
    assert.equal(stats.gets.length, 3, "read canonical + V2 manifest + directory, never page or V1 fallback");
    assert.ok(!stats.gets.some((key) => key.endsWith("/index.json")));
  });

  test("T03: missing V1 and V2 artifacts or bucket binding return CURRENT retryable 503", async () => {
    for (const options of [{ objects: new Map() }, { noBucket: true }, { throwBucketGetter: true }]) {
      const { response, body, stats } = await request("?q=alice", options);
      assert.equal(response.status, 503);
      assert.deepEqual(body, { error: "suggestions_unavailable" });
      verifyPrivate(response, true);
      assert.equal(stats.reads, 1);
      assert.equal(stats.writes, 0);
    }
  });

  test("T03: missing V2 commit point safely falls back to valid V1 index", async () => {
    const objects = artifacts();
    objects.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
    const { response, body, stats } = await request("?q=alice", { objects });
    assert.equal(response.status, 200);
    assert.equal(body.source, "v1");
    assert.ok(body.items.some((x) => x.id === "alice"));
    verifyPrivate(response);
    assert.equal(stats.reads, 1);
  });
  test("RH-019 full HTTP golden: Next CURRENT and Hono adapter match status, body, cache and R2 keys", async () => {
    const testCases = [
      { path: "", note: "empty" },
      { path: "?q=a", note: "short" },
      { path: "?q=al&limit=2&onlyApproved=1", note: "V2" },
      { path: "?q=alice&limit=20&offset=1", note: "V1 fuzzy/pagination compatibility fallback" },
      { path: "?q=alice&limit=0&offset=bad", note: "bounded params" },
      { path: "?q=%E3%82%82%E3%81%A1", note: "Unicode" },
      { path: "?q=al", guard: { ok: false, status: 401, error: "unauthorized" }, anonymous: true, note: "401" },
      { path: "?q=al", guard: { ok: false, status: 403, error: "account_disabled" }, banned: true, note: "403" },
      { path: "?q=al", guard: { ok: false, status: 503, error: "database_unavailable" }, dbFailure: true, note: "auth 503" },
      { path: "?q=aa&limit=2&offset=1", budgetExceeded: true, note: "V2 over-budget refine without V1" },
      { path: "?q=alice", missingArtifacts: true, note: "missing artifacts 503" },
      { path: "?q=alice", noBucket: true, note: "no bucket 503" },
      { path: "?q=alice", throwBucketGetter: true, note: "R2 getter throws 503, no secret leak" },
    ];
    for (const entry of testCases) {
      const objects = entry.missingArtifacts
        ? new Map()
        : entry.budgetExceeded ? pageBudgetExceededArtifacts() : artifacts();
      const legacy = makeEnv({ objects, noBucket: entry.noBucket, throwBucketGetter: entry.throwBucketGetter });
      const guard = entry.guard ?? { ok: true, user: { id: "user-1", is_banned: 0 } };
      resetLegacyV1();
      resetLegacyV2();
      globalThis.__mig0648LegacyTest = { guard, env: legacy.env };
      let current;
      try {
        const response = await legacyGET(new Request(URL_BASE + entry.path));
        current = {
          status: response.status,
          body: await response.json(),
          cache: response.headers.get("Cache-Control"),
          pragma: response.headers.get("Pragma"),
          expires: response.headers.get("Expires"),
          retry: response.headers.get("Retry-After"),
        };
      } finally {
        delete globalThis.__mig0648LegacyTest;
      }
      const target = await request(entry.path, {
        anonymous: entry.anonymous,
        banned: entry.banned,
        dbFailure: entry.dbFailure,
        objects,
        noBucket: entry.noBucket,
        throwBucketGetter: entry.throwBucketGetter,
      });
      assert.deepEqual({
        status: target.response.status,
        body: target.body,
        cache: target.response.headers.get("Cache-Control"),
        pragma: target.response.headers.get("Pragma"),
        expires: target.response.headers.get("Expires"),
        retry: target.response.headers.get("Retry-After"),
      }, current, entry.note);
      assert.deepEqual(target.stats.gets, legacy.stats.gets, `R2 key path: ${entry.note}`);
      assert.ok(target.stats.reads <= 1, `session D1 read bound: ${entry.note}`);
      assert.equal(target.stats.writes, 0);
    }
  });

}

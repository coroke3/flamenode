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
    MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
    memberSuggestionsV2DirectoryObjectKey,
    memberSuggestionsV2PageObjectKey,
  } = await import("../../../src/lib/video/memberSuggestionsPostingsV2.ts");
  const { resetMemberSuggestionsCacheForTest } = await import("../../../packages/server-core/src/memberSuggestion/loader.ts");
  const { resetMemberSuggestionsV2CacheForTest } = await import("../../../packages/server-core/src/memberSuggestion/v2Loader.ts");

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

  function makeEnv({ banned = false, userFound = true, dbFailure = false, noBucket = false, noDb = false, objects = artifacts() } = {}) {
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
    return { env: { ...(noDb ? {} : { DB }), ...(noBucket ? {} : { BUCKET }) }, stats, objects };
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

  test("T03: missing V1 and V2 artifacts or bucket binding return CURRENT retryable 503", async () => {
    for (const options of [{ objects: new Map() }, { noBucket: true }]) {
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
}

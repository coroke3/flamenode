// MIG-0627 U02d PREP ONLY: exercise the actual mounted Hono search API with
// generated postings plus fake R2/D1. The runtime R2 readers remain intact.
// This does not approve a replacement artifact producer or production cutover.
import assert from "node:assert/strict";
import test from "node:test";
import { runUnderRootTsx } from "../apps/api/test/support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1 } from "../apps/api/test/support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../apps/api/src/app.ts");
  const { resetOperationModeCachesForTests } = await import("../apps/api/src/routes/live/operationMode.ts");
  const { clearPublicApiRateLimitForTests } = await import("@flamenode/server-core/publicData/publicApi");
  const {
    buildStaticVideoSearchPostingArtifacts,
    staticVideoSearchPostingManifestObjectKey,
    staticVideoSearchPostingDirectoryObjectKey,
    staticVideoSearchPostingPageObjectKey,
  } = await import("@flamenode/server-core/publicData/searchIndexCore");

  const source = [
    { id: "posted-tokyo", title: "Cyberpunk Tokyo Night", display_name: "Cyber Artist", youtube_video_id: null, creator_x_user_id: null, creator_x_user_name: null },
    { id: "posted-kyoto", title: "Retro Kyoto Sunset", display_name: "Kyoto Artist", youtube_video_id: null, creator_x_user_id: null, creator_x_user_name: null },
  ];
  const generation = "mig-0627-u02d";
  const manifestKey = staticVideoSearchPostingManifestObjectKey("current");
  const liteKey = "search-index-lite.json";

  function harness(t, mode = "off") {
    clearPublicApiRateLimitForTests();
    resetOperationModeCachesForTests();
    const sqlite = createSqlite();
    t.after(() => sqlite.close());
    const d1 = createD1(sqlite);
    const storage = createFakeBucket();
    const reads = [];
    const bucket = {
      async get(key) {
        reads.push(key);
        return storage.get(key);
      },
      async head(key) {
        const obj = await storage.get(key);
        return obj ? { size: obj.size, etag: obj.etag } : null;
      },
    };
    const env = { DB: d1, KV: createFakeKv(), BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: mode };
    return {
      storage, reads, d1,
      async query(value = "Tokyo", params = {}, headers = {}) {
        const url = new URL("http://localhost/api/videos");
        url.searchParams.set("q", value);
        for (const [key, parameter] of Object.entries(params)) {
          url.searchParams.set(key, parameter);
        }
        const response = await app.request(new Request(url, { headers }), {}, env);
        return { response, payload: response.status === 304 ? null : await response.json() };
      },
    };
  }

  async function seedPostings(storage, { directory = (value) => value, page = (value) => value, omitPages = false } = {}) {
    const artifacts = buildStaticVideoSearchPostingArtifacts({
      items: source, generatedAt: 1700000000, generation,
    });
    await storage.put(manifestKey, artifacts.manifest);
    for (const entry of artifacts.directories) {
      await storage.put(staticVideoSearchPostingDirectoryObjectKey(generation, entry.bucket), directory(entry.directory));
    }
    if (!omitPages) {
      for (const entry of artifacts.pages) {
        await storage.put(staticVideoSearchPostingPageObjectKey(generation, entry.bucket, entry.page.page), page(entry.page));
      }
    }
    return artifacts;
  }

  async function seedLite(storage) {
    await storage.put(liteKey, {
      generated_at: 1700000000,
      videos: [{ id: "lite-only-tokyo", title: "Tokyo fallback", creator_display_name: "Fallback Artist" }],
    });
  }

  test("MIG-0627 U02d PREP T01: current-generation posting search is bounded and skips legacy lite", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage);
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["posted-tokyo"]);
    assert.ok(h.reads.includes(manifestKey));
    assert.equal(h.reads.includes(liteKey), false, "verified posting path must not re-read legacy lite");
    assert.ok(h.reads.length > 1 && h.reads.length <= 35, "manifest + bounded directory/page reads");
    assert.deepEqual({ statements: h.d1.stats.statements, writes: h.d1.stats.writes }, { statements: 0, writes: 0 });
  });

  test("MIG-0627 U02d PREP T02: missing indexed posting page uses only existing legacy lite fallback", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage, { omitPages: true });
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["lite-only-tokyo"]);
    assert.ok(h.reads.includes(manifestKey));
    assert.ok(h.reads.includes(liteKey));
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02d PREP T03: mismatched directory generation never advertises stale postings", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage, { directory: (entry) => ({ ...entry, generation: "videos-stale" }) });
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["lite-only-tokyo"]);
    assert.ok(h.reads.includes(liteKey));
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02d PREP T04: malformed posting page without fallback fails unavailable, not stale public data", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage, { page: (entry) => ({ ...entry, generation: "videos-stale" }) });
    const { response, payload } = await h.query();
    assert.equal(response.status, 503);
    assert.deepEqual(payload, { error: "static_list_unavailable" });
    assert.ok(h.reads.includes(liteKey));
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });
  test("MIG-0627 U02d PREP T05: enforce-mode malformed visibility manifest cannot release public search", async (t) => {
    const h = harness(t, "enforce");
    await seedPostings(h.storage);
    await seedLite(h.storage);
    const visibilityKey = "visibility/blocked-entities.v1.json";
    await h.storage.put(visibilityKey, "{broken-visibility-manifest");
    const { response, payload } = await h.query();
    assert.equal(response.status, 503);
    assert.deepEqual(payload, { error: "static_list_unavailable" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.ok(h.reads.length >= 1 && h.reads.every((key) => key === visibilityKey),
      "invalid visibility manifest must prevent every search-index and lite data read");
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02d PREP T06: postings spanning more than 32 pages fall back before shard reads", async (t) => {
    const h = harness(t);
    const pages = Array.from({ length: 33 }, (_, index) => index + 1);
    await seedPostings(h.storage, {
      directory: (directory) => ({
        ...directory,
        grams: Object.fromEntries(Object.entries(directory.grams).map(([gram, entry]) => [
          gram, { ...entry, pages, total: 33 },
        ])),
      }),
    });
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["lite-only-tokyo"]);
    assert.ok(h.reads.includes(manifestKey));
    assert.ok(h.reads.includes(liteKey), "over-limit posting path must use existing lite fallback");
    assert.equal(h.reads.some((key) => /\/bucket\/\d+\/\d+\.json$/.test(key)), false,
      "query must not fetch any of the 33 advertised posting pages");
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02d PREP T07: missing posting manifest still reads legacy lite once", async (t) => {
    const h = harness(t);
    await seedLite(h.storage);
    const { response, payload } = await h.query();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["lite-only-tokyo"]);
    assert.deepEqual(h.reads, [manifestKey, liteKey]);
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02d PREP T08: both indexes missing returns noncacheable retryable 503", async (t) => {
    const h = harness(t);
    const { response, payload } = await h.query();
    assert.equal(response.status, 503);
    assert.deepEqual(payload, { error: "static_list_unavailable" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.deepEqual(h.reads, [manifestKey, liteKey], "only the two documented index keys can be read");
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  // Event-scoped search is a distinct RH-032 consumer branch. Characterize
  // its existing fallback before replacing either R2 artifact; do not change
  // runtime code, heal enqueue behavior, or the documented >500-row STOP.
  const eventId = "evt-preflight";
  const baseKey = `events/${eventId}/base.v1.json`;
  const composedKey = `events/${eventId}.json`;

  function eventPayload(videos, videoTotal = videos.length) {
    return {
      generated_at: 1700000000,
      event: { id: eventId, title: "Event preflight", visibility_status: "public" },
      public_videos: videos,
      video_total: videoTotal,
    };
  }

  const tokyoEventVideo = {
    id: "event-tokyo",
    title: "Tokyo event work",
    display_name: "Event Artist",
    scheduled_time: 1700001000,
    status: "public",
  };
  const kyotoEventVideo = {
    id: "event-kyoto",
    title: "Kyoto event work",
    display_name: "Other Artist",
    scheduled_time: 1700002000,
    status: "public",
  };
  const composedVideo = { ...tokyoEventVideo, id: "composed-tokyo" };

  function assertNoD1(h) {
    assert.deepEqual(
      { statements: h.d1.stats.statements, writes: h.d1.stats.writes },
      { statements: 0, writes: 0 },
    );
  }

  test("MIG-0627 U02d PREP T09: event-scoped search reads complete base, not composed or global postings", async (t) => {
    const h = harness(t);
    await seedPostings(h.storage);
    await seedLite(h.storage);
    await h.storage.put(baseKey, eventPayload([tokyoEventVideo, kyotoEventVideo]));
    await h.storage.put(composedKey, eventPayload([composedVideo]));

    const { response, payload } = await h.query("Tokyo", { event: eventId, limit: "1" });
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["event-tokyo"]);
    assert.equal(payload.total, 1);
    assert.equal(payload.page, 1);
    assert.equal(payload.limit, 1);
    assert.equal(payload.items[0].status, "public");
    assert.deepEqual(h.reads, [baseKey]);
    assertNoD1(h);
  });

  test("MIG-0627 U02d PREP T10: absent event base uses the existing composed artifact once", async (t) => {
    const h = harness(t);
    await seedLite(h.storage);
    await h.storage.put(composedKey, eventPayload([composedVideo, kyotoEventVideo]));

    const { response, payload } = await h.query("Tokyo", { event: eventId });
    assert.equal(response.status, 200);
    assert.deepEqual(payload.items.map((item) => item.id), ["composed-tokyo"]);
    assert.equal(payload.total, 1);
    assert.deepEqual(h.reads, [baseKey, composedKey]);
    assertNoD1(h);
  });

  test("MIG-0627 U02d PREP T11: present incomplete event base does not fall back to stale composed", async (t) => {
    const h = harness(t);
    await h.storage.put(baseKey, eventPayload([tokyoEventVideo], 2));
    await h.storage.put(composedKey, eventPayload([composedVideo]));

    const { response, payload } = await h.query("Tokyo", { event: eventId });
    assert.equal(response.status, 503);
    assert.deepEqual(payload, { error: "static_list_unavailable" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(h.reads, [baseKey]);
    assertNoD1(h);
  });

  test("MIG-0627 U02d PREP T12: composed event without score cannot pretend to support score sort", async (t) => {
    const h = harness(t);
    await h.storage.put(composedKey, eventPayload([composedVideo]));

    const { response, payload } = await h.query("Tokyo", { event: eventId, sort: "score" });
    assert.equal(response.status, 503);
    assert.deepEqual(payload, { error: "static_list_unavailable" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(h.reads, [baseKey, composedKey]);
    assertNoD1(h);
  });

  // Characterization of the existing RH-032 cutover blocker, NOT acceptance
  // of Hono's 503 as equivalent to CURRENT's bounded degraded-D1 listing.
  const boundaryRows = Array.from({ length: 501 }, (_, index) => ({
    id: `pool-${String(index).padStart(3, "0")}`,
    title: `Tokyo work ${index}`,
    display_name: "Pool artist",
    scheduled_time: 1700001000 + index,
    status: "public",
    // Deliberately independent of scheduled_time so score-as-new cannot pass.
    score: (index * 137) % 500,
  }));

  test("MIG-0627 U02d PREP T13: exactly 500 event videos retain bounded final page for all sorts", async (t) => {
    const h = harness(t);
    const rows = boundaryRows.slice(0, 500);
    await h.storage.put(baseKey, eventPayload(rows));
    await h.storage.put(composedKey, eventPayload([composedVideo]));
    await seedLite(h.storage);
    for (const sort of ["new", "old", "score"]) {
      const { response, payload } = await h.query("Tokyo", { event: eventId, sort, page: "11", limit: "48" });
      assert.equal(response.status, 200, sort);
      assert.equal(payload.total, 500, sort);
      assert.equal(payload.page, 11, sort);
      assert.equal(payload.limit, 48, sort);
      const expectedIds = sort === "old"
        ? rows.slice(480, 500).map((item) => item.id)
        : sort === "new"
          ? rows.slice(0, 20).reverse().map((item) => item.id)
          : [
              "pool-387", "pool-314", "pool-241", "pool-168", "pool-095",
              "pool-022", "pool-449", "pool-376", "pool-303", "pool-230",
              "pool-157", "pool-084", "pool-011", "pool-438", "pool-365",
              "pool-292", "pool-219", "pool-146", "pool-073", "pool-000",
            ];
      assert.deepEqual(payload.items.map((item) => item.id), expectedIds, sort);
      assert.ok(payload.items.every((item) => item.status === "public"), sort);
    }
    assert.deepEqual(h.reads, [baseKey, baseKey, baseKey], "one base read per request; no composed or global fallback");
    assertNoD1(h);
  });

  test("MIG-0627 U02d PREP T14: KNOWN GAP - 501 event videos fail closed without truncated or stale results", async (t) => {
    const cases = [
      { label: "500 stored / 501 declared", base: eventPayload(boundaryRows.slice(0, 500), 501), composed: eventPayload([composedVideo]), reads: [baseKey] },
      { label: "501 stored / 501 declared", base: eventPayload(boundaryRows), composed: eventPayload([composedVideo]), reads: [baseKey] },
      { label: "missing base / oversized composed", base: null, composed: eventPayload(boundaryRows), reads: [baseKey, composedKey] },
    ];
    for (const { label, base, composed, reads } of cases) {
      const h = harness(t);
      if (base) await h.storage.put(baseKey, base);
      await h.storage.put(composedKey, composed);
      await seedLite(h.storage);
      const { response, payload } = await h.query("Tokyo", { event: eventId, page: "1", limit: "48" });
      assert.equal(response.status, 503, label);
      assert.deepEqual(payload, { error: "static_list_unavailable" }, label);
      assert.equal(response.headers.get("Cache-Control"), "no-store", label);
      assert.equal(response.headers.get("Retry-After"), "30", label);
      assert.equal(response.headers.get("ETag"), null, label);
      assert.deepEqual(h.reads, reads, label);
      assertNoD1(h);
    }
  });


  test("MIG-0627 U02d PREP T15: equal score and time retain deterministic order", async (t) => {
    const h = harness(t);
    const rows = [
      { ...boundaryRows[0], id: "tie-z", score: 10, scheduled_time: 100 },
      { ...boundaryRows[1], id: "tie-b", score: 10, scheduled_time: 200 },
      { ...boundaryRows[2], id: "tie-a", score: 10, scheduled_time: 200 },
      { ...boundaryRows[3], id: "tie-c", score: 5, scheduled_time: 300 },
    ];
    await h.storage.put(baseKey, eventPayload(rows));
    const expected = {
      score: ["tie-a", "tie-b", "tie-z", "tie-c"],
      new: ["tie-c", "tie-a", "tie-b", "tie-z"],
      old: ["tie-z", "tie-a", "tie-b", "tie-c"],
    };
    for (const [sort, ids] of Object.entries(expected)) {
      const { response, payload } = await h.query("Tokyo", { event: eventId, sort });
      assert.equal(response.status, 200, sort);
      assert.equal(payload.total, 4, sort);
      assert.deepEqual(payload.items.map((item) => item.id), ids, sort);
    }
    assert.deepEqual(h.reads, [baseKey, baseKey, baseKey]);
    assertNoD1(h);
  });

  // #892: conditional HTTP responses must be examined separately from
  // projection. Keep these controls when the owner fixes the identity guard.
  const identityVisibilityKey = "visibility/blocked-entities.v1.json";
  async function seedIdentityManifest(storage, blockedId = null) {
    await storage.put(identityVisibilityKey, {
      schema_version: 1,
      revision: blockedId === null ? 1 : 2,
      generated_at: 1700000000,
      entities: blockedId === null ? [] : [{
        entity_type: "event", entity_id: blockedId,
        fence_token: "fixture-fence", blocked_at: 1700000000,
      }],
    });
  }

  function assertIdentityUnavailable(result) {
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.payload, { error: "static_list_unavailable" });
    assert.equal(result.response.headers.get("Cache-Control"), "no-store");
    assert.equal(result.response.headers.get("Retry-After"), "30");
    assert.equal(result.response.headers.get("ETag"), null);
  }

  test("MIG-0627 U02d PREP T16: correct event ETag cannot override requested event revocation", async (t) => {
    for (const path of ["base", "composed"]) {
      for (const sort of ["new", "old", "score"]) {
        const h = harness(t, "enforce");
        await seedIdentityManifest(h.storage);
        await h.storage.put(path === "base" ? baseKey : composedKey,
          eventPayload([{ ...tokyoEventVideo, score: 1 }]));
        const params = { event: eventId, sort };
        const first = await h.query("Tokyo", params);
        assert.equal(first.response.status, 200);
        assert.deepEqual(first.payload.items.map((item) => item.primary_event_id), [eventId]);
        const etag = first.response.headers.get("ETag");
        assert.ok(etag);
        const revalidated = await h.query("Tokyo", params, { "If-None-Match": etag });
        assert.equal(revalidated.response.status, 304);
        assert.equal(revalidated.payload, null);
        const reads = path === "base"
          ? [identityVisibilityKey, baseKey]
          : [identityVisibilityKey, baseKey, identityVisibilityKey, composedKey];
        assert.deepEqual(h.reads, [...reads, ...reads]);
        await seedIdentityManifest(h.storage, eventId);
        for (const tag of [etag, "*"]) {
          h.reads.length = 0;
          assertIdentityUnavailable(await h.query("Tokyo", params, { "If-None-Match": tag }));
          assert.deepEqual(h.reads, [identityVisibilityKey, identityVisibilityKey],
            "requested event fence rejects both paths before any artifact read");
        }
        assertNoD1(h);
      }
    }
  });

  // CHARACTERIZATION ONLY. #892 is unresolved; these assertions reproduce
  // the current defect, not an acceptable response contract. Invert the
  // 200/304 expectations to fixed 503/no-store/no-ETag with the approved
  // identity repair, preserving T16 and the embedded-event fence control.
  test("MIG-0627 U02d PREP T17: KNOWN GAP #892 - wrong public event identity can return 200 and 304", async (t) => {
    const wrongId = "evt-other";
    for (const path of ["base", "composed"]) {
      for (const sort of ["new", "old", "score"]) {
        const h = harness(t, "enforce");
        await seedIdentityManifest(h.storage);
        const wrong = eventPayload([{ ...tokyoEventVideo, score: 1 }]);
        wrong.event = { ...wrong.event, id: wrongId };
        await h.storage.put(path === "base" ? baseKey : composedKey, wrong);
        const params = { event: eventId, sort };
        const first = await h.query("Tokyo", params);
        assert.equal(first.response.status, 200, "KNOWN GAP: wrong event returned");
        assert.deepEqual(first.payload.items.map((item) => item.primary_event_id), [wrongId]);
        const etag = first.response.headers.get("ETag");
        assert.ok(etag);
        assert.match(first.response.headers.get("Cache-Control") ?? "", /^public,/);
        for (const tag of [etag, "*"]) {
          const revalidated = await h.query("Tokyo", params, { "If-None-Match": tag });
          assert.equal(revalidated.response.status, 304, "KNOWN GAP: wrong event revalidated");
          assert.equal(revalidated.payload, null);
        }
        const reads = path === "base"
          ? [identityVisibilityKey, baseKey]
          : [identityVisibilityKey, baseKey, identityVisibilityKey, composedKey];
        assert.deepEqual(h.reads, [...reads, ...reads, ...reads]);
        await seedIdentityManifest(h.storage, wrongId);
        for (const tag of [etag, "*"]) {
          h.reads.length = 0;
          assertIdentityUnavailable(await h.query("Tokyo", params, { "If-None-Match": tag }));
          assert.deepEqual(h.reads, [identityVisibilityKey, baseKey, identityVisibilityKey, composedKey]);
        }
        assertNoD1(h);
      }
    }
  });

}

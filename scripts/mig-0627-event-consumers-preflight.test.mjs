// MIG-0627 U02e PREP ONLY. Existing mounted Hono public event consumers:
// preserve privacy/DTO/availability/read boundaries before any source cutover.
// Fake R2 + local SQLite D1; this does NOT validate a Worker-accessible artifact handoff.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runUnderRootTsx } from "../apps/api/test/support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1 } from "../apps/api/test/support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../apps/api/src/app.ts");
  const { resetOperationModeCachesForTests } = await import("../apps/api/src/routes/live/operationMode.ts");
  const { clearPublicApiRateLimitForTests } = await import("@flamenode/server-core/publicData/publicApi");
  const { wrapSnapshot } = await import("../apps/site/scripts/produceSnapshots.ts");
  const { publishApiArtifacts } = await import("../apps/site/scripts/publishApiArtifacts.ts");
  const { EVENT_INDEX_KEY, eventDetailKey, eventReleaseKey } = await import("../apps/site/src/lib/publicDataLoader.ts");

  const indexKey = "events/index.json";
  const releaseKey = "events/evt-public/release.v1.json";
  const visibilityKey = "visibility/blocked-entities.v1.json";

  function harness(t, overrides = {}) {
    clearPublicApiRateLimitForTests();
    resetOperationModeCachesForTests();
    const sqlite = createSqlite();
    t.after(() => sqlite.close());
    sqlite.exec(
      "INSERT INTO events (id, title, visibility_status, start_time, end_time, created_at, max_slots_per_video, public_api_enabled) VALUES " +
      "('evt-public', 'Public Event', 'public', 1700002000, 1700003000, 100, 1, 1), " +
      "('evt-private', 'Private Event', 'private', 1700002000, 1700003000, 100, 1, 1), " +
      "('evt-disabled', 'Disabled Event', 'public', 1700002000, 1700003000, 100, 1, 0)"
    );
    const d1 = createD1(sqlite);
    const storage = createFakeBucket();
    const reads = [];
    const bucket = {
      async get(key) {
        reads.push(key);
        return storage.get(key);
      },
      async head(key) {
        const object = await storage.get(key);
        return object ? { size: object.size, etag: object.etag } : null;
      },
    };
    const env = {
      DB: d1, BUCKET: bucket, KV: createFakeKv(),
      PUBLIC_VISIBILITY_GUARD_MODE: "off",
      ...overrides,
    };
    return {
      d1, storage, reads, env,
      request(pathname) {
        return app.request("http://localhost" + pathname, {}, env);
      },
    };
  }

  test("MIG-0627 U02e PREP T01: static event index projects public ranged events with one R2 read and no D1", async (t) => {
    const h = harness(t, { FORCE_STATIC_ONLY: "1" });
    await h.storage.put(indexKey, {
      generated_at: 1700000000,
      items: [
        { id: "evt-public", title: "Public Event", visibility_status: "public", start_time: 1700002000, end_time: 1700003000 },
        { id: "evt-point", title: "Point Event", visibility_status: "public", start_time: 1700002000 },
        { id: "evt-private", title: "Private Event", visibility_status: "private", start_time: 1700002000, end_time: 1700003000 },
      ],
      group_sections: [],
    });
    const response = await h.request("/api/events");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map((row) => row.id), ["evt-public"]);
    assert.deepEqual({ page: payload.page, limit: payload.limit }, { page: 1, limit: 60 });
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60, s-maxage=120, stale-while-revalidate=300");
    assert.deepEqual(h.reads, [indexKey]);
    assert.deepEqual({ statements: h.d1.stats.statements, writes: h.d1.stats.writes }, { statements: 0, writes: 0 });
  });

  test("MIG-0627 U02e PREP T02: absent index is 503/no-store, never an empty public success", async (t) => {
    const h = harness(t, { FORCE_STATIC_ONLY: "1" });
    const response = await h.request("/api/events");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "public_data_unavailable" });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Retry-After"), "30");
    assert.deepEqual(h.reads, [indexKey]);
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02e PREP T03: D1-authorized release reads exactly its existing R2 artifact", async (t) => {
    const h = harness(t);
    await h.storage.put(releaseKey, {
      schema_version: 1, generated_at: 1700000000,
      event: { id: "evt-public", title: "Public Event", visibility_status: "public" },
      videos: [{
        id: "video-public", title: "Public Video", visibility_status: "public",
        collaboration_type: "individual", creator_display_name: "Creator", members: [],
      }],
      total: 1,
    });
    const response = await h.request("/api/event-endpoints/evt-public/release");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.event.id, "evt-public");
    assert.deepEqual(payload.videos.map((row) => row.id), ["video-public"]);
    assert.equal(payload.total, 1);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
    assert.deepEqual(h.reads, [releaseKey]);
    assert.deepEqual({ statements: h.d1.stats.statements, writes: h.d1.stats.writes }, { statements: 1, writes: 0 });
  });

  test("MIG-0627 U02e PREP T04: private or disabled event denies release before any R2 artifact access", async (t) => {
    const h = harness(t);
    for (const id of ["evt-private", "evt-disabled", "evt-unknown"]) {
      const response = await h.request("/api/event-endpoints/" + id + "/release");
      assert.equal(response.status, 404, id);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
    }
    assert.deepEqual(h.reads, [], "D1 visibility and public_api_enabled gates must precede release artifact reads");
    assert.deepEqual({ statements: h.d1.stats.statements, writes: h.d1.stats.writes }, { statements: 3, writes: 0 });
  });

  test("MIG-0627 U02e PREP T05: staff read requires committed visibility manifest before any event artifact", async (t) => {
    const h = harness(t);
    const response = await h.request("/api/public/events/evt-public/staff");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(h.reads, [visibilityKey], "missing manifest must not fall back to stale event base");
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });

  test("MIG-0627 U02e PREP T06: CURRENT/Hono R2 consumers stay until verified cross-Worker producer", async () => {
    const root = new URL("../", import.meta.url);
    const [currentList, honoList, honoRelease, honoStaff, apiBindings] = await Promise.all([
      readFile(new URL("app/api/events/route.ts", root), "utf8"),
      readFile(new URL("apps/api/src/routes/events/publicList.ts", root), "utf8"),
      readFile(new URL("apps/api/src/routes/events/publicRelease.ts", root), "utf8"),
      readFile(new URL("apps/api/src/routes/public/eventStaff.ts", root), "utf8"),
      readFile(new URL("apps/api/src/env.ts", root), "utf8"),
    ]);
    assert.match(currentList, /loadStaticEventsIndex/);
    assert.match(honoList, /key: "events\/index\.json"/);
    assert.match(honoRelease, /loadPublicSnapshot/);
    assert.match(honoStaff, /eventBaseObjectKey\(eventId\)/);
    assert.doesNotMatch(apiBindings, /FLAMENODE_SNAPSHOT_(?:DIR|MANIFEST_FILE)/,
      "Astro's build-local directory is not a published API Worker artifact binding");
  });

  // Use the actual merged MIG-0666 publisher and envelope builder, not a
  // hand-written R2 body. The shared in-memory bucket is an injected test
  // binding only; no deployment, atomic generation pointer or live R2 proof.
  function handoffFixture() {
    const generation = "mig-0627-u02e-handoff";
    const event = {
      id: "evt-public", title: "Public Event", visibility_status: "public",
      start_time: 1700002000, end_time: 1700003000,
    };
    const index = { generated_at: 1700000000, items: [event], group_sections: [] };
    const release = {
      schema_version: 1, generated_at: 1700000000, event,
      videos: [{
        id: "video-public", title: "Public Video", visibility_status: "public",
        collaboration_type: "individual", creator_display_name: "Creator", members: [],
      }],
      total: 1,
    };
    const snapshots = [
      wrapSnapshot(EVENT_INDEX_KEY, generation, index),
      wrapSnapshot(eventDetailKey(event.id), generation, { event }),
      wrapSnapshot(eventReleaseKey(event.id), generation, release),
    ];
    return {
      index, release,
      result: {
        publicEventIds: [event.id], snapshots,
        manifest: {
          schemaVersion: 1, generation,
          allowedKeys: snapshots.map((snapshot) => snapshot.key),
          blockedKeys: [],
        },
      },
    };
  }

  function publisherBinding(h) {
    const reads = [];
    const writes = [];
    return {
      reads, writes,
      bucket: {
        async get(key) {
          reads.push(key);
          return h.storage.get(key);
        },
        async put(key, body) {
          writes.push(key);
          return h.storage.put(key, body);
        },
      },
    };
  }

  test("MIG-0627 U02e PREP T07: actual build publisher hands bare event index and release DTOs to mounted Hono", async (t) => {
    const h = harness(t, { FORCE_STATIC_ONLY: "1" });
    const { result, index, release } = handoffFixture();
    const p = publisherBinding(h);

    const first = await publishApiArtifacts(result, p.bucket);
    assert.deepEqual({ artifacts: first.artifacts, puts: first.puts, skipped: first.skipped, retries: first.retries, verified: first.verified },
      { artifacts: 2, puts: 2, skipped: 0, retries: 0, verified: 2 });
    assert.deepEqual(p.writes, [releaseKey, indexKey], "release before index publication");
    assert.deepEqual(p.reads, [releaseKey, releaseKey, indexKey, indexKey], "comparison and readback per artifact");
    assert.deepEqual(await (await h.storage.get(indexKey)).json(), index);
    assert.deepEqual(await (await h.storage.get(releaseKey)).json(), release);
    assert.equal(first.bytes, Buffer.byteLength(JSON.stringify(index)) + Buffer.byteLength(JSON.stringify(release)));
    assert.equal(h.d1.stats.statements, 0, "publisher does not touch runtime D1");

    const list = await h.request("/api/events");
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.deepEqual(listBody.items.map((row) => [row.id, row.title]), [["evt-public", "Public Event"]]);
    assert.deepEqual({ page: listBody.page, limit: listBody.limit }, { page: 1, limit: 60 });
    assert.equal(list.headers.get("Cache-Control"), "public, max-age=60, s-maxage=120, stale-while-revalidate=300");
    assert.deepEqual(h.reads, [indexKey]);
    assert.equal(h.d1.stats.statements, 0);

    const response = await h.request("/api/event-endpoints/evt-public/release");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.event.id, "evt-public");
    assert.deepEqual(body.videos.map((row) => row.id), ["video-public"]);
    assert.equal(body.total, 1);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
    assert.deepEqual(h.reads, [indexKey, releaseKey]);
    assert.deepEqual({ statements: h.d1.stats.statements, writes: h.d1.stats.writes }, { statements: 1, writes: 0 });

    for (const id of ["evt-private", "evt-disabled"]) {
      const denied = await h.request("/api/event-endpoints/" + id + "/release");
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { error: "not_found" });
    }
    assert.deepEqual(h.reads, [indexKey, releaseKey], "D1 authorization precedes artifact access");
    assert.deepEqual({ statements: h.d1.stats.statements, writes: h.d1.stats.writes }, { statements: 3, writes: 0 });

    p.reads.length = 0;
    const unchanged = await publishApiArtifacts(result, p.bucket);
    assert.deepEqual({ puts: unchanged.puts, skipped: unchanged.skipped, verified: unchanged.verified },
      { puts: 0, skipped: 2, verified: 2 });
    assert.deepEqual(p.writes, [releaseKey, indexKey], "identical build issues no additional PUT");
    assert.deepEqual(p.reads, [releaseKey, indexKey]);
  });

  test("MIG-0627 U02e PREP T08: bad build generation, digest or manifest deny before publication I/O", async (t) => {
    const h = harness(t, { FORCE_STATIC_ONLY: "1" });
    const { result, index, release } = handoffFixture();
    const p = publisherBinding(h);
    await publishApiArtifacts(result, p.bucket);
    p.reads.length = 0;
    p.writes.length = 0;

    const key = eventReleaseKey("evt-public");
    for (const kind of ["generation", "digest", "blocked"]) {
      const invalid = structuredClone(result);
      const snapshot = invalid.snapshots.find((entry) => entry.key === key);
      assert.ok(snapshot);
      if (kind === "generation") {
        const envelope = JSON.parse(snapshot.json);
        envelope.generation = "different-generation";
        snapshot.json = JSON.stringify(envelope);
      } else if (kind === "digest") {
        snapshot.sha256 = "0".repeat(64);
      } else {
        invalid.manifest.blockedKeys.push(key);
      }
      await assert.rejects(publishApiArtifacts(invalid, p.bucket), /api artifact publish:/, kind);
      assert.deepEqual(p.reads, [], kind + ": preflight must precede comparison reads");
      assert.deepEqual(p.writes, [], kind + ": no rejected generation is published");
      assert.deepEqual(await (await h.storage.get(indexKey)).json(), index);
      assert.deepEqual(await (await h.storage.get(releaseKey)).json(), release);
    }
    assert.equal(h.d1.stats.statements, 0);
    assert.equal(h.d1.stats.writes, 0);
  });
}

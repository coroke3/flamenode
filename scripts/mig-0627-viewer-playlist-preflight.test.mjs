// MIG-0627 U02d viewer/event-playlist PREP only: actual mounted Hono route,
// in-memory SQLite D1 and fake R2. No runtime reader retirement or deployment.
// T06 characterizes a privacy gap; it must NOT be interpreted as safe behavior.
import assert from "node:assert/strict";
import test from "node:test";
import { runUnderRootTsx } from "../apps/api/test/support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1 } from "../apps/api/test/support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../apps/api/src/app.ts");
  const { resetOperationModeCachesForTests } = await import("../apps/api/src/routes/live/operationMode.ts");
  const videoKey = "videos/vid-main.json";
  const playlistKey = "events/evt-1/playlist.v1.json";
  const manifestKey = "visibility/blocked-entities.v1.json";
  const detail = {
    generated_at: 1700000000,
    video: { id: "vid-main", title: "Public Main", visibility_status: "public" },
    public_events: [{ id: "evt-1", title: "Public Event", visibility_status: "public" }],
  };
  const playlist = {
    schema_version: 1, generated_at: 1700000000, event_id: "evt-1", complete: true,
    items: [
      { id: "vid-main", title: "Public Main", display_name: "Main Author", youtube_video_id: "youtube_main" },
      { id: "vid-other", title: "Other Video", display_name: "Other Author", youtube_video_id: "youtube_other" },
    ],
  };
  const fenced = (type, id) => ({
    entity_type: type, entity_id: id, fence_token: "fence-1", blocked_at: 1700000000,
  });

  function harness(t, guard = "off") {
    resetOperationModeCachesForTests();
    const sqlite = createSqlite();
    t.after(() => sqlite.close());
    const d1 = createD1(sqlite);
    const storage = createFakeBucket();
    const reads = [];
    const bucket = {
      async get(key) { reads.push(key); return storage.get(key); },
      async head(key) { const item = await storage.get(key); return item && { etag: item.etag, size: item.size }; },
    };
    const env = {
      DB: d1, KV: createFakeKv(), BUCKET: bucket,
      FORCE_STATIC_ONLY: "1", PUBLIC_VISIBILITY_GUARD_MODE: guard,
    };
    return {
      storage, reads, d1,
      async request(query = "?playlist=evt-1") {
        const response = await app.request("/api/videos/vid-main/viewer-overlay" + query, {}, env);
        return { response, payload: await response.json() };
      },
    };
  }
  const putBase = async (h) => {
    await h.storage.put(videoKey, detail);
    await h.storage.put(playlistKey, playlist);
  };
  const putManifest = async (h, entries = []) => h.storage.put(manifestKey, {
    schema_version: 1, revision: 1, generated_at: 1700000000, entities: entries,
  });
  function assertZeroDb(h) {
    assert.equal(h.d1.stats.statements, 0, "static-only viewer is R2-only");
    assert.equal(h.d1.stats.writes, 0);
  }
  const assertPrivate = (response) =>
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");

  test("MIG-0627 U02d viewer T01: public video then complete playlist uses two R2 GETs and no D1", async (t) => {
    const h = harness(t);
    await putBase(h);
    const { response, payload } = await h.request();
    assert.equal(response.status, 200);
    assertPrivate(response);
    assert.deepEqual(payload.playlistItems.map((item) => item.id), ["vid-main", "vid-other"]);
    assert.equal(payload.playlistLabel, "Public Event 上映順");
    assert.deepEqual(h.reads, [videoKey, playlistKey], "video visibility gate precedes playlist");
    assertZeroDb(h);
  });

  test("MIG-0627 U02d viewer T02: nonpublic video returns 404 before any playlist read", async (t) => {
    const h = harness(t);
    await h.storage.put(videoKey, { ...detail, video: { ...detail.video, visibility_status: "private" } });
    await h.storage.put(playlistKey, playlist);
    const { response, payload } = await h.request();
    assert.equal(response.status, 404);
    assert.deepEqual(payload, { error: "video_not_found" });
    assert.deepEqual(h.reads, [videoKey]);
    assertPrivate(response);
    assertZeroDb(h);
  });

  test("MIG-0627 U02d viewer T03: invalid event ID and lib playlist avoid event R2 reads", async (t) => {
    const h = harness(t);
    await putBase(h);
    for (const id of ["evt.1", "lib-like", "lib-bookmark"]) {
      const { response, payload } = await h.request("?playlist=" + id);
      assert.equal(response.status, 200, id);
      assert.deepEqual(payload.playlistItems, [], id);
      assert.equal(payload.playlistLabel, "再生リスト", id);
      assertPrivate(response);
    }
    assert.deepEqual(h.reads, [videoKey, videoKey, videoKey]);
    assertZeroDb(h);
  });

  test("MIG-0627 U02d viewer T04: incomplete/mismatched/duplicate/single-item playlist is withheld", async (t) => {
    const cases = [
      { ...playlist, complete: false },
      { ...playlist, event_id: "other-event" },
      { ...playlist, items: [playlist.items[0], playlist.items[0]] },
      { ...playlist, items: [playlist.items[0]] },
    ];
    for (const artifact of cases) {
      const h = harness(t);
      await h.storage.put(videoKey, detail);
      await h.storage.put(playlistKey, artifact);
      const { response, payload } = await h.request();
      assert.equal(response.status, 200);
      assert.deepEqual(payload.playlistItems, [], "untrusted playlist never produces partial navigation");
      assert.equal(payload.playlistLabel, "再生リスト");
      assert.deepEqual(h.reads, [videoKey, playlistKey]);
      assertPrivate(response);
      assertZeroDb(h);
    }
  });

  test("MIG-0627 U02d viewer T05: committed event fence withholds its playlist", async (t) => {
    const h = harness(t, "enforce");
    await putBase(h);
    await putManifest(h, [fenced("event", "evt-1")]);
    const { response, payload } = await h.request();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.playlistItems, []);
    assert.equal(h.reads.includes(playlistKey), false, "revoked event artifact must not be read");
    assert.deepEqual(h.reads, [manifestKey, videoKey, manifestKey]);
    assertPrivate(response);
    assertZeroDb(h);
  });

  test("MIG-0627 U02d viewer T06: KNOWN GAP - revoked video persists inside stale playlist", async (t) => {
    const h = harness(t, "enforce");
    await putBase(h);
    await putManifest(h, [fenced("video", "vid-other")]);
    const { response, payload } = await h.request();
    assert.equal(response.status, 200);
    // This currently reproduces the bug, not a desired security contract:
    // artifactVisibility has no event_slots case to remove fenced video IDs.
    assert.deepEqual(payload.playlistItems.map((item) => item.id), ["vid-main", "vid-other"]);
    assert.equal(h.reads.filter((key) => key === manifestKey).length, 2);
    assertPrivate(response);
    assertZeroDb(h);
  });

  test("MIG-0627 U02d viewer T07: fenced primary video stops before playlist and D1", async (t) => {
    const h = harness(t, "enforce");
    await putBase(h);
    await putManifest(h, [fenced("video", "vid-main")]);
    const { response, payload } = await h.request();
    assert.equal(response.status, 404);
    assert.deepEqual(payload, { error: "video_not_found" });
    assert.equal(h.reads.includes(playlistKey), false);
    assert.deepEqual(h.reads, [manifestKey, videoKey]);
    assertPrivate(response);
    assertZeroDb(h);
  });

  test("MIG-0627 U02d viewer T08: manifest corruption and oversize playlist do not expose rows", async (t) => {
    const broken = harness(t, "enforce");
    await putBase(broken);
    await broken.storage.put(manifestKey, "{broken");
    const first = await broken.request();
    assert.equal(first.response.status, 503);
    assert.deepEqual(first.payload, { error: "viewer_overlay_unavailable" });
    assert.deepEqual(broken.reads, [manifestKey]);
    assertPrivate(first.response);
    assertZeroDb(broken);

    const huge = harness(t);
    await huge.storage.put(videoKey, detail);
    huge.storage.setRaw(playlistKey, {
      data: playlist, size: 8 * 1024 * 1024 + 1, etag: "too-large",
    });
    const second = await huge.request();
    assert.equal(second.response.status, 200);
    assert.deepEqual(second.payload.playlistItems, []);
    assert.deepEqual(huge.reads, [videoKey, playlistKey]);
    assertPrivate(second.response);
    assertZeroDb(huge);
  });
}

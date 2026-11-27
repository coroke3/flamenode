// SEC-712: mounted viewer API regression for stale R2 event playlists.
// Synthetic in-memory SQLite and fake R2; no real Cloudflare data is accessed.
import assert from "node:assert/strict";
import test from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";
import { createFakeBucket, createFakeKv, createSqlite, createD1 } from "./support/publicEventsHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../src/app.ts");
  const { resetOperationModeCachesForTests } = await import("../src/routes/live/operationMode.ts");
  const videoKey = "videos/vid-main.json";
  const playlistKey = "events/evt-1/playlist.v1.json";
  const manifestKey = "visibility/blocked-entities.v1.json";
  const detail = {
    generated_at: 1700000000,
    video: { id: "vid-main", title: "Main", visibility_status: "public" },
    public_events: [{ id: "evt-1", title: "Event", visibility_status: "public" }],
  };
  const playlist = {
    schema_version: 1, generated_at: 1700000000, event_id: "evt-1", complete: true,
    items: [
      { id: "vid-main", title: "Main", display_name: "Safe Main", youtube_video_id: "main" },
      { id: "vid-revoked", title: "EX_REVOKED_TITLE", display_name: "EX_REVOKED_AUTHOR", youtube_video_id: "revoked" },
      { id: "vid-third", title: "Third", display_name: "Safe Third", youtube_video_id: "third" },
    ],
  };
  const fence = (entity_type, entity_id) => ({
    entity_type, entity_id, fence_token: "fence-712", blocked_at: 1700000000,
  });

  function harness(t, guard = "enforce") {
    resetOperationModeCachesForTests();
    const sqlite = createSqlite();
    t.after(() => sqlite.close());
    const d1 = createD1(sqlite);
    const storage = createFakeBucket();
    const reads = [];
    const bucket = {
      async get(key) { reads.push(key); return storage.get(key); },
      async head(key) {
        const item = await storage.get(key);
        return item && { etag: item.etag, size: item.size };
      },
    };
    const env = {
      DB: d1, KV: createFakeKv(), BUCKET: bucket,
      FORCE_STATIC_ONLY: "1", PUBLIC_VISIBILITY_GUARD_MODE: guard,
    };
    return {
      storage, reads, d1,
      async request() {
        const response = await app.request(
          "/api/videos/vid-main/viewer-overlay?playlist=evt-1", {}, env,
        );
        return { response, body: await response.text() };
      },
    };
  }

  async function seed(h, entries = []) {
    await h.storage.put(videoKey, detail);
    await h.storage.put(playlistKey, playlist);
    await h.storage.put(manifestKey, {
      schema_version: 1, revision: 1, generated_at: 1700000000, entities: entries,
    });
  }

  function assertSafe(h, response) {
    assert.equal(response.headers.get("Cache-Control"),
      "private, no-store, no-cache, must-revalidate");
    assert.equal(h.d1.stats.statements, 0, "static-only path cannot read D1");
    assert.equal(h.d1.stats.writes, 0, "never modify D1");
    assert.ok(h.reads.length <= 4, "must not add R2 reads to the two-artifact path");
  }

  test("SEC-712 Hono: fenced item absent while two public playlist videos remain", async (t) => {
    const h = harness(t);
    await seed(h, [fence("video", "vid-revoked")]);
    const { response, body } = await h.request();
    assert.equal(response.status, 200);
    assertSafe(h, response);
    const data = JSON.parse(body);
    assert.deepEqual(data.playlistItems.map((item) => item.id), ["vid-main", "vid-third"]);
    assert.doesNotMatch(body, /EX_REVOKED_TITLE|EX_REVOKED_AUTHOR|vid-revoked|revoked/);
    assert.equal(h.reads.filter((k) => k === manifestKey).length, 2);
  });

  test("SEC-712 Hono: after two revocations the remaining single-item playlist stays hidden", async (t) => {
    const h = harness(t);
    await seed(h, [fence("video", "vid-revoked"), fence("video", "vid-third")]);
    const { response, body } = await h.request();
    assert.equal(response.status, 200);
    assertSafe(h, response);
    const data = JSON.parse(body);
    assert.deepEqual(data.playlistItems, []);
    assert.equal(data.playlistLabel, "再生リスト");
    assert.doesNotMatch(body, /EX_REVOKED_TITLE|EX_REVOKED_AUTHOR|vid-revoked/);
  });

  test("SEC-712 Hono: no fence keeps the original complete playlist", async (t) => {
    const h = harness(t, "off");
    await seed(h);
    const { response, body } = await h.request();
    assert.equal(response.status, 200);
    assertSafe(h, response);
    assert.deepEqual(JSON.parse(body).playlistItems.map((item) => item.id),
      ["vid-main", "vid-revoked", "vid-third"]);
    assert.deepEqual(h.reads, [videoKey, playlistKey]);
  });

  test("SEC-712 Hono: filtering cannot conceal an invalid original playlist", async (t) => {
    const safe = [playlist.items[0], playlist.items[2]];
    const hidden = playlist.items[1];
    const cases = [
      ["501 rows", [
        ...Array.from({ length: 500 }, (_, index) => ({ ...safe[0], id: `vid-${index}` })), hidden,
      ]],
      ["null row", [...safe, null]],
      ["malformed fenced row", [...safe, { ...hidden, title: "" }]],
      ["duplicate fenced IDs", [...safe, hidden, { ...hidden }]],
    ];
    for (const [name, items] of cases) {
      const h = harness(t);
      await seed(h, [fence("video", "vid-revoked")]);
      await h.storage.put(playlistKey, { ...playlist, items });
      const { response, body } = await h.request();
      assert.equal(response.status, 200, name);
      assertSafe(h, response);
      assert.deepEqual(JSON.parse(body).playlistItems, [], name);
      assert.equal(JSON.parse(body).playlistLabel, "再生リスト", name);
    }
  });

  test("SEC-712 Hono: event fence and malformed manifest fail closed", async (t) => {
    const h = harness(t);
    await seed(h, [fence("event", "evt-1")]);
    const first = await h.request();
    assert.equal(first.response.status, 200);
    assertSafe(h, first.response);
    assert.deepEqual(JSON.parse(first.body).playlistItems, []);
    assert.equal(h.reads.includes(playlistKey), false);

    const broken = harness(t);
    await seed(broken);
    await broken.storage.put(manifestKey, "{invalid");
    const denied = await broken.request();
    assert.equal(denied.response.status, 503);
    assertSafe(broken, denied.response);
    assert.doesNotMatch(denied.body, /EX_REVOKED_TITLE|EX_REVOKED_AUTHOR/);
  });
}

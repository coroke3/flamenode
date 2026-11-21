import assert from "node:assert/strict";
import test from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";

// SEC-712 follow-up: the Hono reader must reject a manifest that changes
// while a stale, complete event playlist is fetched from R2. This is a
// synthetic fake-R2 regression, not a workerd CPU / colo-consistency result.
if (runUnderRootTsx(import.meta.url)) {
  const { loadPublicSnapshot } = await import("../src/lib/publicSnapshot.ts");
  const manifestKey = "visibility/blocked-entities.v1.json";
  const playlistKey = "events/evt-1/playlist.v1.json";
  const videoKey = "videos/vid-safe.json";
  const slotsKey = "events/evt-1/slots.json";
  const playlist = {
    schema_version: 1, event_id: "evt-1", complete: true,
    generated_at: 1700000000,
    items: [
      { id: "vid-safe", title: "Safe", display_name: "Safe creator" },
      { id: "vid-revoked", title: "OLD SECRET TITLE", display_name: "OLD SECRET AUTHOR" },
    ],
  };

  const videoDetail = {
    schema_version: 1, generated_at: 1700000000,
    video: { id: "vid-safe", title: "Safe", visibility_status: "public", youtube_video_id: "yt-safe" },
    public_events: [{ id: "evt-1", title: "Event", visibility_status: "public" }],
  };

  function fixture() {
    const calls = [];
    // Each fake R2 bucket owns its own artifact, so test-added legacy flags
    // cannot bleed into concurrent scenarios or mask an earlier regression.
    const localPlaylist = structuredClone(playlist);
    let currentEtag = '"manifest-v1"';
    let mode = "normal";
    let blockedEvent = false;
    const manifest = () => JSON.stringify({
      schema_version: 1, revision: currentEtag === '"manifest-v1"' ? 1 : 2,
      generated_at: 1700000000,
      entities: blockedEvent ? [
        { entity_type: "event", entity_id: "evt-1", fence_token: "fence-1", blocked_at: 1700000000 },
      ] : currentEtag === '"manifest-v2"' ? [
        { entity_type: "video", entity_id: "vid-revoked", fence_token: "fence-2", blocked_at: 1700000001 },
      ] : [],
    });
    const bucket = {
      async get(key) {
        calls.push("GET " + key);
        if (key === manifestKey) {
          if (mode === "missing-initial") return null;
          const value = manifest();
          return { etag: currentEtag, size: Buffer.byteLength(value), text: async () => value };
        }
        if (key === videoKey) {
          return { size: Buffer.byteLength(JSON.stringify(videoDetail)),
            json: async () => structuredClone(videoDetail) };
        }
        if (key === playlistKey) {
          if (mode === "race") currentEtag = '"manifest-v2"';
          return { size: Buffer.byteLength(JSON.stringify(localPlaylist)),
            json: async () => structuredClone(localPlaylist) };
        }
        if (key === slotsKey) {
          return { size: 40, json: async () => ({ slots: [{ id: "slot-1" }] }) };
        }
        return null;
      },
      async head(key) {
        calls.push("HEAD " + key);
        assert.equal(key, manifestKey, "only visibility manifest HEAD is permitted");
        if (mode === "post-error") throw new Error("r2_head_unavailable");
        if (mode === "post-missing") return null;
        if (mode === "post-empty-etag") return { etag: "" };
        return { etag: currentEtag };
      },
    };
    return {
      calls, bucket, playlist: localPlaylist,
      setMode: (value) => { mode = value; },
      setBlockedEvent: (value) => { blockedEvent = value; },
      setEtag: (value) => { currentEtag = value; },
      clear: () => { calls.length = 0; },
    };
  }

  function options(bucket, guardModeRaw = "enforce", key = playlistKey) {
    return { bucket, key, targetType: "event_slots", guardModeRaw, targetEntityId: "evt-1" };
  }

  test("SEC-712 Hono: stable enforce playlist uses only 2 R2 GET + 1 post-read HEAD", async () => {
    const h = fixture();
    const result = await loadPublicSnapshot(options(h.bucket));
    assert.equal(result.kind, "ok");
    assert.deepEqual(result.data?.items, h.playlist.items);
    assert.deepEqual(h.calls, [
      "GET " + manifestKey, "GET " + playlistKey, "HEAD " + manifestKey,
    ]);
  });

  test("SEC-712 Hono: manifest video revocation during playlist GET denies stale body", async () => {
    const h = fixture();
    h.setMode("race");
    const result = await loadPublicSnapshot(options(h.bucket));
    assert.equal(result.kind, "unavailable");
    assert.deepEqual(h.calls, [
      "GET " + manifestKey, "GET " + playlistKey, "HEAD " + manifestKey,
    ]);
    assert.ok(!JSON.stringify(result).includes("OLD SECRET TITLE"));
    assert.equal(h.playlist.items.length, 2, "cached artifact never mutated");
  });

  test("SEC-712 Hono: missing/invalid post-read HEAD fails closed", async () => {
    for (const mode of ["post-error", "post-missing", "post-empty-etag"]) {
      const h = fixture();
      h.setMode(mode);
      const result = await loadPublicSnapshot(options(h.bucket));
      assert.equal(result.kind, "unavailable", mode);
      assert.deepEqual(h.calls, [
        "GET " + manifestKey, "GET " + playlistKey, "HEAD " + manifestKey,
      ]);
    }
  });

  test("SEC-712 Hono: missing initial manifest and parent event fence deny before playlist GET", async () => {
    const missing = fixture();
    missing.setMode("missing-initial");
    assert.equal((await loadPublicSnapshot(options(missing.bucket))).kind, "unavailable");
    assert.deepEqual(missing.calls, ["GET " + manifestKey]);
    const fenced = fixture();
    fenced.setBlockedEvent(true);
    assert.equal((await loadPublicSnapshot(options(fenced.bucket))).kind, "not_found");
    assert.deepEqual(fenced.calls, ["GET " + manifestKey]);
  });

  test("SEC-712 Hono: off/observe and non-playlist slots do not gain a HEAD", async () => {
    const off = fixture();
    off.setMode("race");
    assert.equal((await loadPublicSnapshot(options(off.bucket, "off"))).kind, "ok");
    assert.deepEqual(off.calls, ["GET " + playlistKey]);
    const observe = fixture();
    observe.setMode("race");
    assert.equal((await loadPublicSnapshot(options(observe.bucket, "observe"))).kind, "ok");
    assert.deepEqual(observe.calls, ["GET " + manifestKey, "GET " + playlistKey]);
    const slots = fixture();
    assert.equal((await loadPublicSnapshot(options(slots.bucket, "enforce", slotsKey))).kind, "ok");
    assert.deepEqual(slots.calls, ["GET " + manifestKey, "GET " + slotsKey]);
  });


  test("SEC-712 mounted Hono route: a mid-read video revocation never reaches playlistItems", async (t) => {
    // Exercise the actual GET /api/videos/:id/viewer-overlay response boundary,
    // not only loadPublicSnapshot. No real Cloudflare binding or D1 writes.
    const { app } = await import("../src/app.ts");
    const { createSqlite, createD1, createFakeKv } = await import("./support/publicEventsHarness.mjs");
    const { resetOperationModeCachesForTests } = await import("../src/routes/live/operationMode.ts");
    const sqlite = createSqlite();
    t.after(() => sqlite.close());
    const db = createD1(sqlite);
    async function invoke(h) {
      resetOperationModeCachesForTests();
      const response = await app.request(
        "/api/videos/vid-safe/viewer-overlay?playlist=evt-1", {}, {
          DB: db, KV: createFakeKv(), BUCKET: h.bucket,
          FORCE_STATIC_ONLY: "1", PUBLIC_VISIBILITY_GUARD_MODE: "enforce",
        },
      );
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, no-cache, must-revalidate");
      assert.equal(db.stats.statements, 0, "static-only must not read D1");
      assert.equal(db.stats.writes, 0, "never write to D1");
      assert.equal(h.calls.filter((c) => c === "GET " + manifestKey).length, 2,
        "video and playlist readers each consult the manifest before their R2 read");
      assert.equal(h.calls.filter((c) => c === "GET " + playlistKey).length, 1);
      assert.equal(h.calls.filter((c) => c === "HEAD " + manifestKey).length, 1);
      return { dto: JSON.parse(text), text };
    }
    const stable = fixture();
    const allowed = await invoke(stable);
    assert.deepEqual(allowed.dto.playlistItems.map((row) => row.id), ["vid-safe", "vid-revoked"]);

    const stale = fixture();
    stale.setMode("race");
    const denied = await invoke(stale);
    assert.deepEqual(denied.dto.playlistItems, [], "deny stale playlist after ETag change");
    assert.doesNotMatch(denied.text, /vid-revoked|OLD SECRET TITLE|OLD SECRET AUTHOR/);
    assert.equal(stale.playlist.items.length, 2, "source artifact must remain unchanged");
  });

  test("SEC-712 Hono route: off/observe retain public playlist and avoid post-read HEAD", async (t) => {
    // Guard off/observe skips the R2 manifest revocation fence; it must not
    // require an extra HEAD or lose an otherwise-public two-item playlist.
    // Do NOT assert that explicit status:private rows must be returned:
    // shared-core #719 intentionally treats those markers as non-public.
    // This is an HTTP route regression, not merely the shared helper.
    const { app } = await import("../src/app.ts");
    const { createSqlite, createD1, createFakeKv } = await import("./support/publicEventsHarness.mjs");
    const { resetOperationModeCachesForTests } = await import("../src/routes/live/operationMode.ts");

    for (const guardMode of ["off", "observe"]) {
      resetOperationModeCachesForTests();
      const sqlite = createSqlite();
      t.after(() => sqlite.close());
      const db = createD1(sqlite);
      const h = fixture();
      h.playlist.items[1].status = "public";
      const original = structuredClone(h.playlist);

      const response = await app.request(
        "/api/videos/vid-safe/viewer-overlay?playlist=evt-1", {}, {
          DB: db, KV: createFakeKv(), BUCKET: h.bucket,
          FORCE_STATIC_ONLY: "1", PUBLIC_VISIBILITY_GUARD_MODE: guardMode,
        },
      );
      assert.equal(response.status, 200, guardMode);
      assert.equal(response.headers.get("Cache-Control"),
        "private, no-store, no-cache, must-revalidate", guardMode);
      const body = await response.json();
      assert.deepEqual(body.playlistItems.map((row) => row.id),
        ["vid-safe", "vid-revoked"],
        guardMode + ": both explicitly public playlist items remain visible");
      assert.equal(body.playlistLabel, "Event 上映順", guardMode);
      assert.equal(db.stats.statements, 0, "static-only cannot read D1");
      assert.equal(db.stats.writes, 0, "must never write D1");
      assert.deepEqual(h.playlist, original, "R2 source artifact must not mutate");
      assert.equal(h.calls.filter((c) => c === "HEAD " + manifestKey).length, 0,
        guardMode + ": no post-read HEAD outside enforce");
      assert.equal(h.calls.filter((c) => c === "GET " + manifestKey).length,
        guardMode === "off" ? 0 : 2, guardMode);
      assert.equal(h.calls.filter((c) => c === "GET " + playlistKey).length, 1);
    }
  });

  test("SEC-712 Hono: synthetic bucket without HEAD performs bounded manifest re-read", async () => {
    const h = fixture();
    const getOnlyBucket = { get: (key) => h.bucket.get(key) };
    assert.equal((await loadPublicSnapshot(options(getOnlyBucket))).kind, "ok");
    assert.deepEqual(h.calls, [
      "GET " + manifestKey, "GET " + playlistKey, "GET " + manifestKey,
    ]);
    h.clear();
    h.setMode("race");
    assert.equal((await loadPublicSnapshot(options(getOnlyBucket))).kind, "unavailable");
    assert.deepEqual(h.calls, [
      "GET " + manifestKey, "GET " + playlistKey, "GET " + manifestKey,
    ]);
  });
}

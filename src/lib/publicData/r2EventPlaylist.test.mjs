import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const runtimeStub =
    "data:text/javascript," +
    encodeURIComponent(
      "export function getCloudflareContext(){ return globalThis.__flamenodeCloudflareContext; }",
    );
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      if (specifier === "@opennextjs/cloudflare") {
        return { url: runtimeStub, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  test("r2 event playlist helper is R2-only and fails closed for malformed data", async () => {
    const source = await import("./r2EventPlaylist.ts");
    assert.equal(typeof source.loadPublicEventYoutubePlaylistIdR2Only, "function");
    const implementation = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./r2EventPlaylist.ts", import.meta.url), "utf8"),
    );
    assert.equal(
      (implementation.match(/readPublicVisibilityBlockedEntitiesManifest/g) ?? [])
        .length,
      3,
      "runtime, before-read, and after-read visibility guards must remain explicit",
    );
    assert.match(implementation, /visibility\.etag !== afterVisibility\.etag/);
  });

  test("r2 event playlist helper fails closed on manifest races and invalid artifacts", async () => {
    const { loadPublicEventYoutubePlaylistIdR2Only } = await import(
      "./r2EventPlaylist.ts"
    );
    const manifestKey = "visibility/blocked-entities.v1.json";
    let manifestReads = 0;
    let mode = "ok";
    const manifest = JSON.stringify({
      schema_version: 1,
      revision: 1,
      generated_at: 1,
      entities: [],
    });
    const base = JSON.stringify({
      event: {
        id: "event-1",
        visibility_status: "public",
        youtube_playlist_id: "PL12345678",
      },
    });
    const bucket = {
      async get(key) {
        if (key === manifestKey) {
          manifestReads += 1;
          const etag = mode === "etag-race" && manifestReads > 1 ? "b" : "a";
          const text =
            mode === "blocked" && manifestReads > 1
              ? JSON.stringify({
                  schema_version: 1,
                  revision: 2,
                  generated_at: 1,
                  entities: [
                    {
                      entity_type: "event",
                      entity_id: "event-1",
                      fence_token: "t",
                      blocked_at: 1,
                    },
                  ],
                })
              : manifest;
          return { etag, size: text.length, text: async () => text };
        }
        if (key === "events/event-1/base.v1.json") {
          if (mode === "oversize") return { size: 8 * 1024 * 1024 + 1 };
          const text = mode === "malformed" ? "not-json" : base;
          return {
            size: text.length,
            json: async () => JSON.parse(text),
          };
        }
        return null;
      },
    };
    globalThis.__flamenodeCloudflareContext = {
      env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: "enforce" },
    };

    mode = "ok";
    manifestReads = 0;
    assert.equal(await loadPublicEventYoutubePlaylistIdR2Only("event-1"), "PL12345678");
    for (const failureMode of ["etag-race", "blocked", "oversize", "malformed"]) {
      mode = failureMode;
      manifestReads = 0;
      assert.equal(
        await loadPublicEventYoutubePlaylistIdR2Only("event-1"),
        null,
        failureMode,
      );
    }
    delete globalThis.__flamenodeCloudflareContext;
  });

  test("SEC-712 CURRENT: individually blocked playlist videos are hidden without mutating R2", async () => {
    const { loadPublicEventPlaylistR2Only } = await import("./r2EventPlaylist.ts");
    const manifestKey = "visibility/blocked-entities.v1.json";
    const playlistKey = "events/event-1/playlist.v1.json";
    const original = {
      schema_version: 1, generated_at: 1700000000,
      event_id: "event-1", complete: true,
      items: [
        { id: "vid-a", title: "Public A", display_name: "A", youtube_video_id: "y-a" },
        { id: "vid-hidden", title: "SECRET OLD TITLE", display_name: "SECRET OLD AUTHOR", youtube_video_id: "y-hidden" },
        { id: "vid-c", title: "Public C", display_name: "C", youtube_video_id: "y-c" },
      ],
    };
    const fence = (entity_type, entity_id) => ({
      entity_type, entity_id, fence_token: "f-720", blocked_at: 1700000000,
    });
    let mode = "video-fence";
    let guard = "enforce";
    let reads = [];
    const manifest = (entries, revision = 1) => JSON.stringify({
      schema_version: 1, revision, generated_at: 1700000000, entities: entries,
    });
    const bucket = {
      async get(key) {
        reads.push(key);
        if (key === manifestKey) {
          const nth = reads.filter((x) => x === manifestKey).length;
          if (mode === "missing-manifest") return null;
          if (mode === "invalid-manifest") return {
            etag: "bad", size: 8, text: async () => "{broken",
          };
          const race = mode === "video-race" && nth > 1;
          const entries = mode === "video-fence" ? [fence("video", "vid-hidden")]
            : mode === "two-fences" ? [fence("video", "vid-hidden"), fence("video", "vid-c")]
            : mode === "event-fence" ? [fence("event", "event-1")]
            : race ? [fence("video", "vid-hidden")] : [];
          const body = manifest(entries, race ? 2 : 1);
          return { etag: race ? "after" : "before", size: Buffer.byteLength(body), text: async () => body };
        }
        if (key === playlistKey) {
          return { size: Buffer.byteLength(JSON.stringify(original)), json: async () => structuredClone(original) };
        }
        return null;
      },
    };
    const use = (nextMode, nextGuard = "enforce") => {
      mode = nextMode;
      guard = nextGuard;
      reads = [];
      globalThis.__flamenodeCloudflareContext = {
        env: { BUCKET: bucket, PUBLIC_VISIBILITY_GUARD_MODE: guard },
      };
    };
    try {
      use("video-fence");
      const filtered = await loadPublicEventPlaylistR2Only("event-1");
      assert.deepEqual(filtered?.items.map((row) => row.id), ["vid-a", "vid-c"]);
      assert.equal(filtered?.complete, true);
      assert.equal(filtered?.eventId, "event-1");
      assert.ok(!JSON.stringify(filtered).includes("SECRET OLD"));
      assert.equal(original.items.length, 3, "raw cached R2 payload must not change");
      assert.deepEqual(reads, [manifestKey, playlistKey, manifestKey], "no extra R2 reads");
      use("two-fences");
      assert.deepEqual((await loadPublicEventPlaylistR2Only("event-1"))?.items.map((x) => x.id), ["vid-a"],
        "caller may hide a playlist with one remaining entry");
      use("no-fence");
      assert.deepEqual((await loadPublicEventPlaylistR2Only("event-1"))?.items.map((x) => x.id),
        ["vid-a", "vid-hidden", "vid-c"], "public entries remain unchanged");
      // The playlist normalizer intentionally drops status fields; enforce
      // must inspect those original R2 fields before returning public DTOs.
      original.items[1].visibility_status = "private";
      original.items[2].status = "private";
      use("no-fence");
      assert.deepEqual((await loadPublicEventPlaylistR2Only("event-1"))?.items.map((x) => x.id),
        ["vid-a"], "explicitly nonpublic raw rows cannot bypass filtering via normalization");
      for (const nonEnforced of ["off", "observe"]) {
        use("no-fence", nonEnforced);
        assert.deepEqual((await loadPublicEventPlaylistR2Only("event-1"))?.items.map((x) => x.id),
          ["vid-a", "vid-hidden", "vid-c"], "non-enforced legacy behavior remains unchanged");
        assert.deepEqual(reads, [playlistKey], "non-enforced modes do not read manifest");
      }
      delete original.items[1].visibility_status;
      delete original.items[2].status;

      // The normalizer's documented cap is 500 items; filtering must retain
      // stable ordering at the boundary and never mutate the source list.
      const originalItems = original.items;
      original.items = Array.from({ length: 500 }, (_, index) => ({
        id: index === 321 ? "vid-hidden" : `vid-${index}`,
        title: `Title ${index}`, display_name: `Creator ${index}`,
        youtube_video_id: `youtube-${index}`,
      }));
      use("video-fence");
      const atCap = await loadPublicEventPlaylistR2Only("event-1");
      assert.equal(atCap?.items.length, 499);
      assert.equal(atCap.items[320].id, "vid-320");
      assert.equal(atCap.items[321].id, "vid-322");
      assert.equal(atCap.items.at(-1).id, "vid-499");
      assert.equal(original.items.length, 500, "cached 500-item input remains unchanged");
      assert.deepEqual(reads, [manifestKey, playlistKey, manifestKey]);
      original.items = [...original.items, {
        id: "vid-501", title: "Over limit", display_name: "Over limit",
      }];
      use("no-fence");
      assert.equal(await loadPublicEventPlaylistR2Only("event-1"), null,
        "an oversized playlist still fails closed before filtering");
      original.items = originalItems;
      use("video-race");
      assert.equal(await loadPublicEventPlaylistR2Only("event-1"), null,
        "a video revoked between pre/post manifests must fail closed on changed ETag");
      assert.deepEqual(reads, [manifestKey, playlistKey, manifestKey]);
      use("event-fence");
      assert.equal(await loadPublicEventPlaylistR2Only("event-1"), null);
      assert.deepEqual(reads, [manifestKey], "parent event block must refuse the playlist GET");
      for (const failure of ["missing-manifest", "invalid-manifest"]) {
        use(failure);
        assert.equal(await loadPublicEventPlaylistR2Only("event-1"), null, failure);
      }
      for (const nonEnforced of ["off", "observe"]) {
        use("video-fence", nonEnforced);
        assert.deepEqual((await loadPublicEventPlaylistR2Only("event-1"))?.items.map((x) => x.id),
          ["vid-a", "vid-hidden", "vid-c"], nonEnforced);
        assert.deepEqual(reads, [playlistKey], "non-enforced mode must not read the manifest");
      }
    } finally {
      delete globalThis.__flamenodeCloudflareContext;
    }
  });
}

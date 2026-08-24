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
}

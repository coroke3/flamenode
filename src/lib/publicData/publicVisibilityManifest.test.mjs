import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20default%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const {
    readPublicVisibilityBlockedEntitiesManifest,
    writePublicVisibilityBlockedEntitiesManifest,
  } =
    await import("./publicVisibilityManifest.ts");

  test("manifest size guard uses UTF-8 bytes rather than JavaScript characters", async () => {
    const multibyteId = "é".repeat(525_000);
    const bucket = {
      async get() {
        return {
          text: async () =>
            JSON.stringify({
              schema_version: 1,
              revision: 1,
              generated_at: 100,
              entities: [
                {
                  entity_type: "video",
                  entity_id: multibyteId,
                  fence_token: "token",
                  blocked_at: 100,
                },
              ],
            }),
        };
      },
    };

    await assert.rejects(
      () => readPublicVisibilityBlockedEntitiesManifest(bucket),
      /public_visibility_manifest_too_large/,
    );
  });

  test("R2 size metadata rejects an oversized manifest before text buffering", async () => {
    let textCalls = 0;
    const bucket = {
      async get() {
        return {
          size: 1024 * 1024 + 1,
          text: async () => {
            textCalls += 1;
            return "{}";
          },
        };
      },
    };

    await assert.rejects(
      () => readPublicVisibilityBlockedEntitiesManifest(bucket),
      /public_visibility_manifest_too_large/,
    );
    assert.equal(textCalls, 0);
  });

  test("enforce mode fails closed when the R2 manifest bucket is missing", async () => {
    const previous = process.env.PUBLIC_VISIBILITY_GUARD_MODE;
    process.env.PUBLIC_VISIBILITY_GUARD_MODE = "enforce";
    try {
      await assert.rejects(
        () => readPublicVisibilityBlockedEntitiesManifest(null),
        /public_visibility_manifest_bucket_missing/,
      );
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_VISIBILITY_GUARD_MODE;
      else process.env.PUBLIC_VISIBILITY_GUARD_MODE = previous;
    }
  });

  test("conditional manifest conflict re-reads and reapplies the mutator", async () => {
    let current = {
      etag: "newer-etag",
      body: JSON.stringify({
        schema_version: 1,
        revision: 4,
        generated_at: 100,
        entities: [
          {
            entity_type: "event",
            entity_id: "event-b",
            fence_token: "token-b",
            blocked_at: 100,
          },
        ],
      }),
    };
    let calls = 0;
    const bucket = {
      async get() {
        return {
          etag: current.etag,
          text: async () => current.body,
        };
      },
      async put(_key, body, options) {
        calls += 1;
        if (calls === 1) return null;
        assert.equal(options?.onlyIf?.etagMatches, "newer-etag");
        current = { etag: "merged-etag", body: String(body) };
        return { etag: current.etag };
      },
    };

    await writePublicVisibilityBlockedEntitiesManifest(
      {
        schema_version: 1,
        revision: 2,
        generated_at: 90,
        entities: [
          {
            entity_type: "event",
            entity_id: "event-a",
            fence_token: "token-a",
            blocked_at: 90,
          },
        ],
      },
      {
        bucket,
        ifMatchEtag: "old-etag",
        mutateOnConflict: (latest) => ({
          ...latest,
          revision: latest.revision + 1,
          generated_at: 101,
          entities: [
            ...latest.entities,
            {
              entity_type: "event",
              entity_id: "event-a",
              fence_token: "token-a",
              blocked_at: 101,
            },
          ],
        }),
      },
    );

    const saved = JSON.parse(current.body);
    assert.deepEqual(
      saved.entities.map((entry) => entry.entity_id).sort(),
      ["event-a", "event-b"],
    );
  });
}

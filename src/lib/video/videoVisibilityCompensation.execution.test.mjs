import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx =
  process.env.FLAMENODE_VISIBILITY_COMPENSATION_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_VISIBILITY_COMPENSATION_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  mock.module("next/navigation", {
    namedExports: {
      unstable_rethrow() {},
    },
  });

  const state = {
    videoVisibility: "public",
    fence: null,
    manifest: {
      schema_version: 1,
      revision: 1,
      generated_at: 1,
      entities: [
        {
          entity_type: "video",
          entity_id: "video-1",
          fence_token: "fence-token-1",
          blocked_at: 100,
        },
      ],
    },
    etag: "etag-1",
    readThrows: false,
    writeCalls: 0,
    writeThrows: [],
    warnLogs: [],
  };

  const originalWarn = console.warn;
  console.warn = (...args) => {
    state.warnLogs.push(args);
    originalWarn(...args);
  };

  mock.module("@/lib/publicData/publicVisibilityManifest", {
    namedExports: {
      async readPublicVisibilityBlockedEntitiesManifest() {
        if (state.readThrows) {
          throw new Error("manifest_unreadable");
        }
        return { manifest: structuredClone(state.manifest), etag: state.etag };
      },
      async writePublicVisibilityBlockedEntitiesManifest(_manifest, options) {
        state.writeCalls += 1;
        const nextError = state.writeThrows.shift();
        if (nextError) throw nextError;
        if (options?.ifMatchEtag && options.ifMatchEtag !== state.etag) {
          const error = new Error("etag_conflict");
          error.name = "PreconditionFailed";
          throw error;
        }
      },
    },
  });

  mock.module("@/lib/publicData/publicVisibilityFenceStore", {
    namedExports: {
      async getPublicVisibilityFence() {
        return state.fence;
      },
    },
  });

  const {
    compensateDepublicizationFenceOnD1Failure,
    handleVideoVisibilityMutationFailure,
  } = await import("./videoVisibilityTransition.ts");

  function createDb() {
    return {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  limit: async () => [
                    { visibility_status: state.videoVisibility },
                  ],
                };
              },
            };
          },
        };
      },
    };
  }

  function reset() {
    state.videoVisibility = "public";
    state.fence = null;
    state.manifest = {
      schema_version: 1,
      revision: 1,
      generated_at: 1,
      entities: [
        {
          entity_type: "video",
          entity_id: "video-1",
          fence_token: "fence-token-1",
          blocked_at: 100,
        },
      ],
    };
    state.etag = "etag-1";
    state.readThrows = false;
    state.writeCalls = 0;
    state.writeThrows = [];
    state.warnLogs = [];
  }

  test("public video with matching R2 token compensates by writing release", async () => {
    reset();
    await compensateDepublicizationFenceOnD1Failure(createDb(), {
      videoId: "video-1",
      fenceToken: "fence-token-1",
      traceId: "trace-1",
    });
    assert.equal(state.writeCalls, 1);
  });

  test("R2 token mismatch does not write", async () => {
    reset();
    state.manifest.entities[0].fence_token = "other-token";
    await compensateDepublicizationFenceOnD1Failure(createDb(), {
      videoId: "video-1",
      fenceToken: "fence-token-1",
      traceId: "trace-2",
    });
    assert.equal(state.writeCalls, 0);
  });

  test("private video does not write", async () => {
    reset();
    state.videoVisibility = "private";
    await compensateDepublicizationFenceOnD1Failure(createDb(), {
      videoId: "video-1",
      fenceToken: "fence-token-1",
      traceId: "trace-3",
    });
    assert.equal(state.writeCalls, 0);
  });

  test("confirmed D1 blocked fence with same token does not write", async () => {
    reset();
    state.fence = {
      state: "blocked",
      fence_token: "fence-token-1",
    };
    await compensateDepublicizationFenceOnD1Failure(createDb(), {
      videoId: "video-1",
      fenceToken: "fence-token-1",
      traceId: "trace-4",
    });
    assert.equal(state.writeCalls, 0);
  });

  test("missing R2 entry does not write", async () => {
    reset();
    state.manifest.entities = [];
    await compensateDepublicizationFenceOnD1Failure(createDb(), {
      videoId: "video-1",
      fenceToken: "fence-token-1",
      traceId: "trace-5a",
    });
    assert.equal(state.writeCalls, 0);
  });

  test("unreadable R2 manifest propagates without write", async () => {
    reset();
    state.readThrows = true;
    await assert.rejects(
      compensateDepublicizationFenceOnD1Failure(createDb(), {
        videoId: "video-1",
        fenceToken: "fence-token-1",
        traceId: "trace-5b",
      }),
    );
    assert.equal(state.writeCalls, 0);
  });

  test("ETag conflict retries then succeeds", async () => {
    reset();
    const conflict = new Error("etag_conflict");
    conflict.name = "PreconditionFailed";
    state.writeThrows = [conflict];
    await compensateDepublicizationFenceOnD1Failure(createDb(), {
      videoId: "video-1",
      fenceToken: "fence-token-1",
      traceId: "trace-6",
    });
    assert.equal(state.writeCalls, 2);
  });

  test("ETag conflict until max logs stuck_fence_candidate without throw", async () => {
    reset();
    const conflict = new Error("etag_conflict");
    conflict.name = "PreconditionFailed";
    state.writeThrows = [conflict, conflict, conflict];
    await assert.doesNotReject(
      compensateDepublicizationFenceOnD1Failure(createDb(), {
        videoId: "video-1",
        fenceToken: "fence-token-1",
        traceId: "trace-7",
      }),
    );
    assert.equal(state.writeCalls, 3);
    assert.ok(
      state.warnLogs.some((args) =>
        String(args[0]).includes("stuck_fence_candidate"),
      ),
    );
  });

  test("handleVideoVisibilityMutationFailure returns ok:false when compensation throws", async () => {
    reset();
    state.readThrows = true;
    const result = await handleVideoVisibilityMutationFailure(
      createDb(),
      new Error("d1_mutation_failed"),
      {
        flow: "admin_set_video_status",
        traceId: "trace-8",
        videoId: "video-1",
        eventId: "event-1",
        depublicizedFromPublic: true,
        fenceToken: "fence-token-1",
      },
    );
    assert.deepEqual(result, {
      ok: false,
      message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。",
    });
    assert.ok(
      state.warnLogs.some((args) =>
        String(args[0]).includes("stuck_fence_candidate"),
      ),
    );
  });
}

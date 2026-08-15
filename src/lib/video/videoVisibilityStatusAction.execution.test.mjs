import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_VIDEO_VISIBILITY_STATUS_EXECUTION === "1";

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
        FLAMENODE_VIDEO_VISIBILITY_STATUS_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { registerHooks } = await import("node:module");
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

  let currentHarness;

  mock.module("@/lib/audit/mutate", {
    namedExports: {
      AuditMutationError: class AuditMutationError extends Error {
        constructor(message = "mutation failed") {
          super(message);
          this.name = "AuditMutationError";
        }
      },
      async mutateWithAudit() {
        if (currentHarness.mutationMode === "success") {
          currentHarness.mutationCalls += 1;
          return [];
        }
        if (currentHarness.mutationMode === "cas_fail") {
          throw new currentHarness.AuditMutationError("changes mismatch");
        }
        throw new Error(`unexpected mutation mode: ${currentHarness.mutationMode}`);
      },
    },
  });

  mock.module("@/lib/video/videoVisibilityTransition", {
    namedExports: {
      async compensateDepublicizationFenceOnD1Failure() {},
      async preCommitVideoVisibilityDepublicization() {
        if (currentHarness.precommitMode === "fail") {
          throw new Error("public_visibility_fence_token_mismatch");
        }
      },
    },
  });

  const { AuditMutationError } = await import("@/lib/audit/mutate.ts");
  const { executeVideoVisibilityStatusMutation } = await import(
    "./videoVisibilityStatusAction.ts"
  );

  function createHarness({ visibilityStatus }) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE videos (
        id TEXT PRIMARY KEY,
        visibility_status TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    if (visibilityStatus !== null) {
      sqlite
        .prepare(
          "INSERT INTO videos (id, visibility_status, updated_at) VALUES (?, ?, 100)",
        )
        .run("video-1", visibilityStatus);
    }

    const harness = {
      sqlite,
      mutationMode: "success",
      precommitMode: "success",
      mutationCalls: 0,
      AuditMutationError,
      db: {
        select() {
          return {
            from() {
              return {
                where() {
                  return {
                    async limit() {
                      const row = sqlite
                        .prepare(
                          "SELECT id, visibility_status, updated_at FROM videos WHERE id = ?",
                        )
                        .get("video-1");
                      return row ? [row] : [];
                    },
                  };
                },
              };
            },
          };
        },
      },
    };
    return harness;
  }

  function makeTransition(queueStatements = [], options = {}) {
    return {
      mutationStatements: [{ kind: "mutation" }],
      expectedMutationChanges: [1],
      audits: [],
      notificationBatch: { statements: [], expectedChanges: [] },
      queueBatch: {
        statements: queueStatements,
        expectedChanges: queueStatements.map(() => 1),
        acceptedTargetCount: queueStatements.length,
      },
      depublicizedFromPublic: options.depublicizedFromPublic ?? false,
      fenceToken: options.fenceToken ?? null,
      publicCacheKeys: [],
    };
  }

  test("first operator succeeds pending to public", async () => {
    currentHarness = createHarness({ visibilityStatus: "pending" });
    currentHarness.mutationMode = "success";

    const result = await executeVideoVisibilityStatusMutation({
      db: currentHarness.db,
      videoId: "video-1",
      requestedStatus: "public",
      transition: makeTransition([{ kind: "queue" }]),
      reason: null,
      logTag: "test-video-status",
      staticRebuildWakeSource: "admin",
    });

    assert.equal(result.ok, true);
    assert.equal(result.message, "ステータスを更新しました。");
    assert.equal(result.pendingPublicReflection, true);
    assert.equal(currentHarness.mutationCalls, 1);
    currentHarness.sqlite.close();
  });

  test("second operator CAS fail with public reread is idempotent ok", async () => {
    currentHarness = createHarness({ visibilityStatus: "public" });
    currentHarness.mutationMode = "cas_fail";

    const result = await executeVideoVisibilityStatusMutation({
      db: currentHarness.db,
      videoId: "video-1",
      requestedStatus: "public",
      transition: makeTransition(),
      reason: null,
      logTag: "test-video-status",
    });

    assert.equal(result.ok, true);
    assert.equal(result.message, "すでに同じ状態へ更新されています。");
    assert.equal(result.errorCode, undefined);
    currentHarness.sqlite.close();
  });

  test("second operator CAS fail with different status returns concurrent_update", async () => {
    currentHarness = createHarness({ visibilityStatus: "private" });
    currentHarness.mutationMode = "cas_fail";

    const result = await executeVideoVisibilityStatusMutation({
      db: currentHarness.db,
      videoId: "video-1",
      requestedStatus: "public",
      transition: makeTransition(),
      reason: null,
      logTag: "test-video-status",
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "concurrent_update");
    assert.equal(result.retryable, true);
    assert.match(result.message, /別の担当者が状態を変更しました/);
    currentHarness.sqlite.close();
  });

  test("visibility precommit failure returns visibility_precommit_failed", async () => {
    currentHarness = createHarness({ visibilityStatus: "public" });
    currentHarness.precommitMode = "fail";

    const result = await executeVideoVisibilityStatusMutation({
      db: currentHarness.db,
      videoId: "video-1",
      requestedStatus: "private",
      transition: makeTransition([], {
        depublicizedFromPublic: true,
        fenceToken: "fence-1",
      }),
      reason: null,
      logTag: "test-video-status",
    });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "visibility_precommit_failed");
    assert.equal(result.retryable, false);
    assert.equal(result.message, "公開ブロックの記録に失敗しました。");
    assert.equal(currentHarness.mutationCalls, 0);
    currentHarness.sqlite.close();
  });
}

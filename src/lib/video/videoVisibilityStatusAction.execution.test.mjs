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
  const navigationUrl = import.meta.resolve("next/navigation.js");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "next/navigation") return nextResolve(navigationUrl, context);
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
        currentHarness.mutationAttempts += 1;
        if (currentHarness.mutationMode === "throw") {
          currentHarness.failureOrder.push("mutate");
          throw currentHarness.mutationFailure;
        }
        if (currentHarness.mutationMode === "success") {
          currentHarness.mutationCalls += 1;
          return [];
        }
        if (currentHarness.mutationMode === "cas_fail") {
          throw new currentHarness.AuditMutationError("changes mismatch");
        }
        throw new Error(`unexpected mutation mode: ${currentHarness.mutationMode}`);
      },
      asBatchRunnable(statement) {
        return statement;
      },
    },
  });

  mock.module("@/lib/video/videoVisibilityTransition", {
    namedExports: {
      async compensateDepublicizationFenceOnD1Failure() {
        currentHarness.compensationCalls += 1;
        currentHarness.failureOrder.push("compensate");
      },
      async preCommitVideoVisibilityDepublicization() {
        if (currentHarness.precommitMode === "fail") {
          throw new Error("public_visibility_fence_token_mismatch");
        }
      },
    },
  });

  // A void R2 compensator return is not proof of rollback. Model the manifest
  // readback explicitly rather than inheriting the host's absent-bucket state.
  mock.module("@/lib/publicData/visibilityManifestHost", {
    namedExports: {
      nextVisibilityManifestHost: {
        async read() {
          currentHarness.compensationReadbackCalls += 1;
          currentHarness.failureOrder.push("confirm");
          if (currentHarness.compensationReadbackMode === "read_error") {
            throw new Error("private R2 provider error");
          }
          return {
            etag: currentHarness.compensationReadbackMode === "missing_etag"
              ? null
              : "verified-r2-etag",
            manifest: {
              entities: currentHarness.compensationReadbackMode === "still_blocked"
                ? [{ entity_type: "video", entity_id: "video-1" }]
                : [],
            },
          };
        },
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
      compensationReadbackMode: "confirmed",
      compensationReadbackCalls: 0,
      rereadCalls: 0,
      mutationCalls: 0,
      mutationAttempts: 0,
      compensationCalls: 0,
      failureOrder: [],
      AuditMutationError,
      db: {
        select() {
          return {
            from() {
              return {
                where() {
                  return {
                    async limit() {
                      currentHarness.rereadCalls += 1;
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

  test("visibility precommit failure with confirmed cleanup returns visibility_precommit_failed", async () => {
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
    assert.equal(currentHarness.rereadCalls, 0,
      "a failed R2 precommit must not reread the D1 status");
    assert.equal(currentHarness.compensationReadbackCalls, 1,
      "a verified cleanup requires a fresh R2 manifest readback");
    currentHarness.sqlite.close();
  });

  for (const mode of ["missing_etag", "still_blocked", "read_error"]) {
    test(`visibility precommit failure with ${mode} R2 readback returns status_unverified`, async () => {
      currentHarness = createHarness({ visibilityStatus: "public" });
      currentHarness.precommitMode = "fail";
      currentHarness.compensationReadbackMode = mode;

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
      assert.equal(result.errorCode, "status_unverified");
      assert.equal(result.retryable, false);
      assert.equal(
        result.message,
        "状態の確認に失敗しました。状態を再取得してから操作してください。",
      );
      assert.equal(currentHarness.mutationCalls, 0);
      assert.equal(currentHarness.rereadCalls, 0,
        "no D1 status-oracle reread may occur after an ambiguous R2 precommit");
      assert.equal(currentHarness.compensationReadbackCalls, 1,
        "R2 compensation must be confirmed by one fresh manifest readback");
      currentHarness.sqlite.close();
    });
  }

  const failureCases = [
    ["unfenced", null, "confirmed"],
    ["fenced/confirmed", "fence-1", "confirmed"],
    ["fenced/unverified", "fence-1", "still_blocked"],
  ];

  function runFrameworkFailure(failure, fenceToken, readbackMode) {
    currentHarness = createHarness({ visibilityStatus: "public" });
    currentHarness.mutationMode = "throw";
    currentHarness.mutationFailure = failure;
    currentHarness.compensationReadbackMode = readbackMode;
    return executeVideoVisibilityStatusMutation({
      db: currentHarness.db,
      videoId: "video-1",
      requestedStatus: "private",
      transition: makeTransition([], {
        depublicizedFromPublic: fenceToken !== null,
        fenceToken,
      }),
      reason: null,
      logTag: "test-video-status",
    });
  }

  function assertFailureEffects(fenceToken) {
    const count = fenceToken ? 1 : 0;
    assert.equal(currentHarness.mutationAttempts, 1);
    assert.equal(currentHarness.mutationCalls, 0);
    assert.equal(currentHarness.compensationCalls, count);
    assert.equal(currentHarness.compensationReadbackCalls, count);
    assert.equal(currentHarness.rereadCalls, 0);
    assert.deepEqual(currentHarness.failureOrder,
      fenceToken ? ["mutate", "compensate", "confirm"] : ["mutate"]);
    assert.equal(currentHarness.sqlite.prepare(
      "SELECT visibility_status FROM videos WHERE id = ?",
    ).get("video-1").visibility_status, "public");
  }

  test("MIG-0603: real Next classifier hostile metadata fails closed before status reread", async () => {
    const secret = "MIG0603_PRIVATE_PROVIDER_CANARY";
    let accessorCalls = 0;
    const accessor = key => Object.defineProperty(new Error(secret), key, {
      get() { accessorCalls += 1; throw new Error(secret); },
    });
    const cycle = new Error(secret);
    cycle.cause = cycle;
    let tooDeep = new Error(secret);
    for (let n = 0; n < 65; n += 1) tooDeep = new Error(secret, { cause: tooDeep });
    const failures = [
      ["digest getter", accessor("digest")],
      ["message getter", accessor("message")],
      ["React marker getter", accessor("$$typeof")],
      ["cause getter", accessor("cause")],
      ["nested getter", new Error(secret, { cause: accessor("digest") })],
      ["has trap", new Proxy(new Error(secret), { has() { throw new Error(secret); } })],
      ["prototype trap", new Proxy(new Error(secret), { getPrototypeOf() { throw new Error(secret); } })],
      ["descriptor trap", new Proxy(new Error(secret), { getOwnPropertyDescriptor() { throw new Error(secret); } })],
      ["cyclic cause", cycle],
      ["bounded cause depth", tooDeep],
    ];
    for (const [name, failure] of failures) {
      for (const [variant, fenceToken, readbackMode] of failureCases) {
        const warnings = [];
        const originalWarn = console.warn;
        console.warn = (...args) => warnings.push(args);
        try {
          const result = await runFrameworkFailure(failure, fenceToken, readbackMode);
          assert.equal(result.ok, false, name + "/" + variant);
          assert.equal(result.errorCode, "status_unverified", name + "/" + variant);
          assert.equal(result.retryable, false);
          assert.equal(result.message, "状態の確認に失敗しました。状態を再取得してから操作してください。");
          assertFailureEffects(fenceToken);
          const codes = warnings.map(args => args[1].error_code);
          assert.deepEqual(codes, readbackMode === "still_blocked"
            ? ["visibility_compensation_failed", "status_framework_classification_unavailable"]
            : ["status_framework_classification_unavailable"]);
          for (const args of warnings) {
            assert.equal(args.length, 2);
            assert.deepEqual(Object.keys(args[1]).sort(), ["error_code", "traceId"]);
          }
          assert.doesNotMatch(JSON.stringify({ result, warnings }), new RegExp(secret));
        } finally {
          console.warn = originalWarn;
          currentHarness.sqlite.close();
        }
      }
    }
    assert.equal(accessorCalls, 0, "provider accessors must never execute");
  });

  test("MIG-0603: real Next signals keep exact direct/nested identity after verified compensation", async () => {
    const { redirect, notFound } = await import(navigationUrl);
    const { DynamicServerError } = await import("next/dist/client/components/hooks-server-context.js");
    const { BailoutToCSRError } = await import("next/dist/shared/lib/lazy-dynamic/bailout-to-csr.js");
    const { unstable_postpone } = await import("next/dist/compiled/react-experimental/index.js");
    for (const [name, raise] of [
      ["redirect", () => redirect("/list")],
      ["notFound", () => notFound()],
      ["dynamic server", () => { throw new DynamicServerError("headers"); }],
      ["client rendering", () => { throw new BailoutToCSRError("test"); }],
      ["React postpone", () => unstable_postpone("test")],
    ]) {
      let signal;
      try { raise(); } catch (error) { signal = error; }
      assert.ok(signal, name);
      for (const depth of [0, 1, 32]) {
        let failure = signal;
        for (let n = 0; n < depth; n += 1) failure = new Error("wrapper", { cause: failure });
        for (const [variant, fenceToken, readbackMode] of failureCases) {
          const label = name + "/" + depth + "/" + variant;
          try {
            const run = runFrameworkFailure(failure, fenceToken, readbackMode);
            if (readbackMode === "still_blocked") {
              const result = await run;
              assert.equal(result.ok, false, label);
              assert.equal(result.errorCode, "status_unverified", label);
              assert.equal(result.retryable, false, label);
            } else {
              await assert.rejects(run, error => error === signal, label);
            }
            assertFailureEffects(fenceToken);
          } finally {
            currentHarness.sqlite.close();
          }
        }
      }
    }
  });
}

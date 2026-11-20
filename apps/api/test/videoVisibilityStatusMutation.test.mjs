import assert from "node:assert/strict";
import { test } from "node:test";
import { executeVideoVisibilityStatusMutation } from "@flamenode/server-core/video/visibilityStatusMutation";

function transition(overrides = {}) {
  return {
    mutationStatements: ["video-update"],
    expectedMutationChanges: [1],
    audits: [{ table_name: "videos", target_id: "v-1", operation: "UPDATE" }],
    notificationBatch: { statements: [], expectedChanges: [] },
    queueBatch: { statements: ["rebuild"], expectedChanges: [1], acceptedTargetCount: 1 },
    fenceToken: "fence-1",
    depublicizedFromPublic: true,
    validationError: undefined,
    ...overrides,
  };
}

function host(overrides = {}, calls = []) {
  return {
    createTraceId: () => "trace-1",
    preCommit: async () => { calls.push("precommit"); },
    mutate: async (_db, input) => { calls.push(["mutate", input]); },
    compensate: async () => { calls.push("compensate"); },
    confirmCompensation: async () => true,
    rethrowFrameworkControl: () => {},
    isAuditMutationError: () => false,
    rereadStatus: async () => "private",
    isVisibilityPrecommitFailure: () => false,
    markPendingPublicReflection: (result, enqueued) =>
      result.ok && enqueued ? { ...result, pendingPublicReflection: true } : result,
    log: (level, tag) => calls.push(["log", level, tag]),
    ...overrides,
  };
}

test("pre-commit fence is awaited before the atomic audited mutation", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "private",
    transition: transition(),
    reason: "moderation",
    logTag: "admin-video-status",
  }, host({}, calls));

  assert.equal(result.ok, true);
  assert.equal(result.pendingPublicReflection, true);
  assert.equal(calls[0], "precommit");
  assert.equal(calls[1][0], "mutate");
  assert.deepEqual(calls[1][1].expectedMutationChanges, [1]);
});

test("notification outbox SQL joins the video, fence, and rebuild writes in the same audit batch", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "voided",
    transition: transition({
      mutationStatements: ["video-status-CAS", "fence-upsert", "rebuild-queue"],
      expectedMutationChanges: [1, 1, null],
      notificationBatch: {
        statements: ["notification-outbox-insert"],
        expectedChanges: [1],
      },
    }),
    reason: "moderation",
    logTag: "admin-video-status",
    notificationWakeSource: "admin",
    staticRebuildWakeSource: "admin",
  }, host({}, calls));

  assert.equal(result.ok, true);
  const mutation = calls.find((entry) => Array.isArray(entry) && entry[0] === "mutate");
  assert.ok(mutation, "one atomic audited mutation is invoked");
  assert.deepEqual(mutation[1].mutationStatements, [
    "video-status-CAS",
    "fence-upsert",
    "rebuild-queue",
    "notification-outbox-insert",
  ]);
  assert.deepEqual(mutation[1].expectedMutationChanges, [1, 1, null, 1]);
  assert.equal(mutation[1].notificationWakeSource, "admin");
  assert.equal(mutation[1].staticRebuildWakeSource, "admin");
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "precommit", "mutate",
  ], "the outbox is not executed as a separate postcommit write");
});

test("validation errors stop before any external mutation", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "public",
    transition: transition({ validationError: "invalid transition" }),
    reason: null,
    logTag: "admin-video-status",
  }, host({}, calls));

  assert.deepEqual(result, { ok: false, message: "invalid transition" });
  assert.deepEqual(calls, []);
});

test("audit CAS error compensates the fence and treats an already-applied status as idempotent", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "private",
    transition: transition({ queueBatch: { statements: [], expectedChanges: [], acceptedTargetCount: 0 } }),
    reason: "moderation",
    logTag: "admin-video-status",
  }, host({
    mutate: async () => { throw Object.assign(new Error("CAS"), { auditMutation: true }); },
    isAuditMutationError: (error) => Boolean(error?.auditMutation),
    rereadStatus: async () => "private",
  }, calls));

  assert.equal(result.ok, true);
  assert.equal(result.message, "すでに同じ状態へ更新されています。");
  assert.equal(result.pendingPublicReflection, undefined);
  assert.ok(calls.includes("compensate"));
});

test("audit CAS error with a different current status returns retryable conflict", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "private",
    transition: transition(),
    reason: null,
    logTag: "admin-video-status",
  }, host({
    mutate: async () => { throw Object.assign(new Error("CAS"), { auditMutation: true }); },
    isAuditMutationError: (error) => Boolean(error?.auditMutation),
    rereadStatus: async () => "public",
  }, calls));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "concurrent_update");
  assert.equal(result.traceId, "trace-1");
  assert.equal(result.retryable, true);
});

test("MIG-0603: aborted trusted first-batch guards never become idempotent success or auto-retry", async () => {
  const secret = "session=private-bearer-token SQL=SELECT";
  for (const [tag, classifiedAsAuditError, current] of [
    ["same-status-CAS", true, "private"],
    ["other-status-CAS", true, "public"],
    ["revoked-guard-provider-error", false, "private"],
    ["revoked-guard-other-status", false, "public"],
  ]) {
    const calls = [];
    const abort = new Error("failed first batch guard " + secret);
    if (classifiedAsAuditError) abort.auditMutation = true;
    const result = await executeVideoVisibilityStatusMutation({
      db: {}, videoId: "v-1", requestedStatus: "private",
      transition: transition({
        fenceToken: null, depublicizedFromPublic: false,
        queueBatch: { statements: [], expectedChanges: [], acceptedTargetCount: 0 },
      }),
      preMutationAssertions: ["trusted-live-revocable-identity-grant"],
      reason: "review", logTag: "manage-video-status",
    }, host({
      mutate: async () => { calls.push("mutate"); throw abort; },
      isAuditMutationError: (error) => Boolean(error?.auditMutation),
      rereadStatus: async () => {
        calls.push("reread");
        return current;
      },
      log: (level, message, details) => calls.push(["log", level, message, details]),
    }, calls));
    assert.deepEqual(result, {
      ok: false,
      message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
      errorCode: "status_unverified", traceId: "trace-1", retryable: false,
    }, tag);
    assert.deepEqual(calls.map((call) => Array.isArray(call) ? call[0] : call),
      ["mutate", "log"], tag + ": never perform status-oracle reread after an unverified guard");
    assert.equal(calls[1][1], "warn");
    assert.deepEqual(calls[1][3], {
      traceId: "trace-1", error_code: "status_guard_or_mutation_failed",
    });
    assert.doesNotMatch(JSON.stringify({ result, calls }), /private-bearer-token|SQL=SELECT/,
      "sensitive provider errors never reach responses or logs");
  }
});

test("shared CURRENT/Hono status failures log fixed codes, never provider SQL or tokens", async () => {
  const secret = "Authorization:Bearer private-credential password=secret";
  for (const [name, overrides, expectedCode] of [
    ["precommit", {
      preCommit: async () => { throw new Error("public_visibility_manifest_missing " + secret); },
      isVisibilityPrecommitFailure: () => true,
    }, "visibility_precommit_failed"],
    ["mutation", {
      mutate: async () => { throw new Error("D1 SQL SELECT token FROM sessions " + secret); },
    }, "mutation_failed"],
  ]) {
    const calls = [];
    const result = await executeVideoVisibilityStatusMutation({
      db: {}, videoId: "v-1", requestedStatus: "private",
      transition: transition(), reason: "moderation", logTag: "admin-video-status",
    }, host({
      ...overrides,
      log: (level, tag, details) => calls.push(["log", level, tag, details]),
    }, calls));
    assert.equal(result.ok, false, name);
    assert.equal(result.errorCode, expectedCode, name);
    assert.equal(result.traceId, "trace-1", name);
    const logged = calls.filter((entry) => Array.isArray(entry) && entry[0] === "log");
    assert.equal(logged.length, 1, name);
    assert.equal(logged[0][1], "error", name);
    assert.deepEqual(logged[0][3], { traceId: "trace-1", error_code: expectedCode }, name);
    assert.doesNotMatch(JSON.stringify(logged), /private-credential|password=secret|SELECT token/, name);
  }
});

test("fence pre-commit failure runs token-scoped compensation before non-retryable mapping", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "private",
    transition: transition(),
    reason: null,
    logTag: "admin-video-status",
  }, host({
    preCommit: async () => { throw new Error("public_visibility_manifest_unavailable"); },
    isVisibilityPrecommitFailure: () => true,
  }, calls));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "visibility_precommit_failed");
  assert.equal(result.retryable, false);
  assert.equal(calls.some((entry) => entry === "compensate"), true);
});



test("generic R2 precommit transport failure is never retryable or mislabeled as a D1 CAS", async () => {
  const privateToken = "Authorization:Bearer upstream-secret SQL=SELECT";
  for (const auditFlag of [false, true]) {
    const calls = [];
    const result = await executeVideoVisibilityStatusMutation({
      db: {},
      videoId: "v-1",
      requestedStatus: "private",
      transition: transition(),
      reason: "moderation",
      logTag: "admin-video-status",
    }, host({
      preCommit: async () => {
        calls.push("precommit");
        const error = new Error("R2 HTTP transport timeout " + privateToken);
        if (auditFlag) error.auditMutation = true;
        throw error;
      },
      isVisibilityPrecommitFailure: () => false,
      // Even a mis-tagged error from the R2 adapter must never trigger D1
      // CAS idempotency classification or rereads before a D1 write occurred.
      isAuditMutationError: (error) => Boolean(error?.auditMutation),
      compensate: async (_db, input) => {
        calls.push("compensate");
        assert.equal(input.videoId, "v-1");
        assert.equal(input.fenceToken, "fence-1");
        assert.equal(input.allowNonPublicRollback, false);
      },
      mutate: async () => { calls.push("mutate"); },
      rereadStatus: async () => { calls.push("reread"); return "private"; },
      log: (level, tag, details) => calls.push(["log", level, tag, details]),
    }, calls));
    assert.deepEqual(result, {
      ok: false,
      message: "公開ブロックの記録に失敗しました。",
      errorCode: "visibility_precommit_failed",
      traceId: "trace-1",
      retryable: false,
    });
    assert.deepEqual(calls.map((value) => Array.isArray(value) ? value[0] : value), [
      "precommit", "compensate", "log",
    ], "no audit mutation, no D1 CAS reread, compensation before fixed error response");
    const diagnostic = calls[2];
    assert.equal(diagnostic[1], "error");
    assert.deepEqual(diagnostic[3], {
      traceId: "trace-1", error_code: "visibility_precommit_failed",
    });
    assert.doesNotMatch(JSON.stringify({ result, calls }), /upstream-secret|SQL=SELECT|Authorization:Bearer/);
  }
});

test("failed R2 fence compensation prevents unsafe retryable D1 CAS response", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "private",
    transition: transition(),
    reason: "moderation",
    logTag: "admin-video-status",
  }, host({
    mutate: async () => {
      calls.push("mutate");
      throw Object.assign(new Error("CAS conflict"), { auditMutation: true });
    },
    isAuditMutationError: (error) => Boolean(error?.auditMutation),
    compensate: async (_db, input) => {
      calls.push(["compensate", input]);
      throw new Error("R2 compensation unavailable Authorization:Bearer compensation-secret");
    },
    rereadStatus: async () => {
      calls.push("reread");
      return "public";
    },
    log: (level, tag, details) => calls.push(["log", level, tag, details]),
  }, calls));

  assert.equal(result.ok, false);
  assert.deepEqual(result, {
    ok: false,
    message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
    errorCode: "status_unverified",
    traceId: "trace-1",
    retryable: false,
  });
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "precommit",
    "mutate",
    "compensate",
    "log",
  ], "failed compensation must not allow an automatic D1 retry or idempotent status inference");
  const compensation = calls.find((entry) => Array.isArray(entry) && entry[0] === "compensate");
  assert.equal(compensation[1].videoId, "v-1");
  assert.equal(compensation[1].fenceToken, "fence-1");
  assert.equal(compensation[1].allowNonPublicRollback, false);
  const warning = calls.find((entry) => Array.isArray(entry) && entry[0] === "log");
  assert.equal(warning[1], "warn");
  assert.deepEqual(warning[3], {
    traceId: "trace-1", error_code: "visibility_compensation_failed",
  });
  assert.doesNotMatch(JSON.stringify(warning), /compensation-secret|Authorization:Bearer/);
});

test("unconfirmed R2 rollback cannot report public status already applied (CURRENT/Hono core)", async () => {
  const privateError = "Authorization:Bearer secret-public-provider-token";
  for (const auditFailure of [true, false]) {
    const calls = [];
    const result = await executeVideoVisibilityStatusMutation({
      db: {},
      videoId: "v-1",
      requestedStatus: "public",
      transition: transition({ depublicizedFromPublic: false }),
      reason: null,
      logTag: "admin-video-status",
    }, host({
      mutate: async () => {
        calls.push("mutate");
        const failure = new Error("D1 mutation rejected " + privateError);
        if (auditFailure) failure.auditMutation = true;
        throw failure;
      },
      isAuditMutationError: (error) => Boolean(error?.auditMutation),
      compensate: async (_db, input) => {
        calls.push("compensate");
        assert.equal(input.allowNonPublicRollback, true);
        throw new Error("R2 rollback timeout " + privateError);
      },
      // Even if a concurrent update appears public, the failed R2 rollback
      // means this cannot be interpreted as confirmed public visibility.
      rereadStatus: async () => { calls.push("reread"); return "public"; },
      log: (level, tag, details) => calls.push(["log", level, tag, details]),
    }, calls));
    assert.deepEqual(result, {
      ok: false,
      message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
      errorCode: "status_unverified",
      traceId: "trace-1",
      retryable: false,
    });
    assert.deepEqual(calls.map((item) => Array.isArray(item) ? item[0] : item), [
      "precommit", "mutate", "compensate", "log",
    ], "do not claim idempotent success or issue a new D1 query after R2 rollback failed");
    assert.deepEqual(calls[3], [
      "log", "warn", "[admin-video-status] visibility compensation failed",
      { traceId: "trace-1", error_code: "visibility_compensation_failed" },
    ]);
    assert.doesNotMatch(JSON.stringify({ result, calls }), /secret-public-provider-token|Authorization:Bearer/);
  }
});

test("best-effort R2 compensation silently exhausts retries: never claim public visibility or retry", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "public",
    transition: transition({ depublicizedFromPublic: false }),
    reason: null,
    logTag: "manage-video-status",
  }, host({
    mutate: async () => {
      calls.push("mutate");
      throw Object.assign(new Error("audit CAS mismatch"), { auditMutation: true });
    },
    isAuditMutationError: (error) => Boolean(error?.auditMutation),
    compensate: async () => {
      calls.push("compensate");
      // Mirrors the actual compensation helper: logs failed R2 CAS retries
      // then returns void without throwing an exception.
    },
    confirmCompensation: async (videoId) => {
      calls.push("confirm");
      assert.equal(videoId, "v-1");
      return false; // R2 manifest still contains a blocked video.
    },
    rereadStatus: async () => { calls.push("reread"); return "public"; },
    log: (level, tag, details) => calls.push(["log", level, tag, details]),
  }, calls));
  assert.deepEqual(result, {
    ok: false,
    message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
    errorCode: "status_unverified",
    traceId: "trace-1",
    retryable: false,
  });
  assert.deepEqual(calls.map((row) => Array.isArray(row) ? row[0] : row), [
    "precommit", "mutate", "compensate", "confirm", "log",
  ], "a void return cannot prove R2 rollback or authorize a new D1 read");
  assert.deepEqual(calls[4], [
    "log", "warn", "[manage-video-status] visibility compensation failed",
    { traceId: "trace-1", error_code: "visibility_compensation_failed" },
  ]);
});

test("R2 compensation readback unavailable also fails closed without idempotent success", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {}, videoId: "v-1", requestedStatus: "public",
    transition: transition({ depublicizedFromPublic: false }),
    reason: null, logTag: "admin-video-status",
  }, host({
    mutate: async () => { calls.push("mutate"); throw new Error("D1 transport error"); },
    compensate: async () => { calls.push("compensate"); },
    confirmCompensation: async () => {
      calls.push("confirm");
      throw new Error("R2 readback timeout Authorization:Bearer private");
    },
    rereadStatus: async () => { calls.push("reread"); return "public"; },
    log: (level, tag, details) => calls.push(["log", level, tag, details]),
  }, calls));
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "status_unverified");
  assert.equal(result.retryable, false);
  assert.deepEqual(calls.map((row) => Array.isArray(row) ? row[0] : row), [
    "precommit", "mutate", "compensate", "confirm", "log",
  ]);
  assert.doesNotMatch(JSON.stringify({ result, calls }), /Authorization:Bearer|private/);
});

test("CAS status reread outage is non-retryable and never leaks D1 secrets (CURRENT/Hono core)", async () => {
  const secret = "SELECT sessionToken FROM session WHERE password=classified";
  for (const fenceToken of ["fence-1", null]) {
    const calls = [];
    const result = await executeVideoVisibilityStatusMutation({
      db: {},
      videoId: "v-1",
      requestedStatus: "private",
      transition: transition({ fenceToken }),
      reason: "moderation",
      logTag: "admin-video-status",
    }, host({
      mutate: async () => {
        calls.push("mutate");
        throw Object.assign(new Error("CAS conflict"), { auditMutation: true });
      },
      isAuditMutationError: (error) => Boolean(error?.auditMutation),
      compensate: async () => { calls.push("compensate"); },
      rereadStatus: async () => {
        calls.push("reread");
        throw new Error("D1 unavailable " + secret);
      },
      log: (level, tag, details) => calls.push(["log", level, tag, details]),
    }, calls));

    assert.deepEqual(result, {
      ok: false,
      message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
      errorCode: "status_unverified",
      traceId: "trace-1",
      retryable: false,
    }, "unconfirmed CAS outcome must never be a success or an automatic retry");
    assert.deepEqual(
      calls.map((entry) => Array.isArray(entry) ? entry[0] : entry),
      fenceToken ? ["precommit", "mutate", "compensate", "reread", "log"]
        : ["mutate", "reread", "log"],
      "reread must follow the original CAS error and any token-scoped compensation",
    );
    const warnings = calls.filter((entry) => Array.isArray(entry) && entry[0] === "log");
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0].slice(1), [
      "warn", "[admin-video-status] visibility status reread failed",
      { traceId: "trace-1", error_code: "visibility_status_reread_failed" },
    ]);
    assert.doesNotMatch(JSON.stringify({ result, calls }), /classified|sessionToken|SELECT session/i);
  }
});

test("R2 compensation unavailable returns sanitized status_unverified without unsafe D1 reread", async () => {
  const calls = [];
  const result = await executeVideoVisibilityStatusMutation({
    db: {},
    videoId: "v-1",
    requestedStatus: "public",
    transition: transition({ depublicizedFromPublic: false }),
    reason: null,
    logTag: "manage-video-status",
  }, host({
    mutate: async () => { throw Object.assign(new Error("CAS"), { auditMutation: true }); },
    isAuditMutationError: (error) => Boolean(error?.auditMutation),
    compensate: async () => { throw new Error("R2 account_token=private"); },
    rereadStatus: async () => { throw new Error("D1 authorization=private"); },
    log: (level, tag, details) => calls.push([level, tag, details]),
  }, calls));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "status_unverified");
  assert.equal(result.retryable, false);
  // host() records the successful precommit as a string event too;
  // only structured logger calls have a diagnostic error_code field.
  const diagnosticLogs = calls.filter((entry) => Array.isArray(entry));
  assert.deepEqual(diagnosticLogs.map((entry) => entry[2].error_code), [
    "visibility_compensation_failed",
  ]);
  assert.deepEqual(diagnosticLogs.map((entry) => entry[0]), ["warn"]);
  assert.equal(diagnosticLogs.length, 1, "a failed compensation aborts before an extra D1 reread");
  assert.doesNotMatch(JSON.stringify({ calls, result }), /account_token|authorization=private/);
});


test("CAS status reread returns no row: reject unknown outcome without unsafe retry", async () => {
  for (const observed of [null, undefined]) {
    for (const fenceToken of ["fence-1", null]) {
      const calls = [];
      const result = await executeVideoVisibilityStatusMutation({
        db: {},
        videoId: "v-1",
        requestedStatus: "private",
        transition: transition({ fenceToken }),
        reason: null,
        logTag: "manage-video-status",
      }, host({
        mutate: async () => {
          calls.push("mutate");
          throw Object.assign(new Error("CAS conflict"), { auditMutation: true });
        },
        isAuditMutationError: (error) => Boolean(error?.auditMutation),
        compensate: async () => { calls.push("compensate"); },
        rereadStatus: async () => {
          calls.push("reread");
          return observed;
        },
        log: (level, tag, details) => calls.push(["log", level, tag, details]),
      }, calls));

      assert.deepEqual(result, {
        ok: false,
        message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
        errorCode: "status_unverified",
        traceId: "trace-1",
        retryable: false,
      }, "a missing row is not positive confirmation of a stale CAS conflict");
      assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry),
        fenceToken ? ["precommit", "mutate", "compensate", "reread", "log"]
          : ["mutate", "reread", "log"]);
      assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && entry[0] === "log"),
        [["log", "warn", "[manage-video-status] visibility status missing after CAS conflict",
          { traceId: "trace-1", error_code: "visibility_status_missing" }]],
        "only a fixed diagnostic is logged, never the missing-row provider response");
    }
  }
});

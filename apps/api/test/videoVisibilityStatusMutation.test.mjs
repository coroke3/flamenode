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


test("failed fence compensation does not mask the original audit CAS conflict", async () => {
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
  assert.equal(result.errorCode, "concurrent_update");
  assert.equal(result.retryable, true);
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "precommit",
    "mutate",
    "compensate",
    "log",
    "reread",
  ]);
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

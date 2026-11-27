import assert from "node:assert/strict";
import { test } from "node:test";
import { handleNotificationWakeQueue } from "../fast-jobs/notificationQueueConsumer.ts";
import { handleStaticRebuildWakeQueue } from "../content-jobs/staticRebuildWakeQueue.ts";
import { logWorkerJob, logQueueConsumerFailure, normalizeQuotaStopReason, safeErrorSummary } from "./safeLog.ts";

test("safeErrorSummary redacts credentials from worker logs", () => {
  const summary = safeErrorSummary(
    "request failed: Cookie=session_id=top-secret Authorization: Bearer bearer-secret",
  );
  assert.doesNotMatch(summary, /top-secret|bearer-secret/);
  assert.match(summary, /Cookie=\[REDACTED\]/);
  assert.match(summary, /Authorization:\[REDACTED\]/);
});

test("safeErrorSummary redacts compound OAuth credential keys", () => {
  const summary = safeErrorSummary(
    "refresh_token=TOPSECRET client_secret=SECONDSECRET access_token=THIRDSECRET",
  );
  assert.doesNotMatch(summary, /TOPSECRET|SECONDSECRET|THIRDSECRET/);
  assert.match(summary, /refresh_token=\[REDACTED\]/);
  assert.match(summary, /client_secret=\[REDACTED\]/);
  assert.match(summary, /access_token=\[REDACTED\]/);
});

test("safeErrorSummary redacts complete URLs, including opaque query values", () => {
  const summary = safeErrorSummary(
    "request failed https://storage.example/private/path?opaque=TOPSECRET",
  );
  assert.doesNotMatch(summary, /storage\.example|TOPSECRET|opaque/);
  assert.match(summary, /\[REDACTED_URL\]/);
});

test("normalizes quota reasons to the internal vocabulary", () => {
  assert.equal(normalizeQuotaStopReason("DAILY_LIMIT"), "daily_limit");
  assert.equal(normalizeQuotaStopReason("https://secret.example/id"), "unknown");
  assert.equal(normalizeQuotaStopReason(undefined), undefined);
});

test("logQueueConsumerFailure emits structured queue consumer errors", () => {
  const original = console.warn;
  let line = "";
  console.warn = (value) => {
    line = String(value);
  };
  try {
    logQueueConsumerFailure({
      service: "flamenode-fast-jobs",
      queueKind: "notification_available",
      messageCount: 2,
      error: new Error("Bearer secret-token failed"),
    });
  } finally {
    console.warn = original;
  }
  const parsed = JSON.parse(line);
  assert.equal(parsed.service, "flamenode-fast-jobs");
  assert.equal(parsed.queue_kind, "notification_available");
  assert.equal(parsed.message_count, 2);
  assert.doesNotMatch(parsed.error, /secret-token/);
});

test("logWorkerJob emits structured observability fields", () => {
  const original = console.log;
  let line = "";
  console.log = (value) => { line = String(value); };
  try {
    logWorkerJob({ worker: "w", job: "j", run_id: "r", started_at: "t", processed: 0, skipped: 0, failed: 0, duration_ms: 1, result: "skipped", external_api_calls: 2, d1_changes: 3, retry_count: 1, quota_stopped: false, commit_sha: "a".repeat(40) });
  } finally { console.log = original; }
  const parsed = JSON.parse(line);
  assert.equal(parsed.external_api_calls, 2);
  assert.equal(parsed.commit_sha, "a".repeat(40));
});
test("SEC-785: hostile Error.message, Proxy and non-string messages remain safe", () => {
  let readCount = 0;
  const poisoned = new Error("PROVIDER_SECRET");
  Object.defineProperty(poisoned, "message", {
    get() {
      readCount += 1;
      throw new Error("POISONED_MESSAGE_ACCESS");
    },
  });
  assert.equal(safeErrorSummary(poisoned), "worker task failed");
  assert.equal(readCount, 1);

  const hostile = new Proxy(new Error("PROVIDER_PRIVATE"), {
    getPrototypeOf() {
      throw new Error("POISONED_PROXY_PROTOTYPE");
    },
  });
  assert.equal(safeErrorSummary(hostile), "worker task failed");

  const wrongType = new Error("original");
  Object.defineProperty(wrongType, "message", { value: { toString() { throw new Error("POISONED_TO_STRING"); } } });
  assert.equal(safeErrorSummary(wrongType), "worker task failed");

  const prior = console.warn;
  let emitted = "";
  console.warn = (line) => { emitted = String(line); };
  try {
    logQueueConsumerFailure({ service: "test-worker", queueKind: "notification_available", messageCount: 1, error: poisoned });
  } finally {
    console.warn = prior;
  }
  assert.equal(JSON.parse(emitted).error, "worker task failed");
  assert.doesNotMatch(emitted, /PROVIDER_SECRET|POISONED_/);
});

test("SEC-785: a broken console.warn cannot block actual notification and static rebuild Queue retries", async () => {
  const poison = new Error("PRIVATE_PROVIDER_PAYLOAD");
  Object.defineProperty(poison, "message", {
    get() { throw new Error("POISONED_MESSAGE_GETTER"); },
  });
  const env = {
    DB: { prepare() { throw poison; } },
    R2: { async get() { return null; }, async put() {} },
    KV: {},
    QUEUE_DISPATCH_ENABLED: "1",
    QUEUE_CONTINUATION_ENABLED: "0",
  };
  const mkMessage = (kind) => ({
    body: { version: 1, kind, source: "web", requested_at: 1, trace_id: "trace-1" },
    ackCalls: 0,
    retryCalls: 0,
    ack() { this.ackCalls++; },
    retry() { this.retryCalls++; },
  });
  const notification = mkMessage("notification_available");
  const staticRebuild = mkMessage("static_rebuild_available");
  const original = console.warn;
  let failedLogCalls = 0;
  console.warn = () => { failedLogCalls++; throw new Error("BROKEN_LOG_SINK"); };
  try {
    await handleNotificationWakeQueue({ messages: [notification] }, env);
    const result = await handleStaticRebuildWakeQueue({ messages: [staticRebuild] }, env);
    assert.equal(result.retryBatch, true);
    assert.equal(result.failed, 1);
  } finally {
    console.warn = original;
  }
  assert.equal(failedLogCalls, 2, "both consumer catch paths attempted best-effort diagnostics");
  for (const message of [notification, staticRebuild]) {
    assert.equal(message.ackCalls, 0, "a failed D1 drain must not be acknowledged");
    assert.equal(message.retryCalls, 1, "logger failure must not stop the Queue retry");
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
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

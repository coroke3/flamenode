import assert from "node:assert/strict";
import { test } from "node:test";
import { logWorkerJob, normalizeQuotaStopReason, safeErrorSummary } from "./safeLog.ts";

test("safeErrorSummary redacts credentials from worker logs", () => {
  const summary = safeErrorSummary(
    "request failed: Cookie=session_id=top-secret Authorization: Bearer bearer-secret",
  );
  assert.doesNotMatch(summary, /top-secret|bearer-secret/);
  assert.match(summary, /Cookie=\[REDACTED\]/);
  assert.match(summary, /Authorization:\[REDACTED\]/);
});

test("normalizes quota reasons to the internal vocabulary", () => {
  assert.equal(normalizeQuotaStopReason("DAILY_LIMIT"), "daily_limit");
  assert.equal(normalizeQuotaStopReason("https://secret.example/id"), "unknown");
  assert.equal(normalizeQuotaStopReason(undefined), undefined);
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

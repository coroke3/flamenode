import assert from "node:assert/strict";
import { test } from "node:test";
import { safeErrorSummary } from "./safeLog.ts";

test("safeErrorSummary redacts credentials from worker logs", () => {
  const summary = safeErrorSummary(
    "request failed: Cookie=session_id=top-secret Authorization: Bearer bearer-secret",
  );
  assert.doesNotMatch(summary, /top-secret|bearer-secret/);
  assert.match(summary, /Cookie=\[REDACTED\]/);
  assert.match(summary, /Authorization:\[REDACTED\]/);
});

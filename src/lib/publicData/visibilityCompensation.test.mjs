import assert from "node:assert/strict";
import { test } from "node:test";
import { logStuckPublicVisibilityFenceCandidate } from "./visibilityCompensation.ts";

test("failed visibility compensation emits a structured stuck-fence candidate", () => {
  const originalWarn = console.warn;
  const rows = [];
  console.warn = (value) => rows.push(String(value));
  try {
    logStuckPublicVisibilityFenceCandidate({
      flow: "fixture",
      entityType: "x_user",
      entityId: "creator",
      fenceToken: "vf_fixture",
      error: new Error("r2_cas_failed"),
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0]), {
    service: "visibility_fence",
    flow: "fixture",
    phase: "stuck_fence_candidate",
    entity_type: "x_user",
    entity_id: "creator",
    fence_token: "vf_fixture",
    attempt_count: 3,
    error_code: "r2_cas_failed",
  });
});

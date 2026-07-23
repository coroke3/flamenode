/**
 * operation_mode KV 複製ヘルパー。
 *
 * Usage: node --test src/lib/operationMode/kvMirror.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATION_MODE_KV_KEY,
  parseOperationModeKvMirror,
} from "./kvMirrorCore.ts";

test("parseOperationModeKvMirror: 有効な JSON を解釈する", () => {
  assert.deepEqual(
    parseOperationModeKvMirror(
      JSON.stringify({
        mode: "economy",
        updated_at: 1_700_000_000,
        reason: "quota",
      }),
    ),
    {
      mode: "economy",
      updated_at: 1_700_000_000,
      reason: "quota",
    },
  );
});

test("parseOperationModeKvMirror: 不正値は null", () => {
  assert.equal(parseOperationModeKvMirror(null), null);
  assert.equal(parseOperationModeKvMirror(""), null);
  assert.equal(parseOperationModeKvMirror("{"), null);
  assert.equal(
    parseOperationModeKvMirror(JSON.stringify({ mode: "broken", updated_at: 1 })),
    null,
  );
  assert.equal(
    parseOperationModeKvMirror(JSON.stringify({ mode: "economy" })),
    null,
  );
});

test("OPERATION_MODE_KV_KEY は固定キー", () => {
  assert.equal(OPERATION_MODE_KV_KEY, "operation_mode:mirror");
});

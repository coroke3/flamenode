/**
 * 公開向け operation_mode 解決。
 *
 * Usage: node --test src/lib/operationMode/publicMode.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseOperationModeKvMirror } from "./kvMirrorCore.ts";
import {
  isForceStaticOnlyEnv,
  readIsolateModeCache,
  resetPublicOperationModeCacheForTests,
  resolveForcedOperationMode,
  writeIsolateModeCache,
} from "./publicModeCore.ts";

const publicModeSource = await readFile(
  new URL("./publicMode.ts", import.meta.url),
  "utf8",
);

test("isForceStaticOnlyEnv: 1 / true / yes のみ有効", () => {
  for (const value of ["1", "true", "TRUE", "yes", "Yes"]) {
    assert.equal(isForceStaticOnlyEnv(value), true, value);
  }
  for (const value of ["0", "false", "", "normal", undefined]) {
    assert.equal(isForceStaticOnlyEnv(value), false, String(value));
  }
});

test("resolveForcedOperationMode: FORCE_STATIC_ONLY で static_only", () => {
  assert.equal(resolveForcedOperationMode(undefined), null);
  assert.equal(resolveForcedOperationMode("1"), "static_only");
});

test("isolate cache は TTL 内だけ有効", () => {
  resetPublicOperationModeCacheForTests();
  assert.equal(readIsolateModeCache(1_000), null);
  writeIsolateModeCache("economy", 1_000);
  assert.equal(readIsolateModeCache(1_000), "economy");
  assert.equal(readIsolateModeCache(40_000), null);
});

test("parseOperationModeKvMirror は reason を保持する", () => {
  const mirror = parseOperationModeKvMirror(
    JSON.stringify({ mode: "read_only", updated_at: 10, reason: "manual" }),
  );
  assert.equal(mirror?.mode, "read_only");
  assert.equal(mirror?.reason, "manual");
});

test("resolvePublicOperationMode: 設定解決不能時も static_only へ自動遷移しない", () => {
  assert.match(publicModeSource, /const fallback: OperationMode = "normal"/);
  assert.match(publicModeSource, /static_only へ自動遷移しない/);
});

test("resolvePublicOperationMode: 優先順位コメントを保持する", () => {
  assert.match(publicModeSource, /FORCE_STATIC_ONLY/);
  assert.match(publicModeSource, /KV 複製/);
  assert.match(publicModeSource, /allowD1 時のみ D1/);
});

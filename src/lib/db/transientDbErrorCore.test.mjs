import assert from "node:assert/strict";
import { test } from "node:test";

import { isTransientDbError } from "./transientDbErrorCore.ts";

test("SQLITE_BUSY と database is locked は一時エラーとして再試行する", () => {
  assert.equal(isTransientDbError({ code: "SQLITE_BUSY" }), true);
  assert.equal(
    isTransientDbError(new Error("NOSENTRY database is locked: SQLITE_BUSY")),
    true,
  );
  assert.equal(
    isTransientDbError({
      message:
        "D1_ERROR: Failed to parse body as JSON, got: Error: internal error; reference = abc",
    }),
    true,
  );
});

test("Cloudflare D1がretry推奨する接続/instance resetを一時エラーとして扱う", () => {
  for (const message of [
    "Network connection lost.",
    "storage caused object to be reset",
    "reset because its code was updated",
  ]) {
    assert.equal(isTransientDbError(new Error(message)), true, message);
  }
  assert.equal(
    isTransientDbError({
      message: "outer wrapper",
      cause: new Error("Network connection lost."),
    }),
    true,
  );
  assert.equal(isTransientDbError("Network connection lost."), true);
});

test("通常の query 失敗は再試行しない", () => {
  assert.equal(
    isTransientDbError(new Error('no such table: "events"')),
    false,
  );
});

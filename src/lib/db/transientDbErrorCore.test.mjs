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

test("通常の query 失敗は再試行しない", () => {
  assert.equal(
    isTransientDbError(new Error('no such table: "events"')),
    false,
  );
});

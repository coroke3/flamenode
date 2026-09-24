import assert from "node:assert/strict";
import { test } from "node:test";
import { logSafeAuthError } from "./safeLogger.ts";

test("Auth.jsのerror loggerはSQL params・message・stackを出力しない", () => {
  const originalError = console.error;
  const lines = [];
  console.error = (...values) => lines.push(values.map(String).join(" "));
  try {
    const error = Object.assign(
      new Error("select * from session where token=? params: session-secret"),
      {
        type: "SessionTokenError",
        stack: "Drizzle stack with session-secret",
      },
    );
    logSafeAuthError(error);
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(lines, ["[auth][error] SessionTokenError"]);
  assert.doesNotMatch(lines.join(" "), /session-secret|select|Drizzle/);
});

test("不正なAuth.js error typeは固定ラベルへ置換する", () => {
  const originalError = console.error;
  const lines = [];
  console.error = (...values) => lines.push(values.map(String).join(" "));
  try {
    logSafeAuthError(Object.assign(new Error("private"), { type: "token=secret" }));
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(lines, ["[auth][error] AUTH_ERROR"]);
});

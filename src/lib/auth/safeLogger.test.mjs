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

test("Auth loggerはErrorのgetterとProxyが例外でも固定コードのみ出力する", () => {
  const originalError = console.error;
  const lines = [];
  console.error = (...values) => lines.push(values.map(String).join(" "));
  try {
    const brokenType = Object.defineProperty(new Error("secret=type"), "type", {
      get() { throw new Error("secret=type-getter"); },
    });
    const brokenName = Object.defineProperty(new Error("secret=name"), "name", {
      get() { throw new Error("secret=name-getter"); },
    });
    const brokenProxy = new Proxy(new Error("secret=proxy"), {
      get() { throw new Error("secret=proxy-getter"); },
    });
    assert.doesNotThrow(() => logSafeAuthError(brokenType));
    assert.doesNotThrow(() => logSafeAuthError(brokenName));
    assert.doesNotThrow(() => logSafeAuthError(brokenProxy));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(lines, Array(3).fill("[auth][error] AUTH_ERROR"));
  assert.doesNotMatch(lines.join(" "), /secret|getter|proxy/);
});

test("Auth loggerは不正なtypeを文字列化せず安全なnameへfallbackする", () => {
  const originalError = console.error;
  const lines = [];
  console.error = (...values) => lines.push(values.map(String).join(" "));
  try {
    const error = Object.assign(new Error("session-token-secret"), {
      type: { toString() { throw new Error("secret=coercion"); } },
    });
    assert.doesNotThrow(() => logSafeAuthError(error));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(lines, ["[auth][error] Error"]);
});

test("Auth loggerの診断先が例外を投げても認証処理へ伝播しない", () => {
  const originalError = console.error;
  console.error = () => { throw new Error("failed log sink"); };
  try {
    assert.doesNotThrow(() => logSafeAuthError(Object.assign(new Error("private"), {
      type: "SessionTokenError",
    })));
  } finally {
    console.error = originalError;
  }
});

/** SEC-0804 follow-up: Hono Auth.js logger must remain best-effort for hostile provider errors. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import { AUTH_BASELINE_ENV } from "../../../src/lib/auth/authBaseline.fixture.mjs";

process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));

if (runTestWithTsx(import.meta.url)) {
  const { createHarness } = await loadAuthBaseline();
  const { buildUnmountedAuthConfig } = await import("../src/auth/authjs.ts");

  function loggerFor(d1) {
    return buildUnmountedAuthConfig({
      d1,
      authSecret: AUTH_BASELINE_ENV.AUTH_SECRET,
      discordClientId: AUTH_BASELINE_ENV.AUTH_DISCORD_ID,
      discordClientSecret: AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET,
      authOrigin: AUTH_BASELINE_ENV.AUTH_URL,
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    }).logger;
  }

  test("Hono Auth.js safe logger preserves known safe error types", async (t) => {
    const { d1 } = createHarness(t);
    const logger = loggerFor(d1);
    const original = console.error;
    const calls = [];
    console.error = (...args) => calls.push(args);
    try {
      logger.error(Object.assign(new Error("provider secret must not be logged"), {
        type: "OAuthCallbackError",
      }));
      assert.deepEqual(calls, [["[auth][error] OAuthCallbackError"]]);
      assert.doesNotMatch(String(calls), /provider secret/);
    } finally {
      console.error = original;
    }
  });

  test("Hono Auth.js safe logger contains throwing getters and hostile Proxy traps", async (t) => {
    const { d1 } = createHarness(t);
    const logger = loggerFor(d1);
    const original = console.error;
    const calls = [];
    console.error = (...args) => calls.push(args);
    const poisonedType = new Error("secret-type");
    Object.defineProperty(poisonedType, "type", { get() { throw new Error("secret-getter"); } });
    const poisonedName = new Error("secret-name");
    Object.defineProperty(poisonedName, "type", { value: undefined });
    Object.defineProperty(poisonedName, "name", { get() { throw new Error("secret-name-getter"); } });
    const hostileProxy = new Proxy(new Error("secret-proxy"), {
      get() { throw new Error("secret-proxy-trap"); },
    });
    try {
      assert.doesNotThrow(() => logger.error(poisonedType));
      assert.doesNotThrow(() => logger.error(poisonedName));
      assert.doesNotThrow(() => logger.error(hostileProxy));
      assert.deepEqual(calls, [
        ["[auth][error] AUTH_ERROR"],
        ["[auth][error] AUTH_ERROR"],
        ["[auth][error] AUTH_ERROR"],
      ]);
      assert.doesNotMatch(String(calls), /secret-(?:type|getter|name|proxy)/);
    } finally {
      console.error = original;
    }
  });

  test("Hono Auth.js safe logger does not propagate a throwing diagnostic sink", async (t) => {
    const { d1 } = createHarness(t);
    const logger = loggerFor(d1);
    const original = console.error;
    console.error = () => { throw new Error("diagnostic sink failure"); };
    try {
      assert.doesNotThrow(() => logger.error(Object.assign(new Error("secret"), {
        type: "OAuthCallbackError",
      })));
    } finally {
      console.error = original;
    }
  });
}

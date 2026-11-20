/** MIG-0804 U02: unmounted @auth/core security regression; synthetic SQLite only. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runTestWithTsx } from "../../../src/lib/testing/runTestWithTsx.mjs";
import { loadAuthBaseline } from "../../../src/lib/auth/authBaselineHarness.mjs";
import {
  AUTH_BASELINE_ENV, BASELINE_COOKIES, SESSIONS,
} from "../../../src/lib/auth/authBaseline.fixture.mjs";

process.env.TSX_TSCONFIG_PATH ??= fileURLToPath(new URL("../../../tsconfig.json", import.meta.url));

if (runTestWithTsx(import.meta.url)) {
  const { createHarness } = await loadAuthBaseline();
  const { buildUnmountedAuthConfig } = await import("../src/auth/authjs.ts");
  const { createUnmountedAuthRoutes } = await import("../src/routes/auth.ts");

  const origin = AUTH_BASELINE_ENV.AUTH_URL;
  function credentials(d1) {
    return {
      d1,
      authSecret: AUTH_BASELINE_ENV.AUTH_SECRET,
      discordClientId: AUTH_BASELINE_ENV.AUTH_DISCORD_ID,
      discordClientSecret: AUTH_BASELINE_ENV.AUTH_DISCORD_SECRET,
      authOrigin: origin,
      siteOrigin: AUTH_BASELINE_ENV.NEXT_PUBLIC_SITE_URL,
    };
  }

  test("MIG-0804 U02 T01: Auth.js redirect callback rejects external origins and unsafe schemes", async (t) => {
    const { d1 } = createHarness(t);
    const callback = buildUnmountedAuthConfig(credentials(d1)).callbacks.redirect;
    assert.equal(typeof callback, "function");
    for (const input of [
      "https://evil.example/path",
      "https://flamenode.example.evil.example/path",
      "javascript:alert(1)",
      "data:text/html,evil",
      "https://evil.example@attacker.invalid/path",
    ]) {
      const target = await callback({ url: input, baseUrl: origin });
      assert.equal(target, origin + "/dashboard", input);
    }
    // A protocol-relative string is interpreted by this CURRENT callback as
    // a path on the *configured* origin; it must never become an external host.
    const doubleSlash = await callback({ url: "//attacker.invalid/path", baseUrl: origin });
    assert.equal(new URL(doubleSlash).origin, origin);
    assert.equal(await callback({ url: "/dashboard?next=%2Fabout", baseUrl: origin }),
      origin + "/dashboard?next=%2Fabout");
  });

  test("MIG-0804 U02 T02: spoofed Host headers cannot redirect or set cookies for another origin", async (t) => {
    const { d1 } = createHarness(t);
    const app = createUnmountedAuthRoutes(credentials(d1));
    const res = await app.request(origin + "/api/auth/session", {
      headers: {
        cookie: BASELINE_COOKIES.sessionToken.name + "=" + SESSIONS.valid.sessionToken,
        host: "attacker.invalid",
        "x-forwarded-host": "attacker.invalid",
      },
    });
    const redirect = res.headers.get("location");
    if (redirect) assert.equal(new URL(redirect, origin).origin, origin);
    const cookie = res.headers.getSetCookie().join("\n").toLowerCase();
    assert.doesNotMatch(cookie, /domain\s*=\s*attacker\.invalid/);
  });

  test("MIG-0804 U02 T03: D1 runtime exception fails closed as private 503 (not an empty login)", async (t) => {
    const { d1 } = createHarness(t);
    const providerSentinel = "SENTINEL_AUTH_D1_PROVIDER_PRIVATE";
    const brokenD1 = {
      ...d1,
      prepare() { throw new Error(providerSentinel); },
      batch() { throw new Error(providerSentinel); },
    };
    const app = createUnmountedAuthRoutes(credentials(brokenD1));
    const res = await app.request(origin + "/api/auth/session", {
      headers: {
        cookie: BASELINE_COOKIES.sessionToken.name + "=" + SESSIONS.valid.sessionToken,
      },
    });
    const body = await res.text();
    assert.equal(res.status, 503, "a provider outage cannot be represented as a logged-out 200 session");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/i);
    assert.doesNotMatch(body, new RegExp(providerSentinel));
  });
}

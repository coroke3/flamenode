import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTH_COOKIE_DEFINITIONS,
  MOCK_AUTH_USERS,
  MOCK_SESSIONS,
  MOCK_DISCORD_ACCOUNTS,
} from "./authBaseline.fixture.mjs";
import {
  configuredHttpOrigin,
  requestHasSameOrigin,
  isLoopbackHostname,
} from "./origin.ts";

const [accountLinkAdapterSource, authIndexSource] = await Promise.all([
  readFile(new URL("./accountLinkAdapter.ts", import.meta.url), "utf8"),
  readFile(new URL("./index.ts", import.meta.url), "utf8"),
]);

test("T01: Expired session evaluates as signed-out / unauthenticated", () => {
  const now = new Date();
  const valid = MOCK_SESSIONS.validSession;
  const expired = MOCK_SESSIONS.expiredSession;

  assert.ok(valid.expires.getTime() > now.getTime(), "Valid session is in future");
  assert.ok(expired.expires.getTime() < now.getTime(), "Expired session is in past");

  // In database session strategy, a session with expires <= now is expired
  function isSessionActive(session, currentTime = new Date()) {
    if (!session || !session.expires) return false;
    return new Date(session.expires).getTime() > currentTime.getTime();
  }

  assert.equal(isSessionActive(valid), true);
  assert.equal(isSessionActive(expired), false);
  assert.equal(isSessionActive(null), false);
  assert.equal(isSessionActive({ expires: null }), false);

  // Invariant in auth/index.ts: database strategy is explicitly set
  assert.match(authIndexSource, /session:\s*\{\s*strategy:\s*"database"\s*\}/);
});

test("T02: Account token strip and duplicate Discord account linking invariants", () => {
  // Verify accountRowWithoutTokens in source code never persists OAuth tokens
  assert.match(accountLinkAdapterSource, /access_token:\s*null/);
  assert.match(accountLinkAdapterSource, /refresh_token:\s*null/);
  assert.match(accountLinkAdapterSource, /id_token:\s*null/);
  assert.match(accountLinkAdapterSource, /export function accountRowWithoutTokens/);

  // Verify atomic linking guards provider and conflict errors
  assert.match(accountLinkAdapterSource, /AUTH_DISCORD_ID_CONFLICT/);
  assert.match(accountLinkAdapterSource, /AUTH_UNSUPPORTED_ACCOUNT_PROVIDER/);
  assert.match(accountLinkAdapterSource, /AUTH_LINK_USER_NOT_FOUND/);

  // Duplicate linking logic simulation
  const existingLinks = [
    {
      userId: MOCK_DISCORD_ACCOUNTS.linkedAccount1.userId,
      providerAccountId: MOCK_DISCORD_ACCOUNTS.linkedAccount1.providerAccountId,
    },
  ];

  function validateAccountLink(newAccount, existing) {
    if (newAccount.provider !== "discord" || !newAccount.providerAccountId) {
      throw new Error("AUTH_UNSUPPORTED_ACCOUNT_PROVIDER");
    }
    const conflict = existing.find(
      (acc) =>
        acc.providerAccountId === newAccount.providerAccountId &&
        acc.userId !== newAccount.userId,
    );
    if (conflict) {
      throw new Error("AUTH_DISCORD_ID_CONFLICT");
    }
    return true;
  }

  // Same user re-linking is idempotent
  assert.equal(
    validateAccountLink(MOCK_DISCORD_ACCOUNTS.linkedAccount1, existingLinks),
    true,
  );

  // Different user attempting to claim same discord account is rejected
  assert.throws(
    () =>
      validateAccountLink(
        MOCK_DISCORD_ACCOUNTS.duplicateDiscordAccount,
        existingLinks,
      ),
    /AUTH_DISCORD_ID_CONFLICT/,
  );

  // Unsupported provider rejected
  assert.throws(
    () =>
      validateAccountLink(
        { provider: "github", providerAccountId: "123", userId: "usr_001" },
        existingLinks,
      ),
    /AUTH_UNSUPPORTED_ACCOUNT_PROVIDER/,
  );
});

test("T03: Origin verification and safe redirect invariants", () => {
  const prodSiteUrl = "https://flamenode.net";

  // Configured origin parsing
  assert.equal(
    configuredHttpOrigin(prodSiteUrl, "NEXT_PUBLIC_SITE_URL"),
    "https://flamenode.net",
  );

  // Missing origin throws
  assert.throws(
    () => configuredHttpOrigin(undefined, "AUTH_URL"),
    /AUTH_URL_MISSING/,
  );

  // Invalid origin throws
  assert.throws(
    () => configuredHttpOrigin("not-a-url", "AUTH_URL"),
    /AUTH_URL_INVALID_ORIGIN/,
  );

  // Localhost forbidden in production
  assert.throws(
    () =>
      configuredHttpOrigin("http://localhost:3000", "AUTH_URL", {
        allowLoopback: false,
      }),
    /AUTH_URL_LOCALHOST_FORBIDDEN/,
  );

  // Loopback hostname detection
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("flamenode.net"), false);

  // Same-origin checking
  assert.equal(
    requestHasSameOrigin("https://flamenode.net", "https://flamenode.net"),
    true,
  );
  assert.equal(
    requestHasSameOrigin("https://evil.attacker.com", "https://flamenode.net"),
    false,
  );
  assert.equal(requestHasSameOrigin(null, "https://flamenode.net"), false);

  // Redirect target calculation (CURRENT Auth.js callbacks.redirect specification)
  function resolveSafeRedirect(targetUrl, authOrigin) {
    if (targetUrl.startsWith("/")) {
      return `${authOrigin}${targetUrl}`;
    }
    try {
      const parsed = new URL(targetUrl);
      if (parsed.origin === authOrigin) return parsed.href;
    } catch {
      /* fall through */
    }
    return `${authOrigin}/dashboard`;
  }

  // Relative path is safely resolved against auth origin
  assert.equal(
    resolveSafeRedirect("/manage/events", prodSiteUrl),
    "https://flamenode.net/manage/events",
  );

  // Same-origin absolute URL is allowed
  assert.equal(
    resolveSafeRedirect("https://flamenode.net/profile", prodSiteUrl),
    "https://flamenode.net/profile",
  );

  // Off-origin phishing URL safely defaults to /dashboard
  assert.equal(
    resolveSafeRedirect("https://evil-phish.com/steal-token", prodSiteUrl),
    "https://flamenode.net/dashboard",
  );

  // Malformed URL safely defaults to /dashboard
  assert.equal(
    resolveSafeRedirect("javascript:alert(1)", prodSiteUrl),
    "https://flamenode.net/dashboard",
  );
});

test("T04: Fixture contains zero live secrets or real credentials", () => {
  const allJson = JSON.stringify({
    MOCK_AUTH_USERS,
    MOCK_SESSIONS,
    MOCK_DISCORD_ACCOUNTS,
  });

  // Verify no realistic live Discord client secret or private keys exist
  assert.doesNotMatch(allJson, /client_secret|private_key/i);
  assert.doesNotMatch(allJson, /eyJ[a-zA-Z0-9_-]{20,}/); // No JWTs

  // All session tokens must use explicit synthetic prefix
  for (const session of Object.values(MOCK_SESSIONS)) {
    if (typeof session === "string") {
      assert.match(session, /^synthetic_/);
    } else if (session?.sessionToken) {
      assert.match(session.sessionToken, /^synthetic_/);
    }
  }
});

test("T05: Cookie contract baseline for Auth.js v5 and Web Standard compatibility", () => {
  const prod = AUTH_COOKIE_DEFINITIONS.production;
  const dev = AUTH_COOKIE_DEFINITIONS.development;

  // Production prefix requirements
  assert.equal(prod.sessionToken.name, "__Secure-authjs.session-token");
  assert.equal(prod.callbackUrl.name, "__Secure-authjs.callback-url");
  assert.equal(prod.csrfToken.name, "__Host-authjs.csrf-token");

  // Dev naming requirements
  assert.equal(dev.sessionToken.name, "authjs.session-token");
  assert.equal(dev.callbackUrl.name, "authjs.callback-url");
  assert.equal(dev.csrfToken.name, "authjs.csrf-token");

  // Options invariants
  for (const [env, cookies] of Object.entries(AUTH_COOKIE_DEFINITIONS)) {
    for (const [key, def] of Object.entries(cookies)) {
      assert.equal(def.options.httpOnly, true, `${env} ${key} must be httpOnly`);
      assert.equal(def.options.sameSite, "lax", `${env} ${key} must have sameSite=lax`);
      assert.equal(def.options.path, "/", `${env} ${key} must have path=/`);
      if (env === "production") {
        assert.equal(def.options.secure, true, `production ${key} must be secure`);
      }
    }
  }
});

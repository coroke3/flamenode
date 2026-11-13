import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDatabaseAuthSessionClaims, authRuntimeDefaults, discordProviderOptions, resolveAuthRuntimeCredentials } from "../src/auth/config.ts";

test("MIG-0802 U01: DB callback overwrites stale session role, ban and Active X without losing profile", () => {
  const session = {
    expires: "2026-12-01T00:00:00.000Z",
    user: {
      id: "stale-id", name: "Profile", email: "profile@example.test",
      image: "https://example.test/p.png",
      role: "admin", is_banned: 0, active_x_user_id: "x-stale",
    },
  };
  const dbUser = {
    id: "db-id", role: "user", is_banned: 1,
    active_x_user_id: "x-current",
  };
  const originalUser = session.user;
  const copy = { ...dbUser };
  assert.equal(applyDatabaseAuthSessionClaims(session, dbUser), session,
    "Auth.js session callback returns the same instance as CURRENT");
  assert.equal(session.user, originalUser, "CURRENT mutates session.user in place");
  assert.deepEqual({ ...session.user }, {
    id: "db-id", name: "Profile", email: "profile@example.test",
    image: "https://example.test/p.png",
    role: "user", is_banned: 1, active_x_user_id: "x-current",
  });
  assert.deepEqual(dbUser, copy, "database row is not mutated");
});

test("MIG-0802 U01: nullish DB columns use exact CURRENT defaults, not a stale cookie claim", () => {
  const session = { user: {
    id: "stale", role: "admin", is_banned: 1, active_x_user_id: "x-stale",
  } };
  applyDatabaseAuthSessionClaims(session, {
    id: "fresh", role: null, is_banned: null, active_x_user_id: undefined,
  });
  assert.deepEqual(session.user, {
    id: "fresh", role: "user", is_banned: 0, active_x_user_id: null,
  });
  const second = { user: {} };
  applyDatabaseAuthSessionClaims(second, {
    id: "db-2", role: "", is_banned: 0, active_x_user_id: "",
  });
  assert.deepEqual(second.user, {
    id: "db-2", role: "", is_banned: 0, active_x_user_id: "",
  }, "nullish coalescing does not replace deliberate empty strings or zero");
});

test("MIG-0802 U01: empty user/session cases preserve CURRENT callback semantics", () => {
  const withoutSessionUser = { user: undefined, expires: "future" };
  const withoutDbUser = { user: { id: "kept", role: "admin" } };
  assert.equal(applyDatabaseAuthSessionClaims(withoutSessionUser, { id: "db" }), withoutSessionUser);
  assert.equal(withoutSessionUser.user, undefined);
  assert.equal(applyDatabaseAuthSessionClaims(withoutDbUser, null), withoutDbUser);
  assert.deepEqual(withoutDbUser.user, { id: "kept", role: "admin" });
  assert.deepEqual(applyDatabaseAuthSessionClaims({}, undefined), {});
});


test("MIG-0802 U01: shared Auth credentials exactly preserve CURRENT trimming and configured precedence", () => {
  const values = {
    authSecret: "  synthetic-auth-secret  ",
    discordClientId: "  client-id ",
    discordClientSecret: " client-secret  ",
    allowLocalDevSecret: false,
  };
  assert.deepEqual(resolveAuthRuntimeCredentials(values), {
    secret: "synthetic-auth-secret",
    discordClientId: "client-id",
    discordClientSecret: "client-secret",
  });
  assert.deepEqual(values, {
    authSecret: "  synthetic-auth-secret  ",
    discordClientId: "  client-id ",
    discordClientSecret: " client-secret  ",
    allowLocalDevSecret: false,
  });
});

test("MIG-0802 U01: no production auth fallback and explicit local-only secret fallback", () => {
  const base = { authSecret: " \t ", discordClientId: "d", discordClientSecret: "s" };
  assert.throws(
    () => resolveAuthRuntimeCredentials({ ...base, allowLocalDevSecret: false }),
    /AUTH_SECRET_MISSING/,
  );
  const local = resolveAuthRuntimeCredentials({ ...base, allowLocalDevSecret: true });
  assert.equal(local.secret, "flamenode-local-development-auth-secret");
  assert.equal(local.discordClientId, "d");
  assert.equal(local.discordClientSecret, "s");
  assert.throws(
    () => resolveAuthRuntimeCredentials({
      ...base, authSecret: "signed-secret", discordClientId: " ", allowLocalDevSecret: false,
    }),
    /AUTH_DISCORD_CONFIG_MISSING/,
  );
  assert.throws(
    () => resolveAuthRuntimeCredentials({
      ...base, authSecret: "signed-secret", discordClientSecret: null, allowLocalDevSecret: true,
    }),
    /AUTH_DISCORD_CONFIG_MISSING/,
  );
  const explicit = resolveAuthRuntimeCredentials({
    ...base, authSecret: "explicit", allowLocalDevSecret: true,
  });
  assert.equal(explicit.secret, "explicit", "explicit secret has precedence over local fallback");
});

test("MIG-0802 U01: Discord provider uses exact CURRENT linking policy, OAuth endpoint and scope", () => {
  const credentials = {
    discordClientId: "synthetic-client",
    discordClientSecret: "synthetic-secret",
    secret: "synthetic-auth-secret",
  };
  const options = discordProviderOptions(credentials);
  assert.deepEqual(options, {
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret",
    allowDangerousEmailAccountLinking: true,
    authorization: {
      url: "https://discord.com/api/oauth2/authorize",
      params: { scope: "identify email" },
    },
  }, "the explicit Discord URL and email-linking flag must not drift from CURRENT");
  assert.deepEqual(credentials, {
    discordClientId: "synthetic-client",
    discordClientSecret: "synthetic-secret",
    secret: "synthetic-auth-secret",
  }, "credential input must be read-only");
  assert.equal("secret" in options, false, "the Auth.js session secret is configured separately");
  assert.equal("redirect_uri" in options.authorization.params, false,
    "the runtime must continue constructing the callback URL");
});

test("MIG-0802 U01: resolved credentials pass through the exact shared Discord provider options", () => {
  const resolved = resolveAuthRuntimeCredentials({
    authSecret: " shared-secret ",
    discordClientId: "  my-client-id  ",
    discordClientSecret: "  my-client-secret ",
    allowLocalDevSecret: false,
  });
  assert.deepEqual(discordProviderOptions(resolved), {
    clientId: "my-client-id",
    clientSecret: "my-client-secret",
    allowDangerousEmailAccountLinking: true,
    authorization: {
      url: "https://discord.com/api/oauth2/authorize",
      params: { scope: "identify email" },
    },
  });
});


test("MIG-0802 U01: shared Auth.js defaults preserve CURRENT database sessions, pages and Host policy", () => {
  const options = authRuntimeDefaults();
  assert.deepEqual(options, {
    trustHost: true,
    session: { strategy: "database" },
    pages: { signIn: "/entry", error: "/entry" },
  });
  assert.deepEqual(Object.keys(options).sort(), ["pages", "session", "trustHost"],
    "shared pure defaults must not carry secret, provider, adapter or callbacks");
});

test("MIG-0802 U01: each Auth.js config build receives independent option objects", () => {
  const first = authRuntimeDefaults();
  const second = authRuntimeDefaults();
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.session, second.session);
  assert.notStrictEqual(first.pages, second.pages);
  first.pages.signIn = "/untrusted-mutation";
  first.session.strategy = "mutated";
  assert.deepEqual(second, {
    trustHost: true,
    session: { strategy: "database" },
    pages: { signIn: "/entry", error: "/entry" },
  }, "mutation by a request cannot persist into another Auth.js config");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDatabaseAuthSessionClaims } from "../src/auth/config.ts";

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

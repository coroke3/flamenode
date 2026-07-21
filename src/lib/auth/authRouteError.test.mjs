import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authTemporarilyUnavailableResponse,
  handleAuthRouteRequest,
  isAuthRouteTemporarilyUnavailable,
} from "./authRouteError.ts";

const CONFIG_ERRORS = [
  "AUTH_DATABASE_UNAVAILABLE",
  "AUTH_SECRET_MISSING",
  "AUTH_DISCORD_CONFIG_MISSING",
  "AUTH_URL_MISSING",
  "AUTH_URL_INVALID_ORIGIN",
  "AUTH_URL_LOCALHOST_FORBIDDEN",
  "NEXT_PUBLIC_SITE_URL_MISSING",
  "NEXT_PUBLIC_SITE_URL_INVALID_ORIGIN",
  "NEXT_PUBLIC_SITE_URL_LOCALHOST_FORBIDDEN",
  "AUTH_ORIGIN_MISMATCH",
];

test("known auth config failures and wrapped Cloudflare binding failures are unavailable", () => {
  for (const code of CONFIG_ERRORS) {
    assert.equal(isAuthRouteTemporarilyUnavailable(new Error(code)), true, code);
  }

  const bindingError = new Error("CLOUDFLARE_BINDINGS_UNAVAILABLE:DB,KV");
  bindingError.name = "CloudflareBindingsUnavailableError";
  const authWrapper = new Error("Auth.js wrapper", {
    cause: { err: bindingError },
  });
  assert.equal(isAuthRouteTemporarilyUnavailable(authWrapper), true);
});

test("unknown auth and similarly prefixed failures remain unknown", () => {
  for (const error of [
    new Error("AUTH_LINK_USER_NOT_FOUND"),
    new Error("AUTH_SECRET_MISSING:do-not-match-prefix"),
    new Error("NEXT_PUBLIC_SITE_URL_OTHER"),
    new Error("CLOUDFLARE_BINDINGS_UNAVAILABLE:DB"),
  ]) {
    assert.equal(isAuthRouteTemporarilyUnavailable(error), false);
  }
});

test("normal auth responses are returned unchanged", async () => {
  const expected = new Response("ok", { status: 201 });
  const request = new Request("https://flamenode.example/api/auth/session");
  const actual = await handleAuthRouteRequest(async () => expected, request);
  assert.equal(actual, expected);
});

test("known failures return a generic no-store 503 without secret details", async () => {
  const secret = "discord-client-secret-must-not-leak";
  const wrapped = new Error(secret, {
    cause: { err: new Error("AUTH_DISCORD_CONFIG_MISSING") },
  });
  const request = new Request("https://flamenode.example/api/auth/session");
  const response = await handleAuthRouteRequest(async () => {
    throw wrapped;
  }, request);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  const body = await response.text();
  assert.equal(body, '{"error":"auth_temporarily_unavailable"}');
  assert.doesNotMatch(body, new RegExp(secret));
  assert.doesNotMatch(body, /AUTH_DISCORD_CONFIG_MISSING/);
});

test("unknown failures are rethrown by identity", async () => {
  const unknown = new Error("AUTH_LINK_USER_NOT_FOUND");
  const request = new Request("https://flamenode.example/api/auth/session");
  await assert.rejects(
    handleAuthRouteRequest(async () => {
      throw unknown;
    }, request),
    (error) => error === unknown,
  );
});

test("generic response helper is exact and does not cache", async () => {
  const response = authTemporarilyUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "auth_temporarily_unavailable",
  });
});

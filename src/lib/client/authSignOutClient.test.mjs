import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { signOutViaAuthRoute } from "./authSignOutClient.ts";

const originalFetch = globalThis.fetch;
const originalRandomUUID = crypto.randomUUID;
const originalConsoleInfo = console.info;

function jsonResponse(body, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

function setupFetch(sequence) {
  let callIndex = 0;
  globalThis.fetch = mock.fn(async (url) => {
    const step = sequence[callIndex++];
    if (!step) {
      throw new Error(`unexpected fetch call: ${url}`);
    }
    if (step.throw) throw step.throw;
    return step.response;
  });
}

function findFlowTrace(spy, errorCode) {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call.arguments[0]));
      } catch {
        return null;
      }
    })
    .find((entry) => entry?.error_code === errorCode);
}

beforeEach(() => {
  crypto.randomUUID = () => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  console.info = mock.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  crypto.randomUUID = originalRandomUUID;
  console.info = originalConsoleInfo;
});

test("signOutViaAuthRoute returns ok false when session cookie remained", async () => {
  setupFetch([
    { response: jsonResponse({ csrfToken: "csrf-token" }) },
    { response: jsonResponse({}, true) },
    { response: jsonResponse({ user: { id: "user-1" } }) },
    { response: jsonResponse({ user: { id: "user-1" } }) },
  ]);

  const result = await signOutViaAuthRoute();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /ログアウトに失敗しました/);
  }
  assert.ok(findFlowTrace(console.info, "AUTH_SIGNOUT_COOKIE_REMAINED"));
});

test("signOutViaAuthRoute returns ok true when session cleared", async () => {
  setupFetch([
    { response: jsonResponse({ csrfToken: "csrf-token" }) },
    { response: jsonResponse({}, true) },
    { response: jsonResponse({ user: null }) },
  ]);

  const result = await signOutViaAuthRoute();
  assert.deepEqual(result, { ok: true });
});

test("signOutViaAuthRoute retries session verify and succeeds on second attempt", async () => {
  setupFetch([
    { response: jsonResponse({ csrfToken: "csrf-token" }) },
    { response: jsonResponse({}, true) },
    { response: jsonResponse({}, false) },
    { response: jsonResponse({ user: null }) },
  ]);

  const result = await signOutViaAuthRoute();
  assert.deepEqual(result, { ok: true });
});

test("signOutViaAuthRoute returns ok true when session verify is inconclusive", async () => {
  setupFetch([
    { response: jsonResponse({ csrfToken: "csrf-token" }) },
    { response: jsonResponse({}, true) },
    { response: jsonResponse({}, false) },
    { throw: new Error("network down") },
  ]);

  const result = await signOutViaAuthRoute();
  assert.deepEqual(result, { ok: true });
  assert.ok(findFlowTrace(console.info, "AUTH_SIGNOUT_SESSION_VERIFY_INCONCLUSIVE"));
});

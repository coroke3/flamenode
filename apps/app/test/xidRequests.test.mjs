import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createXidRequestsApi } from "../.test-dist/apps/app/src/api/xidRequests.js";
import { dom, fakeApi, flush, mount, ok, onboarding, onboardingState, requestRow, settings } from "./helpers.mjs";

const success = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { "content-type": "application/json" },
});
const event = (name) => new dom.window.Event(name, { bubbles: true, cancelable: true });
async function type(m, selector, value) {
  const el = m.container.querySelector(selector);
  assert.ok(el, `missing input ${selector}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(event("input"));
  });
}
async function submit(m, selector = "form") {
  const form = m.container.querySelector(selector);
  assert.ok(form, "missing form");
  await act(async () => { form.dispatchEvent(event("submit")); });
}

test("SA-099/100/101: JSON body, same-origin, no-store, correct method and paths", async () => {
  const calls = [];
  const api = createXidRequestsApi(async (path, init) => {
    calls.push({ path, init });
    return success();
  });
  assert.equal((await api.requestLink("@Alice")).ok, true);
  assert.equal((await api.requestMerge("alice", "bob")).ok, true);
  assert.equal((await api.cancelRequest("a/b")).ok, true);
  assert.equal((await api.requestMergeRevert("parent")).ok, true);
  assert.deepEqual(calls.map((x) => x.path), [
    "/api/xid/requests", "/api/xid/requests",
    "/api/xid/requests/a%2Fb/cancel", "/api/xid/merge-revert-requests",
  ]);
  assert.deepEqual(calls.map((x) => JSON.parse(x.init.body)), [
    { request_type: "link", x_id: "@Alice" },
    { request_type: "merge", x_id: "alice", target_x_user_id: "bob" },
    {},
    { parent_request_id: "parent" },
  ]);
  for (const { init } of calls) {
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers["content-type"], "application/json");
  }
});

test("write never treats malformed or HTTP error result as success", async () => {
  for (const response of [
    new Response("<html>oops</html>", { status: 200 }),
    new Response(JSON.stringify({ ok: "true" }), { status: 200 }),
    new Response(JSON.stringify({ ok: true, message: "bad" }), { status: 403 }),
  ]) {
    const api = createXidRequestsApi(async () => response);
    assert.equal((await api.requestLink("alice")).ok, false);
  }
  const api = createXidRequestsApi(async () => new Response(JSON.stringify({ ok: false, message: "再試行してください" }), { status: 409 }));
  assert.deepEqual(await api.requestLink("alice"), { ok: false, message: "再試行してください" });
});

test("settings: X ID submission rejects invalid handles locally and prevents a double POST", async () => {
  let resolve;
  const submitted = [];
  const a = fakeApi({ getSettings: ok(settings()) });
  a.xidRequests = {
    requestLink: (value) => { submitted.push(value); return new Promise((r) => { resolve = r; }); },
    requestMerge: async () => ({ ok: true }),
    cancelRequest: async () => ({ ok: true }),
    requestMergeRevert: async () => ({ ok: true }),
  };
  const m = await mount("/dashboard/settings", a);
  assert.ok(m.container.querySelector("form"));
  await type(m, "#xid-input", "https://evil.example/a");
  assert.equal(m.container.querySelector('button[type="submit"]').disabled, true);
  await type(m, "#xid-input", "@Alice");
  assert.equal(m.container.querySelector('button[type="submit"]').disabled, false);
  await act(async () => {
    const form = m.container.querySelector("form");
    form.dispatchEvent(event("submit"));
    form.dispatchEvent(event("submit"));
  });
  assert.deepEqual(submitted, ["@Alice"]);
  assert.equal(m.container.querySelector('button[type="submit"]').disabled, true);
  await act(async () => resolve({ ok: true }));
  await flush();
  assert.equal(a.calls.filter(([name]) => name === "getSettings").length, 2);
  await m.unmount();
});

test("history: withdrawing pending request retains CURRENT confirmation, message and refresh", async () => {
  const confirmations = [];
  dom.window.confirm = (value) => { confirmations.push(value); return true; };
  const cancelled = [];
  const a = fakeApi({ getSettings: ok(settings({ requestHistory: [requestRow("r1")] })) });
  a.xidRequests = {
    requestLink: async () => ({ ok: true }),
    requestMerge: async () => ({ ok: true }),
    cancelRequest: async (id) => { cancelled.push(id); return { ok: true }; },
    requestMergeRevert: async () => ({ ok: true }),
  };
  const m = await mount("/dashboard/settings?tab=history", a);
  await act(async () => m.container.querySelector("button").click());
  await flush();
  assert.deepEqual(cancelled, ["r1"]);
  assert.deepEqual(confirmations, ["この申請を取り下げますか？"]);
  assert.equal(a.calls.filter(([name]) => name === "getSettings").length, 2);
  await m.unmount();
});

test("onboarding: a successful request refetches state without a transient LOADING screen", async () => {
  const a = fakeApi({ getOnboarding: ok(onboarding({ state: onboardingState({ xIdentityStatus: "none" }) })) });
  let requestCount = 0;
  a.xidRequests = {
    requestLink: async () => { requestCount++; return { ok: true }; },
    requestMerge: async () => ({ ok: false }),
    cancelRequest: async () => ({ ok: false }),
    requestMergeRevert: async () => ({ ok: false }),
  };
  const m = await mount("/onboarding?start=1", a);
  await type(m, "#ob-xid-input", "alice");
  await submit(m);
  await flush();
  assert.equal(requestCount, 1);
  assert.equal(a.calls.filter(([name]) => name === "getOnboarding").length, 2);
  assert.doesNotMatch(m.container.textContent, /読み込み中\.\.\./);
  await m.unmount();
});

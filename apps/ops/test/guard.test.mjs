import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { App } from "../.test-dist/apps/ops/src/App.js";
import { createOpsApi, parseAccountSummary } from "../.test-dist/apps/ops/src/api/account.js";
import { AUTH_UNAVAILABLE, decideOpsAccess, decideNavigation } from "../.test-dist/apps/ops/src/routes/guard.js";

const summary = (over = {}) => ({
  loggedIn: true, role: "user", canAccessAdmin: false, canAccessManage: true, ...over,
});
const decide = (surface, raw) => decideOpsAccess(surface, parseAccountSummary(raw));

test("MIG-0707 T02: no session, 503/unavailable and malformed response never render Ops", () => {
  for (const surface of ["manage", "admin"]) {
    assert.equal(decide(surface, { loggedIn: false }), "/entry");
    assert.equal(decide(surface, { loggedIn: false, unavailable: true }), AUTH_UNAVAILABLE);
    for (const raw of [null, {}, [], { loggedIn: true }, summary({ role: "owner" }),
      summary({ canAccessManage: "yes" }),
      summary({ degradedReason: "management_access_unavailable" }),
      { loggedIn: false, unavailable: "invalid" }]) {
      assert.equal(decide(surface, raw), AUTH_UNAVAILABLE);
    }
  }
});
test("MIG-0707 T02: CURRENT normal Manage/Admin permission gate parity", () => {
  assert.equal(decide("manage", summary()), "allow");
  assert.equal(decide("manage", summary({ role: "admin", canAccessManage: false, canAccessAdmin: true })), "allow");
  assert.equal(decide("manage", summary({ canAccessManage: false })), "/dashboard");
  assert.equal(decide("admin", summary({ role: "moderator", canAccessAdmin: true })), "/dashboard");
  assert.equal(decide("admin", summary({ role: "admin", canAccessAdmin: true })), "allow");
});
test("MIG-0707 D-17-14: management outage and legacy degraded fail closed", () => {
  for (const surface of ["manage", "admin"]) {
    for (const role of ["admin", "user"]) {
      assert.equal(decide(surface, summary({ role, degraded: true,
        degradedReason: "management_access_unavailable" })), AUTH_UNAVAILABLE);
      assert.equal(decide(surface, summary({ role, degraded: true })), AUTH_UNAVAILABLE);
      assert.equal(decide(surface, summary({ role, degraded: true,
        degradedReason: "unexpected_future_reason" })), AUTH_UNAVAILABLE);
    }
  }
});
test("MIG-0707 D-17-14: pending enrichment failure only defers non-admin Manage to navigation", () => {
  const pending = { degraded: true, degradedReason: "pending_requests_unavailable" };
  assert.equal(decide("manage", summary({ ...pending, canAccessManage: false })), "check-navigation");
  assert.equal(decide("manage", summary({ ...pending, role: "admin", canAccessManage: false })), "allow");
  assert.equal(decide("admin", summary({ ...pending, role: "admin" })), "allow");
  assert.equal(decide("admin", summary(pending)), "/dashboard");
  assert.equal(decideNavigation("allow"), "allow");
  assert.equal(decideNavigation("deny"), "/dashboard");
  assert.equal(decideNavigation("anonymous"), "/entry");
  assert.equal(decideNavigation("unavailable"), AUTH_UNAVAILABLE);
});
test("MIG-0707 U02: read-only RH-001 request, cookie scope and status mapping", async () => {
  const calls = [];
  const api = createOpsApi(async (path, init) => {
    calls.push([path, init]);
    return new Response(JSON.stringify(summary()), { status: 200 });
  });
  assert.equal((await api.getSummary()).status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/account/summary");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].credentials, "same-origin");
  for (const code of [401, 403, 500, 503]) {
    const failed = createOpsApi(async () => new Response("{}", { status: code }));
    assert.deepEqual(await failed.getSummary(), { status: "unavailable" });
  }
  assert.deepEqual(await createOpsApi(async () => { throw new Error("offline"); }).getSummary(),
    { status: "unavailable" });
});
test("MIG-0707 U02: navigation verifies access/403 reason, never trusts other errors", async () => {
  const withResponse = (status, body) => createOpsApi(async () =>
    new Response(JSON.stringify(body), { status })).checkManageNavigation();
  assert.equal(await withResponse(200, { access: { canAccessManage: true } }), "allow");
  assert.equal(await withResponse(200, { access: { canAccessAdmin: true } }), "allow");
  assert.equal(await withResponse(200, { access: { canAccessManage: false } }), "unavailable");
  assert.equal(await withResponse(403, { reason: "manage_access_required" }), "deny");
  assert.equal(await withResponse(403, { error: "Forbidden" }), "unavailable");
  assert.equal(await withResponse(401, {}), "anonymous");
  assert.equal(await withResponse(503, {}), "unavailable");
  assert.equal(await withResponse(200, []), "unavailable");
});


test("T03 Data Router shell retains fail-closed access and disposes StrictMode/API history listeners", async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://flamenode.test/admin/events/new", pretendToBeVisual: true });
  const assigned = [];
  const windowProxy = new Proxy(dom.window, {
    get(target, key) {
      if (key === "location") return {
        assign: url => assigned.push(url), href: target.location.href, origin: target.location.origin,
        pathname: target.location.pathname, search: target.location.search, hash: target.location.hash,
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  dom.window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  const globals = {
    window: windowProxy, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response("{}", { status: 503 }),
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const listeners = new Set();
  const add = dom.window.addEventListener.bind(dom.window);
  const remove = dom.window.removeEventListener.bind(dom.window);
  t.mock.method(dom.window, "addEventListener", (type, listener, options) => {
    if (type === "popstate") listeners.add(listener);
    return add(type, listener, options);
  });
  t.mock.method(dom.window, "removeEventListener", (type, listener, options) => {
    if (type === "popstate") listeners.delete(listener);
    return remove(type, listener, options);
  });
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = api => React.act(async () => root.render(
    React.createElement(React.StrictMode, null, React.createElement(App, { api })),
  ));
  const admin = { status: "ok", summary: summary({ role: "admin", canAccessAdmin: true }) };
  const apiFor = result => ({ getSummary: async () => result, checkManageNavigation: async () => "allow" });
  try {
    await render(apiFor(admin));
    assert.match(dom.window.document.body.textContent, /移行準備中/);
    assert.equal(listeners.size, 1, "StrictMode must leave one active browser history listener");
    for (const [name, api, destination] of [
      ["anonymous", apiFor({ status: "anonymous" }), "/entry"],
      ["role", apiFor({ status: "ok", summary: summary({ role: "moderator" }) }), "/dashboard"],
      ["degraded", apiFor({ status: "ok", summary: summary({ role: "admin", degraded: true, degradedReason: "management_access_unavailable" }) }), AUTH_UNAVAILABLE],
      ...[401, 403, 503].map(code => [String(code), createOpsApi(async () => new Response("{}", { status: code })), AUTH_UNAVAILABLE]),
    ]) {
      assigned.length = 0;
      await render(api);
      assert.equal(assigned.at(-1), destination, name);
      assert.equal(dom.window.document.querySelector("[data-admin-shell]"), null, name);
      assert.equal(listeners.size, 1, name);
    }
    let resolveOld;
    const pending = new Promise(resolve => { resolveOld = resolve; });
    const signals = [];
    await render({ getSummary: signal => { signals.push(signal); return pending; }, checkManageNavigation: async () => "allow" });
    assert.equal(dom.window.document.querySelector("[data-admin-shell]"), null);
    assigned.length = 0;
    await render(apiFor({ status: "anonymous" }));
    await React.act(async () => resolveOld(admin));
    assert.ok(signals.length > 0 && signals.every(signal => signal.aborted));
    assert.equal(dom.window.document.querySelector("[data-admin-shell]"), null, "old allow must not revive after API replacement");
    assert.equal(assigned.at(-1), "/entry");
    await render(apiFor(admin));
    assert.match(dom.window.document.body.textContent, /移行準備中/, "fresh authorized retry succeeds");
    assert.equal(listeners.size, 1);
  } finally {
    await React.act(async () => root.unmount());
    assert.equal(listeners.size, 0, "App disposal removes browser history listeners");
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  }
});

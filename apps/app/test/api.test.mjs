// MIG-0701: PersonalApi read client (URL building, status mapping, read-only).
import assert from "node:assert/strict";
import test from "node:test";
import { createPersonalApi, dashboard, library, user } from "./helpers.mjs";

const respond = (status, body) => ({ status, json: async () => { if (body === undefined) throw new Error("no body"); return body; } });
function client(res) {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push([url, init]); if (res instanceof Error) throw res; return res; };
  return { api: createPersonalApi(fetchFn), calls };
}

test("session: 200 -> ok(user), 401 anonymous, 403 banned, other/network/bad JSON -> unavailable", async () => {
  const u = user();
  assert.deepEqual(await client(respond(200, { user: u })).api.getSession(), { status: "ok", user: u });
  assert.deepEqual(await client(respond(401, {})).api.getSession(), { status: "anonymous" });
  assert.deepEqual(await client(respond(403, {})).api.getSession(), { status: "banned" });
  for (const res of [respond(503, {}), respond(500, {}), respond(404, {}), respond(200), new Error("net")]) {
    assert.deepEqual(await client(res).api.getSession(), { status: "unavailable" });
  }
});

test("data endpoints use GET /api/personal/* with same-origin credentials and no-store; no body, no write methods", async () => {
  const d = dashboard();
  const c = client(respond(200, d));
  assert.deepEqual(await c.api.getDashboard(), { status: "ok", data: d });
  assert.equal(c.calls[0][0], "/api/personal/dashboard");
  assert.equal(c.calls[0][1].method, "GET");
  assert.equal(c.calls[0][1].credentials, "same-origin");
  assert.equal(c.calls[0][1].cache, "no-store");
  assert.equal(c.calls[0][1].body, undefined);
});

test("query strings: only provided values, URL-encoded", async () => {
  const lib = client(respond(200, library()));
  await lib.api.getLibrary({ tab: "mine", page: "2" });
  await lib.api.getLibrary({ tab: null, page: undefined });
  await lib.api.getLibrary({ tab: "a b&c", page: "" });
  assert.deepEqual(lib.calls.map((c) => c[0]), [
    "/api/personal/library?tab=mine&page=2", "/api/personal/library", "/api/personal/library?tab=a+b%26c",
  ]);
  const set = client(respond(200, {}));
  await set.api.getSettings({ tab: "history", x: "Foo", onboarding: "1" });
  await set.api.getSettings({});
  await set.api.getOnboarding();
  assert.deepEqual(set.calls.map((c) => c[0]), [
    "/api/personal/settings?tab=history&x=Foo&onboarding=1", "/api/personal/settings", "/api/personal/onboarding",
  ]);
});

test("every data endpoint maps 401/403/5xx identically", async () => {
  for (const call of [(a) => a.getDashboard(), (a) => a.getLibrary({}), (a) => a.getSettings({}), (a) => a.getOnboarding()]) {
    assert.deepEqual(await call(client(respond(401, {})).api), { status: "anonymous" });
    assert.deepEqual(await call(client(respond(403, {})).api), { status: "banned" });
    assert.deepEqual(await call(client(respond(503, { error: "unavailable" })).api), { status: "unavailable" });
  }
});

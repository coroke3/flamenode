import assert from "node:assert/strict";
import test from "node:test";
import { createOperationModeBannerApi } from "../.test-dist/apps/app/src/api/operationMode.js";

const respond = (status, body) => ({
  status,
  json: async () => {
    if (body === undefined) throw new Error("invalid JSON");
    return body;
  },
});
function client(result) {
  const calls = [];
  const api = createOperationModeBannerApi(async (path, init) => {
    calls.push({ path, init });
    if (result instanceof Error) throw result;
    return result;
  });
  return { api, calls };
}

test("MIG-0718 U01 T01: supported non-normal modes retain their reason", async () => {
  for (const mode of ["economy", "read_only", "static_only", "maintenance"]) {
    const response = { mode, reason: "scheduled maintenance" };
    assert.deepEqual(await client(respond(200, response)).api.getBanner(), response);
    assert.deepEqual(await client(respond(200, { mode, reason: null })).api.getBanner(),
      { mode, reason: null });
  }
});

test("MIG-0718 U01 T01: uses public GET, same-origin credentials, no-store and forwards abort signal", async () => {
  const c = client(respond(200, { mode: "economy", reason: null }));
  const controller = new AbortController();
  assert.deepEqual(await c.api.getBanner(controller.signal), { mode: "economy", reason: null });
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].path, "/api/operation-mode/banner");
  assert.equal(c.calls[0].init.method, "GET");
  assert.equal(c.calls[0].init.credentials, "same-origin");
  assert.equal(c.calls[0].init.cache, "no-store");
  assert.deepEqual(c.calls[0].init.headers, { accept: "application/json" });
  assert.equal(c.calls[0].init.signal, controller.signal);
  assert.equal(c.calls[0].init.body, undefined);
});

test("MIG-0718 U01 T02: normal/unexpected mode/malformed JSON display no banner", async () => {
  for (const raw of [
    { mode: "normal", reason: null },
    { mode: "normal", reason: "operator note" },
    { mode: "unknown", reason: "note" },
    null, [], "", {}, { reason: null },
  ]) {
    assert.equal(await client(respond(200, raw)).api.getBanner(), null);
  }
});

test("MIG-0718 U01 T02: network errors, 401, 403, 404, 5xx, JSON failure hide banner", async () => {
  for (const result of [
    respond(401, { error: "unauthorized" }),
    respond(403, { error: "forbidden" }),
    respond(404, null),
    respond(503, { error: "unavailable" }),
    respond(200),
    new Error("network failure"),
  ]) assert.equal(await client(result).api.getBanner(), null);
});

test("MIG-0718 U01 T02: reject malformed or huge reason before rendering", async () => {
  for (const raw of [
    { mode: "economy" },
    { mode: "maintenance", reason: 123 },
    { mode: "economy", reason: "x".repeat(2049) },
  ]) assert.equal(await client(respond(200, raw)).api.getBanner(), null);
  assert.deepEqual(await client(respond(200, {
    mode: "maintenance", reason: "x".repeat(2048),
  })).api.getBanner(), { mode: "maintenance", reason: "x".repeat(2048) });
});

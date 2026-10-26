import assert from "node:assert/strict";
import test from "node:test";
import { createOperationModeBannerApi } from "../.test-dist/apps/app/src/api/operationMode.js";

const respond = (status, body) =>
  new Response(body === undefined ? "{invalid" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
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

test("MIG-0718 U01 T03: announced oversized body is rejected before reading", async () => {
  let started = 0;
  const stream = new ReadableStream({
    pull(controller) {
      started += 1;
      controller.enqueue(new TextEncoder().encode('{"mode":"economy","reason":null}'));
      controller.close();
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { "Content-Length": String(128 * 1024) },
  });
  assert.equal(await client(response).api.getBanner(), null);
  // The browser may pre-pull; content-length rejection must not parse or show it.
  assert.ok(started <= 1);
});

test("MIG-0718 U01 T03: chunked response over 16KiB is not buffered or displayed", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(9000).fill(65));
      controller.enqueue(new Uint8Array(9000).fill(65));
      // Do not close the stream: cancellation must stop an unfinished body.
    },
    cancel() { cancelled = true; },
  });
  assert.equal(await client(new Response(stream, { status: 200 })).api.getBanner(), null);
  assert.equal(cancelled, true, "unfinished response body must be cancelled");
});

test("MIG-0718 U01 T03: streamed multi-byte UTF-8 across chunks decodes safely", async () => {
  const expected = { mode: "economy", reason: "雪\u26c4" };
  const utf8 = new TextEncoder().encode(JSON.stringify(expected));
  const splitAt = utf8.findIndex((byte) => byte >= 0x80) + 1;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(utf8.slice(0, splitAt));
      controller.enqueue(utf8.slice(splitAt));
      controller.close();
    },
  });
  assert.deepEqual(await client(new Response(stream, { status: 200 })).api.getBanner(), expected);
});

test("MIG-0718 U01 T03: aborted request ignores a late successful response", async () => {
  const controller = new AbortController();
  const c = createOperationModeBannerApi(async () => {
    controller.abort();
    return respond(200, { mode: "maintenance", reason: "stale" });
  });
  assert.equal(await c.getBanner(controller.signal), null);
});

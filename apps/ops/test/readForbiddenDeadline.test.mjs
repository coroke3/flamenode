import test from "node:test";
import assert from "node:assert/strict";
import { getJson } from "../.test-dist/apps/ops/src/api/read.js";

const json = (status, value) =>
  new Response(JSON.stringify(value), {
    status, headers: { "content-type": "application/json" },
  });

test("SEC-808: 403 header remains forbidden when optional JSON never resolves", async () => {
  let reads = 0;
  const begin = Date.now();
  const result = await getJson(async (url, init) => {
    assert.equal(url, "/api/admin-read/ops/youtube-sync");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    return {
      status: 403,
      json() { reads += 1; return new Promise(() => {}); },
    };
  }, "/api/admin-read/ops/youtube-sync");
  assert.deepEqual(result, { status: "forbidden" });
  assert.equal(reads, 1);
  assert.ok(Date.now() - begin < 2000, "stalled 403 cannot indefinitely hide revocation");
});

test("SEC-808: 403 body that resolves promptly preserves existing redirect/reason contract", async () => {
  for (const redirect of ["/dashboard", "/entry", "/onboarding",
    "/entry?error=auth_temporarily_unavailable"]) {
    assert.deepEqual(await getJson(async () => json(403, { redirect, reason: "denied" }), "/api/manage"),
      { status: "forbidden", redirect, reason: "denied" });
  }
  assert.deepEqual(await getJson(async () => json(403, {
    redirect: "https://malicious.example", reason: "denied",
  }), "/api/manage"), { status: "forbidden", reason: "denied" });
  assert.deepEqual(await getJson(async () => new Response("bad JSON", { status: 403 }), "/api/manage"),
    { status: "forbidden" });
  assert.deepEqual(await getJson(async () => ({ status: 403, json() { throw Error("broken"); } }),
    "/api/manage"), { status: "forbidden" });
});

test("SEC-808: abort during stalled 403 body returns unavailable without waiting for deadline", async () => {
  const controller = new AbortController();
  let notifyBody;
  const bodyStarted = new Promise(resolve => { notifyBody = resolve; });
  const begin = Date.now();
  const pending = getJson(async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    return {
      status: 403,
      json() { notifyBody(); return new Promise(() => {}); },
    };
  }, "/api/manage", controller.signal);
  await bodyStarted;
  controller.abort();
  assert.deepEqual(await pending, { status: "unavailable" });
  assert.ok(Date.now() - begin < 2000);
});

test("SEC-808: late 403 JSON cannot reclassify a completed forbidden result", async () => {
  let release;
  const body = new Promise(resolve => { release = resolve; });
  const result = await getJson(async () => ({ status: 403, json: () => body }), "/api/manage");
  assert.deepEqual(result, { status: "forbidden" });
  release({ redirect: "/onboarding", reason: "late" });
  await Promise.resolve();
  assert.deepEqual(result, { status: "forbidden" });
});

test("SEC-808: ordinary 401/200/404/501/503 mappings remain unchanged", async () => {
  for (const [status, expected] of [
    [401, { status: "anonymous" }],
    [200, { status: "ok", data: { x: true } }],
    [404, { status: "notFound" }],
    [501, { status: "unsupported" }],
    [503, { status: "unavailable" }],
  ]) {
    assert.deepEqual(await getJson(async () => json(status, { x: true }), "/api/manage"), expected);
  }
});

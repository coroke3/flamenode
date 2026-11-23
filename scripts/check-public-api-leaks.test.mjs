import assert from "node:assert/strict";
import test from "node:test";
import { checkEndpoint, discoverVideoDetailEndpoint } from "./check-public-api-leaks.mjs";

const origin = "https://example.test";
const listUrl = `${origin}/api/videos?limit=1`;
const envelope = { total: 1, page: 1, limit: 1 };

test("discovers the first public video detail URL and encodes its id", async () => {
  const result = await discoverVideoDetailEndpoint(origin, async (url) => {
    assert.equal(url, listUrl);
    return Response.json({ items: [{ id: "video/one" }], ...envelope });
  });
  assert.deepEqual(result, {
    kind: "ok",
    endpoint: `${origin}/api/videos/video%2Fone`,
  });
});

test("a valid empty list is the only successful skip", async () => {
  assert.deepEqual(
    await discoverVideoDetailEndpoint(origin, async () => Response.json({ items: [], total: 0, page: 1, limit: 1 })),
    { kind: "empty" },
  );
});

test("discovery HTTP failures cannot silently skip the detail probe", async () => {
  assert.deepEqual(
    await discoverVideoDetailEndpoint(origin, async () => new Response(null, { status: 503 })),
    { kind: "http_error", url: listUrl, status: 503 },
  );
});

test("discovery transport errors are surfaced separately", async () => {
  assert.deepEqual(
    await discoverVideoDetailEndpoint(origin, async () => {
      throw new Error("network unavailable");
    }),
    { kind: "fetch_error", url: listUrl },
  );
});

test("malformed JSON and invalid list shapes fail closed", async () => {
  for (const response of [
    new Response("{broken", { headers: { "Content-Type": "application/json" } }),
    Response.json(null),
    Response.json({}),
    Response.json({ items: null }),
    Response.json({ items: "not an array" }),
    Response.json({ items: [{ title: "missing id" }], ...envelope }),
    Response.json({ items: [{ id: "   " }], ...envelope }),
    // empty list with a malformed or inconsistent envelope must not skip the probe
    Response.json({ items: [] }),
    Response.json({ items: [], total: 1, page: 1, limit: 1 }),
    Response.json({ items: [], total: -1, page: 1, limit: 1 }),
    Response.json({ items: [], total: 0, page: 0, limit: 1 }),
    Response.json({ items: [], total: 0, page: 1, limit: "1" }),
    // non-empty list with a missing or inconsistent envelope
    Response.json({ items: [{ id: "a" }] }),
    Response.json({ items: [{ id: "a" }], total: 0, page: 1, limit: 1 }),
  ]) {
    assert.deepEqual(
      await discoverVideoDetailEndpoint(origin, async () => response),
      { kind: "invalid_json", url: listUrl },
    );
  }
});


test("poisoned discovery provider messages never escape or change the fail-closed verdict", async () => {
  const poisoned = new Error("provider-secret=private");
  Object.defineProperty(poisoned, "message", {
    get() { throw new Error("message getter must never be read"); },
  });
  for (const failure of [
    new Error("provider-secret=private"),
    poisoned,
    {
      get name() { throw new Error("name getter must never be read"); },
      get message() { throw new Error("message getter must never be read"); },
      toString() { throw new Error("String(error) must never be called"); },
    },
  ]) {
    const result = await discoverVideoDetailEndpoint(origin, async () => { throw failure; });
    assert.deepEqual(result, { kind: "fetch_error", url: listUrl });
    assert.doesNotMatch(JSON.stringify(result), /provider-secret|message getter|name getter/);
  }
});

test("live leak probe never logs provider errors or poisoned JSON decoder details", async () => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => { lines.push(args); };
  try {
    const poisoned = new Error("provider-secret=private");
    Object.defineProperty(poisoned, "message", {
      get() { throw new Error("poisoned decoder getter"); },
    });
    const transport = await checkEndpoint(listUrl, async () => { throw poisoned; });
    assert.deepEqual(transport, { kind: "fetch_error" });
    const invalid = await checkEndpoint(listUrl, async () => ({
      ok: true,
      async json() { throw poisoned; },
    }));
    assert.deepEqual(invalid, { kind: "invalid_json" });
    assert.deepEqual(lines, [
      ["[fetch error] " + listUrl + ": network_error"],
      ["[invalid json] " + listUrl + ": malformed_json"],
    ]);
    assert.doesNotMatch(JSON.stringify(lines), /provider-secret|poisoned decoder getter/);
  } finally {
    console.error = original;
  }
});


test("unavailable diagnostics never turn rejected live probes into success or throw", async () => {
  const original = console.error;
  console.error = () => { throw new Error("logger unavailable"); };
  try {
    const failedNetwork = await checkEndpoint(listUrl, async () => { throw new Error("network failed"); });
    assert.deepEqual(failedNetwork, { kind: "fetch_error" });

    const failedHttp = await checkEndpoint(listUrl, async () => new Response(null, { status: 503 }));
    assert.deepEqual(failedHttp, { kind: "http_error" });

    const failedJson = await checkEndpoint(listUrl, async () => new Response("{bad", {
      headers: { "Content-Type": "application/json" },
    }));
    assert.deepEqual(failedJson, { kind: "invalid_json" });
  } finally {
    console.error = original;
  }
});

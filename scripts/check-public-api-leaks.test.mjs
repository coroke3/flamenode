import assert from "node:assert/strict";
import test from "node:test";
import { discoverVideoDetailEndpoint } from "./check-public-api-leaks.mjs";

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
    { kind: "fetch_error", url: listUrl, message: "network unavailable" },
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

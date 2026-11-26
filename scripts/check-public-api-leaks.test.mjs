import assert from "node:assert/strict";
import test from "node:test";
import { checkEndpoint, discoverVideoDetailEndpoint, runLiveCheck } from "./check-public-api-leaks.mjs";

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


test("complete live probe retains all endpoint checks and exit 3 for malformed discovery despite a broken logger", async () => {
  const originalError = console.error;
  const originalLog = console.log;
  const successLogs = [];
  console.error = () => { throw new Error("diagnostic sink is down"); };
  console.log = (...args) => { successLogs.push(args); };
  try {
    for (const discoveryResponse of [
      new Response(null, { status: 503 }),
      new Response("{invalid-json", { headers: { "Content-Type": "application/json" } }),
    ]) {
      const seen = [];
      const exits = [];
      await runLiveCheck(origin, async (url) => {
        seen.push(url);
        if (url === listUrl) return discoveryResponse;
        if (url.endsWith("page=1")) return new Response("{bad");
        return Response.json({ ok: true });
      }, (code) => exits.push(code));
      assert.deepEqual(exits, [3]);
      assert.equal(seen.length, 5, "discovery plus four API probes must run, even when diagnostics throw");
      assert.equal(seen[0], listUrl);
    }
    assert.deepEqual(successLogs, [], "a failed live probe must not emit the success banner");
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("complete live probe detects forbidden public keys when diagnostic logger throws", async () => {
  const originalError = console.error;
  const originalLog = console.log;
  const successLogs = [];
  let calls = 0;
  console.error = () => { throw new Error("log unavailable"); };
  console.log = (...args) => { successLogs.push(args); };
  try {
    const exits = [];
    await runLiveCheck(origin, async (url) => {
      calls += 1;
      if (url === listUrl) return Response.json({ items: [], total: 0, page: 1, limit: 1 });
      return Response.json({ email: "private.example" });
    }, (code) => exits.push(code));
    assert.equal(calls, 5);
    assert.deepEqual(exits, [1], "forbidden public keys retain exit code 1");
    assert.deepEqual(successLogs, []);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("complete live probe retains the valid empty-list success behavior", async () => {
  const originalError = console.error;
  const originalLog = console.log;
  const successLogs = [];
  let calls = 0;
  console.error = () => { throw new Error("unused log unavailable"); };
  console.log = (...args) => { successLogs.push(args); };
  try {
    const exits = [];
    await runLiveCheck(origin, async (url) => {
      calls += 1;
      if (url === listUrl) return Response.json({ items: [], total: 0, page: 1, limit: 1 });
      return Response.json({ items: [] });
    }, (code) => exits.push(code));
    assert.equal(calls, 5);
    assert.deepEqual(exits, []);
    assert.deepEqual(successLogs, [
      ["[check:public-api-leaks] OK: live public API responses contain no forbidden keys."],
    ]);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { getJson } from "../.test-dist/apps/ops/src/api/read.js";
import { send } from "../.test-dist/apps/ops/src/api/write.js";

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0707 T05: Ops read client maps all six status codes", async () => {
  const expected = [
    [200, { status: "ok", data: { items: [1] } }],
    [401, { status: "anonymous" }],
    [403, { status: "forbidden", redirect: "/dashboard", reason: "no_role" }],
    [404, { status: "notFound" }],
    [501, { status: "unsupported" }],
    [500, { status: "unavailable" }],
  ];
  for (const [status, result] of expected) {
    const body = status === 200 ? { items: [1] }
      : status === 403 ? { redirect: "/dashboard", reason: "no_role" } : {};
    assert.deepEqual(await getJson(async () => jsonResponse(status, body), "/api/manage/test"), result);
  }
});

test("MIG-0707 T05: GET retains same-origin/no-store and abort signal", async () => {
  const controller = new AbortController();
  let request;
  const result = await getJson(async (path, init) => {
    request = { path, init };
    return jsonResponse(200, { ok: true });
  }, "/api/admin-read/users", controller.signal);
  assert.deepEqual(result, { status: "ok", data: { ok: true } });
  assert.equal(request.path, "/api/admin-read/users");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.headers.accept, "application/json");
  assert.equal(request.init.signal, controller.signal);
});

test("MIG-0707 T05: malformed response, rejected network and late abort fail closed", async () => {
  assert.deepEqual(await getJson(async () => new Response("not-json", { status: 200 }), "/api/manage"),
    { status: "unavailable" });
  assert.deepEqual(await getJson(async () => new Response("not-json", { status: 403 }), "/api/manage"),
    { status: "unavailable" });
  assert.deepEqual(await getJson(async () => { throw new Error("offline"); }, "/api/manage"),
    { status: "unavailable" });
  const controller = new AbortController();
  assert.deepEqual(await getJson(async () => {
    controller.abort();
    return jsonResponse(200, { secret: true });
  }, "/api/manage", controller.signal), { status: "unavailable" });
});

test("MIG-0707 T05: forbidden result never copies non-string redirect or reason", async () => {
  assert.deepEqual(await getJson(async () => jsonResponse(403, {
    redirect: { unsafe: true }, reason: ["untrusted"],
  }), "/api/manage"), { status: "forbidden" });
});

test("MIG-0707 T05: send JSON and FormData with correct headers, preserves false ok", async () => {
  const seen = [];
  const fetchFn = async (path, init) => {
    seen.push({ path, init });
    return jsonResponse(400, { ok: false, error: "invalid" });
  };
  assert.deepEqual(await send(fetchFn, "PATCH", "/api/admin/test", { x: 1 }),
    { status: "ok", data: { ok: false, error: "invalid" } });
  assert.equal(seen[0].init.credentials, "same-origin");
  assert.equal(seen[0].init.cache, "no-store");
  assert.equal(seen[0].init.headers["content-type"], "application/json");
  assert.equal(seen[0].init.headers.accept, "application/json");
  assert.equal(seen[0].init.body, '{"x":1}');
  const form = new FormData();
  form.set("file", "data");
  await send(fetchFn, "POST", "/api/admin/upload", form);
  assert.equal(seen[1].init.body, form);
  assert.equal("content-type" in seen[1].init.headers, false);
});

test("MIG-0707 T05: send 401 without ok, invalid JSON and network errors", async () => {
  assert.deepEqual(await send(async () => jsonResponse(401, { error: "login" }), "POST", "/api/ops"),
    { status: "anonymous" });
  assert.deepEqual(await send(async () => jsonResponse(200, { result: true }), "PUT", "/api/ops"),
    { status: "unavailable" });
  assert.deepEqual(await send(async () => new Response("oops", { status: 200 }), "DELETE", "/api/ops"),
    { status: "unavailable" });
  assert.deepEqual(await send(async () => { throw Error("offline"); }, "POST", "/api/ops"),
    { status: "unavailable" });
});

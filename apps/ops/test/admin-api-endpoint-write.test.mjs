import assert from "node:assert/strict";
import test from "node:test";
import { createAdminApiEndpointWriteApi } from "../.test-dist/apps/ops/src/api/adminApiEndpointWrite.js";

const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0727 U04: enable and disable use exact mounted SA-007/008 paths", async () => {
  const calls = [];
  const api = createAdminApiEndpointWriteApi(async (path, init) => {
    calls.push({ path, init });
    return reply(200, { ok: true, id: "event/a", message: "公開API設定を更新しました。" });
  });
  assert.equal((await api.enable(" event/a ")).ok, true);
  assert.equal((await api.setActive("event/a", 0)).ok, true);
  assert.equal((await api.setActive("event/a", 1)).ok, true);
  assert.deepEqual(calls.map(c => c.path), [
    "/api/admin/api-endpoints", "/api/admin/api-endpoints/event%2Fa", "/api/admin/api-endpoints/event%2Fa",
  ]);
  assert.deepEqual(calls.map(c => c.init.method), ["POST", "PATCH", "PATCH"]);
  assert.deepEqual(calls.map(c => JSON.parse(c.init.body)), [
    { event_id: "event/a" }, { public_api_enabled: 0 }, { public_api_enabled: 1 },
  ]);
  for (const call of calls) {
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.headers["content-type"], "application/json");
  }
});

test("MIG-0727 U04: invalid event IDs and enabled values never trigger a mutation", async () => {
  let calls = 0;
  const api = createAdminApiEndpointWriteApi(async () => {
    calls++;
    return reply(200, { ok: true });
  });
  assert.deepEqual(await api.enable(""), { ok: false, message: "event_idが不正です。" });
  assert.equal((await api.enable(" ".repeat(5))).ok, false);
  assert.equal((await api.enable("x".repeat(129))).ok, false);
  assert.equal((await api.setActive("", 0)).ok, false);
  assert.equal((await api.setActive("event1", 2)).ok, false);
  assert.equal((await api.setActive("event1", "0")).ok, false);
  assert.equal(calls, 0);
});

test("MIG-0727 U04: auth denial, upstream failure, invalid response and CAS failure remain fail-closed", async () => {
  const denied = createAdminApiEndpointWriteApi(async () => reply(401, { ok: true }));
  assert.deepEqual(await denied.enable("event1"), { ok: false, message: "ログインしてください。" });
  const conflict = createAdminApiEndpointWriteApi(async () => reply(500, {
    ok: false, message: "更新が競合したか監査記録に失敗しました。",
  }));
  assert.deepEqual(await conflict.setActive("event1", 0), {
    ok: false, message: "更新が競合したか監査記録に失敗しました。",
  });
  const malformed = createAdminApiEndpointWriteApi(async () => reply(200, { ok: true, id: 123 }));
  assert.equal((await malformed.enable("event1")).ok, false);
  const liar = createAdminApiEndpointWriteApi(async () => reply(403, { ok: true }));
  assert.equal((await liar.enable("event1")).ok, false);
  const offline = createAdminApiEndpointWriteApi(async () => { throw Error("offline"); });
  assert.equal((await offline.enable("event1")).ok, false);
});

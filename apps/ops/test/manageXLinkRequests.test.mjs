// MIG-0725 U03a. Read-only request queue contract; server denies unauthorized staff with 404.
import assert from "node:assert/strict";
import test from "node:test";
import { readManageXLinkRequests } from "../.test-dist/apps/ops/src/api/manageXLinkRequests.js";

const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const row = {
  id: "req/1", requested_x_id: "alice", requested_by_auth_user_id: "account1",
  discord_name: "Staff", discord_image: null, requested_at: 1_700_000_000,
  request_type: "new_link", target_x_user_id: null, requested_x_name: "Alice",
  requested_icon_url: null, requested_approval_status: "pending",
  target_icon_url: null, target_approval_status: null,
};

test("U03a queues only a no-store same-origin GET and carries the abort signal", async () => {
  const controller = new AbortController();
  let calls = 0;
  const got = await readManageXLinkRequests(async (url, init) => {
    calls++;
    assert.equal(url, "/api/manage/x-link-requests");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.accept, "application/json");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.body, undefined);
    return response(200, { rows: [row] });
  }, controller.signal);
  assert.equal(calls, 1);
  assert.deepEqual(got, { status: "ok", data: { rows: [row] } });
  assert.deepEqual(await readManageXLinkRequests(async () => response(200, { rows: [] })),
    { status: "ok", data: { rows: [] } });
});

test("U03a refuses malformed or partial sensitive X ID pending records", async () => {
  for (const body of [
    {}, { rows: null }, { rows: [{ id: "req1" }] }, { rows: "private" },
    { rows: [{ ...row, requested_at: "1700000000" }] },
    { rows: [{ ...row, target_icon_url: ["https://invalid.example"] }] },
    { rows: [{ ...row, requested_by_auth_user_id: null }] },
  ]) {
    assert.deepEqual(await readManageXLinkRequests(async () => response(200, body)),
      { status: "unavailable" });
  }
});

test("U03a unauthorized or unavailable reads never expose prior request rows", async () => {
  const outcomes = [
    [401, "anonymous"], [403, "forbidden"], [404, "notFound"],
    [501, "unsupported"], [500, "unavailable"],
  ];
  for (const [status, expected] of outcomes) {
    const got = await readManageXLinkRequests(async () => response(status, {
      rows: [row], redirect: "https://evil.invalid",
    }));
    assert.equal(got.status, expected);
    assert.equal("data" in got, false);
    assert.equal("redirect" in got, false);
  }
  assert.deepEqual(await readManageXLinkRequests(async () => {
    throw new Error("network_failure");
  }), { status: "unavailable" });
  const abort = new AbortController();
  abort.abort();
  assert.deepEqual(await readManageXLinkRequests(
    async () => response(200, { rows: [row] }), abort.signal),
    { status: "unavailable" });
});

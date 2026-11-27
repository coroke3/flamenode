// MIG-0725 U03a. Read-only request queue contract; server denies unauthorized staff with 404.
import assert from "node:assert/strict";
import test from "node:test";
import { readManageXLinkRequests, approveXIdLinkRequest, rejectXIdLinkRequest } from "../.test-dist/apps/ops/src/api/manageXLinkRequests.js";

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

test("U03c SA-090: exact encoded request path, no duplicate id or authority in JSON", async () => {
  const calls = [];
  const result = await approveXIdLinkRequest(async (url, init) => {
    calls.push([url, init]);
    return response(200, { ok: true, message: "連携を承認しました。" });
  }, " req/1 ");
  assert.deepEqual(result, { status: "ok", data: { ok: true, message: "連携を承認しました。" } });
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "/api/xid/link-requests/req%2F1/approve");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
  assert.deepEqual(init.headers, { accept: "application/json", "content-type": "application/json" });
  assert.deepEqual(JSON.parse(init.body), {});
});

test("U03c SA-091: CURRENT trim, optional reason and 500 UTF-16 code-unit limit", async () => {
  for (const [input, expected] of [[undefined, ""], ["  理由  ", "理由"], ["  " + "あ".repeat(501) + " ", "あ".repeat(500)]]) {
    let calls = 0;
    const got = await rejectXIdLinkRequest(async (url, init) => {
      calls++;
      assert.equal(url, "/api/xid/link-requests/req%2F1/reject");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { reason: expected });
      return response(200, { ok: true, message: "却下しました。" });
    }, "req/1", input);
    assert.equal(calls, 1);
    assert.deepEqual(got, { status: "ok", data: { ok: true, message: "却下しました。" } });
  }
});

test("U03c SA-090/091: blank and unsafe dot-segment or malformed Unicode IDs never fetch", async () => {
  for (const mutate of [approveXIdLinkRequest, rejectXIdLinkRequest]) {
    let calls = 0;
    const fetchFn = async () => { calls++; return response(200, { ok: true }); };
    assert.deepEqual(await mutate(fetchFn, "  "), { status: "ok", data: { ok: false, message: "申請 ID がありません。" } });
    for (const id of [".", "..", String.fromCharCode(0xd800)]) {
      assert.deepEqual(await mutate(fetchFn, id), { status: "unavailable" });
    }
    assert.equal(calls, 0);
  }
});

test("U03c D-17-3: 401 wins over JSON and non-auth failure messages retain CURRENT result", async () => {
  for (const mutate of [approveXIdLinkRequest, rejectXIdLinkRequest]) {
    for (const payload of [{ ok: false, message: "ログインが必要です。" }, { ok: true }, null]) {
      assert.deepEqual(await mutate(async () => response(401, payload), "req1"), { status: "anonymous" });
    }
    assert.deepEqual(await mutate(async () => new Response("not json", { status: 401 }), "req1"), { status: "anonymous" });
    for (const status of [400, 404, 409, 413, 503]) {
      const denial = { ok: false, message: "処理できません。" };
      assert.deepEqual(await mutate(async () => response(status, denial), "req1"), { status: "ok", data: denial });
      assert.deepEqual(await mutate(async () => response(status, { ok: true }), "req1"), { status: "unavailable" });
    }
  }
});

test("U03c strict provisional result: unknown fields, malformed messages and transport failures fail closed", async () => {
  for (const mutate of [approveXIdLinkRequest, rejectXIdLinkRequest]) {
    for (const payload of [null, [], {}, { ok: "true" }, { ok: true, message: null }, { ok: true, message: 123 }, { ok: true, redirect: "https://evil.invalid" }, { ok: false, actor_x_user_id: "unexpected" }]) {
      assert.deepEqual(await mutate(async () => response(200, payload), "req1"), { status: "unavailable" });
    }
    assert.deepEqual(await mutate(async () => new Response("not json", { status: 200 }), "req1"), { status: "unavailable" });
    assert.deepEqual(await mutate(async () => { throw new Error("private provider detail"); }, "req1"), { status: "unavailable" });
    assert.deepEqual(await mutate(async () => response(200, { ok: true }), "req1"), { status: "ok", data: { ok: true } });
  }
});

test("U03c privileged 403 is authoritative before body parsing for both review operations", async () => {
  for (const mutate of [approveXIdLinkRequest, rejectXIdLinkRequest]) {
    for (const payload of [{ ok: false, message: "private denial" }, { ok: true }, null]) {
      assert.deepEqual(await mutate(async () => response(403, payload), "req1"), { status: "forbidden" });
    }
    for (const status of [401, 403]) {
      let calls = 0;
      let bodyReads = 0;
      const denied = new Response("denied", { status });
      denied.json = () => { bodyReads++; throw new Error("private body"); };
      const got = await mutate(async (path, init) => {
        calls++;
        assert.match(path, /^\/api\/xid\/link-requests\/req1\/(?:approve|reject)$/);
        assert.equal(init.credentials, "same-origin");
        assert.equal(init.cache, "no-store");
        return denied;
      }, "req1");
      assert.deepEqual(got, { status: status === 401 ? "anonymous" : "forbidden" });
      assert.equal(calls, 1);
      assert.equal(bodyReads, 0);
    }
    assert.deepEqual(await mutate(async () => new Response("malformed", { status: 403 }), "req1"),
      { status: "forbidden" });
    assert.deepEqual(await mutate(async () => response(409, { ok: false, message: "conflict" }), "req1"),
      { status: "ok", data: { ok: false, message: "conflict" } });
  }
});

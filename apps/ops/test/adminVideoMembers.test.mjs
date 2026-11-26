import test from "node:test";
import assert from "node:assert/strict";
import { readAdminVideoMembers } from "../.test-dist/apps/ops/src/api/adminVideoMembers.js";

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "content-type": "application/json" },
  });
}
function member(i = 0, overrides = {}) {
  return {
    name: `Member ${i}`, x_user_id: `member_${i}`, role: "",
    comment: "", order_index: i, can_edit: 0, is_public_member: 1,
    chapters: [{ time: "1:23", label: "Scene", note: "retained" }],
    ...overrides,
  };
}
function snapshot(videoId = "v1", members = [member()]) {
  return {
    video: { id: videoId, title: "Works", youtube_video_id: null, collaboration_type: "collab" },
    initialMembers: members,
  };
}

test("MIG-0730 U02a: encoded GET forwards no-store, same-origin and AbortSignal", async () => {
  let request;
  const controller = new AbortController();
  const result = await readAdminVideoMembers("v one", async (path, init) => {
    request = { path, init };
    return json(200, snapshot("v one"));
  }, controller.signal);
  assert.equal(result.status, "ok");
  assert.equal(result.data.initialMembers[0].chapters[0].time, "1:23", "member chapter input is preserved");
  assert.equal(request.path, "/api/admin-read/videos/v%20one/members");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.credentials, "same-origin");
  assert.equal(request.init.cache, "no-store");
  assert.equal(request.init.headers.accept, "application/json");
  assert.equal(request.init.signal, controller.signal);
});

test("MIG-0730 U02a: 401/403/404 and transient read errors are distinct", async () => {
  for (const [code, status] of [
    [401, "anonymous"], [403, "forbidden"], [404, "notFound"],
    [501, "unsupported"], [503, "unavailable"],
  ]) {
    assert.equal(
      (await readAdminVideoMembers("v1", async () => json(code, {}))).status,
      status,
    );
  }
  const forbidden = await readAdminVideoMembers("v1", async () =>
    json(403, { reason: "forbidden", redirect: "https://example.com" }));
  assert.deepEqual(forbidden, { status: "forbidden", reason: "forbidden" },
    "403 must not permit arbitrary privileged navigation");
  assert.deepEqual(await readAdminVideoMembers("v1", async () => {
    throw Error("offline");
  }), { status: "unavailable" });
});

test("MIG-0730 U02a: malformed or cross-video 200 must not render private member input", async () => {
  const invalid = [
    snapshot("other"), // wrong /admin/videos/:id URL
    snapshot("v1", [member(0, { is_public_member: 0 })]), // hidden edit-only X
    snapshot("v1", [member(0, { chapters: [{ time: 83, label: "Scene", note: "" }] })]),
    snapshot("v1", Array.from({ length: 101 }, (_, index) => member(index))),
    { video: { id: "v1" }, initialMembers: [] },
    { video: snapshot().video, initialMembers: "not-an-array" },
  ];
  for (const body of invalid) {
    assert.deepEqual(
      await readAdminVideoMembers("v1", async () => json(200, body)),
      { status: "unavailable" },
    );
  }
  const hundred = snapshot("v1", Array.from({ length: 100 }, (_, i) => member(i)));
  const result = await readAdminVideoMembers("v1", async () => json(200, hundred));
  assert.equal(result.status, "ok", "CURRENT permits exactly 100 public members");
  assert.equal(result.data.initialMembers.length, 100);
  assert.equal((await readAdminVideoMembers("v1", async () => json(404, {}))).status,
    "notFound", "CURRENT returns 404 when the D1 member count exceeds 100");
});

test("MIG-0730 U02cm: malformed decoded GET getters/proxies do not reject a private read", async () => {
  // A mocked/legacy JSON port can return a non-JSON value after its json()
  // promise resolves. Reject it without a rejected Promise or stuck loader.
  const top = { video: snapshot().video,
    get initialMembers() { throw Error("PRIVATE_TOP_LEVEL"); } };
  const nested = snapshot();
  Object.defineProperty(nested.initialMembers[0], "name", {
    enumerable: true,
    get() { throw Error("PRIVATE_MEMBER_NAME"); },
  });
  const revoked = Proxy.revocable(snapshot(), {});
  revoked.revoke();
  const unsafeArray = Array.from({ length: 101 }, (_, i) => member(i));
  let accessed = 0;
  Object.defineProperty(unsafeArray, 0, {
    enumerable: true, configurable: true,
    get() { accessed++; throw Error("PRIVATE_OVERSIZE"); },
  });
  for (const bad of [top, nested, revoked.proxy, snapshot("v1", unsafeArray)]) {
    let calls = 0;
    const result = await readAdminVideoMembers("v1", async () => {
      calls++;
      return { status: 200, json: async () => bad };
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { status: "unavailable" },
      "hostile decoded data is unavailable, never a successful private read");
  }
  assert.equal(accessed, 0, "101 members are rejected before nested getter evaluation");
});

test("MIG-0730 U02a: malformed route IDs and cancelled requests never reveal members", async () => {
  let called = 0;
  const fetchFn = async () => { called++; return json(200, snapshot()); };
  for (const id of ["", ".", "..", "v\0tail", "\uD800", "\uDC00", "v\uD800tail", "v/child", "v\\child", " leading", "trailing ", "v\nchild", "v\tchild", "v".repeat(65), null, undefined]) {
    assert.deepEqual(await readAdminVideoMembers(id, fetchFn), { status: "unavailable" });
  }
  assert.equal(called, 0, "reject invalid IDs before network request");
  const controller = new AbortController();
  assert.deepEqual(
    await readAdminVideoMembers("v1", async () => {
      controller.abort();
      return json(200, snapshot());
    }, controller.signal),
    { status: "unavailable" },
    "an aborted fetch must not deliver a previously authorized snapshot",
  );
});


test("MIG-0730 U02i: pre-aborted read returns unavailable before invoking fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await readAdminVideoMembers("v1", async () => {
    calls++;
    return json(200, snapshot());
  }, controller.signal);
  assert.deepEqual(result, { status: "unavailable" });
  assert.equal(calls, 0, "cancelled prior read must never send HTTP");
});

test("MIG-0730 U02i: valid 64-character route ID remains supported", async () => {
  const id = "x".repeat(64);
  let requested = "";
  const result = await readAdminVideoMembers(id, async path => {
    requested = path;
    return json(200, snapshot(id));
  });
  assert.equal(requested, "/api/admin-read/videos/" + id + "/members");
  assert.equal(result.status, "ok");
});

test("MIG-0730 U02cr: abort triggered during private GET validation never publishes members", async () => {
  const controller = new AbortController();
  const payload = snapshot("v1", [member(0, { name: "PRIVATE_MEMBER" })]);
  // getJson's post-json AbortSignal check runs before this lazy getter is
  // accessed by readAdminVideoMembers' schema validation.
  Object.defineProperty(payload, "initialMembers", {
    enumerable: true,
    get() {
      controller.abort();
      return [member(0, { name: "PRIVATE_MEMBER" })];
    },
  });
  let requests = 0;
  const got = await readAdminVideoMembers("v1", async () => {
    requests++;
    return { status: 200, json: async () => payload };
  }, controller.signal);
  assert.deepEqual(got, { status: "unavailable" },
    "a revoked request must not expose newly parsed private participant rows");
  assert.equal(controller.signal.aborted, true);
  assert.equal(requests, 1);

  const normalController = new AbortController();
  const valid = await readAdminVideoMembers("v1", async () =>
    json(200, snapshot("v1", [member(1)])), normalController.signal);
  assert.equal(valid.status, "ok", "unaborted valid snapshots still render");
});

test("MIG-0730 U02cz: GET validates exactly the array used at its 100-row gate", async () => {
  const first = [member(0)];
  const oversized = Array.from({ length: 101 }, (_, i) => member(i, { name: "PRIVATE" }));
  let traversed = 0;
  Object.defineProperty(oversized, 0, {
    get() { traversed++; throw Error("PRIVATE_ROW_ACCESS"); },
  });
  const body = snapshot("v1", first);
  let reads = 0;
  Object.defineProperty(body, "initialMembers", {
    get() { reads++; return reads === 1 ? first : oversized; },
  });
  const result = await readAdminVideoMembers("v1",
    async () => ({ status: 200, json: async () => body }));
  assert.equal(result.status, "ok");
  assert.equal(result.data.initialMembers.length, 1);
  assert.equal(result.data.initialMembers[0].name, "Member 0");
  assert.equal(reads, 1, "the top-level member getter is read only once");
  assert.equal(traversed, 0, "the substituted oversized member data is never visited");
});

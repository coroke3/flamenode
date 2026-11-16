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

test("MIG-0730 U02a: malformed route IDs and cancelled requests never reveal members", async () => {
  let called = 0;
  const fetchFn = async () => { called++; return json(200, snapshot()); };
  for (const id of ["", ".", "..", "v\0tail", "\uD800", "\uDC00", "v\uD800tail"]) {
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

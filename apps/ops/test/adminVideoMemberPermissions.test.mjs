import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyAdminVideoMemberPermissionBatch } from "../.test-dist/apps/ops/src/api/adminVideoMemberPermissions.js";

const input = (overrides = {}) => ({
  videoId: "video-1", notify: true,
  intents: [{ x_user_id: "@ALICE", display_name: " Alice ", intent: "on" }],
  ...overrides,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0730 U02f: POST exact candidate SA-084 endpoint with canonical X ID and auth-safe no-store", async () => {
  const calls = [];
  const fetchFn = async (path, init) => {
    calls.push({ path, init });
    return json({ ok: true, videoId: "video-1", message: "saved" });
  };
  const saved = await applyAdminVideoMemberPermissionBatch(input({ edit_privilege_mode: "admin" }), fetchFn);
  assert.deepEqual(saved, { ok: true, message: "saved" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/videos/video-1/collaborators/batch");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, {
    accept: "application/json", "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    video_id: "video-1", edit_privilege_mode: "admin", notify: true,
    intents: [{ x_user_id: "alice", display_name: "Alice", intent: "on" }],
  });
});

test("MIG-0730 U02f: exactly 100 intents are permitted, 101 are blocked pre-network", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return json({ ok: true, videoId: "video-1" }); };
  const hundred = Array.from({ length: 100 }, (_, n) => ({
    x_user_id: "member_" + n, display_name: "Member", intent: n % 2 ? "off" : "on",
  }));
  assert.equal((await applyAdminVideoMemberPermissionBatch(input({ intents: hundred }), fetchFn)).ok, true);
  assert.equal(calls, 1);
  const over = await applyAdminVideoMemberPermissionBatch(input({
    intents: [...hundred, { x_user_id: "member_100", display_name: "Member", intent: "on" }],
  }), fetchFn);
  assert.equal(over.ok, false);
  assert.equal(calls, 1);
});

test("MIG-0730 U02f: reject duplicate canonical X handles and invalid inputs before HTTP", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return json({ ok: true }); };
  const bad = [
    input({ intents: [] }),
    input({ intents: [
      { x_user_id: "@ALICE", display_name: "Alice", intent: "on" },
      { x_user_id: "alice", display_name: "Alice 2", intent: "off" },
    ] }),
    input({ intents: [{ x_user_id: "x".repeat(21), display_name: "X", intent: "on" }] }),
    input({ intents: [{ x_user_id: "Alice/Admin", display_name: "A", intent: "on" }] }),
    input({ intents: [{ x_user_id: "alice", display_name: " ", intent: "on" }] }),
    input({ intents: [{ x_user_id: "alice", display_name: "x".repeat(81), intent: "on" }] }),
    input({ intents: [{ x_user_id: "alice", display_name: "A", intent: "toggle" }] }),
    input({ intents: [null] }),
    input({ notify: false }),
    input({ edit_privilege_mode: "superuser" }),
    input({ videoId: "" }),
    input({ videoId: "../other" }),
    input({ videoId: "v\\child" }),
    input({ videoId: " leading" }),
    input({ videoId: "trailing " }),
    input({ videoId: "other\0id" }),
    input({ videoId: "\uD800" }),
    input({ videoId: "a".repeat(65) }),
  ];
  for (const payload of bad) {
    const response = await applyAdminVideoMemberPermissionBatch(payload, fetchFn);
    assert.equal(response.ok, false);
  }
  assert.equal(calls, 0);
});

test("MIG-0730 U02f: 401/403/404/503/invalid success never claim committed", async () => {
  let calls = 0;
  for (const status of [401, 403, 404, 405, 413, 503]) {
    const response = await applyAdminVideoMemberPermissionBatch(input(), async () => {
      calls++;
      return json({ ok: true, message: "unauthorized hidden" }, status);
    });
    assert.deepEqual(response, { ok: false, message: "権限変更を確認できませんでした。状態を再取得してください。" });
  }
  for (const response of [
    json({ ok: false, message: "secret" }),
    json({ ok: "true", message: "secret" }),
    json({ ok: true, message: 42 }),
    json({ ok: true, message: "x".repeat(301) }),
    new Response("<html>not-json</html>", { status: 200 }),
  ]) {
    const result = await applyAdminVideoMemberPermissionBatch(input(), async () => { calls++; return response; });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message ?? "", /secret/);
  }
  assert.equal(calls, 11);
});

test("MIG-0730 U02f: ambiguous network failure is not automatically retried", async () => {
  let calls = 0;
  const response = await applyAdminVideoMemberPermissionBatch(input(), async () => {
    calls++;
    throw new Error("Provider INTERNAL SECRET");
  });
  assert.equal(calls, 1);
  assert.equal(response.ok, false);
  assert.doesNotMatch(response.message ?? "", /Provider|SECRET/);
});

test("MIG-0730 U02f: candidate is neither route-registered nor injected to the editor", async () => {
  const [router, editor, adapter] = await Promise.all([
    readFile(new URL("../src/routes/router.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/admin/AdminVideoMembersEditorPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/adminVideoMemberPermissions.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(router, /adminVideoMemberPermissions|AdminVideoMembersEditorPreview/);
  assert.doesNotMatch(editor, /adminVideoMemberPermissions|applyAdminVideoMemberPermissionBatch/);
  assert.match(adapter, /MIG-0650/);
  assert.match(adapter, /never|Never/i);
});

test("MIG-0730 U02l: permission batch preserves encoded safe video path and authoritative body ID", async () => {
  const requests = [];
  const data = input({ videoId: "video with space" });
  const result = await applyAdminVideoMemberPermissionBatch(data, async (path, init) => {
    requests.push({ path, init });
    return json({ ok: true, videoId: "video with space" });
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/videos/video%20with%20space/collaborators/batch");
  assert.equal(JSON.parse(requests[0].init.body).video_id, "video with space");
});

test("MIG-0730 U02bi: SA-084 must bind success to the requested video before local permission UI changes", async () => {
  let requests = 0;
  const invalidReceipts = [
    { ok: true },
    { ok: true, videoId: null },
    { ok: true, videoId: "" },
    { ok: true, videoId: "other-video", message: "wrong target" },
    { ok: true, videoId: 123 },
    { ok: "true", videoId: "video-1" },
  ];
  for (const receipt of invalidReceipts) {
    const result = await applyAdminVideoMemberPermissionBatch(input(), async () => {
      requests++;
      return json(receipt);
    });
    assert.deepEqual(result, {
      ok: false,
      message: "権限変更を確認できませんでした。状態を再取得してください。",
    });
    assert.doesNotMatch(result.message, /wrong target/);
  }
  assert.equal(requests, invalidReceipts.length, "ambiguous replies do not trigger retries");

  const valid = await applyAdminVideoMemberPermissionBatch(input(), async (path) => {
    requests++;
    assert.equal(path, "/api/videos/video-1/collaborators/batch");
    return json({ ok: true, videoId: "video-1", message: "verified" });
  });
  assert.deepEqual(valid, { ok: true, message: "verified" });
  assert.equal(requests, invalidReceipts.length + 1);
});

test("MIG-0730 U02bj: same-video permission POST remains single-flight across client callers", async () => {
  for (const outcome of ["success", "ambiguous_failure"]) {
    const videoId = "video-" + outcome;
    const requests = [];
    let settle, fail;
    const pending = new Promise((resolve, reject) => {
      settle = resolve; fail = reject;
    });
    const fetchFn = (path, init) => {
      requests.push({ path, init });
      if (path.includes(videoId)) return pending;
      return Promise.resolve(json({ ok: true, videoId: "independent-video" }));
    };
    const original = input({ videoId });
    const first = applyAdminVideoMemberPermissionBatch(original, fetchFn);
    assert.equal(requests.length, 1, "the first call must acquire the in-tab latch before awaiting");
    const duplicate = await applyAdminVideoMemberPermissionBatch(original, fetchFn);
    assert.deepEqual(duplicate, {
      ok: false,
      message: "この作品の権限変更は処理中です。結果を確認してから操作してください。",
    });
    assert.equal(requests.length, 1, "the second same-video call must not issue a POST");

    const unrelated = await applyAdminVideoMemberPermissionBatch(
      input({ videoId: "independent-video" }), fetchFn,
    );
    assert.deepEqual(unrelated, { ok: true }, "a different video is not blocked");
    assert.equal(requests.length, 2);
    if (outcome === "success") {
      settle(json({ ok: true, videoId }));
    } else {
      fail(new Error("write may have committed before transport failed"));
    }
    const firstResult = await first;
    assert.equal(firstResult.ok, outcome === "success");
    assert.equal(requests.length, 2, "an ambiguous result must not automatically retry");

    // Only a new explicit submission, after the previous request settled, may POST.
    const next = await applyAdminVideoMemberPermissionBatch(original, async (path) => {
      requests.push({ path });
      return json({ ok: true, videoId });
    });
    assert.deepEqual(next, { ok: true });
    assert.equal(requests.length, 3);
  }
});

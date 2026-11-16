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
    return json({ ok: true, message: "saved" });
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
  const fetchFn = async () => { calls++; return json({ ok: true }); };
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

import assert from "node:assert/strict";
import test from "node:test";
import { createAdminTermsApi } from "../.test-dist/apps/ops/src/api/adminTerms.js";

const draft = { version_label: "2026-11", body_markdown: "# 規約本文", severity: "major" };
const reply = (code, body) => new Response(JSON.stringify(body), {
  status: code, headers: { "content-type": "application/json" },
});

test("MIG-0727 U03b: terms draft create and update use exact Hono paths with shared validation", async () => {
  const calls = [];
  const api = createAdminTermsApi(async (path, init) => {
    calls.push({ path, init });
    return reply(200, { ok: true, id: "tv/a" });
  });
  assert.deepEqual(await api.createDraft(draft), { ok: true, id: "tv/a" });
  assert.deepEqual(await api.updateDraft("tv/a", draft), { ok: true, id: "tv/a" });
  assert.equal(calls[0].path, "/api/admin/terms");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].path, "/api/admin/terms/tv%2Fa");
  assert.equal(calls[1].init.method, "PATCH");
  for (const call of calls) {
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), {
      ...draft, ...(call.init.method === "PATCH" ? { id: "tv/a" } : {}),
    });
  }
  assert.equal((await api.createDraft({ ...draft, version_label: "" })).ok, false);
  assert.equal((await api.createDraft({ ...draft, body_markdown: "" })).ok, false);
  assert.equal((await api.createDraft({ ...draft, severity: "critical" })).ok, false);
  assert.equal((await api.updateDraft("", draft)).ok, false);
  assert.equal(calls.length, 2, "invalid drafts must not send mutations");
});

test("MIG-0727 U03b: 409 conflict, 401 expiry and malformed write response fail closed", async () => {
  const conflict = createAdminTermsApi(async () =>
    reply(409, { ok: false, message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。" }));
  assert.deepEqual(await conflict.updateDraft("tv1", draft),
    { ok: false, message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。" });
  const denied = createAdminTermsApi(async () => reply(401, { ok: true }));
  assert.deepEqual(await denied.publish("tv1"), { ok: false, message: "ログインしてください。" });
  const invalid = createAdminTermsApi(async () => reply(200, { ok: true, id: 44 }));
  assert.equal((await invalid.createDraft(draft)).ok, false);
  const down = createAdminTermsApi(async () => { throw Error("offline"); });
  assert.equal((await down.archive("tv1")).ok, false);
});

test("MIG-0727 U03b: publish and archive preserve pendingPublicReflection and do not send a body", async () => {
  const calls = [];
  const api = createAdminTermsApi(async (path, init) => {
    calls.push({ path, init });
    return reply(200, { ok: true, id: "tv1", pendingPublicReflection: true });
  });
  assert.deepEqual(await api.publish("tv1"),
    { ok: true, id: "tv1", pendingPublicReflection: true });
  assert.deepEqual(await api.archive("tv1"),
    { ok: true, id: "tv1", pendingPublicReflection: true });
  assert.equal(calls[0].path, "/api/admin/terms/tv1/publish");
  assert.equal(calls[1].path, "/api/admin/terms/tv1/archive");
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, undefined);
  }
  assert.equal((await api.publish("")).ok, false);
  assert.equal((await api.archive("")).ok, false);
  assert.equal(calls.length, 2);
});

test("MIG-0727 U03b: reaccept broadcast requires TERMS and carries the prior cursor unchanged", async () => {
  const calls = [];
  const api = createAdminTermsApi(async (path, init) => {
    calls.push({ path, init });
    return reply(200, { ok: true, enqueued: 0, cursor: "user-next", message: "DMなし" });
  });
  assert.equal((await api.broadcast("tv1", "TERM", "", "確認してください")).ok, false);
  assert.equal((await api.broadcast("tv1", "TERMS", "x".repeat(129), "確認してください")).ok, false);
  assert.equal((await api.broadcast("tv1", "TERMS", "", "  ")).ok, false);
  assert.equal(calls.length, 0);
  const r = await api.broadcast("tv1", "TERMS", "user-prev", "確認してください");
  assert.deepEqual(r, { ok: true, enqueued: 0, cursor: "user-next", message: "DMなし" });
  assert.equal(calls[0].path, "/api/admin/terms/tv1/reaccept-broadcast");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    confirm: "TERMS", cursor: "user-prev", content: "確認してください",
  });
  assert.equal((await api.broadcast("", "TERMS", "", "確認してください")).ok, false);
  assert.equal(calls.length, 1);
});

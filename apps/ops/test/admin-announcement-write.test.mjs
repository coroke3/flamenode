import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminAnnouncementsApi,
  readAnnouncementDetail,
} from "../.test-dist/apps/ops/src/api/adminAnnouncementWrite.js";

const input = {
  title: "お知らせ",
  body: "本文",
  severity: "info",
  target_audience: "all",
  is_published: "0",
  publish_at: "",
  expire_at: "",
};
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const detail = {
  id: "anc_1", title: "お知らせ", body: "本文", severity: "info",
  target_audience: "all", is_published: 0,
  publish_at: null, expire_at: null, updated_at: 1760000000,
};

test("MIG-0727 U02b: announcement detail GET is no-store, identity-checked and fail-closed", async () => {
  let sent;
  const signal = new AbortController().signal;
  const result = await readAnnouncementDetail("anc_1", async (path, init) => {
    sent = { path, init };
    return reply(200, { item: detail });
  }, signal);
  assert.deepEqual(result, { status: "ok", data: { item: detail } });
  assert.equal(sent.path, "/api/admin-read/announcements/anc_1");
  assert.equal(sent.init.method, "GET");
  assert.equal(sent.init.cache, "no-store");
  assert.equal(sent.init.credentials, "same-origin");
  assert.equal(sent.init.signal, signal);
  assert.deepEqual(await readAnnouncementDetail("anc_1", async () =>
    reply(200, { item: { ...detail, id: "another" } })), { status: "unavailable" });
  assert.deepEqual(await readAnnouncementDetail("anc_1", async () =>
    reply(200, { item: { id: "anc_1" } })), { status: "unavailable" });
  assert.deepEqual(await readAnnouncementDetail("anc_1", async () =>
    reply(404, {})), { status: "notFound" });
  assert.deepEqual(await readAnnouncementDetail("", async () => {
    throw Error("must not fetch");
  }), { status: "notFound" });
});

test("MIG-0727 U02b: create uses shared body/transport contracts; rejects invalid inputs before fetch", async () => {
  const calls = [];
  const api = createAdminAnnouncementsApi(async (path, init) => {
    calls.push({ path, init });
    return reply(200, { ok: true, id: "anc_1" });
  });
  assert.deepEqual(await api.create(input), { ok: true, id: "anc_1" });
  assert.equal(calls[0].path, "/api/admin/announcements");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ...input, id: undefined,
  });
  assert.equal((await api.create({ ...input, title: "" })).ok, false);
  assert.equal((await api.create({ ...input, publish_at: "invalid" })).ok, false);
  assert.equal((await api.create({ ...input, target_audience: "unknown" })).ok, false);
  assert.equal(calls.length, 1, "invalid input must not send a mutation");
});

test("MIG-0727 U02b: update preserves CAS, 409 message and URL-encodes path identity", async () => {
  const calls = [];
  const api = createAdminAnnouncementsApi(async (path, init) => {
    calls.push({ path, init });
    return reply(409, { ok: false, message: "他の操作で更新されています。再読み込みして確認してください。" });
  });
  const result = await api.update("abc/def", { ...input, base_updated_at: 1760000000 });
  assert.deepEqual(result, { ok: false, message: "他の操作で更新されています。再読み込みして確認してください。" });
  assert.equal(calls[0].path, "/api/admin/announcements/abc%2Fdef");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(JSON.parse(calls[0].init.body).base_updated_at, 1760000000);
  assert.equal(JSON.parse(calls[0].init.body).id, "abc/def");
  assert.equal((await api.update("", input)).ok, false);
  assert.equal(calls.length, 1);
});

test("MIG-0727 U02b: delete uses same-origin DELETE and fails closed on 401 or malformed success", async () => {
  const calls = [];
  const good = createAdminAnnouncementsApi(async (path, init) => {
    calls.push({ path, init });
    return reply(200, { ok: true });
  });
  assert.deepEqual(await good.delete("a/b"), { ok: true });
  assert.equal(calls[0].path, "/api/admin/announcements/a%2Fb");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal((await good.delete("")).ok, false);
  assert.equal(calls.length, 1);
  const denied = createAdminAnnouncementsApi(async () => reply(401, { ok: true }));
  assert.deepEqual(await denied.delete("anc_1"), { ok: false, message: "ログインしてください。" });
  const malformed = createAdminAnnouncementsApi(async () => reply(200, { ok: true, id: 123 }));
  assert.equal((await malformed.create(input)).ok, false);
  const unreachable = createAdminAnnouncementsApi(async () => { throw Error("offline"); });
  assert.equal((await unreachable.create(input)).ok, false);
});

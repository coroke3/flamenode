import test from "node:test";
import assert from "node:assert/strict";
import { createXidProfileApi } from "../src/api/xidProfile.ts";

const ok = (body = { ok: true }) => new Response(JSON.stringify(body),
  { status: 200, headers: { "content-type": "application/json" } });

test("MIG-0708 U02: Active X POST uses CURRENT field and same-origin no-store", async () => {
  const requests = [];
  const api = createXidProfileApi(async (path, init) => {
    requests.push({ path, init }); return ok({ ok: true, message: "切り替えました。" });
  });
  assert.deepEqual(await api.setActive("My_X"), { ok: true, message: "切り替えました。" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/xid/active");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.credentials, "same-origin");
  assert.equal(requests[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(requests[0].init.body), { x_user_id: "My_X" });
});

test("MIG-0708 U02: profile PATCH sends exact CURRENT fields and encoded path ID", async () => {
  const calls = [];
  const fields = { x_name: "", profile_text: "About", portfolio_contact: "Email",
    youtube_channel_url: "https://youtube.com/@abc", other_social_links: "[]" };
  const api = createXidProfileApi(async (path, init) => { calls.push({ path, init }); return ok(); });
  assert.deepEqual(await api.updateProfile("a/b", fields), { ok: true });
  assert.equal(calls[0].path, "/api/xid/a%2Fb/profile");
  assert.deepEqual(JSON.parse(calls[0].init.body), fields);
  assert.equal(calls[0].init.method, "PATCH");
});

test("MIG-0708 U02: delete rejects wrong confirmation before network", async () => {
  let calls = 0;
  const api = createXidProfileApi(async (_path, init) => { calls++; return ok(); });
  assert.deepEqual(await api.deleteXId("foo", "DELETE bar"), { ok: false });
  assert.equal(calls, 0);
  assert.deepEqual(await api.deleteXId("foo", "DELETE foo"), { ok: true });
  assert.equal(calls, 1);
});

test("MIG-0708 U02: icon selection is JSON, upload is multipart without content-type", async () => {
  const calls = [];
  const api = createXidProfileApi(async (path, init) => {
    calls.push({ path, init }); return ok({ ok: true, iconUrl: "https://cdn.example/icon.png" });
  });
  await api.setIcon("foo", "https://cdn.example/icon.png");
  assert.equal(calls[0].path, "/api/xid/foo/icon");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(JSON.parse(calls[0].init.body).icon_url, "https://cdn.example/icon.png");
  // A Blob is accepted by FormData in Node (File is not always global).
  const file = new Blob(["abc"], { type: "image/png" });
  await api.uploadIcon("foo", file);
  assert.equal(calls[1].path, "/api/xid/foo/icon/upload");
  assert.equal(calls[1].init.method, "POST");
  assert.ok(calls[1].init.body instanceof FormData);
  assert.equal(calls[1].init.body.get("icon_file").size, 3);
  assert.equal(calls[1].init.headers["content-type"], undefined);
});

test("MIG-0708 U02: 413 validation, provider failure and malformed 200 fail closed", async () => {
  const responses = [
    new Response(JSON.stringify({ ok: false, message: "画像は8MB以下にしてください。" }), { status: 413 }),
    new Response(JSON.stringify({ ok: true, message: "must-not-succeed" }), { status: 503 }),
    new Response("<html>provider error</html>", { status: 200 }),
    ok({ unexpected: true }),
  ];
  const api = createXidProfileApi(async () => responses.shift());
  assert.deepEqual(await api.setIcon("foo", "icon"), { ok: false, message: "画像は8MB以下にしてください。" });
  assert.deepEqual(await api.setActive("foo"), { ok: false, message: "must-not-succeed" });
  assert.deepEqual(await api.setActive("foo"), { ok: false });
  assert.deepEqual(await api.setActive("foo"), { ok: false });
  const rejects = createXidProfileApi(async () => { throw Error("SECRET_DB_TOKEN"); });
  assert.deepEqual(await rejects.setActive("foo"), { ok: false });
});

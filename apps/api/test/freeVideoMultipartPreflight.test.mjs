import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { limitVideoActionBody } from "../src/middleware/bodyLimit.ts";
import { readFreeVideoMultipartPreflight } from "../src/routes/videos/submit.ts";

const authenticated = () => ({
  activeXId: "alice",
  isCollab: false,
  nowSec: 1_700_000_000,
});

function fixture(context = authenticated()) {
  const app = new Hono();
  const mutations = { count: 0 };
  app.post("/api/videos/free", limitVideoActionBody("SA-086"), async (c) => {
    c.header("Cache-Control", "private, no-store");
    const parsed = await readFreeVideoMultipartPreflight(c, context);
    if (!parsed.ok) return c.json(parsed, 400);
    // Mimic a downstream call without a D1 binding: this increments only
    // when the preflight accepts the input. It does NOT test DB mutations.
    mutations.count++;
    return c.json({
      ok: true,
      requestedEventId: parsed.value.requestedEventId,
      scheduledTime: parsed.value.scheduledTime,
      members: parsed.value.memberSubmission.members.length,
    }, 200);
  });
  return { app, mutations };
}

const validForm = () => {
  const form = new FormData();
  form.set("active_x_snapshot", "@alice");
  form.set("event_ids", "event-a");
  form.set("scheduled_time", "2026-11-21T12:34");
  return form;
};

test("MIG-0651 U02 HTTP: real multipart passes clone byte cap then pure validation", async () => {
  const { app, mutations } = fixture();
  const response = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: validForm(),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    requestedEventId: "event-a",
    scheduledTime: Date.UTC(2026, 10, 21, 3, 34) / 1000,
    members: 0,
  });
  assert.equal(mutations.count, 1);
});

test("MIG-0651 U02 HTTP: conflicting scalar multipart keys fail before mutation", async () => {
  const { app, mutations } = fixture();
  const form = validForm();
  form.append("icon_mode", "none");
  form.append("icon_mode", "upload");
  const response = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: form,
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false, message: "投稿フォームの入力が不正です。",
  });
  assert.equal(mutations.count, 0);
});

test("MIG-0651 U02 HTTP: stale authenticated Active X fails before mutation", async () => {
  const { app, mutations } = fixture({ ...authenticated(), activeXId: "bob" });
  const response = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: validForm(),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /Active X ID/);
  assert.equal(mutations.count, 0);
});

test("MIG-0651 U02 HTTP: invalid media type and broken multipart boundary fail closed", async () => {
  const { app, mutations } = fixture();
  const path = "http://localhost/api/videos/free";
  const plain = await app.request(path, {
    method: "POST", headers: { "Content-Type": "text/plain" },
    body: "active_x_snapshot=alice",
  });
  assert.equal(plain.status, 400);
  assert.deepEqual(await plain.json(), { ok: false, message: "投稿フォームの入力が不正です。" });

  const broken = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=missing" },
    body: "not a multipart payload",
  });
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { ok: false, message: "投稿フォームの入力が不正です。" });
  assert.equal(mutations.count, 0);
});

test("MIG-0651 U02 HTTP: urlencoded body accepted, bad field file denied", async () => {
  const { app, mutations } = fixture();
  const url = await app.request("http://localhost/api/videos/free", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "active_x_snapshot=%40alice&event_ids=event-a",
  });
  assert.equal(url.status, 200);
  assert.equal((await url.json()).requestedEventId, "event-a");

  const form = validForm();
  form.set("event_ids", new Blob(["event-a"]), "selection.txt");
  const bad = await app.request("http://localhost/api/videos/free", {
    method: "POST", body: form,
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).message, /イベントは1件/);
  assert.equal(mutations.count, 1, "only urlencoded input reached the simulated downstream stage");
});

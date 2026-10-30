import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import {
  DEFAULT_XID_WRITE_LIMIT_BYTES,
  XID_ACTION_BODY_LIMITS,
  XID_ICON_UPLOAD_LIMIT_BYTES,
  limitXIdActionBody,
} from "../src/middleware/bodyLimit.ts";

function testApp(action) {
  const app = new Hono();
  app.use("/xid", limitXIdActionBody(action));
  app.post("/xid", async (c) =>
    c.json({ ok: true, bytes: (await c.req.arrayBuffer()).byteLength }),
  );
  return app;
}

function send(app, length, headers = {}) {
  return app.request("http://localhost/xid", {
    method: "POST",
    headers,
    body: new Uint8Array(length),
  });
}

test("G21 assigns 64 KiB to each standard X ID write and 8 MiB to icon upload", () => {
  assert.deepEqual(Object.keys(XID_ACTION_BODY_LIMITS), [
    "SA-098", "SA-099", "SA-100", "SA-101",
    "SA-102", "SA-103", "SA-104", "SA-105",
  ]);
  for (const action of Object.keys(XID_ACTION_BODY_LIMITS).slice(0, -1)) {
    assert.equal(XID_ACTION_BODY_LIMITS[action], DEFAULT_XID_WRITE_LIMIT_BYTES);
  }
  assert.equal(XID_ACTION_BODY_LIMITS["SA-105"], XID_ICON_UPLOAD_LIMIT_BYTES);
});

test("standard write accepts exactly 64 KiB and leaves the original body readable", async () => {
  const response = await send(testApp("SA-102"), DEFAULT_XID_WRITE_LIMIT_BYTES);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, bytes: DEFAULT_XID_WRITE_LIMIT_BYTES });
});

test("standard write rejects 64 KiB + 1 by streamed byte count", async () => {
  const response = await send(testApp("SA-098"), DEFAULT_XID_WRITE_LIMIT_BYTES + 1);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: false, reason: "body_too_large" });
});

test("icon upload accepts exactly 8 MiB", async () => {
  const response = await send(testApp("SA-105"), XID_ICON_UPLOAD_LIMIT_BYTES);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, bytes: XID_ICON_UPLOAD_LIMIT_BYTES });
});

test("icon upload rejects 8 MiB + 1", async () => {
  const response = await send(testApp("SA-105"), XID_ICON_UPLOAD_LIMIT_BYTES + 1);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, reason: "body_too_large" });
});

test("declared oversize fails before any body consumption", async () => {
  const response = await send(testApp("SA-103"), 1, {
    "Content-Length": String(DEFAULT_XID_WRITE_LIMIT_BYTES + 1),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, reason: "body_too_large" });
});

test("a forged Content-Length of zero cannot bypass the stream limit", async () => {
  const response = await send(testApp("SA-104"), DEFAULT_XID_WRITE_LIMIT_BYTES + 1, {
    "Content-Length": "0",
  });
  assert.equal(response.status, 413);
});

test("malformed or noncanonical Content-Length is refused", async () => {
  for (const length of ["NaN", "-1", "01", "8.5"]) {
    const response = await send(testApp("SA-098"), 1, { "Content-Length": length });
    assert.equal(response.status, 400, length);
    assert.deepEqual(await response.json(), { ok: false, reason: "invalid_body_length" });
  }
});

test("empty request is accepted", async () => {
  const response = await testApp("SA-098").request("http://localhost/xid", { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, bytes: 0 });
});

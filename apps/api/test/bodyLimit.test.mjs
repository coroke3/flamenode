import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import {
  DEFAULT_XID_WRITE_LIMIT_BYTES,
  XID_ACTION_BODY_LIMITS,
  XID_ICON_UPLOAD_LIMIT_BYTES,
  limitXIdActionBody,
  VIDEO_ACTION_BODY_LIMITS,
  VIDEO_SUBMISSION_BODY_LIMIT_BYTES,
  limitVideoActionBody,
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


test("used request body cannot bypass or crash the preflight clone", async () => {
  const app = new Hono();
  app.use("/xid", async (c, next) => {
    await c.req.text();
    await next();
  });
  app.use("/xid", limitXIdActionBody("SA-098"));
  app.post("/xid", (c) => c.json({ ok: true }));
  const response = await app.request("http://localhost/xid", {
    method: "POST",
    body: "already read by upstream middleware",
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: false, reason: "body_unreadable" });
});


function videoBudgetTestApp(action) {
  const app = new Hono();
  app.use("/video", limitVideoActionBody(action));
  app.post("/video", async (c) =>
    c.json({ ok: true, bytes: (await c.req.arrayBuffer()).byteLength }),
  );
  return app;
}

function sendVideoBudget(app, length, headers = {}) {
  return app.request("http://localhost/video", {
    method: "POST", headers, body: new Uint8Array(length),
  });
}

test("MIG-0651 D-15-3: all three video mutation actions use the CURRENT 8 MiB byte cap", async () => {
  assert.deepEqual(Object.keys(VIDEO_ACTION_BODY_LIMITS), ["SA-086", "SA-088", "SA-089"]);
  assert.equal(VIDEO_SUBMISSION_BODY_LIMIT_BYTES, 8 * 1024 * 1024);
  for (const action of Object.keys(VIDEO_ACTION_BODY_LIMITS)) {
    assert.equal(VIDEO_ACTION_BODY_LIMITS[action], VIDEO_SUBMISSION_BODY_LIMIT_BYTES);
    const app = videoBudgetTestApp(action);
    const accepted = await sendVideoBudget(app, VIDEO_SUBMISSION_BODY_LIMIT_BYTES);
    assert.equal(accepted.status, 200, action + ": exactly 8 MiB must pass");
    assert.deepEqual(await accepted.json(), {
      ok: true, bytes: VIDEO_SUBMISSION_BODY_LIMIT_BYTES,
    });
    const denied = await sendVideoBudget(app, VIDEO_SUBMISSION_BODY_LIMIT_BYTES + 1);
    assert.equal(denied.status, 413, action + ": exactly 8 MiB +1 must reject");
    assert.equal(denied.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await denied.json(), { ok: false, reason: "body_too_large" });
  }
});

test("MIG-0651 D-15-3: declared oversized video request and forged zero length fail closed", async () => {
  const app = videoBudgetTestApp("SA-086");
  const declared = await sendVideoBudget(app, 1, {
    "Content-Length": String(VIDEO_SUBMISSION_BODY_LIMIT_BYTES + 1),
  });
  assert.equal(declared.status, 413);
  assert.deepEqual(await declared.json(), { ok: false, reason: "body_too_large" });
  const forged = await sendVideoBudget(app, VIDEO_SUBMISSION_BODY_LIMIT_BYTES + 1, {
    "Content-Length": "0",
  });
  assert.equal(forged.status, 413);
  assert.deepEqual(await forged.json(), { ok: false, reason: "body_too_large" });
  const malformed = await sendVideoBudget(app, 1, { "Content-Length": "0001" });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { ok: false, reason: "invalid_body_length" });
});


test("MIG-0651 T05: multipart envelope bytes, not only uploaded file bytes, count toward 8 MiB", async () => {
  const boundary = "fn-mig0651-test-boundary";
  const encode = new TextEncoder();
  const prefix = encode.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="icon_file"; filename="icon.png"\r\nContent-Type: image/png\r\n\r\n`,
  );
  const suffix = encode.encode(`\r\n--${boundary}--\r\n`);
  const multipartBody = (totalBytes) => {
    const body = new Uint8Array(totalBytes);
    assert.ok(totalBytes > prefix.byteLength + suffix.byteLength);
    body.set(prefix);
    body.fill(65, prefix.byteLength, totalBytes - suffix.byteLength);
    body.set(suffix, totalBytes - suffix.byteLength);
    return body;
  };
  const app = new Hono();
  app.use("/video", limitVideoActionBody("SA-086"));
  app.post("/video", async (c) => {
    const data = await c.req.formData();
    const file = data.get("icon_file");
    return c.json({ ok: true, fileBytes: file instanceof File ? file.size : null });
  });
  const sendMultipart = (totalBytes) => app.request("http://localhost/video", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: multipartBody(totalBytes),
  });
  const exact = await sendMultipart(VIDEO_SUBMISSION_BODY_LIMIT_BYTES);
  assert.equal(exact.status, 200);
  assert.deepEqual(await exact.json(), {
    ok: true,
    fileBytes: VIDEO_SUBMISSION_BODY_LIMIT_BYTES - prefix.byteLength - suffix.byteLength,
  });
  const tooLarge = await sendMultipart(VIDEO_SUBMISSION_BODY_LIMIT_BYTES + 1);
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await tooLarge.json(), { ok: false, reason: "body_too_large" });
});

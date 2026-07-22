import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectUnauthorizedWorkerRequest } from "./workerAdminAuth.ts";
import fs from "node:fs";
import path from "node:path";

const env = { WORKER_ADMIN_TOKEN: "test-admin-token" };

test("worker admin endpoint rejects all methods except POST", () => {
  const response = rejectUnauthorizedWorkerRequest(new Request("https://worker.test/rebuild"), env);
  assert.equal(response?.status, 405);
  assert.equal(response?.headers.get("Allow"), "POST");
});

test("worker admin endpoint is hidden when its token is unset", () => {
  const response = rejectUnauthorizedWorkerRequest(
    new Request("https://worker.test/rebuild", { method: "POST" }),
    {},
  );
  assert.equal(response?.status, 404);
});

test("worker admin endpoint requires the configured bearer token and empty body", () => {
  const unauthorized = rejectUnauthorizedWorkerRequest(
    new Request("https://worker.test/rebuild", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    }),
    env,
  );
  assert.equal(unauthorized?.status, 401);

  const emptyBodyStream = rejectUnauthorizedWorkerRequest(
    new Request("https://worker.test/rebuild", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-token",
        "Content-Length": "0",
      },
      // Some clients attach an empty body stream alongside Content-Length: 0.
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      duplex: "half",
    }),
    env,
  );
  assert.equal(emptyBodyStream?.status, 401);

  const tooLarge = rejectUnauthorizedWorkerRequest(
    new Request("https://worker.test/rebuild", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin-token",
        "Content-Length": "7",
      },
      body: "payload",
    }),
    env,
  );
  assert.equal(tooLarge?.status, 413);

  const malformedLength = rejectUnauthorizedWorkerRequest(
    new Request("https://worker.test/rebuild", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin-token",
        "Content-Length": "not-a-number",
      },
    }),
    env,
  );
  assert.equal(malformedLength?.status, 413);

  const accepted = rejectUnauthorizedWorkerRequest(
    new Request("https://worker.test/rebuild", {
      method: "POST",
      headers: { Authorization: "Bearer test-admin-token" },
    }),
    env,
  );
  assert.equal(accepted, null);
});

test("checked-in deployment templates contain exactly the three deployed workers", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const expected = ["content-jobs", "fast-jobs", "sync-jobs"];
  const actual = fs
    .readdirSync(path.join(root, "workers"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, "workers", entry.name, "wrangler.toml")))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, expected);
});

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

  const tooLarge = rejectUnauthorizedWorkerRequest(
    new Request("https://worker.test/rebuild", {
      method: "POST",
      headers: { Authorization: "Bearer test-admin-token" },
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

test("checked-in deployment templates contain exactly one background worker", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const expected = ["background-jobs"];
  const actual = fs
    .readdirSync(path.join(root, "workers"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, "workers", entry.name, "wrangler.toml")))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, expected);
});

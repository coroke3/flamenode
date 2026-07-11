import assert from "node:assert/strict";
import { test } from "node:test";
import { handleContentJobsFetch } from "./index.ts";

function makeEnv(token = "test-admin-token") {
  return {
    WORKER_ADMIN_TOKEN: token,
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    },
    R2: {},
    KV: {},
  };
}

test("content manual rebuild is POST and Bearer protected", async () => {
  const env = makeEnv();
  const get = await handleContentJobsFetch(new Request("https://worker.test/rebuild"), env);
  assert.equal(get.status, 405);

  const missing = await handleContentJobsFetch(
    new Request("https://worker.test/rebuild", { method: "POST" }),
    env,
  );
  assert.equal(missing.status, 401);

  const hidden = await handleContentJobsFetch(
    new Request("https://worker.test/rebuild", { method: "POST" }),
    makeEnv(""),
  );
  assert.equal(hidden.status, 404);
});

test("content manual rebuild serializes through the D1 cron lease", async () => {
  let calls = 0;
  const response = await handleContentJobsFetch(
    new Request("https://worker.test/rebuild", {
      method: "POST",
      headers: { Authorization: "Bearer test-admin-token" },
    }),
    makeEnv(),
    async () => {
      calls += 1;
      return { processed: 2, failed: 0, skipped: 0 };
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { ok: true, processed: 2, failed: 0, skipped: 0 });
});

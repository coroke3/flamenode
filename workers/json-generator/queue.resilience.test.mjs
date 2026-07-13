import assert from "node:assert/strict";
import { test } from "node:test";
import { markProcessing, markRetryOrFailed } from "./queue.ts";

test("markProcessing treats missing D1 metadata as an unclaimed row", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async run() {
            return {};
          },
        };
      },
    },
  };

  assert.equal(await markProcessing(env, "row-1", 100), null);
});

test("markRetryOrFailed normalizes malformed attempt_count before binding", async () => {
  let bindings = [];
  const env = {
    DB: {
      prepare() {
        return {
          bind(...values) {
            bindings = values;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };

  await markRetryOrFailed(
    env,
    {
      id: "row-2",
      target_type: "top",
      target_id: "global",
      priority: "normal",
      attempt_count: Number.NaN,
    },
    "lease-token",
    new Error("temporary"),
    200,
  );

  assert.equal(bindings[0], 1);
  assert.equal(bindings[2], 260);
});

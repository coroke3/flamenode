import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireCronLease, MAX_CRON_LEASE_SECONDS } from "./cronLease.ts";

test("acquireCronLease uses the final lease_expires_at schema contract", async () => {
  let statement = "";
  let bindings = [];
  const env = {
    DB: {
      prepare(sql) {
        statement = sql;
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

  const lease = await acquireCronLease(env, {
    jobName: "fast-jobs",
    leaseSeconds: 60,
    now: 100,
  });

  assert.ok(lease);
  assert.match(statement, /lease_expires_at/);
  assert.doesNotMatch(statement, /lease_until/);
  assert.equal(bindings[0], "fast-jobs");
  assert.equal(bindings[2], 160);
});

test("acquireCronLease returns null when another run owns an active lease", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 0 } };
          },
        };
      },
    },
  };
  const lease = await acquireCronLease(env, { jobName: "sync-jobs", leaseSeconds: 60 });
  assert.equal(lease, null);
});

test("acquireCronLease caps an invalidly long lease", async () => {
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

  await acquireCronLease(env, {
    jobName: "content-jobs",
    leaseSeconds: Number.POSITIVE_INFINITY,
    now: 100,
  });
  assert.equal(bindings[2], 100 + MAX_CRON_LEASE_SECONDS);
});

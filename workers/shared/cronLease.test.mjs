import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireCronLease,
  MAX_CRON_LEASE_SECONDS,
  withCronLease,
} from "./cronLease.ts";

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
  const lease = await acquireCronLease(env, {
    jobName: "sync-jobs",
    leaseSeconds: 60,
  });
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

test("withCronLease propagates a lost heartbeat and records failure", async () => {
  const statements = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return this;
          },
          async run() {
            statements.push(sql);
            if (sql.includes("INSERT INTO worker_leases")) {
              return { meta: { changes: 1 } };
            }
            if (
              sql.includes("SET lease_expires_at") &&
              sql.includes("lease_expires_at >")
            ) {
              return { meta: { changes: 0 } };
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };

  await assert.rejects(
    withCronLease(
      env,
      {
        jobName: "heartbeat-test",
        leaseSeconds: 2,
        heartbeatSeconds: 1,
      },
      () => new Promise((resolve) => setTimeout(resolve, 1_100)),
    ),
    /cron lease lost: heartbeat-test/,
  );

  assert.ok(statements.some((sql) => sql.includes("last_failed_at")));
  assert.ok(statements.some((sql) => sql.includes("lease_token = ''")));
});

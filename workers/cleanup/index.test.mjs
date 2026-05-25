import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runCleanup,
  runCleanupWithRetry,
  readHistoryRetentionDays,
} from "./index.ts";

function makePreparedMock(sql, recorder, firstReturn) {
  return {
    sql,
    bind(...args) {
      this._binds = args;
      return this;
    },
    async first() {
      recorder.push({ sql, op: "first", binds: this._binds ?? [] });
      return firstReturn ?? null;
    },
    async all() {
      recorder.push({ sql, op: "all", binds: this._binds ?? [] });
      return { results: [] };
    },
    async run() {
      recorder.push({ sql, op: "run", binds: this._binds ?? [] });
      return { success: true };
    },
  };
}

function makeDbMock(opts = {}) {
  const recorder = [];
  return {
    recorder,
    prepare(sql) {
      const firstReturn = sql.includes("history_retention_days")
        ? opts.historyRetentionFirst ?? null
        : null;
      return makePreparedMock(sql, recorder, firstReturn);
    },
  };
}

function makeEnvMock(opts) {
  const db = makeDbMock(opts);
  return { env: { DB: db }, recorder: db.recorder };
}

test("runCleanup: expected cleanup SQL is issued without video writes", async () => {
  const { env, recorder } = makeEnvMock();
  await runCleanup(env);

  const sqls = recorder.map((r) => r.sql);
  assert.ok(sqls.some((s) => s.includes("history_retention_days") && s.includes("SELECT")));
  assert.ok(sqls.some((s) => s.includes("UPDATE slots") && s.includes("priority_reclaim_until")));
  assert.ok(sqls.some((s) => s.includes("UPDATE slots") && s.includes("x_reapply_required")));
  assert.ok(sqls.some((s) => s.includes("DELETE FROM notification_outbox") && s.includes("'sent'")));
  assert.ok(sqls.some((s) => s.includes("DELETE FROM notification_outbox") && s.includes("'failed'")));
  assert.ok(sqls.some((s) => s.includes("DELETE FROM history_logs") && s.includes("retention_class = 'normal'")));
  assert.ok(sqls.some((s) => s.includes("DELETE FROM history_logs") && s.includes("retention_class = 'long_audit'")));
  assert.equal(sqls.some((s) => s.includes("UPDATE videos")), false);
});

test("runCleanup: history_retention_days=30 shortens normal history cutoff", async () => {
  const { env, recorder } = makeEnvMock({
    historyRetentionFirst: { history_retention_days: 30 },
  });
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  const normalDelete = recorder.find(
    (r) => r.sql.includes("DELETE FROM history_logs") && r.sql.includes("'normal'"),
  );
  assert.ok(normalDelete);
  const cutoff = normalDelete.binds[0];
  const expected = now - 30 * 86400;
  assert.ok(Math.abs(cutoff - expected) <= 5, `cutoff=${cutoff} ~= ${expected}`);
});

test("runCleanup: history_retention_days=null falls back to 90 days", async () => {
  const { env, recorder } = makeEnvMock({
    historyRetentionFirst: { history_retention_days: null },
  });
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  const normalDelete = recorder.find(
    (r) => r.sql.includes("DELETE FROM history_logs") && r.sql.includes("'normal'"),
  );
  assert.ok(normalDelete);
  const cutoff = normalDelete.binds[0];
  const expected = now - 90 * 86400;
  assert.ok(Math.abs(cutoff - expected) <= 5, `cutoff=${cutoff} ~= ${expected}`);
});

test("readHistoryRetentionDays: first() errors fall back to defaults", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            throw new Error("D1 unavailable");
          },
        };
      },
    },
  };
  const r = await readHistoryRetentionDays(env);
  assert.equal(r.normalDays, 90);
  assert.equal(r.longAuditDays, 365);
});

test("runCleanupWithRetry: transient errors are retried", async () => {
  let firstCallCount = 0;
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            firstCallCount += 1;
            if (firstCallCount === 1) throw new Error("Too many requests");
            return null;
          },
          async run() {
            return { success: true };
          },
        };
      },
    },
  };
  await runCleanupWithRetry(env);
  assert.ok(firstCallCount >= 1);
});

test("runCleanupWithRetry: schema errors are not retried", async () => {
  let firstCallCount = 0;
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            firstCallCount += 1;
            throw new Error("no such column: bogus");
          },
          async run() {
            return { success: true };
          },
        };
      },
    },
  };
  await runCleanupWithRetry(env);
  assert.equal(firstCallCount, 1);
});

test("runCleanup: mutating slot queries bind current time", async () => {
  const { env, recorder } = makeEnvMock();
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  const slotPrio = recorder.find((r) =>
    r.sql.includes("UPDATE slots") && r.sql.includes("priority_reclaim_until"),
  );
  assert.ok(slotPrio);
  assert.ok(Math.abs(slotPrio.binds[0] - now) <= 5);
  assert.equal(recorder.some((r) => r.sql.includes("UPDATE videos")), false);
});

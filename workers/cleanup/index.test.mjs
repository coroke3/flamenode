import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runCleanup,
  runCleanupWithRetry,
  readAuditCleanupSettings,
} from "./index.ts";

function makePreparedMock(sql, recorder, firstReturn, runResult = { success: true }) {
  return {
    bind(...args) {
      this.binds = args;
      return this;
    },
    async first() {
      recorder.push({ sql, op: "first", binds: this.binds ?? [] });
      return firstReturn ?? null;
    },
    async run() {
      recorder.push({ sql, op: "run", binds: this.binds ?? [] });
      return runResult;
    },
  };
}

function makeEnv(options = {}) {
  const recorder = [];
  let mutationIndex = 0;
  return {
    recorder,
    env: {
      DB: {
        prepare(sql) {
          const firstReturn = sql.includes("audit_compact_after_days")
            ? options.settings ?? { audit_compact_after_days: 30 }
            : null;
          const runResult = sql.includes("audit_compact_after_days")
            ? { success: true }
            : { success: true, meta: { changes: options.changes?.[mutationIndex++] ?? 0 } };
          return makePreparedMock(sql, recorder, firstReturn, runResult);
        },
      },
    },
  };
}

test("cleanupはsystem_settings.audit_*だけを設定正本として使う", async () => {
  const { env, recorder } = makeEnv({
    settings: { audit_compact_after_days: 14 },
  });
  await runCleanup(env);
  const sql = recorder.map((entry) => entry.sql).join("\n");
  assert.match(sql, /audit_compact_after_days/);
  assert.doesNotMatch(sql, /history_retention_days/);
  assert.doesNotMatch(sql, /audit_log_settings/);
  assert.doesNotMatch(sql, /priority_reclaim_until/);
  assert.match(sql, /DELETE FROM notification_outbox/);
  assert.match(sql, /DELETE FROM spreadsheet_import_runs/);
  assert.match(sql, /DELETE FROM audit_logs/);
  const compact = recorder.find((entry) =>
    entry.sql.includes("before_json = NULL"),
  );
  assert.ok(compact);
  const expected = Math.floor(Date.now() / 1000) - 14 * 86400;
  assert.ok(Math.abs(compact.binds[0] - expected) <= 5);
});

test("設定読取失敗時は監査compact既定値へ戻す", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          async first() {
            throw new Error("D1 unavailable");
          },
        };
      },
    },
  };
  assert.deepEqual(await readAuditCleanupSettings(env), {
    compactAfterDays: 30,
  });
});

test("設定読取の一時エラーは既定値へフォールバックしcleanupを継続する", async () => {
  let firstCalls = 0;
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            firstCalls += 1;
            throw new Error("Too many requests");
          },
          async run() {
            return { success: true };
          },
        };
      },
    },
  };
  const result = await runCleanupWithRetry(env);
  assert.equal(result.failed, 0);
  assert.equal(firstCalls, 1);
});

test("cleanup changes sum", async () => {
  const { env } = makeEnv({ changes: [1, 2, 3, 5, 8, 13] });
  assert.equal(await runCleanup(env), 32);
});

test("cleanup retries once and reports metrics", async () => {
  let runCalls = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            return sql.includes("audit_compact_after_days") ? { audit_compact_after_days: 30 } : null;
          },
          async run() {
            runCalls += 1;
            if (runCalls === 1) throw new Error("network unavailable");
            return { success: true, meta: { changes: 4 } };
          },
        };
      },
    },
  };
  assert.deepEqual(await runCleanupWithRetry(env), {
    processed: 1, failed: 0, d1_changes: 24, retry_count: 1,
    external_api_calls: 0, quota_stopped: false,
  });
});

test("cleanup gives up on schema errors", async () => {
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            return sql.includes("audit_compact_after_days") ? { audit_compact_after_days: 30 } : null;
          },
          async run() { throw new Error("no such table: audit_logs"); },
        };
      },
    },
  };
  assert.deepEqual(await runCleanupWithRetry(env), {
    processed: 0, failed: 1, d1_changes: 0, retry_count: 0,
    external_api_calls: 0, quota_stopped: false,
  });
});

test("cleanup reports committed changes from an attempt that later gives up", async () => {
  let runCalls = 0;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            return sql.includes("audit_compact_after_days")
              ? { audit_compact_after_days: 30 }
              : null;
          },
          async run() {
            runCalls += 1;
            if (runCalls === 1) return { meta: { changes: 2 } };
            throw new Error("no such table: audit_logs");
          },
        };
      },
    },
  };
  assert.deepEqual(await runCleanupWithRetry(env), {
    processed: 0,
    failed: 1,
    d1_changes: 2,
    retry_count: 0,
    external_api_calls: 0,
    quota_stopped: false,
  });
});

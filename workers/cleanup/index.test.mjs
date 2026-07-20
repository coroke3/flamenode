import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runCleanup,
  runCleanupWithRetry,
  readAuditCleanupSettings,
} from "./index.ts";

function makePreparedMock(sql, recorder, firstReturn) {
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
      return { success: true };
    },
  };
}

function makeEnv(options = {}) {
  const recorder = [];
  return {
    recorder,
    env: {
      DB: {
        prepare(sql) {
          const firstReturn = sql.includes("audit_compact_after_days")
            ? options.settings ?? { audit_compact_after_days: 30 }
            : null;
          return makePreparedMock(sql, recorder, firstReturn);
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

test("一時エラーは再試行する", async () => {
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
            if (firstCalls === 1) throw new Error("Too many requests");
            return { audit_compact_after_days: 30 };
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
  assert.ok(firstCalls >= 2);
});

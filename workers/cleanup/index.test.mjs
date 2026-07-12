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
      let firstReturn = null;
      if (sql.includes("history_retention_days")) {
        firstReturn = opts.historyRetentionFirst ?? null;
      } else if (sql.includes("compact_after_days")) {
        firstReturn = opts.auditSettingsFirst ?? { compact_after_days: 30 };
      }
      return makePreparedMock(sql, recorder, firstReturn);
    },
  };
}

function makeEnvMock(opts) {
  const db = makeDbMock(opts);
  return { env: { DB: db }, recorder: db.recorder };
}

test("runCleanup: audit_logs と通知・スロットのクリーンアップ SQL を発行する", async () => {
  const { env, recorder } = makeEnvMock();
  await runCleanup(env);

  const sqls = recorder.map((r) => r.sql);
  assert.ok(sqls.some((s) => s.includes("history_retention_days") && s.includes("SELECT")));
  assert.ok(sqls.some((s) => s.includes("UPDATE slots") && s.includes("priority_reclaim_until")));
  assert.equal(sqls.some((s) => s.includes("x_reapply_required")), false);
  assert.equal(sqls.some((s) => s.includes("deadline_at")), false);
  assert.ok(sqls.some((s) => s.includes("DELETE FROM notification_outbox") && s.includes("'sent'")));
  assert.ok(sqls.some((s) => s.includes("DELETE FROM notification_outbox") && s.includes("'failed'")));
  const previewCleanup = recorder.find((r) =>
    r.sql.includes("DELETE FROM spreadsheet_import_runs"),
  );
  assert.ok(previewCleanup);
  assert.ok(previewCleanup.sql.includes("LIMIT ?2"));
  assert.equal(previewCleanup.binds[1], 500);
  assert.ok(
    sqls.some(
      (s) =>
        s.includes("UPDATE audit_logs") &&
        s.includes("restore_status = 'expired'"),
    ),
  );
  assert.ok(sqls.some((s) => s.includes("DELETE FROM audit_logs")));
  assert.ok(
    sqls.some(
      (s) =>
        s.includes("UPDATE audit_logs") &&
        s.includes("before_json = NULL"),
    ),
  );
  assert.equal(sqls.some((s) => s.includes("history_logs")), false);
  assert.equal(sqls.some((s) => s.includes("UPDATE videos")), false);
});

test("runCleanup: compact_after_days を audit_log_settings から読む", async () => {
  const { env, recorder } = makeEnvMock({
    auditSettingsFirst: { compact_after_days: 14 },
  });
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  const compactUpdate = recorder.find(
    (r) =>
      r.sql.includes("UPDATE audit_logs") &&
      r.sql.includes("before_json = NULL"),
  );
  assert.ok(compactUpdate);
  const cutoff = compactUpdate.binds[0];
  const expected = now - 14 * 86400;
  assert.ok(Math.abs(cutoff - expected) <= 5, `cutoff=${cutoff} ~= ${expected}`);
});

test("runCleanup: audit_log_settings 未作成時は compact 30 日フォールバック", async () => {
  const recorder = [];
  const env = {
    DB: {
      prepare(sql) {
        if (sql.includes("compact_after_days")) {
          return makePreparedMock(sql, recorder, null);
        }
        if (sql.includes("history_retention_days")) {
          return makePreparedMock(sql, recorder, { history_retention_days: null });
        }
        return makePreparedMock(sql, recorder, null);
      },
    },
  };
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  const compactUpdate = recorder.find(
    (r) =>
      r.sql.includes("UPDATE audit_logs") &&
      r.sql.includes("before_json = NULL"),
  );
  assert.ok(compactUpdate);
  const cutoff = compactUpdate.binds[0];
  const expected = now - 30 * 86400;
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
  let auditDeleteAttempts = 0;
  const env = {
    DB: {
      prepare(sql) {
        const isAuditDelete =
          typeof sql === "string" && sql.includes("DELETE FROM audit_logs");
        return {
          bind() {
            return this;
          },
          async first() {
            return null;
          },
          async run() {
            if (isAuditDelete) {
              auditDeleteAttempts += 1;
              throw new Error("no such table: audit_logs");
            }
            return { success: true };
          },
        };
      },
    },
  };
  await runCleanupWithRetry(env);
  assert.equal(auditDeleteAttempts, 1);
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

/**
 * cleanup Worker の runCleanup を D1 モックで実行する単体テスト。
 *
 * 検証ポイント:
 * - 各テーブルに対する正しい SQL が発行されること
 * - system_settings.history_retention_days がカスタム値だった場合に history_logs の cutoff が変わること
 * - エラー耐性: first() が throw してもデフォルト値で続行
 *
 * 実 D1 には触らない。すべて in-memory モック。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runCleanup, readHistoryRetentionDays } from "./index.ts";

/** D1PreparedStatement モック。bind/all/first/run を全て記録する。 */
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

/** D1Database モック。prepare を全て recorder に登録。 */
function makeDbMock(opts = {}) {
  const recorder = [];
  return {
    recorder,
    prepare(sql) {
      // history_retention_days を返すクエリだけ first で値を返す
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

test("runCleanup: 想定 7 つの SQL を発行する", async () => {
  const { env, recorder } = makeEnvMock();
  await runCleanup(env);

  const sqls = recorder.map((r) => r.sql);
  // 1) history_retention_days SELECT
  assert.ok(
    sqls.some((s) => s.includes("history_retention_days") && s.includes("SELECT")),
    "history_retention_days SELECT が発行される",
  );
  // 2) slots priority_reclaim_until UPDATE
  assert.ok(
    sqls.some((s) => s.includes("UPDATE slots") && s.includes("priority_reclaim_until")),
    "slots.priority_reclaim_until 解放 UPDATE",
  );
  // 3) slots x_reapply_required → voided
  assert.ok(
    sqls.some((s) => s.includes("UPDATE slots") && s.includes("x_reapply_required")),
    "x_reapply_required → voided UPDATE",
  );
  // 4) notification_outbox sent DELETE
  assert.ok(
    sqls.some(
      (s) => s.includes("DELETE FROM notification_outbox") && s.includes("'sent'"),
    ),
    "notification_outbox sent DELETE",
  );
  // 5) notification_outbox failed DELETE
  assert.ok(
    sqls.some(
      (s) => s.includes("DELETE FROM notification_outbox") && s.includes("'failed'"),
    ),
    "notification_outbox failed DELETE",
  );
  // 6) history_logs normal DELETE
  assert.ok(
    sqls.some(
      (s) =>
        s.includes("DELETE FROM history_logs") && s.includes("retention_class = 'normal'"),
    ),
    "history_logs normal DELETE",
  );
  // 7) history_logs long_audit DELETE
  assert.ok(
    sqls.some(
      (s) =>
        s.includes("DELETE FROM history_logs") && s.includes("retention_class = 'long_audit'"),
    ),
    "history_logs long_audit DELETE",
  );
  // 8) videos voided is_deleted UPDATE
  assert.ok(
    sqls.some(
      (s) =>
        s.includes("UPDATE videos") &&
        s.includes("'voided'") &&
        s.includes("is_deleted = 1"),
    ),
    "voided 動画 is_deleted=1 補正 UPDATE",
  );
});

test("runCleanup: history_retention_days=30 の場合 history normal cutoff が短くなる", async () => {
  const { env, recorder } = makeEnvMock({
    historyRetentionFirst: { history_retention_days: 30 },
  });
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  // history_logs normal DELETE の bind 値 = cutoff
  const normalDelete = recorder.find(
    (r) => r.sql.includes("DELETE FROM history_logs") && r.sql.includes("'normal'"),
  );
  assert.ok(normalDelete, "normal delete があるはず");
  const cutoff = normalDelete.binds[0];
  const expected = now - 30 * 86400;
  // ±5秒の誤差を許容
  assert.ok(Math.abs(cutoff - expected) <= 5, `cutoff=${cutoff} ≈ ${expected}`);
});

test("runCleanup: history_retention_days=null ならデフォルト 90日", async () => {
  const { env, recorder } = makeEnvMock({
    historyRetentionFirst: { history_retention_days: null },
  });
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  const normalDelete = recorder.find(
    (r) => r.sql.includes("DELETE FROM history_logs") && r.sql.includes("'normal'"),
  );
  const cutoff = normalDelete.binds[0];
  const expected = now - 90 * 86400;
  assert.ok(Math.abs(cutoff - expected) <= 5, `cutoff=${cutoff} ≈ ${expected}`);
});

test("readHistoryRetentionDays: first() が throw してもデフォルトにフォールバック", async () => {
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

test("runCleanup: 各 UPDATE/DELETE の bind に now が含まれる", async () => {
  const { env, recorder } = makeEnvMock();
  await runCleanup(env);

  const now = Math.floor(Date.now() / 1000);
  // slots priority_reclaim_until UPDATE は now を 1つ bind
  const slotPrio = recorder.find((r) =>
    r.sql.includes("UPDATE slots") && r.sql.includes("priority_reclaim_until"),
  );
  assert.ok(slotPrio);
  assert.ok(Math.abs(slotPrio.binds[0] - now) <= 5);

  // voided videos UPDATE は now と cutoff の 2 つ bind
  const voidedUpd = recorder.find(
    (r) =>
      r.sql.includes("UPDATE videos") &&
      r.sql.includes("'voided'") &&
      r.sql.includes("is_deleted = 1"),
  );
  assert.ok(voidedUpd);
  assert.equal(voidedUpd.binds.length, 2);
  assert.ok(Math.abs(voidedUpd.binds[0] - now) <= 5);
  assert.ok(voidedUpd.binds[1] < voidedUpd.binds[0]);
});

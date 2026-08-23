import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createD1Budget,
  D1BudgetExceededError,
  D1_QUERY_HARD_LIMIT,
  D1_QUERY_SOFT_LIMIT,
  isD1BudgetExhausted,
  withD1Budget,
} from "./d1Budget.ts";

function createFakeDb() {
  const calls = { statements: 0, batches: 0 };
  const db = {
    prepare(query) {
      return {
        bind() {
          return this;
        },
        async all() {
          calls.statements += 1;
          return { results: [], meta: { rows_read: 10, rows_written: 0 } };
        },
        async first() {
          calls.statements += 1;
          return null;
        },
        async run() {
          calls.statements += 1;
          return { meta: { changes: 1, rows_read: 2, rows_written: 1 } };
        },
      };
    },
    async batch(statements) {
      calls.batches += 1;
      calls.statements += statements.length;
      return statements.map(() => ({
        meta: { changes: 1, rows_read: 3, rows_written: 1 },
      }));
    },
  };
  return { db, calls };
}

test("withD1Budget は statement 数と rows read/write を集計する", async () => {
  const fake = createFakeDb();
  const env = withD1Budget({ DB: fake.db });

  await env.DB.prepare("SELECT 1").all();
  await env.DB.prepare("UPDATE sample SET value = 1").run();
  await env.DB.batch([
    env.DB.prepare("UPDATE a SET value = 1"),
    env.DB.prepare("UPDATE b SET value = 2"),
  ]);

  assert.equal(env.d1Budget.statements, 4);
  assert.equal(env.d1Budget.rowsRead, 18);
  assert.equal(env.d1Budget.rowsWritten, 3);
  assert.equal(fake.calls.statements, 4);
});

test("D1_QUERY_SOFT_LIMIT 到達で isD1BudgetExhausted が true になる", () => {
  const budget = createD1Budget();
  budget.statements = D1_QUERY_SOFT_LIMIT;
  assert.equal(isD1BudgetExhausted(budget), true);
});

test("hard limit到達後のsingle statementはD1へ送る前に拒否する", async () => {
  const fake = createFakeDb();
  const env = withD1Budget({ DB: fake.db });
  env.d1Budget.statements = D1_QUERY_HARD_LIMIT;

  await assert.rejects(
    env.DB.prepare("SELECT 1").all(),
    (error) =>
      error instanceof D1BudgetExceededError &&
      error.currentStatements === D1_QUERY_HARD_LIMIT &&
      error.requestedStatements === 1,
  );
  assert.equal(fake.calls.statements, 0);
});

test("39件消費済みから12件batchで51件へ飛び越える操作は事前拒否する", async () => {
  const fake = createFakeDb();
  const env = withD1Budget({ DB: fake.db });
  env.d1Budget.statements = 39;
  const batch = Array.from({ length: 12 }, (_, index) =>
    env.DB.prepare(`UPDATE sample SET value = ${index}`),
  );

  await assert.rejects(
    env.DB.batch(batch),
    /d1_query_budget_exceeded:39\+12\/50/,
  );
  assert.equal(fake.calls.batches, 0);
  assert.equal(fake.calls.statements, 0);
  assert.equal(env.d1Budget.statements, 39);
});

test("39件消費済みから11件batchはhard limitちょうど50なので許可する", async () => {
  const fake = createFakeDb();
  const env = withD1Budget({ DB: fake.db });
  env.d1Budget.statements = 39;
  const batch = Array.from({ length: 11 }, (_, index) =>
    env.DB.prepare(`UPDATE sample SET value = ${index}`),
  );

  await env.DB.batch(batch);
  assert.equal(env.d1Budget.statements, 50);
  assert.equal(fake.calls.batches, 1);
  assert.equal(fake.calls.statements, 11);
});

test("並行開始したsingle statementも予約時点でhard limitを共有する", async () => {
  const fake = createFakeDb();
  const env = withD1Budget({ DB: fake.db });
  env.d1Budget.statements = 49;

  const results = await Promise.allSettled([
    env.DB.prepare("SELECT 1").all(),
    env.DB.prepare("SELECT 2").all(),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(env.d1Budget.statements, 50);
  assert.equal(fake.calls.statements, 1);
});

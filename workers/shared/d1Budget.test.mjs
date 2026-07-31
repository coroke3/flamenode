import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createD1Budget,
  D1_QUERY_SOFT_LIMIT,
  isD1BudgetExhausted,
  withD1Budget,
} from "./d1Budget.ts";

function createFakeDb() {
  const db = {
    prepare(query) {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [], meta: { rows_read: 10, rows_written: 0 } };
        },
        async first() {
          return null;
        },
        async run() {
          return { meta: { changes: 1, rows_read: 2, rows_written: 1 } };
        },
      };
    },
    async batch(statements) {
      return statements.map(() => ({
        meta: { changes: 1, rows_read: 3, rows_written: 1 },
      }));
    },
  };
  return db;
}

test("withD1Budget は statement 数と rows read/write を集計する", async () => {
  const env = withD1Budget({ DB: createFakeDb() });

  await env.DB.prepare("SELECT 1").all();
  await env.DB.prepare("UPDATE sample SET value = 1").run();
  await env.DB.batch([
    env.DB.prepare("UPDATE a SET value = 1"),
    env.DB.prepare("UPDATE b SET value = 2"),
  ]);

  assert.equal(env.d1Budget.statements, 4);
  assert.equal(env.d1Budget.rowsRead, 18);
  assert.equal(env.d1Budget.rowsWritten, 3);
});

test("D1_QUERY_SOFT_LIMIT 到達で isD1BudgetExhausted が true になる", () => {
  const budget = createD1Budget();
  budget.statements = D1_QUERY_SOFT_LIMIT;
  assert.equal(isD1BudgetExhausted(budget), true);
});

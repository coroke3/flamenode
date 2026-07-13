import assert from "node:assert/strict";
import { test } from "node:test";
import { withSerializedD1 } from "./serializedD1.ts";

function createFakeDb() {
  let active = 0;
  let maxActive = 0;
  const calls = [];

  function statement(query, bindings = []) {
    return {
      bind(...values) {
        return statement(query, values);
      },
      async all() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push({ query, bindings, method: "all" });
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { results: [] };
      },
      async first() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push({ query, bindings, method: "first" });
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return null;
      },
      async run() {
        calls.push({ query, bindings, method: "run" });
        return { meta: { changes: 0 } };
      },
      async raw() {
        calls.push({ query, bindings, method: "raw" });
        return [];
      },
    };
  }

  const db = {
    prepare(query) {
      return statement(query);
    },
    async batch(statements) {
      calls.push({ method: "batch", count: statements.length });
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
  };

  return {
    db,
    calls,
    maxActive: () => maxActive,
  };
}

test("Promise.allで開始されたD1 queryも1本ずつ実行する", async () => {
  const fake = createFakeDb();
  const env = withSerializedD1({ DB: fake.db });

  await Promise.all([
    env.DB.prepare("SELECT 1").all(),
    env.DB.prepare("SELECT 2").all(),
    env.DB.prepare("SELECT 3").first(),
  ]);

  assert.equal(fake.maxActive(), 1);
  assert.deepEqual(
    fake.calls.map((call) => call.query).filter(Boolean),
    ["SELECT 1", "SELECT 2", "SELECT 3"],
  );
});

test("bind済みstatementをbatchへ渡せる", async () => {
  const fake = createFakeDb();
  const env = withSerializedD1({ DB: fake.db });

  await env.DB.batch([
    env.DB.prepare("UPDATE sample SET value = ?").bind("a"),
    env.DB.prepare("UPDATE sample SET value = ?").bind("b"),
  ]);

  assert.equal(fake.calls.at(-1)?.method, "batch");
  assert.equal(fake.calls.at(-1)?.count, 2);
});

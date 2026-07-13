import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exponentialBackoffMs,
  ExternalRequestBudget,
  fetchWithTimeout,
  parseRetryAfterMs,
} from "./externalApi.ts";

test("外部API予算は上限を超えて消費しない", () => {
  const budget = new ExternalRequestBudget(2);
  assert.equal(budget.consume(), true);
  assert.equal(budget.consume(), true);
  assert.equal(budget.consume(), false);
  assert.equal(budget.used, 2);
  assert.equal(budget.remaining, 0);
});

test("Retry-Afterは秒とHTTP-dateを上限付きで解釈する", () => {
  assert.equal(parseRetryAfterMs("3", 15_000), 3_000);
  assert.equal(parseRetryAfterMs("120", 15_000), 15_000);
  assert.equal(
    parseRetryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 10_000, 1_000),
    4_000,
  );
});

test("指数バックオフはprovider指定を優先し上限を超えない", () => {
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000 }), 4_000);
  assert.equal(
    exponentialBackoffMs(0, { maxDelayMs: 10_000, retryAfterMs: 30_000 }),
    10_000,
  );
});

test("fetchWithTimeoutは呼出し前に予算を消費する", async () => {
  const budget = new ExternalRequestBudget(1);
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(String(input));
    return new Response("ok");
  };
  await fetchWithTimeout(
    "https://example.test/one",
    {},
    {
      timeoutMs: 100,
      budget,
      budgetErrorCode: "budget",
      timeoutErrorCode: "timeout",
      networkErrorCode: "network",
    },
    fetchImpl,
  );
  await assert.rejects(
    fetchWithTimeout(
      "https://example.test/two",
      {},
      {
        timeoutMs: 100,
        budget,
        budgetErrorCode: "budget",
        timeoutErrorCode: "timeout",
        networkErrorCode: "network",
      },
      fetchImpl,
    ),
    /budget/,
  );
  assert.deepEqual(calls, ["https://example.test/one"]);
});

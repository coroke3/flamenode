import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalRequestBudget,
  fetchWithTimeout,
} from "../../workers/shared/externalApi.ts";

function abortableFetch(_input, init = {}) {
  return new Promise((_, reject) => {
    const signal = init.signal;
    const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) {
      rejectAbort();
      return;
    }
    signal?.addEventListener("abort", rejectAbort, { once: true });
  });
}

test("caller abort reasonはnetwork errorへ変換されない", async () => {
  const controller = new AbortController();
  const budget = new ExternalRequestBudget(1);
  const request = fetchWithTimeout(
    "https://example.test/caller-abort",
    { signal: controller.signal },
    {
      timeoutMs: 1_000,
      budget,
      budgetErrorCode: "budget",
      timeoutErrorCode: "timeout",
      networkErrorCode: "network",
    },
    abortableFetch,
  );

  controller.abort(new Error("caller_cancelled"));
  await assert.rejects(request, /caller_cancelled/);
  assert.equal(budget.used, 1);
});

test("事前abort済みなら外部API予算もfetchも消費しない", async () => {
  const controller = new AbortController();
  controller.abort(new Error("already_cancelled"));
  const budget = new ExternalRequestBudget(1);
  let called = false;

  await assert.rejects(
    fetchWithTimeout(
      "https://example.test/pre-aborted",
      { signal: controller.signal },
      {
        timeoutMs: 1_000,
        budget,
        budgetErrorCode: "budget",
        timeoutErrorCode: "timeout",
        networkErrorCode: "network",
      },
      async () => {
        called = true;
        return new Response("unexpected");
      },
    ),
    /already_cancelled/,
  );

  assert.equal(called, false);
  assert.equal(budget.used, 0);
});

test("helper自身のdeadlineだけはtimeout errorへ正規化する", async () => {
  await assert.rejects(
    fetchWithTimeout(
      "https://example.test/timeout",
      {},
      {
        timeoutMs: 5,
        budget: new ExternalRequestBudget(1),
        budgetErrorCode: "budget",
        timeoutErrorCode: "timeout",
        networkErrorCode: "network",
      },
      abortableFetch,
    ),
    /timeout/,
  );
});

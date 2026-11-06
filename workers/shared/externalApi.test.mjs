import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exponentialBackoffMs,
  ExternalRequestBudget,
  fetchWithTimeout,
  parseRetryAfterMs,
} from "./externalApi.ts";

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

test("Retry-Afterの不正な上限はNaNや無限待機時間を返さない", () => {
  const headers = ["3", "Wed, 21 Oct 2015 07:28:00 GMT"];
  const now = Date.parse("Wed, 21 Oct 2015 07:27:56 GMT");
  for (const cap of [NaN, Infinity, -Infinity]) {
    for (const value of headers) {
      assert.equal(parseRetryAfterMs(value, cap, now), null, `cap=${cap}, value=${value}`);
    }
  }
  assert.equal(parseRetryAfterMs("3", 0), 0);
  assert.equal(parseRetryAfterMs("3", -1), 0);
});

test("Retry-Afterの不正な数値形式はHTTP日付と誤認せず拒否する", () => {
  for (const invalid of ["", " ", "3.5", "1e3", "0x10", "+3", "-1", "Infinity", "NaN", "3 GMT", "+3 GMT", "2026-02-30 GMT", "Mon, 30 Feb 2026 08:49:37 GMT", "Mon, 06 Nov 1994 08:49:37 GMT", "Monday, 06-Nov-94 08:49:37 GMT", "Mon Nov  6 08:49:37 1994"]) {
    assert.equal(parseRetryAfterMs(invalid, 15_000, 1_000), null, invalid);
  }
  assert.equal(parseRetryAfterMs(" 003 ", 15_000), 3_000);
  assert.equal(parseRetryAfterMs("0", 15_000), 0);
  assert.equal(parseRetryAfterMs("999999999999999999999", 15_000), 15_000);
  assert.equal(
    parseRetryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT", 15_000, Date.parse("Wed, 21 Oct 2015 07:27:56 GMT")),
    4_000,
  );
  const dateNow = Date.parse("Sun, 06 Nov 1994 08:49:33 GMT");
  for (const valid of [
    "Sun, 06 Nov 1994 08:49:37 GMT",
    "Sunday, 06-Nov-94 08:49:37 GMT",
    "Sun Nov  6 08:49:37 1994",
  ]) {
    assert.equal(parseRetryAfterMs(valid, 10_000, dateNow), 4_000, valid);
  }
});

test("RFC 850の2桁年は基準時刻から将来50年の窓で解決する", () => {
  const now2026 = Date.parse("Fri, 06 Nov 2026 08:49:33 GMT");
  // Date.parse historically maps -50 to 1950, but HTTP-date means 2050.
  assert.equal(
    parseRetryAfterMs("Sunday, 06-Nov-50 08:49:37 GMT", 10_000, now2026),
    10_000,
  );
  assert.equal(
    parseRetryAfterMs("Monday, 06-Nov-50 08:49:37 GMT", 10_000, now2026),
    null,
    "weekday must be checked against 2050, not Date.parse's 1950",
  );

  // The same two-digit year changes century at the *exact* 50-year
  // boundary, including hour/minute/second (not just year arithmetic).
  assert.equal(
    parseRetryAfterMs("Friday, 06-Nov-76 08:49:32 GMT", 10_000, now2026),
    10_000,
  );
  assert.equal(
    parseRetryAfterMs("Friday, 06-Nov-76 08:49:37 GMT", 10_000, now2026),
    null,
    "beyond 50 years in the future must resolve to 1976",
  );
  assert.equal(
    parseRetryAfterMs("Saturday, 06-Nov-76 08:49:37 GMT", 10_000, now2026),
    0,
    "1976 should remain a valid historical date",
  );

  const now2090 = Date.parse("Mon, 06 Nov 2090 08:49:33 GMT");
  assert.equal(
    parseRetryAfterMs("Wednesday, 06-Nov-15 08:49:37 GMT", 10_000, now2090),
    10_000,
    "future-century 2115 must not be forced into 2015",
  );
});

test("指数バックオフはprovider指定を優先し上限を超えない", () => {
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000 }), 4_000);
  assert.equal(
    exponentialBackoffMs(0, { maxDelayMs: 10_000, retryAfterMs: 30_000 }),
    10_000,
  );
});

test("指数バックオフは非有限の設定とprovider値を有限の待機時間へ正規化する", () => {
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: NaN }), 0);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: Infinity }), 0);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: -Infinity }), 0);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000, retryAfterMs: NaN }), 4_000);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000, retryAfterMs: Infinity }), 4_000);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000, retryAfterMs: -Infinity }), 4_000);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000, baseMs: NaN }), 4_000);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000, baseMs: Infinity }), 4_000);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000, jitterMs: NaN }), 4_000);
  assert.equal(exponentialBackoffMs(2, { maxDelayMs: 10_000, jitterMs: Infinity }), 4_000);
  assert.equal(exponentialBackoffMs(NaN, { maxDelayMs: 10_000 }), 1_000);
  assert.equal(exponentialBackoffMs(Infinity, { maxDelayMs: 10_000 }), 1_000);
  assert.equal(exponentialBackoffMs(0, { maxDelayMs: 10_000, retryAfterMs: 750 }), 750);
  assert.equal(exponentialBackoffMs(1e9, { maxDelayMs: 10_000 }), 10_000);
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

test("fetchWithTimeoutは呼出し元AbortSignalのreasonをそのまま伝播する", async () => {
  const caller = new AbortController();
  const budget = new ExternalRequestBudget(1);
  const request = fetchWithTimeout(
    "https://example.test/caller-abort",
    { signal: caller.signal },
    {
      timeoutMs: 1_000,
      budget,
      budgetErrorCode: "budget",
      timeoutErrorCode: "timeout",
      networkErrorCode: "network",
    },
    abortableFetch,
  );
  caller.abort(new Error("caller_cancelled"));
  await assert.rejects(request, /caller_cancelled/);
  assert.equal(budget.used, 1);
});

test("fetchWithTimeoutは事前abort済みならfetchも予算消費もしない", async () => {
  const caller = new AbortController();
  caller.abort(new Error("already_cancelled"));
  const budget = new ExternalRequestBudget(1);
  let called = false;

  await assert.rejects(
    fetchWithTimeout(
      "https://example.test/pre-aborted",
      { signal: caller.signal },
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

test("fetchWithTimeoutは内部タイマーによる中断だけをtimeoutとして扱う", async () => {
  await assert.rejects(
    fetchWithTimeout(
      "https://example.test/timeout",
      {},
      {
        timeoutMs: 10,
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

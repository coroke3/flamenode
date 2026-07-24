import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    PUBLIC_REQUEST_METRICS_LOG_KEY,
    getPublicRequestMetricsSnapshot,
    logPublicRequestMetrics,
    recordPublicD1Fallback,
    recordPublicD1Query,
    recordPublicR2Get,
    recordPublicStaticHit,
    recordPublicStaticMiss,
    runWithPublicRequestMetrics,
  } = await import("./publicRequestMetrics.ts");

  test("runWithPublicRequestMetrics aggregates counters without PII fields", async () => {
    const snapshot = await runWithPublicRequestMetrics("/user/example", async () => {
      recordPublicR2Get();
      recordPublicStaticHit();
      recordPublicStaticMiss();
      recordPublicD1Query(12);
      recordPublicD1Fallback();
      return getPublicRequestMetricsSnapshot();
    });

    assert.ok(snapshot);
    assert.equal(snapshot.route, "/user/example");
    assert.equal(snapshot.r2_gets, 1);
    assert.equal(snapshot.static_hit, 1);
    assert.equal(snapshot.static_miss, 1);
    assert.equal(snapshot.d1_queries, 1);
    assert.equal(snapshot.rows_read, 12);
    assert.equal(snapshot.d1_fallback, true);
    assert.equal(Object.hasOwn(snapshot, "sql"), false);
  });

  test("runWithPublicRequestMetrics rejects nested ALS", async () => {
    await assert.rejects(
      () =>
        runWithPublicRequestMetrics("outer", async () =>
          runWithPublicRequestMetrics("inner", async () => "nested"),
        ),
      /must not be nested/,
    );
  });

  test("logPublicRequestMetrics emits structured console log", async () => {
    const original = console.log;
    let line = "";
    console.log = (value) => {
      line = String(value);
    };
    try {
      await runWithPublicRequestMetrics("/user/creator", async () => {
        recordPublicR2Get();
        logPublicRequestMetrics();
      });
    } finally {
      console.log = original;
    }

    const parsed = JSON.parse(line);
    assert.equal(parsed.service, PUBLIC_REQUEST_METRICS_LOG_KEY);
    assert.equal(parsed.route, "/user/creator");
    assert.equal(parsed.r2_gets, 1);
    assert.equal(parsed.d1_queries, 0);
    assert.equal(parsed.rows_read, null);
  });
}

const loaderSource = await readFile(new URL("../publicData/loader.ts", import.meta.url), "utf8");

test("loader records public request metrics hooks", () => {
  assert.match(loaderSource, /recordPublicR2Get/);
  assert.match(loaderSource, /recordPublicStaticHit/);
  assert.match(loaderSource, /recordPublicStaticMiss/);
  assert.match(loaderSource, /recordPublicD1Query/);
  assert.doesNotMatch(loaderSource, /recordPublicD1Query\([^)]*options/);
});

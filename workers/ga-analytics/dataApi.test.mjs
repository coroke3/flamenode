import assert from "node:assert/strict";
import { test } from "node:test";
import { ExternalRequestBudget } from "../shared/externalApi.ts";
import {
  aggregateGa4ReportRows,
  extractGa4PropertyQuota,
  fetchVideoViewPeriods,
  formatGa4QuotaLogFields,
  GA4_REPORT_PAGE_SIZE,
} from "./dataApi.ts";

const dimensionIndices = { dateRange: 1, videoId: 0 };

function ga4Row(dateRange, videoId, count) {
  return {
    dimensionValues: [{ value: videoId }, { value: dateRange }],
    metricValues: [{ value: String(count) }],
  };
}

function ga4ReportBody(rows, { rowCount } = {}) {
  return {
    dimensionHeaders: [
      { name: "customEvent:video_id" },
      { name: "dateRange" },
    ],
    metricHeaders: [{ name: "eventCount" }],
    rowCount: rowCount ?? rows.length,
    rows,
  };
}

function ga4Env() {
  return {
    GA4_PROPERTY_ID: "123",
    GA4_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: "unused",
    KV: {
      async get() {
        return JSON.stringify({
          access_token: "cached-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      },
    },
  };
}

test("aggregateGa4ReportRows maps dateRange names to view periods", () => {
  const rows = [
    {
      dimensionValues: [{ value: "video-a" }, { value: "last_2_days" }],
      metricValues: [{ value: "11" }],
    },
    {
      dimensionValues: [{ value: "video-a" }, { value: "last_30" }],
      metricValues: [{ value: "30" }],
    },
    {
      dimensionValues: [{ value: "video-b" }, { value: "last_5" }],
      metricValues: [{ value: "7" }],
    },
    {
      dimensionValues: [{ value: "video-b" }, { value: "unknown_range" }],
      metricValues: [{ value: "999" }],
    },
    {
      dimensionValues: [{ value: "" }, { value: "last_7" }],
      metricValues: [{ value: "5" }],
    },
  ];

  const periods = aggregateGa4ReportRows(rows, dimensionIndices);
  const videoA = periods.find((row) => row.video_id === "video-a");
  const videoB = periods.find((row) => row.video_id === "video-b");

  assert.ok(videoA);
  assert.equal(videoA.views_2d, 11);
  assert.equal(videoA.views_30d, 30);
  assert.equal(videoA.views_5d, 0);

  assert.ok(videoB);
  assert.equal(videoB.views_5d, 7);
  assert.equal(videoB.views_2d, 0);
});

test("aggregateGa4ReportRows rejects unsafe sum of individually valid GA4 metrics", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const safe = aggregateGa4ReportRows([
    ga4Row("last_30", "video-a", max - 1),
    ga4Row("last_30", "video-a", 1),
  ], dimensionIndices);
  assert.equal(safe[0].views_30d, max);
  assert.throws(
    () => aggregateGa4ReportRows([
      ga4Row("last_30", "video-a", max),
      ga4Row("last_30", "video-a", 1),
    ], dimensionIndices),
    /ga4_report_aggregate_views_overflow/,
  );
  // Also catch an overflow in a short window, not only 30-day counts.
  assert.throws(
    () => aggregateGa4ReportRows([
      ga4Row("last_2_days", "video-b", max),
      ga4Row("last_2_days", "video-b", 1),
    ], dimensionIndices),
    /ga4_report_aggregate_views_overflow/,
  );
});

test("fetchVideoViewPeriods aggregates a successful single-page report", async () => {
  const rows = [
    ga4Row("last_2_days", "video-a", 11),
    ga4Row("last_30", "video-a", 30),
  ];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    assert.match(url, /analyticsdata\.googleapis\.com/);
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert.equal(body.offset, 0);
    assert.deepEqual(body.dimensions, [{ name: "customEvent:video_id" }]);
    assert.equal(
      body.dimensions.some((dimension) => dimension.name === "dateRange"),
      false,
    );
    return new Response(JSON.stringify(ga4ReportBody(rows)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await fetchVideoViewPeriods(
    ga4Env(),
    new ExternalRequestBudget(2),
    fetchImpl,
  );
  const videoA = result.periods.find((row) => row.video_id === "video-a");
  assert.ok(videoA);
  assert.equal(videoA.views_2d, 11);
  assert.equal(videoA.views_30d, 30);
});

test("fetchVideoViewPeriods tolerates multi-dateRange rowCount cardinality quirks", async () => {
  // GA4 often reports rowCount as distinct video_id count while rows[] expands
  // by dateRange (e.g. rowCount=1 with 4 range rows).
  const rows = [
    ga4Row("last_2_days", "video-a", 11),
    ga4Row("last_5", "video-a", 12),
    ga4Row("last_7", "video-a", 13),
    ga4Row("last_30", "video-a", 30),
  ];
  const fetchImpl = async () =>
    new Response(JSON.stringify(ga4ReportBody(rows, { rowCount: 1 })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await fetchVideoViewPeriods(
    ga4Env(),
    new ExternalRequestBudget(2),
    fetchImpl,
  );
  const videoA = result.periods.find((row) => row.video_id === "video-a");
  assert.ok(videoA);
  assert.equal(videoA.views_2d, 11);
  assert.equal(videoA.views_5d, 12);
  assert.equal(videoA.views_7d, 13);
  assert.equal(videoA.views_30d, 30);
});

test("fetchVideoViewPeriods paginates while pages are full", async () => {
  const pageOne = Array.from({ length: GA4_REPORT_PAGE_SIZE }, (_, index) =>
    ga4Row("last_2_days", `video-page1-${index}`, 1),
  );
  const pageTwo = [ga4Row("last_2_days", "video-b", 7)];
  const requests = [];
  const fetchImpl = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push(body.offset ?? 0);
    const rows = body.offset === 0 ? pageOne : pageTwo;
    return new Response(
      JSON.stringify(
        ga4ReportBody(rows, { rowCount: 1 }),
      ),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const { periods } = await fetchVideoViewPeriods(
    ga4Env(),
    new ExternalRequestBudget(3),
    fetchImpl,
  );
  assert.deepEqual(requests, [0, GA4_REPORT_PAGE_SIZE]);
  assert.equal(periods.length, GA4_REPORT_PAGE_SIZE + 1);
  assert.equal(periods.find((row) => row.video_id === "video-b")?.views_2d, 7);
});

test("fetchVideoViewPeriods rejects metric header that is not eventCount", async () => {
  const invalid = ga4ReportBody([ga4Row("last_30", "video-a", 12)]);
  invalid.metricHeaders = [{ name: "activeUsers" }];
  const fetchImpl = async () => new Response(JSON.stringify(invalid), { status: 200 });
  await assert.rejects(
    () => fetchVideoViewPeriods(ga4Env(), new ExternalRequestBudget(2), fetchImpl),
    /ga4_report_metric_header_mismatch/,
  );
});

test("fetchVideoViewPeriods rejects dimension header position changes across pages", async () => {
  const firstRows = Array.from({ length: GA4_REPORT_PAGE_SIZE }, (_, i) =>
    ga4Row("last_30", `video-${i}`, 1));
  let calls = 0;
  const fetchImpl = async (_, init) => {
    const offset = JSON.parse(String(init.body)).offset;
    calls += 1;
    const body = offset === 0
      ? ga4ReportBody(firstRows)
      : {
          ...ga4ReportBody([{
            dimensionValues: [{ value: "last_30" }, { value: "video-extra" }],
            metricValues: [{ value: "42" }],
          }]),
          dimensionHeaders: [{ name: "dateRange" }, { name: "customEvent:video_id" }],
        };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  await assert.rejects(
    () => fetchVideoViewPeriods(ga4Env(), new ExternalRequestBudget(3), fetchImpl),
    /ga4_report_dimension_header_mismatch/,
  );
  assert.equal(calls, 2);
});

test("extractGa4PropertyQuota: propertyQuota を安全に抽出する", () => {
  const quota = extractGa4PropertyQuota({
    propertyQuota: {
      tokensPerHour: { consumed: 1, remaining: 19999 },
      tokensPerDay: { consumed: "5", remaining: "39995" },
      concurrentRequests: { remaining: 10 },
      unknownBucket: { foo: "bar" },
    },
  });

  assert.ok(quota);
  assert.deepEqual(quota.tokensPerHour, { consumed: 1, remaining: 19999 });
  assert.deepEqual(quota.tokensPerDay, { consumed: 5, remaining: 39995 });
  assert.deepEqual(quota.concurrentRequests, { remaining: 10 });
  assert.equal(quota.serverErrorsPerProjectPerHour, undefined);
});

test("extractGa4PropertyQuota rejects unsafe numeric counters without suppressing valid buckets", () => {
  // Numeric quota fields used a weaker Number.isInteger check than string fields.
  // Values outside the safe-integer range cannot be logged accurately.
  const over = Number.MAX_SAFE_INTEGER + 1;
  const quota = extractGa4PropertyQuota({
    propertyQuota: {
      tokensPerHour: { remaining: over, consumed: Number.MAX_SAFE_INTEGER },
      tokensPerDay: { remaining: -1, consumed: Infinity },
      concurrentRequests: { remaining: 3 },
    },
  });
  assert.ok(quota);
  assert.deepEqual(quota.tokensPerHour, { consumed: Number.MAX_SAFE_INTEGER });
  assert.equal(quota.tokensPerDay, undefined);
  assert.deepEqual(quota.concurrentRequests, { remaining: 3 });
  assert.deepEqual(formatGa4QuotaLogFields(quota), {
    quota_concurrent_requests_remaining: 3,
  });
  assert.equal(extractGa4PropertyQuota({
    propertyQuota: { tokensPerHour: { remaining: over } },
  }), null);
});

test("extractGa4PropertyQuota: 欠損・不正は null", () => {
  assert.equal(extractGa4PropertyQuota(null), null);
  assert.equal(extractGa4PropertyQuota({}), null);
  assert.equal(
    extractGa4PropertyQuota({ propertyQuota: { tokensPerHour: "bad" } }),
    null,
  );
});

test("formatGa4QuotaLogFields: remaining をログ用フィールドへ変換", () => {
  assert.deepEqual(
    formatGa4QuotaLogFields({
      tokensPerHour: { remaining: 100 },
      tokensPerDay: { remaining: 200 },
      concurrentRequests: { remaining: 3 },
    }),
    {
      quota_tokens_per_hour_remaining: 100,
      quota_tokens_per_day_remaining: 200,
      quota_concurrent_requests_remaining: 3,
    },
  );
  assert.deepEqual(formatGa4QuotaLogFields(null), {});
});

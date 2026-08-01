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

const dimensionIndices = { dateRange: 0, videoId: 1 };

function ga4Row(dateRange, videoId, count) {
  return {
    dimensionValues: [{ value: dateRange }, { value: videoId }],
    metricValues: [{ value: String(count) }],
  };
}

function ga4ReportBody(rows, { rowCount } = {}) {
  return {
    dimensionHeaders: [
      { name: "dateRange" },
      { name: "customEvent:video_id" },
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
      dimensionValues: [{ value: "last_2_days" }, { value: "video-a" }],
      metricValues: [{ value: "11" }],
    },
    {
      dimensionValues: [{ value: "last_30" }, { value: "video-a" }],
      metricValues: [{ value: "30" }],
    },
    {
      dimensionValues: [{ value: "last_5" }, { value: "video-b" }],
      metricValues: [{ value: "7" }],
    },
    {
      dimensionValues: [{ value: "unknown_range" }, { value: "video-b" }],
      metricValues: [{ value: "999" }],
    },
    {
      dimensionValues: [{ value: "last_7" }, { value: "" }],
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

test("fetchVideoViewPeriods fail-closed on rowCount mismatch", async () => {
  const fetchImpl = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const rows =
      (body.offset ?? 0) === 0
        ? [ga4Row("last_2_days", "video-a", 1)]
        : [];
    return new Response(
      JSON.stringify(ga4ReportBody(rows, { rowCount: 5 })),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  await assert.rejects(
    () =>
      fetchVideoViewPeriods(ga4Env(), new ExternalRequestBudget(3), fetchImpl),
    /ga4_report_row_count_mismatch/,
  );
});

test("fetchVideoViewPeriods paginates until rowCount is satisfied", async () => {
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
        ga4ReportBody(rows, { rowCount: GA4_REPORT_PAGE_SIZE + 1 }),
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

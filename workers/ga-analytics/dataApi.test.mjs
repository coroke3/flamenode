import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateGa4ReportRows } from "./dataApi.ts";

const dimensionIndices = { dateRange: 0, videoId: 1 };

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

/**
 * GA4 Data API runReport: 4 dateRanges を 1 POST で取得し VideoViewPeriods へ集約。
 */
import {
  cancelResponseBody,
  ExternalRequestBudget,
  fetchWithTimeout,
  type FetchLike,
} from "../shared/externalApi.ts";
import { getGa4AccessToken, type Ga4AuthEnv } from "./auth.ts";

export const GA4_VIDEO_VIEW_EVENT = "flamenode_video_view";
export const GA4_DATA_API_FETCH_TIMEOUT_MS = 12_000;
export const GA4_REPORT_PAGE_SIZE = 10_000;

export const GA4_DATE_RANGE_NAMES = [
  "last_2_days",
  "last_5",
  "last_7",
  "last_30",
] as const;

export type Ga4DateRangeName = (typeof GA4_DATE_RANGE_NAMES)[number];

export interface VideoViewPeriods {
  video_id: string;
  views_2d: number;
  views_5d: number;
  views_7d: number;
  views_30d: number;
}

export interface Ga4DataApiEnv extends Ga4AuthEnv {
  GA4_PROPERTY_ID?: string;
}

type Ga4ReportRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

type Ga4RunReportResponse = {
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?: Array<{ name?: string }>;
  rows?: Ga4ReportRow[];
  rowCount?: number;
};

const DATE_RANGE_FIELD_MAP: Record<
  Ga4DateRangeName,
  "views_2d" | "views_5d" | "views_7d" | "views_30d"
> = {
  last_2_days: "views_2d",
  last_5: "views_5d",
  last_7: "views_7d",
  last_30: "views_30d",
};

function isGa4DateRangeName(value: string): value is Ga4DateRangeName {
  return (GA4_DATE_RANGE_NAMES as readonly string[]).includes(value);
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function resolveDimensionIndices(
  headers: Array<{ name?: string }>,
): { dateRange: number; videoId: number } {
  const dateRange = headers.findIndex((header) => header.name === "dateRange");
  const videoId = headers.findIndex(
    (header) => header.name === "customEvent:video_id",
  );
  if (dateRange < 0 || videoId < 0) {
    throw new Error("ga4_report_dimension_header_missing");
  }
  return { dateRange, videoId };
}

export function aggregateGa4ReportRows(
  rows: readonly Ga4ReportRow[],
  dimensionIndices: { dateRange: number; videoId: number },
): VideoViewPeriods[] {
  const byVideo = new Map<string, VideoViewPeriods>();

  for (const row of rows) {
    const dimensions = row.dimensionValues ?? [];
    const metrics = row.metricValues ?? [];
    const dateRangeRaw = dimensions[dimensionIndices.dateRange]?.value?.trim();
    const videoId = dimensions[dimensionIndices.videoId]?.value?.trim();
    if (!dateRangeRaw || !videoId || !isGa4DateRangeName(dateRangeRaw)) continue;

    const eventCount = parsePositiveInt(metrics[0]?.value);
    if (eventCount == null) continue;

    const field = DATE_RANGE_FIELD_MAP[dateRangeRaw];
    const existing = byVideo.get(videoId);
    if (existing) {
      existing[field] += eventCount;
    } else {
      byVideo.set(videoId, {
        video_id: videoId,
        views_2d: 0,
        views_5d: 0,
        views_7d: 0,
        views_30d: 0,
        [field]: eventCount,
      });
    }
  }

  return [...byVideo.values()];
}

function buildRunReportBody(offset: number): Record<string, unknown> {
  return {
    dateRanges: [
      { name: "last_2_days", startDate: "1daysAgo", endDate: "today" },
      { name: "last_5", startDate: "4daysAgo", endDate: "today" },
      { name: "last_7", startDate: "6daysAgo", endDate: "today" },
      { name: "last_30", startDate: "29daysAgo", endDate: "today" },
    ],
    dimensions: [{ name: "dateRange" }, { name: "customEvent:video_id" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: {
          matchType: "EXACT",
          value: GA4_VIDEO_VIEW_EVENT,
        },
      },
    },
    returnPropertyQuota: true,
    limit: GA4_REPORT_PAGE_SIZE,
    offset,
  };
}

async function runGa4ReportPage(
  env: Ga4DataApiEnv,
  propertyId: string,
  accessToken: string,
  offset: number,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<Ga4RunReportResponse> {
  signal?.throwIfAborted();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRunReportBody(offset)),
      signal,
    },
    {
      timeoutMs: GA4_DATA_API_FETCH_TIMEOUT_MS,
      budget,
      budgetErrorCode: "ga4_report_request_budget_exhausted",
      timeoutErrorCode: "ga4_report_timeout",
      networkErrorCode: "ga4_report_network_error",
    },
    fetchImpl,
  );
  signal?.throwIfAborted();
  if (!response.ok) {
    await cancelResponseBody(response);
    throw new Error(`ga4_report_http_${response.status}`);
  }
  try {
    const body = (await response.json()) as Ga4RunReportResponse;
    signal?.throwIfAborted();
    return body;
  } catch {
    await cancelResponseBody(response);
    throw new Error("ga4_report_invalid_json");
  }
}

export async function fetchVideoViewPeriods(
  env: Ga4DataApiEnv,
  budget: ExternalRequestBudget,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<VideoViewPeriods[]> {
  signal?.throwIfAborted();
  const propertyId = env.GA4_PROPERTY_ID?.trim();
  if (!propertyId) throw new Error("ga4_property_id_missing");

  const accessToken = await getGa4AccessToken(env, budget, fetchImpl, signal);
  const collectedRows: Ga4ReportRow[] = [];
  let dimensionIndices: { dateRange: number; videoId: number } | null = null;
  let expectedRowCount: number | null = null;
  let offset = 0;

  while (true) {
    const page = await runGa4ReportPage(
      env,
      propertyId,
      accessToken,
      offset,
      budget,
      fetchImpl,
      signal,
    );
    if (!dimensionIndices) {
      dimensionIndices = resolveDimensionIndices(page.dimensionHeaders ?? []);
    }
    if (expectedRowCount == null && page.rowCount != null) {
      const parsed = Number(page.rowCount);
      if (Number.isFinite(parsed) && parsed >= 0) {
        expectedRowCount = Math.floor(parsed);
      }
    }
    const rows = page.rows ?? [];
    collectedRows.push(...rows);
    if (rows.length === 0) break;
    if (expectedRowCount != null && collectedRows.length >= expectedRowCount) break;
    if (rows.length < GA4_REPORT_PAGE_SIZE) break;
    offset += rows.length;
  }

  if (
    expectedRowCount != null &&
    collectedRows.length !== expectedRowCount
  ) {
    throw new Error("ga4_report_row_count_mismatch");
  }
  if (!dimensionIndices) {
    throw new Error("ga4_report_dimension_header_missing");
  }

  return aggregateGa4ReportRows(collectedRows, dimensionIndices);
}

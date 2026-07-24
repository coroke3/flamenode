import { AsyncLocalStorage } from "node:async_hooks";
import {
  mergePublicDataMode,
  type PublicDataMode,
} from "@/lib/publicData/publicDataMode";

export const PUBLIC_REQUEST_METRICS_LOG_KEY = "public_request_metrics";

export type PublicRequestMetricsSnapshot = {
  route: string;
  d1_queries: number;
  rows_read: number | null;
  r2_gets: number;
  static_hit: number;
  static_miss: number;
  d1_fallback: boolean;
  public_data_mode: PublicDataMode | null;
};

type MutablePublicRequestMetrics = {
  route: string;
  d1_queries: number;
  rows_read: number;
  rows_read_known: boolean;
  r2_gets: number;
  static_hit: number;
  static_miss: number;
  d1_fallback: boolean;
  public_data_mode: PublicDataMode | null;
};

const storage = new AsyncLocalStorage<MutablePublicRequestMetrics>();

function createMetricsState(route: string): MutablePublicRequestMetrics {
  return {
    route: route.slice(0, 120),
    d1_queries: 0,
    rows_read: 0,
    rows_read_known: false,
    r2_gets: 0,
    static_hit: 0,
    static_miss: 0,
    d1_fallback: false,
    public_data_mode: null,
  };
}

export function runWithPublicRequestMetrics<T>(
  route: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  if (storage.getStore()) {
    throw new Error(
      "runWithPublicRequestMetrics must not be nested; use PublicMetricsShell ALS only",
    );
  }
  return Promise.resolve(storage.run(createMetricsState(route), fn));
}

export function getPublicRequestMetricsSnapshot():
  | PublicRequestMetricsSnapshot
  | null {
  const state = storage.getStore();
  if (!state) return null;
  return {
    route: state.route,
    d1_queries: state.d1_queries,
    rows_read: state.rows_read_known ? state.rows_read : null,
    r2_gets: state.r2_gets,
    static_hit: state.static_hit,
    static_miss: state.static_miss,
    d1_fallback: state.d1_fallback,
    public_data_mode: state.public_data_mode,
  };
}

export function notePublicDataMode(mode: PublicDataMode): void {
  const state = storage.getStore();
  if (!state) return;
  state.public_data_mode = mergePublicDataMode(state.public_data_mode, mode);
  if (mode === "degraded_d1") {
    state.d1_fallback = true;
  }
}

export function recordPublicR2Get(): void {
  const state = storage.getStore();
  if (state) state.r2_gets += 1;
}

export function recordPublicStaticHit(): void {
  const state = storage.getStore();
  if (state) state.static_hit += 1;
}

export function recordPublicStaticMiss(): void {
  const state = storage.getStore();
  if (state) state.static_miss += 1;
}

export function recordPublicD1Query(rowsRead?: number | null): void {
  const state = storage.getStore();
  if (!state) return;
  state.d1_queries += 1;
  if (typeof rowsRead === "number" && Number.isFinite(rowsRead)) {
    state.rows_read += rowsRead;
    state.rows_read_known = true;
  }
}

export function recordPublicD1Fallback(): void {
  const state = storage.getStore();
  if (state) state.d1_fallback = true;
}

export function logPublicRequestMetrics(): void {
  const snapshot = getPublicRequestMetricsSnapshot();
  if (!snapshot) return;
  console.log(
    JSON.stringify({
      service: PUBLIC_REQUEST_METRICS_LOG_KEY,
      ...snapshot,
    }),
  );
}

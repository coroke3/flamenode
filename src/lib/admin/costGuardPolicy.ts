export type CostGuardMode =
  | "normal"
  | "economy"
  | "read_only"
  | "static_only"
  | "maintenance";

export interface CostUsageSnapshotLike {
  workers_requests_today?: number | null;
  pages_functions_requests_today?: number | null;
  d1_rows_read_today?: number | null;
  d1_rows_written_today?: number | null;
  r2_class_a_month?: number | null;
  r2_class_b_month?: number | null;
  kv_writes_today?: number | null;
}

export interface CostGuardThresholds {
  economy: number;
  read_only: number;
  static_only: number;
  maintenance: number;
}

export const DEFAULT_COST_GUARD_THRESHOLDS: CostGuardThresholds = {
  economy: 0.75,
  read_only: 0.9,
  static_only: 0.97,
  maintenance: 1,
};

export interface CostGuardRecommendation {
  mode: CostGuardMode;
  reasons: string[];
  highestRatio: number;
}

const DEFAULT_DAILY_LIMITS: Record<keyof CostUsageSnapshotLike, number> = {
  workers_requests_today: 100_000,
  pages_functions_requests_today: 100_000,
  d1_rows_read_today: 5_000_000,
  d1_rows_written_today: 100_000,
  r2_class_a_month: 1_000_000,
  r2_class_b_month: 10_000_000,
  kv_writes_today: 1_000,
};

export function parseCostGuardThresholds(
  raw: string | null | undefined,
): CostGuardThresholds {
  if (!raw) return DEFAULT_COST_GUARD_THRESHOLDS;
  try {
    const parsed = JSON.parse(raw) as Partial<CostGuardThresholds>;
    return {
      economy: clampRatio(parsed.economy, DEFAULT_COST_GUARD_THRESHOLDS.economy),
      read_only: clampRatio(parsed.read_only, DEFAULT_COST_GUARD_THRESHOLDS.read_only),
      static_only: clampRatio(parsed.static_only, DEFAULT_COST_GUARD_THRESHOLDS.static_only),
      maintenance: clampRatio(parsed.maintenance, DEFAULT_COST_GUARD_THRESHOLDS.maintenance),
    };
  } catch {
    return DEFAULT_COST_GUARD_THRESHOLDS;
  }
}

export function recommendCostGuardMode(
  snapshot: CostUsageSnapshotLike | null | undefined,
  thresholds: CostGuardThresholds = DEFAULT_COST_GUARD_THRESHOLDS,
): CostGuardRecommendation {
  if (!snapshot) {
    return { mode: "normal", reasons: [], highestRatio: 0 };
  }

  let highestRatio = 0;
  const reasons: string[] = [];
  for (const [key, limit] of Object.entries(DEFAULT_DAILY_LIMITS) as Array<
    [keyof CostUsageSnapshotLike, number]
  >) {
    const value = Number(snapshot[key] ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const ratio = value / limit;
    if (ratio > highestRatio) highestRatio = ratio;
    if (ratio >= thresholds.economy) {
      reasons.push(`${key}:${Math.round(ratio * 100)}%`);
    }
  }

  const mode: CostGuardMode =
    highestRatio >= thresholds.maintenance
      ? "maintenance"
      : highestRatio >= thresholds.static_only
        ? "static_only"
        : highestRatio >= thresholds.read_only
          ? "read_only"
          : highestRatio >= thresholds.economy
            ? "economy"
            : "normal";
  return { mode, reasons, highestRatio };
}

function clampRatio(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

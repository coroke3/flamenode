const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;

export interface RemainingTimeMetric {
  value: string;
  unit: string;
}

export function formatRemainingTimeMetric(
  seconds: number | null | undefined,
): RemainingTimeMetric | null {
  // Snapshot and API timestamps may be malformed. Non-finite arithmetic must
  // never surface "NaN日" / "Infinity日" in the public countdown.
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds <= 0) return { value: "0", unit: "分" };
  if (seconds < HOUR_SECONDS) {
    return {
      value: String(Math.max(1, Math.ceil(seconds / MINUTE_SECONDS))),
      unit: "分",
    };
  }
  if (seconds <= DAY_SECONDS) {
    return {
      value: String(Math.ceil(seconds / HOUR_SECONDS)),
      unit: "時間",
    };
  }
  return {
    value: String(Math.ceil(seconds / DAY_SECONDS)),
    unit: "日",
  };
}

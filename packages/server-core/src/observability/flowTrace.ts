/**
 * 個人情報なしの段階計測ログ。
 * Discord ID / user ID / email / token / Cookie / SQL は含めない。
 */
export type FlowTraceResult =
  | "started"
  | "succeeded"
  | "failed"
  | "skipped";

export type FlowTraceEvent = {
  flow: string;
  phase: string;
  trace_id: string;
  result: FlowTraceResult;
  duration_ms?: number;
  error_code?: string;
  committed?: boolean;
  retryable?: boolean;
};

export function createTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function logFlowTrace(event: FlowTraceEvent): void {
  try {
    console.info(
      JSON.stringify({
        kind: "flow_trace",
        flow: event.flow,
        phase: event.phase,
        trace_id: event.trace_id,
        result: event.result,
        ...(event.duration_ms != null ? { duration_ms: event.duration_ms } : {}),
        ...(event.error_code ? { error_code: event.error_code } : {}),
        ...(event.committed != null ? { committed: event.committed } : {}),
        ...(event.retryable != null ? { retryable: event.retryable } : {}),
      }),
    );
  } catch {
    // 観測失敗で主処理を落とさない
  }
}

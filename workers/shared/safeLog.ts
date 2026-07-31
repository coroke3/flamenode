/**
 * Worker のログには secret や外部レスポンス本文を流さない。
 * Cron の集計ログはこのモジュール経由に限定する。
 */

const MAX_ERROR_SUMMARY_LENGTH = 320;

const REDACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [
    /\b(authorization|token|secret|api[_-]?key|password|cookie|set-cookie|session(?:[_-]?id)?|private[_-]?key)\s*([:=])\s*[^\s,;)}\]]+/gi,
    "$1$2[REDACTED]",
  ],
  [/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]"],
  [
    /(https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/)[^\s/]+/gi,
    "$1[REDACTED]",
  ],
  [/https?:\/\/[^\s/@]+:[^@\s]+@/gi, "https://[REDACTED]@"],
];

export function redactWorkerLogValue(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/** Error object / stack をそのまま出さず、安全な短い要約だけを残す。 */
export function safeErrorSummary(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "worker task failed";
  const normalized = redactWorkerLogValue(raw.replace(/[\r\n\t]+/g, " ").trim());
  return (normalized || "worker task failed").slice(0, MAX_ERROR_SUMMARY_LENGTH);
}

export interface WorkerJobLog {
  worker: string;
  job: string;
  run_id: string;
  started_at: string;
  processed: number;
  skipped: number;
  failed: number;
  duration_ms: number;
  result: "ok" | "failed" | "skipped";
  error?: string;
  external_api_calls?: number;
  d1_changes?: number;
  d1_statements?: number;
  d1_rows_read?: number;
  d1_rows_written?: number;
  retry_count?: number;
  quota_stopped?: boolean;
  quota_stop_reason?: string;
  commit_sha?: string;
}

const QUOTA_REASONS = new Set([
  "external_api",
  "d1",
  "retry",
  "budget",
  "rate_limit",
  "daily_limit",
  "monthly_limit",
  "concurrency",
  "manual",
  "youtube_quota_cooldown",
  "youtube_quota_reservation_denied",
  "youtube_api_error",
  "youtube_quota_deferred",
  "unknown",
]);

/** Keep quota reasons to a small, non-sensitive internal vocabulary. */
export function normalizeQuotaStopReason(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const reason = value.trim().toLowerCase();
  return QUOTA_REASONS.has(reason) ? reason : "unknown";
}

/** 1 job あたり1行だけの構造化ログを出す。 */
export function logWorkerJob(event: WorkerJobLog): void {
  console.log(JSON.stringify(event));
}

/** Queue consumer の catch 専用。秘密情報は safeErrorSummary で除去する。 */
export function logQueueConsumerFailure(input: {
  service: string;
  queueKind: string;
  messageCount: number;
  error: unknown;
  traceId?: string;
}): void {
  console.warn(
    JSON.stringify({
      service: input.service,
      job: "queue-consumer",
      queue_kind: input.queueKind,
      message_count: input.messageCount,
      trace_id: input.traceId ?? null,
      result: "failed",
      error: safeErrorSummary(input.error),
    }),
  );
}

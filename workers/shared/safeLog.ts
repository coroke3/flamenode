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
}

/** 1 job あたり1行だけの構造化ログを出す。 */
export function logWorkerJob(event: WorkerJobLog): void {
  console.log(JSON.stringify(event));
}

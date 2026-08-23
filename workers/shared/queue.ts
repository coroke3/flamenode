/**
 * Cron worker から共有する queue 実行の安全弁。
 * DB の retry 状態を持つ outbox と違い、ここは 1 回の invocation 内の
 * 一時的な失敗だけを有限回再試行する。状態の正本は各 queue の D1 行。
 */

export const MAX_QUEUE_ATTEMPTS = 3;
export const MAX_QUEUE_BATCH = 50;

export interface BoundedRetryOptions {
  /** 総試行回数。外部入力は必ずこの helper 内で上限化する。 */
  attempts?: number;
  /** 再試行間隔の上限。既定値は Cron を長時間占有しない短い待機。 */
  delayMs?: number;
  /** ジョブ固有の分類が必要な場合だけ上書きする。 */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const RETRYABLE_MESSAGE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|Network connection lost|Replica disconnected from primary|Cannot resolve D1 DB due to transient issue on remote node|storage caused object to be reset|reset because its code was updated|SQLITE_BUSY|database is locked|D1_ERROR.*internal error|Failed to parse body as JSON.*internal error|rate.?limit|too many requests|\b429\b|\b5\d\d\b|temporar(?:y|ily)|transient|try again|timeout/i;
const FATAL_MESSAGE =
  /no such table|no such column|schema|constraint failed|foreign key|not null|unique constraint|invalid (?:input|payload|config)|unauthorized|forbidden|missing (?:binding|secret|token|configuration)|D1 DB is overloaded|D1 DB(?:'s)? isolate exceeded its memory limit|D1 DB exceeded its CPU time limit|D1 DB storage operation exceeded timeout/i;

function boundedAttempts(value: number | undefined): number {
  if (!Number.isFinite(value)) return MAX_QUEUE_ATTEMPTS;
  return Math.min(
    MAX_QUEUE_ATTEMPTS,
    Math.max(1, Math.floor(value ?? 1)),
  );
}

function boundedDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(2_000, Math.max(0, Math.floor(value ?? 0)));
}

export function boundedQueueBatch(
  value: number | undefined,
  fallback = MAX_QUEUE_BATCH,
): number {
  const normalizedFallback = Number.isFinite(fallback)
    ? fallback
    : MAX_QUEUE_BATCH;
  const safeFallback = Math.min(
    MAX_QUEUE_BATCH,
    Math.max(1, Math.floor(normalizedFallback)),
  );
  if (!Number.isFinite(value)) return safeFallback;
  return Math.min(
    MAX_QUEUE_BATCH,
    Math.max(1, Math.floor(value ?? safeFallback)),
  );
}

/** DB由来の試行回数を非負整数へ閉じ、次回値を返す。 */
export function nextAttemptNumber(value: unknown): number {
  const normalized = Number(value);
  const current =
    Number.isFinite(normalized) && normalized >= 0
      ? Math.floor(normalized)
      : 0;
  return current + 1;
}

/** HTTP・D1・fetchの一時障害だけを再試行対象にする。 */
export function isRetryableQueueError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const candidate = error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const message = String(candidate.message ?? "");
    // D1 overload/CPU/memory/schema 系は同一 invocation 内で即時retryすると
    // さらにqueueを詰まらせるため、HTTP statusより先にfail-fast判定する。
    if (FATAL_MESSAGE.test(message)) return false;

    const status = Number(candidate.status ?? candidate.statusCode);
    if (
      status === 408 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    ) {
      return true;
    }
    const code = String(candidate.code ?? "");
    if (
      /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_SOCKET)$/.test(
        code,
      )
    ) {
      return true;
    }
    if (RETRYABLE_MESSAGE.test(message)) return true;
    if (candidate.cause && candidate.cause !== error) {
      return isRetryableQueueError(candidate.cause);
    }
    return false;
  }
  const message = String(error ?? "");
  if (FATAL_MESSAGE.test(message)) return false;
  return RETRYABLE_MESSAGE.test(message);
}

/**
 * 一時的な失敗を有限回だけ再試行する。最後の例外は呼び出し側へ返し、
 * secret や payload をこの層でログ出力しない。
 */
export async function withBoundedRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: BoundedRetryOptions = {},
): Promise<T> {
  const attempts = boundedAttempts(options.attempts);
  const delayMs = boundedDelay(options.delayMs);
  const shouldRetry = options.shouldRetry ?? isRetryableQueueError;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) break;
      const waitMs = Math.min(2_000, delayMs * 2 ** (attempt - 1));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("queue task failed");
}

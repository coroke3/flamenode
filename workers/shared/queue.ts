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
}

function boundedAttempts(value: number | undefined): number {
  if (!Number.isFinite(value)) return MAX_QUEUE_ATTEMPTS;
  return Math.min(MAX_QUEUE_ATTEMPTS, Math.max(1, Math.floor(value ?? 1)));
}

function boundedDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(2_000, Math.max(0, Math.floor(value ?? 0)));
}

export function boundedQueueBatch(value: number | undefined, fallback = MAX_QUEUE_BATCH): number {
  const safeFallback = Math.min(MAX_QUEUE_BATCH, Math.max(1, Math.floor(fallback)));
  if (!Number.isFinite(value)) return safeFallback;
  return Math.min(MAX_QUEUE_BATCH, Math.max(1, Math.floor(value ?? safeFallback)));
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
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const waitMs = Math.min(2_000, delayMs * 2 ** (attempt - 1));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("queue task failed");
}

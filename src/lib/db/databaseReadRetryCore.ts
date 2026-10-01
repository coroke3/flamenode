import { isTransientDbError } from "./transientDbErrorCore.ts";

/**
 * Cloudflare D1 already retries retryable read-only SQL at the query level.
 * Replaying a whole multi-query callback in production multiplies completed
 * reads when only its final query fails, so Worker requests deliberately make
 * one callback attempt. Local Miniflare retains a small reconnect retry.
 */
export const WORKER_DATABASE_READ_CALLBACK_ATTEMPTS = 1;
export const LOCAL_DATABASE_READ_CALLBACK_ATTEMPTS = 4;

export async function runDatabaseReadCallback<T, TResolved>(input: {
  resolve: () => TResolved | null;
  run: (resolved: TResolved) => Promise<T>;
  maxAttempts: number;
  onRetry?: (resolved: TResolved) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<T | null> {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts));
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const resolved = input.resolve();
    if (!resolved) return null;
    try {
      return await input.run(resolved);
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      input.onRetry?.(resolved);
      await (input.wait ?? (() => Promise.resolve()))(30 * 2 ** attempt);
    }
  }
  throw lastError;
}

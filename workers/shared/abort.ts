/**
 * Worker task signals are aborted with an Error reason (cron deadline, lease
 * loss, caller abort). Keep that Error so logs and retries see the real cause,
 * and wrap anything else so callers can always rely on an Error.
 */
export function abortError(signal: AbortSignal, fallback: string): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error(signal.reason === undefined ? fallback : String(signal.reason));
}

export function throwIfAborted(signal: AbortSignal | undefined, fallback: string): void {
  if (signal?.aborted) throw abortError(signal, fallback);
}

/** Fixes a module's fallback message so its call sites stay `throwIfAborted(signal)`. */
export function abortGuard(fallback: string): (signal?: AbortSignal) => void {
  return (signal) => throwIfAborted(signal, fallback);
}

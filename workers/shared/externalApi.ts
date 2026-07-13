export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ExternalRequestBudget {
  readonly limit: number;
  private consumed = 0;

  constructor(limit: number) {
    this.limit = Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0));
  }

  get used(): number {
    return this.consumed;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.consumed);
  }

  consume(count = 1): boolean {
    const normalized = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
    if (this.consumed + normalized > this.limit) return false;
    this.consumed += normalized;
    return true;
  }
}

export function parseRetryAfterMs(
  value: string | null,
  maxDelayMs: number,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const cap = Math.max(0, Math.floor(maxDelayMs));
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, cap);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - now), cap);
}

export function exponentialBackoffMs(
  attempt: number,
  options: {
    baseMs?: number;
    maxDelayMs: number;
    retryAfterMs?: number | null;
    jitterMs?: number;
  },
): number {
  const maxDelay = Math.max(0, Math.floor(options.maxDelayMs));
  if (options.retryAfterMs != null) {
    return Math.min(maxDelay, Math.max(0, Math.floor(options.retryAfterMs)));
  }
  const base = Math.max(1, Math.floor(options.baseMs ?? 1_000));
  const jitter = Math.max(0, Math.floor(options.jitterMs ?? 0));
  return Math.min(maxDelay, base * 2 ** Math.max(0, attempt) + jitter);
}

export async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    timeoutMs: number;
    budget: ExternalRequestBudget;
    budgetErrorCode: string;
    timeoutErrorCode: string;
    networkErrorCode: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (!options.budget.consume()) {
    throw new Error(options.budgetErrorCode);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.floor(options.timeoutMs)),
  );
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new Error(timedOut ? options.timeoutErrorCode : options.networkErrorCode);
  } finally {
    clearTimeout(timeout);
  }
}

export async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 接続解放のbest effort。元のAPI結果を上書きしない。
  }
}

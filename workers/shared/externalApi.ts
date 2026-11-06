export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Per-invocation subrequest cap. Runtime safety only — does not change CostGuard / operation_mode. */
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
  // RFC 9110 delta-seconds is one or more decimal digits. Number() also accepts
  // fractions, exponents, signs, hex and whitespace-only strings.
  const raw = value.trim();
  if (/^\d+$/.test(raw)) {
    return Math.min(Number(raw) * 1_000, cap);
  }
  // HTTP-date uses GMT; do not reinterpret malformed numeric values as dates
  // (Date.parse("+3") can otherwise succeed on some runtimes).
  if (!/\bGMT$/i.test(raw)) return null;
  const timestamp = Date.parse(raw);
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
  const callerSignal = init.signal;
  callerSignal?.throwIfAborted();

  if (!options.budget.consume()) {
    throw new Error(options.budgetErrorCode);
  }

  const controller = new AbortController();
  let abortSource: "caller" | "timeout" | null = null;
  const abort = (source: "caller" | "timeout") => {
    if (abortSource !== null) return;
    abortSource = source;
    controller.abort();
  };
  const onCallerAbort = () => abort("caller");
  if (callerSignal?.aborted) {
    onCallerAbort();
  } else {
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  }

  const timeoutMs = Math.max(
    1,
    Math.floor(Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1),
  );
  const timeout = setTimeout(() => abort("timeout"), timeoutMs);
  try {
    const response = await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      await cancelResponseBody(response);
      if (abortSource === "caller") {
        callerSignal?.throwIfAborted();
      }
      if (abortSource === "timeout") {
        throw new Error(options.timeoutErrorCode);
      }
    }
    return response;
  } catch (error) {
    if (abortSource === "caller") {
      callerSignal?.throwIfAborted();
    }
    if (
      abortSource === "timeout" &&
      (controller.signal.aborted ||
        (error instanceof Error && error.message === options.timeoutErrorCode))
    ) {
      throw new Error(options.timeoutErrorCode);
    }
    throw new Error(options.networkErrorCode);
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // 接続解放のbest effort。元のAPI結果を上書きしない。
  }
}

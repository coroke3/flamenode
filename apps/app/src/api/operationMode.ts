// MIG-0718 U03: consume the merged MIG-0661 public DTO, not a local approximation.
import {
  CostGuardBannerResponseSchema,
  type CostGuardBannerResponse,
} from "@flamenode/contracts";

export type BannerMode = Exclude<CostGuardBannerResponse["mode"], "normal">;
export type BannerSnapshot = Omit<CostGuardBannerResponse, "mode"> & { mode: BannerMode };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_BANNER_RESPONSE_BYTES = 16 * 1024; // Bound parsing independently of the contract's reason cap.

/** If headers/status cause an early return, explicitly stop the unread body.
 * Otherwise even rejected huge responses may continue consuming network resources.
 */
function discardResponseBody(response: Response): void {
  try {
    // Start cleanup, but do not wait on a custom stream's cancel() promise:
    // it may never settle and must not block the optional banner read.
    void response.body?.cancel().catch(() => {});
  } catch {
    // Body may already be locked/closed by the platform.
  }
}

/** Bound streamed response bytes before JSON.parse. Content-Length is only an early
 * rejection, never relied on as a trusted size bound. Do not buffer 64KiB+ responses.
 */
async function readBannerPayload(response: Response, signal?: AbortSignal): Promise<unknown> {
  const announcedLength = response.headers.get("content-length");
  if (announcedLength !== null && /^\d+$/.test(announcedLength) &&
      Number(announcedLength) > MAX_BANNER_RESPONSE_BYTES) {
    discardResponseBody(response);
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  let chunksRead = 0;
  let consecutiveEmptyChunks = 0;
  let reachedEnd = false;
  // A mocked/custom stream may ignore fetch's signal; interrupt a pending
  // reader.read() directly when a React view unmounts or changes providers.
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) return null;
      const { done, value } = await reader.read();
      if (signal?.aborted) return null;
      if (done) {
        reachedEnd = true;
        break;
      }
      // The byte budget alone cannot bound streams that repeatedly emit empty
      // chunks; cap read/array overhead while permitting 1-byte chunked JSON.
      chunksRead += 1;
      if (chunksRead > MAX_BANNER_RESPONSE_BYTES + 32) return null;
      if (value.byteLength === 0) {
        consecutiveEmptyChunks += 1;
        if (consecutiveEmptyChunks > 32) return null;
        continue;
      }
      consecutiveEmptyChunks = 0;
      size += value.byteLength;
      if (size > MAX_BANNER_RESPONSE_BYTES) return null;
      parts.push(decoder.decode(value, { stream: true }));
    }
    if (signal?.aborted) return null;
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!reachedEnd) {
      // Underlying stream cancellation is best-effort and can stall indefinitely.
      // Never keep the caller waiting for a non-cooperative cancel hook.
      try { void reader.cancel().catch(() => {}); } catch { /* Already closed. */ }
    }
    reader.releaseLock();
  }
}

function parseBannerSnapshot(raw: unknown): BannerSnapshot | null {
  const parsed = CostGuardBannerResponseSchema.safeParse(raw);
  // "normal" is a valid API response but must not render a banner.
  if (!parsed.success || parsed.data.mode === "normal") return null;
  return parsed.data as BannerSnapshot;
}

/** GET-only, no-store and same-origin. Failure is "no banner", not an auth/logout state. */
export function createOperationModeBannerApi(
  fetchFn: FetchLike = (input, init) => fetch(input, init),
) {
  return {
    async getBanner(signal?: AbortSignal): Promise<BannerSnapshot | null> {
      try {
        const response = await fetchFn("/api/operation-mode/banner", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal,
        });
        if (signal?.aborted || response.status !== 200) {
          discardResponseBody(response);
          return null;
        }
        const payload = await readBannerPayload(response, signal);
        if (signal?.aborted) return null;
        return parseBannerSnapshot(payload);
      } catch {
        // Banner is optional public UX: a failed request does not block dashboard.
        return null;
      }
    },
  };
}

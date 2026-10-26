// MIG-0718 U01 (D-16-1): provisional read-only client while the MIG-0661 contract PR is unmerged.
// Replace the local shape/validator with @flamenode/contracts in U03 after MIG-0661 is DONE.
export type BannerMode = "economy" | "read_only" | "static_only" | "maintenance";
export type BannerSnapshot = { mode: BannerMode; reason: string | null };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const NON_NORMAL_MODES: ReadonlySet<string> = new Set([
  "economy", "read_only", "static_only", "maintenance",
]);
const MAX_REASON_CHARS = 2048; // Provisional cap aligned with the MIG-0661 implementation PR.
const MAX_BANNER_RESPONSE_BYTES = 16 * 1024; // Only a tiny {mode,reason} DTO is expected.

/** Bound streamed response bytes before JSON.parse. Content-Length is only an early
 * rejection, never relied on as a trusted size bound. Do not buffer 64KiB+ responses.
 */
async function readBannerPayload(response: Response, signal?: AbortSignal): Promise<unknown> {
  const announcedLength = response.headers.get("content-length");
  if (announcedLength !== null && /^\d+$/.test(announcedLength) &&
      Number(announcedLength) > MAX_BANNER_RESPONSE_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal?.aborted) return null;
      const { done, value } = await reader.read();
      if (signal?.aborted) return null;
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BANNER_RESPONSE_BYTES) return null;
      parts.push(decoder.decode(value, { stream: true }));
    }
    if (signal?.aborted) return null;
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } finally {
    // Also stop reading network data on oversized / aborted / malformed responses.
    try { await reader.cancel(); } catch { /* Reader may already be closed. */ }
    reader.releaseLock();
  }
}

function parseBannerSnapshot(raw: unknown): BannerSnapshot | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  // CURRENT never displays the banner for "normal" or an unavailable snapshot.
  if (typeof value.mode !== "string" || !NON_NORMAL_MODES.has(value.mode)) return null;
  if (value.reason !== null && (
    typeof value.reason !== "string" || value.reason.length > MAX_REASON_CHARS
  )) return null;
  return { mode: value.mode as BannerMode, reason: value.reason };
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
        if (signal?.aborted || response.status !== 200) return null;
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

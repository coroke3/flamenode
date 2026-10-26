// MIG-0718 U01 (D-16-1): provisional read-only client while the MIG-0661 contract PR is unmerged.
// Replace the local shape/validator with @flamenode/contracts in U03 after MIG-0661 is DONE.
export type BannerMode = "economy" | "read_only" | "static_only" | "maintenance";
export type BannerSnapshot = { mode: BannerMode; reason: string | null };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const NON_NORMAL_MODES: ReadonlySet<string> = new Set([
  "economy", "read_only", "static_only", "maintenance",
]);
const MAX_REASON_CHARS = 2048; // Provisional cap aligned with the MIG-0661 implementation PR.

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
        if (response.status !== 200) return null;
        return parseBannerSnapshot(await response.json());
      } catch {
        // Banner is optional public UX: a failed request does not block dashboard.
        return null;
      }
    },
  };
}

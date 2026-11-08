// MIG-0718 U03: consume the merged MIG-0661 public DTO, not a local approximation.
import {
  CostGuardBannerResponseSchema,
  type CostGuardBannerResponse,
} from "@flamenode/contracts";

export type BannerMode = Exclude<CostGuardBannerResponse["mode"], "normal">;
export type BannerSnapshot = Omit<CostGuardBannerResponse, "mode"> & { mode: BannerMode };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
        const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        // Only the JSON endpoint contract can drive a cost guard notice.
        // A proxy/error page containing JSON-shaped text must fail closed.
        if (response.status !== 200 || mime !== "application/json") return null;
        const raw = await response.json();
        if (signal?.aborted) return null;
        return parseBannerSnapshot(raw);
      } catch {
        // Banner is optional public UX: a failed request does not block dashboard.
        return null;
      }
    },
  };
}

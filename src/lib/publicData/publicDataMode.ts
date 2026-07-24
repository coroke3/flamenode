export type PublicDataMode =
  | "static"
  | "cached_static"
  | "degraded_d1"
  | "unavailable";

/** @deprecated Use `mode` on PublicJsonLoadResult. */
export type PublicJsonLegacySource = "static" | "miss";

export function toPublicJsonLegacySource(
  mode: PublicDataMode,
): PublicJsonLegacySource {
  return mode === "static" || mode === "cached_static" ? "static" : "miss";
}

export function isDegradedD1Mode(mode: PublicDataMode): boolean {
  return mode === "degraded_d1";
}

export function isPublicDataUnavailable(mode: PublicDataMode): boolean {
  return mode === "unavailable";
}

const MODE_RANK: Record<PublicDataMode, number> = {
  unavailable: 0,
  static: 1,
  cached_static: 2,
  degraded_d1: 3,
};

export function mergePublicDataMode(
  current: PublicDataMode | null | undefined,
  next: PublicDataMode,
): PublicDataMode {
  if (!current) return next;
  return MODE_RANK[next] > MODE_RANK[current] ? next : current;
}

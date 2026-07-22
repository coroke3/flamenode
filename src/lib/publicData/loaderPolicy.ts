import type { PublicDataStrategy } from "@/lib/operationMode/types";

/** static_only / maintenance では DB fallback を呼ばないこと。 */
export function canFallbackToDatabase(strategy: PublicDataStrategy): boolean {
  return strategy === "static_json_with_live_overlay";
}

/**
 * An empty cached collection can be stale after an import or bulk publish.
 * Overlay modes must treat it as a semantic miss so D1 remains the source of
 * truth. static_only and maintenance intentionally keep the cached result.
 */
export function shouldUseStaticCollection(
  strategy: PublicDataStrategy,
  itemCount: number,
): boolean {
  return itemCount > 0 || !canFallbackToDatabase(strategy);
}

export function isMaintenanceStrategy(strategy: PublicDataStrategy): boolean {
  return strategy === "maintenance";
}

import type { PublicDataStrategy } from "@/lib/operationMode/types";

/** static_only / maintenance では DB fallback を呼ばないこと。 */
export function canFallbackToDatabase(strategy: PublicDataStrategy): boolean {
  return strategy === "static_json_with_live_overlay";
}

export function isMaintenanceStrategy(strategy: PublicDataStrategy): boolean {
  return strategy === "maintenance";
}

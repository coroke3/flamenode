import type { OperationMode, PublicDataStrategy, StaticRebuildPolicy } from "./types";

export function getPublicDataStrategy(mode: OperationMode): PublicDataStrategy {
  if (mode === "maintenance") return "maintenance";
  if (mode === "static_only") return "static_json_only";
  return "static_json_with_live_overlay";
}

export function isWriteBlocked(mode: OperationMode): boolean {
  return mode === "read_only" || mode === "static_only" || mode === "maintenance";
}

export function isLiveApiEnabled(mode: OperationMode): boolean {
  return mode === "normal" || mode === "economy" || mode === "read_only";
}

export function isStaticRebuildEnabled(mode: OperationMode): boolean {
  return mode !== "maintenance";
}

export function getStaticRebuildPolicy(mode: OperationMode): StaticRebuildPolicy {
  switch (mode) {
    case "normal":
      return { maxItemsPerRun: 20, processSearchIndex: true, processListPopular: true, processAllTargets: true };
    case "economy":
      return { maxItemsPerRun: 5, processSearchIndex: false, processListPopular: false, processAllTargets: false };
    case "read_only":
      return { maxItemsPerRun: 10, processSearchIndex: false, processListPopular: false, processAllTargets: true };
    case "static_only":
      return { maxItemsPerRun: 5, processSearchIndex: false, processListPopular: false, processAllTargets: false };
    case "maintenance":
      return { maxItemsPerRun: 0, processSearchIndex: false, processListPopular: false, processAllTargets: false };
  }
}

export function isAdminBypassAllowed(mode: OperationMode): boolean {
  return mode === "maintenance";
}

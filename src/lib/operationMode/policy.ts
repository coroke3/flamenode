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
      return {
        maxItemsPerRun: 20,
        highPriorityOnly: false,
        allowedTargetTypes: null,
        skipTargetTypesUnlessHighPriority: [],
        reconcileStaleQueue: true,
      };
    case "economy":
      return {
        maxItemsPerRun: 5,
        highPriorityOnly: false,
        allowedTargetTypes: null,
        skipTargetTypesUnlessHighPriority: ["search_index", "list_popular"],
        reconcileStaleQueue: true,
      };
    case "read_only":
      return {
        maxItemsPerRun: 20,
        highPriorityOnly: false,
        allowedTargetTypes: ["event", "video", "user"],
        skipTargetTypesUnlessHighPriority: [],
        reconcileStaleQueue: false,
      };
    case "static_only":
      return {
        maxItemsPerRun: 20,
        highPriorityOnly: true,
        allowedTargetTypes: null,
        skipTargetTypesUnlessHighPriority: [],
        reconcileStaleQueue: false,
      };
    case "maintenance":
      return {
        maxItemsPerRun: 0,
        highPriorityOnly: true,
        allowedTargetTypes: [],
        skipTargetTypesUnlessHighPriority: [],
        reconcileStaleQueue: false,
      };
  }
}

export function isAdminBypassAllowed(mode: OperationMode): boolean {
  return mode === "maintenance";
}

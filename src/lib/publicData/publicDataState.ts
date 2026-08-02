import type { PublicDataMode } from "./publicDataMode";
import type { PublicStaticTargetProbe } from "./publicStaticTargetProbe";
import type { RebuildRequestState } from "../staticRebuild/types";

export type PublicDataState =
  | "ready"
  | "empty"
  | "stale"
  | "reflecting"
  | "unavailable"
  | "not_found";

export function resolvePublicDataState(args: {
  hasRenderableData: boolean;
  isEmptyCollection?: boolean;
  probe?: PublicStaticTargetProbe | null;
  enqueued: boolean;
  mode: PublicDataMode;
}): PublicDataState {
  if (args.hasRenderableData) {
    return args.isEmptyCollection ? "empty" : "ready";
  }
  if (args.mode === "degraded_d1") {
    return "ready";
  }
  if (args.probe?.state === "unknown") {
    return "unavailable";
  }
  if (args.probe?.state === "not_public" || args.probe?.state === "missing") {
    return "not_found";
  }
  if (args.probe?.state === "public" && args.enqueued) {
    return "reflecting";
  }
  if (args.mode === "unavailable") {
    return "unavailable";
  }
  if (args.enqueued) {
    return "reflecting";
  }
  return "unavailable";
}

export function rebuildStateFromEnqueue(args: {
  enqueued: boolean;
  rebuildState?: RebuildRequestState;
}): RebuildRequestState {
  if (args.rebuildState) return args.rebuildState;
  if (args.enqueued) return "requested";
  return "not_needed";
}

export function shouldPublicPageNotFound(state: PublicDataState): boolean {
  return state === "not_found";
}

export function shouldPublicPageShowReflection(state: PublicDataState): boolean {
  return state === "reflecting";
}

export function shouldPublicPageShowUnavailable(state: PublicDataState): boolean {
  return state === "unavailable";
}
